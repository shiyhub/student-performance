-- ============================================================
-- 102-fix-record-update-xp.sql
-- v161：修复「教师端编辑日常表现记录后，经验/等级不重算」（④）
-- 根因：
--   教师端「修改记录」走 daily_record UPDATE；92 号收敛后的触发器只有
--   INSERT/DELETE 两个（trg_apply_record_xp_ins/_del），UPDATE 无触发。
--   教师编辑表现项（增删标签/改分值/换评语档）后，student_info.xp 与
--   level 保持旧值 →「操作（改记录）↔ 显示（经验/等级）」不一致。
--   注：教师端另一处「只改教师评语」的 UPDATE 不含 behavior 列，不受影响。
-- 修复：
--   ① 重写 apply_record_xp：新增 TG_OP='UPDATE' 分支——
--      经验差 = 新 items 应得 − 旧 items 应得（含五维与等级重算，负值截断仍上报）；
--      UPDATE 时同步重建该记录 daily 流水（先删后按新 items 幂等写入，
--      与 submit_today 同口径：仅正经验项、label 带「：值」后缀）；
--      恢复 93 号「DELETE 清流水 / 负截断上报」（101 号重写时遗漏）；
--      沿用 101 号 items 标量防御，并对 JSON null 项统一跳过（防默认 +2 虚计）。
--   ② 新增 UPDATE 触发器 trg_apply_record_xp_upd（AFTER UPDATE OF behavior），
--      并幂等重建 INS/DEL（任何执行顺序只有一套加分触发器，防双计）。
--   ③ submit_today 合并写回路径自行管理增量：经会话标记
--      app.skip_record_xp（事务级）跳过触发器，防 UPDATE 双计。
--      本文件内 submit_today 为 101 号逐字版本 + 该标记（无其他改动）。
-- 可重复执行。
-- 自检：见文件尾。
-- ============================================================

