-- ============================================================
-- 101-clean-null-items.sql
-- 清理 daily_record.behavior.items 中的 null 元素 + 后端入口加固
-- 2026-11-02
--
-- 背景：教师端表现记录页面报错
--   TypeError: Cannot read properties of null (reading 'label')
--   at renderRecordCard (teacher.js)
-- 根因：历史 daily_record 的 behavior.items 数组中混入 JSON null
--   元素（旧版本客户端/旧合并逻辑残留），前端渲染读取 it.label
--   抛错，整个列表渲染中断、页面空白。
--
-- 本文件三部分（可重复执行）：
--   ① 验证：统计含 null 元素的记录数（先跑确认影响面）
--   ② 清理：去除所有 items 中的 JSON null 元素
--   ③ 加固：重写 submit_today（基于 100 号，新增 null 过滤；
--      合并旧记录时自动清掉历史 null；保留 100 号空拦截）
-- ============================================================

-- ------------------------------------------------------------
-- ① 验证：先看 items 字段的类型分布（标量记录是结构异常）
-- ------------------------------------------------------------
-- select jsonb_typeof(behavior->'items') as items类型, count(*)
--   from public.daily_record group by 1 order by 2 desc;
--
-- 含 null 元素的数组记录（先 SELECT 明细，再 count 看数量）：
-- select id, class, student_name, record_date
--   from public.daily_record
--  where jsonb_typeof(behavior->'items') = 'array'
--    and exists (
--        select 1 from jsonb_array_elements(behavior->'items') it
--         where it is not distinct from 'null'::jsonb);
-- select count(*) as 含null元素记录数
--   from public.daily_record
--  where jsonb_typeof(behavior->'items') = 'array'
--    and exists (
--        select 1 from jsonb_array_elements(behavior->'items') it
--         where it is not distinct from 'null'::jsonb);
--
-- 结构异常记录（items 不是数组：标量/缺失）：
-- select id, class, student_name, record_date, behavior->'items' as items
--   from public.daily_record
--  where jsonb_typeof(behavior->'items') is distinct from 'array';

-- ------------------------------------------------------------
-- ② 清理：去掉所有 behavior.items 中的 JSON null 元素
-- ------------------------------------------------------------
update public.daily_record dr
   set behavior = jsonb_set(
         coalesce(dr.behavior, '{}'::jsonb),
         '{items}',
         case
           when jsonb_typeof(dr.behavior->'items') = 'array' then
             coalesce((
                select jsonb_agg(it)
                  from jsonb_array_elements(dr.behavior->'items') it
                 where it is distinct from 'null'::jsonb
             ), '[]'::jsonb)
           else '[]'::jsonb
         end)
 where jsonb_typeof(dr.behavior->'items') is distinct from 'array'
    or (jsonb_typeof(dr.behavior->'items') = 'array'
        and exists (
          select 1 from jsonb_array_elements(dr.behavior->'items') it
           where it is not distinct from 'null'::jsonb));

-- 清理后复核（应返回 0）
-- select count(*) from public.daily_record
--  where exists (
--      select 1 from jsonb_array_elements(behavior->'items') it
--       where it is not distinct from 'null'::jsonb);

-- ------------------------------------------------------------
-- ③ 加固：重写 submit_today（100 号全部能力 + null 过滤）
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
    update public.daily_record
       set behavior=jsonb_build_object('mood',p_mood,'items',v_merged),
           semester=coalesce(v_old.semester,v_sem), create_at=now()
     where id=v_old.id returning id into v_rec_id;
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
-- ④ 重写 apply_record_xp 触发器函数：items 标量防御
--   非数组（标量/缺失）按空数组处理，防触发器展开报
--   22023 cannot extract elements from a scalar；加分逻辑不变
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
  v_delta  int := 0;
  v_delta_de  int := 0;
  v_delta_zhi int := 0;
  v_delta_ti  int := 0;
  v_delta_mei int := 0;
  v_delta_lao int := 0;
  v_xp     int;
begin
  v_rec := case when tg_op = 'DELETE' then old else new end;
  for v_item in
    select e ->> 'id' as tag_id, e ->> 'category' as category
    from jsonb_array_elements(
      case when jsonb_typeof(v_rec.behavior->'items') = 'array'
           then v_rec.behavior->'items' else '[]'::jsonb end) as e
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