-- ------------------------------------------------------------
-- ① 重写 submit_today（101 号全部能力 + null 过滤 + ④(102) 合并跳过标记）
-- ------------------------------------------------------------
create or replace function public.submit_today(p_class text, p_student text, p_mood text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_sem text := case
    when to_char(v_today,'MM-DD') >= '09-01' then to_char(v_today,'YYYY') || '秋'
    when to_char(v_today,'MM-DD') >= '01-08' then to_char(v_today,'YYYY') || '春'
    else to_char(v_today - interval '1 year','YYYY') || '秋'
  end;
  v_sid uuid; v_xp int; v_xp_before int; v_old public.daily_record%rowtype;
  v_old_xp int := 0; v_new_xp int; v_delta int; v_merged jsonb; v_it jsonb; v_tag_xp int; v_dim text; v_rec_id uuid;
  v_items jsonb := '[]'::jsonb; v_unique boolean;
  v_old_items jsonb;  -- 101 号：历史 items 归一化（非数组按空数组处理）
  v_old_de int := 0; v_old_zhi int := 0; v_old_ti int := 0; v_old_mei int := 0; v_old_lao int := 0;
  v_new_de int := 0; v_new_zhi int := 0; v_new_ti int := 0; v_new_mei int := 0; v_new_lao int := 0;
  v_lbl text; v_dim2 text;
begin
  -- 加行锁：同一学生当天提交串行化（防并发双计）
  select id, xp into v_sid, v_xp from public.student_info
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) limit 1 for update;
  if v_sid is null then return jsonb_build_object('ok',false,'reason','no_student'); end if;

  -- ★ 101 号新增：入口先过滤 JSON null 元素（防旧客户端/脏数据进入）
  -- 非数组（标量/缺失）一律按空数组处理，防 cannot extract elements from a scalar
  p_items := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  select coalesce(jsonb_agg(it), '[]'::jsonb) into p_items
    from jsonb_array_elements(p_items) it
   where it is distinct from 'null'::jsonb;

  for v_it in select * from jsonb_array_elements(p_items) loop
    select bt.history_unique is not false into v_unique
      from public.behavior_tags bt where bt.id::text=(v_it->>'id');
    if coalesce(v_unique, false) then
      if exists (
        select 1 from public.daily_record dr,
             lateral jsonb_array_elements(
               case when jsonb_typeof(dr.behavior->'items') = 'array'
                    then dr.behavior->'items' else '[]'::jsonb end) di
         where dr.class = btrim(p_class)
           and dr.student_name = btrim(p_student)
           and di->>'id' = (v_it->>'id')
           and di->>'value' = (v_it->>'value')
      ) then
        continue;
      end if;
    end if;
    v_items := v_items || jsonb_build_array(v_it);
  end loop;
  p_items := v_items;

  -- 100 号空拦截：空表现兜底（原始为空 / 去重后为空都挡住）
  if coalesce(jsonb_array_length(p_items), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_items');
  end if;

  select * into v_old from public.daily_record
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) and record_date=v_today;
  if v_old.id is not null then
    -- 101 号：历史 items 归一化（标量/缺失按空数组），防展开标量报错
    v_old_items := case when jsonb_typeof(v_old.behavior->'items') = 'array'
                        then v_old.behavior->'items' else '[]'::jsonb end;
    -- 合并路径：先检测提交项异常（标签已删/经验值误配）
    perform public.log_item_anomalies(btrim(p_class), btrim(p_student), v_today, 'daily', p_items);
    for v_it in select * from jsonb_array_elements(v_old_items) loop
      continue when v_it is not distinct from 'null'::jsonb;  -- 101 号：跳过历史 null 元素，防旧经验被默认误算
      v_tag_xp := null;
      select xp_value into v_tag_xp from public.behavior_tags where id::text=(v_it->>'id');
      if v_tag_xp is null then v_tag_xp := case when (v_it->>'category')='negative' then 0 else 2 end; end if;
      v_old_xp := v_old_xp + coalesce(v_tag_xp,0);
      v_dim := null;
      select coalesce(nullif(dim,''),'zhi') into v_dim from public.behavior_tags where id::text=(v_it->>'id');
      if v_dim is null then v_dim := 'zhi'; end if;
      case v_dim
        when 'de'  then v_old_de  := v_old_de  + coalesce(v_tag_xp,0);
        when 'ti'  then v_old_ti  := v_old_ti  + coalesce(v_tag_xp,0);
        when 'mei' then v_old_mei := v_old_mei + coalesce(v_tag_xp,0);
        when 'lao' then v_old_lao := v_old_lao + coalesce(v_tag_xp,0);
        else            v_old_zhi := v_old_zhi + coalesce(v_tag_xp,0);
      end case;
    end loop;
    v_merged := v_old_items || p_items;
    -- ★ 101 号：合并时同时过滤旧数组中的历史 null，并 coalesce 防聚合空结果
    select coalesce(jsonb_agg(distinct it), '[]'::jsonb) into v_merged
      from (select it from jsonb_array_elements(v_merged) it
             where it is distinct from 'null'::jsonb) x;
    v_new_xp := 0;
    for v_it in select * from jsonb_array_elements(v_merged) loop
      v_tag_xp := null;
      select xp_value into v_tag_xp from public.behavior_tags where id::text=(v_it->>'id');
      if v_tag_xp is null then v_tag_xp := case when (v_it->>'category')='negative' then 0 else 2 end; end if;
      v_new_xp := v_new_xp + coalesce(v_tag_xp,0);
      v_dim := null;
      select coalesce(nullif(dim,''),'zhi') into v_dim from public.behavior_tags where id::text=(v_it->>'id');
      if v_dim is null then v_dim := 'zhi'; end if;
      case v_dim
        when 'de'  then v_new_de  := v_new_de  + coalesce(v_tag_xp,0);
        when 'ti'  then v_new_ti  := v_new_ti  + coalesce(v_tag_xp,0);
        when 'mei' then v_new_mei := v_new_mei + coalesce(v_tag_xp,0);
        when 'lao' then v_new_lao := v_new_lao + coalesce(v_tag_xp,0);
        else            v_new_zhi := v_new_zhi + coalesce(v_tag_xp,0);
      end case;
    end loop;
    v_delta := v_new_xp - v_old_xp;
    -- ④(102)：合并写回前打会话标记 → UPDATE 触发器跳过（本路径自行管理增量，防双计）
    perform set_config('app.skip_record_xp', 'on', true);
    update public.daily_record
       set behavior=jsonb_build_object('mood',p_mood,'items',v_merged),
           semester=coalesce(v_old.semester,v_sem), create_at=now()
     where id=v_old.id returning id into v_rec_id;
    perform set_config('app.skip_record_xp', 'off', true);
    if v_delta<>0 then
      update public.student_info
         set xp     = greatest(0,coalesce(xp,0)+v_delta),
             xp_de  = greatest(0,coalesce(xp_de,0) + (v_new_de  - v_old_de)),
             xp_zhi = greatest(0,coalesce(xp_zhi,0)+ (v_new_zhi - v_old_zhi)),
             xp_ti  = greatest(0,coalesce(xp_ti,0) + (v_new_ti  - v_old_ti)),
             xp_mei = greatest(0,coalesce(xp_mei,0)+ (v_new_mei - v_old_mei)),
             xp_lao = greatest(0,coalesce(xp_lao,0)+ (v_new_lao - v_old_lao)),
             level  = public.level_from_xp(greatest(0,coalesce(xp,0)+v_delta))
       where id=v_sid returning xp into v_xp;
    end if;
    -- 实时流水：按合并后逐项写入（幂等 upsert，改分/改评后自动同步）
    for v_it in select * from jsonb_array_elements(v_merged) loop
      select t.xp_value, coalesce(nullif(t.dim,''),'zhi'), t.label
        into v_tag_xp, v_dim2, v_lbl from public.behavior_tags t where t.id::text=(v_it->>'id');
      if v_tag_xp is null then v_tag_xp := case when (v_it->>'category')='negative' then 0 else 2 end; v_dim2 := 'zhi'; v_lbl := (v_it->>'id'); end if;
      if coalesce(v_tag_xp,0) > 0 then
        insert into public.xp_log (class,student_name,source,ref_id,label,dim,xp,record_date)
        values (btrim(p_class),btrim(p_student),'daily',v_rec_id,
                v_lbl || case when coalesce(v_it->>'value','') <> '' then '：'||(v_it->>'value') else '' end,
                v_dim2, v_tag_xp, v_today)
        on conflict (source, ref_id, label) do update set xp = excluded.xp, dim = excluded.dim;
      end if;
    end loop;
    return jsonb_build_object('ok',true,'merged',true,'xp_delta',v_delta,'xp',v_xp,'level',public.level_from_xp(v_xp));
  end if;
  -- 新插入路径：先检测提交项异常（标签已删/经验值误配）
  perform public.log_item_anomalies(btrim(p_class), btrim(p_student), v_today, 'daily', p_items);
  select xp into v_xp_before from public.student_info where id = v_sid;
  insert into public.daily_record(class,student_name,record_date,semester,self_evaluation,behavior)
  values (btrim(p_class),btrim(p_student),v_today,v_sem,null,jsonb_build_object('mood',p_mood,'items',p_items))
  returning id into v_rec_id;
  v_new_xp := 0;
  for v_it in select * from jsonb_array_elements(p_items) loop
    v_tag_xp := null;
    select xp_value into v_tag_xp from public.behavior_tags where id::text=(v_it->>'id');
    if v_tag_xp is null then v_tag_xp := case when (v_it->>'category')='negative' then 0 else 2 end; end if;
    v_new_xp := v_new_xp + coalesce(v_tag_xp,0);
  end loop;
  select xp into v_xp from public.student_info where id = v_sid;
  -- 增量校验：实际增量应等于标签应得（防双计/漏计回归）
  if (v_xp - v_xp_before) <> v_new_xp then
    perform public.log_xp_anomaly(btrim(p_class), btrim(p_student), v_today, 'daily', 'xp_mismatch',
      '提交后经验增量与标签应得不符（疑似加分链路异常：双计或漏计）',
      jsonb_build_object('expected', v_new_xp, 'actual', v_xp - v_xp_before, 'record_id', v_rec_id));
  end if;
  -- 实时流水：逐项写入（幂等）
  for v_it in select * from jsonb_array_elements(p_items) loop
    select t.xp_value, coalesce(nullif(t.dim,''),'zhi'), t.label
      into v_tag_xp, v_dim2, v_lbl from public.behavior_tags t where t.id::text=(v_it->>'id');
    if v_tag_xp is null then v_tag_xp := case when (v_it->>'category')='negative' then 0 else 2 end; v_dim2 := 'zhi'; v_lbl := (v_it->>'id'); end if;
    if coalesce(v_tag_xp,0) > 0 then
      insert into public.xp_log (class,student_name,source,ref_id,label,dim,xp,record_date)
      values (btrim(p_class),btrim(p_student),'daily',v_rec_id,
              v_lbl || case when coalesce(v_it->>'value','') <> '' then '：'||(v_it->>'value') else '' end,
              v_dim2, v_tag_xp, v_today)
      on conflict (source, ref_id, label) do update set xp = excluded.xp, dim = excluded.dim;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'merged',false,'xp_delta',v_new_xp,'xp',v_xp,'level',public.level_from_xp(v_xp));
end; $function$;

-- 授权（与 100 号一致）
revoke execute on function public.submit_today(text,text,text,jsonb) from anon;
grant  execute on function public.submit_today(text,text,text,jsonb) to authenticated;

-- ------------------------------------------------------------
-- ② 重写 apply_record_xp 触发器函数：
--    93 号全特性（DELETE 清流水/负截断上报）+ 101 号 items 标量防御
--    + ④(102) 新增 UPDATE 分支（新−旧经验差，含五维/等级重算、流水重建）
--    对 JSON null 项统一跳过（防默认 +2 虚计，与 101 号 submit_today 同口径）
-- ------------------------------------------------------------
create or replace function public.apply_record_xp()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rec    record;
  v_item   record;
  v_tag_xp int;
  v_dim    text;
  v_lbl    text;
  v_delta  int := 0;
  v_delta_de  int := 0;
  v_delta_zhi int := 0;
  v_delta_ti  int := 0;
  v_delta_mei int := 0;
  v_delta_lao int := 0;
  v_xp     int;
begin
  -- ④(102)：submit_today 合并写回自行管理增量 → 会话标记跳过，防 UPDATE 双计
  if tg_op = 'UPDATE' and current_setting('app.skip_record_xp', true) = 'on' then
    return new;
  end if;

  v_rec := case when tg_op = 'DELETE' then old else new end;

  -- 新 items 应得（UPDATE 时为新值；INSERT/DELETE 时即记录本身；跳过 JSON null 项）
  for v_item in
    select e ->> 'id' as tag_id, e ->> 'category' as category
    from jsonb_array_elements(
      case when jsonb_typeof(v_rec.behavior->'items') = 'array'
           then v_rec.behavior->'items' else '[]'::jsonb end) as e
    where e is distinct from 'null'::jsonb
  loop
    select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi')
      into v_tag_xp, v_dim
      from public.behavior_tags t
     where t.id::text = v_item.tag_id;
    if v_tag_xp is null then
      v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
    end if;
    if v_dim is null then v_dim := 'zhi'; end if;
    v_delta := v_delta + coalesce(v_tag_xp, 0);
    case v_dim
      when 'de'  then v_delta_de  := v_delta_de  + coalesce(v_tag_xp, 0);
      when 'ti'  then v_delta_ti  := v_delta_ti  + coalesce(v_tag_xp, 0);
      when 'mei' then v_delta_mei := v_delta_mei + coalesce(v_tag_xp, 0);
      when 'lao' then v_delta_lao := v_delta_lao + coalesce(v_tag_xp, 0);
      else            v_delta_zhi := v_delta_zhi + coalesce(v_tag_xp, 0);
    end case;
  end loop;

  -- ④(102)：UPDATE = 新 items 应得 − 旧 items 应得
  if tg_op = 'UPDATE' then
    for v_item in
      select e ->> 'id' as tag_id, e ->> 'category' as category
      from jsonb_array_elements(
        case when jsonb_typeof(old.behavior->'items') = 'array'
             then old.behavior->'items' else '[]'::jsonb end) as e
      where e is distinct from 'null'::jsonb
    loop
      select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi')
        into v_tag_xp, v_dim
        from public.behavior_tags t
       where t.id::text = v_item.tag_id;
      if v_tag_xp is null then
        v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
      end if;
      if v_dim is null then v_dim := 'zhi'; end if;
      v_delta := v_delta - coalesce(v_tag_xp, 0);
      case v_dim
        when 'de'  then v_delta_de  := v_delta_de  - coalesce(v_tag_xp, 0);
        when 'ti'  then v_delta_ti  := v_delta_ti  - coalesce(v_tag_xp, 0);
        when 'mei' then v_delta_mei := v_delta_mei - coalesce(v_tag_xp, 0);
        when 'lao' then v_delta_lao := v_delta_lao - coalesce(v_tag_xp, 0);
        else            v_delta_zhi := v_delta_zhi - coalesce(v_tag_xp, 0);
      end case;
    end loop;
  end if;

  -- 对账闭环：删除记录清流水；编辑记录重建流水（与最新 items 一致，仅记正经验项）
  if tg_op = 'DELETE' then
    delete from public.xp_log where ref_id = v_rec.id and source = 'daily';
  end if;
  if tg_op = 'UPDATE' then
    delete from public.xp_log where ref_id = new.id and source = 'daily';
    for v_item in
      select e ->> 'id' as tag_id, e ->> 'value' as tag_value, e ->> 'category' as category
      from jsonb_array_elements(
        case when jsonb_typeof(new.behavior->'items') = 'array'
             then new.behavior->'items' else '[]'::jsonb end) as e
      where e is distinct from 'null'::jsonb
    loop
      v_tag_xp := null; v_dim := 'zhi'; v_lbl := v_item.tag_id;
      select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi'), t.label
        into v_tag_xp, v_dim, v_lbl
        from public.behavior_tags t where t.id::text = v_item.tag_id;
      if v_tag_xp is null then
        v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
      end if;
      if coalesce(v_tag_xp, 0) > 0 then
        insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
        values (new.class, new.student_name, 'daily', new.id,
                v_lbl || case when coalesce(v_item.tag_value, '') <> '' then '：' || v_item.tag_value else '' end,
                v_dim, v_tag_xp, new.record_date)
        on conflict (source, ref_id, label) do update set xp = excluded.xp, dim = excluded.dim;
      end if;
    end loop;
  end if;

  if coalesce(v_delta, 0) = 0 then
    return v_rec;
  end if;

  if tg_op = 'DELETE' then
    v_delta := -v_delta;
    v_delta_de  := -v_delta_de;
    v_delta_zhi := -v_delta_zhi;
    v_delta_ti  := -v_delta_ti;
    v_delta_mei := -v_delta_mei;
    v_delta_lao := -v_delta_lao;
  end if;

  -- 负截断检测（扣减致负 → 上报，避免静默截断）
  if v_delta < 0 then
    select coalesce(xp, 0) into v_xp from public.student_info
     where class = v_rec.class and student_name = v_rec.student_name;
    if coalesce(v_xp, 0) + v_delta < 0 then
      perform public.log_xp_anomaly(v_rec.class, v_rec.student_name,
        (v_rec.record_date)::date, 'daily', 'negative_clip',
        '扣减将导致经验为负（已自动截断为 0，请核对扣减来源）',
        jsonb_build_object('before', v_xp, 'delta', v_delta, 'tg_op', tg_op));
    end if;
  end if;

  update public.student_info
     set xp     = greatest(0, coalesce(xp, 0)     + v_delta),
         xp_de  = greatest(0, coalesce(xp_de, 0)  + v_delta_de),
         xp_zhi = greatest(0, coalesce(xp_zhi, 0) + v_delta_zhi),
         xp_ti  = greatest(0, coalesce(xp_ti, 0)  + v_delta_ti),
         xp_mei = greatest(0, coalesce(xp_mei, 0) + v_delta_mei),
         xp_lao = greatest(0, coalesce(xp_lao, 0) + v_delta_lao)
   where class = v_rec.class
     and student_name = v_rec.student_name
  returning xp into v_xp;

  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp)
     where class = v_rec.class
       and student_name = v_rec.student_name;
  end if;
  return v_rec;
end;
$function$;

-- ---------- ③ 幂等重建一套触发器（INS/DEL/UPD，任何执行顺序只有一套） ----------
drop trigger if exists trg_apply_record_xp     on public.daily_record;
drop trigger if exists trg_apply_record_xp_ins on public.daily_record;
drop trigger if exists trg_apply_record_xp_del on public.daily_record;
drop trigger if exists trg_apply_record_xp_upd on public.daily_record;

create trigger trg_apply_record_xp_ins after insert on public.daily_record
  for each row execute function public.apply_record_xp();
create trigger trg_apply_record_xp_del after delete on public.daily_record
  for each row execute function public.apply_record_xp();
create trigger trg_apply_record_xp_upd after update of behavior on public.daily_record
  for each row execute function public.apply_record_xp();
-- ---------- 自检 ----------
-- ① 触发器应只剩一套三个：
--    select tgname from pg_trigger
--     where tgrelid='public.daily_record'::regclass and not tgisinternal;
--    -- 期望：trg_apply_record_xp_ins / trg_apply_record_xp_del / trg_apply_record_xp_upd
-- ② 教师编辑记录后经验/等级重算（示例）：
--    -- 原 items 应得 4 分、编辑后 6 分：
--    update public.daily_record
--       set behavior=jsonb_build_object('mood','normal','items',
--             '[{"id":"<标签A>","value":"良好"}]'::jsonb)
--     where id='<记录id>';
--    -- 期望：student_info.xp +2、level 按新 xp 同步重算、xp_log 按新 items 重建
-- ③ submit_today 合并提交不再双计：学生端当天第二次提交，xp 增量只记新项一次
-- ④ 历史已被编辑污染（未重算）的记录，可事后校准：
--    select * from public.recalc_all_xp();   -- 86 号，按四大渠道真实值重放
