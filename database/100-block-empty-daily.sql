-- ============================================================
-- 100-block-empty-daily.sql
-- 空日常表现后端兜底拦截（现有功能不变，纯增强）
-- 2026-10-30
--
-- 背景：93 号 submit_today 不检查空 items，空记录可被
--   旧客户端 / 离线队列历史空操作 / 直接 RPC 绕过前端写入。
--
-- 修复：在「历史唯一去重之后、合并/插入之前」检查最终 items，
--   为空直接返回 {ok:false,reason:'empty_items'}，不写任何记录。
--   覆盖两类空：
--     ① 原始 p_items 就是空数组；
--     ② 提交项全部是历史已存在的唯一标签，去重后被过滤为空。
--
-- 离线队列：RPC 正常返回（HTTP 200，ok:false），syncRunner 视为
--   同步成功 → 历史空操作安全出队，不再反复重试，也不产生空记录。
--
-- 可重复执行。仅重写 submit_today，其他函数/触发器不变。
-- ============================================================

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
  v_old_de int := 0; v_old_zhi int := 0; v_old_ti int := 0; v_old_mei int := 0; v_old_lao int := 0;
  v_new_de int := 0; v_new_zhi int := 0; v_new_ti int := 0; v_new_mei int := 0; v_new_lao int := 0;
  v_lbl text; v_dim2 text;
begin
  -- 加行锁：同一学生当天提交串行化（防并发双计）
  select id, xp into v_sid, v_xp from public.student_info
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) limit 1 for update;
  if v_sid is null then return jsonb_build_object('ok',false,'reason','no_student'); end if;
  p_items := coalesce(p_items,'[]'::jsonb);
  for v_it in select * from jsonb_array_elements(p_items) loop
    select bt.history_unique is not false into v_unique
      from public.behavior_tags bt where bt.id::text=(v_it->>'id');
    if coalesce(v_unique, false) then
      if exists (
        select 1 from public.daily_record dr,
             lateral jsonb_array_elements(coalesce(dr.behavior->'items','[]'::jsonb)) di
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

  -- ★ 100 号新增：空表现兜底拦截（原始为空 / 去重后为空都在此挡住）
  if coalesce(jsonb_array_length(p_items), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_items');
  end if;

  select * into v_old from public.daily_record
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) and record_date=v_today;
  if v_old.id is not null then
    -- 合并路径：先检测提交项异常（标签已删/经验值误配）
    perform public.log_item_anomalies(btrim(p_class), btrim(p_student), v_today, 'daily', p_items);
    for v_it in select * from jsonb_array_elements(coalesce(v_old.behavior->'items','[]'::jsonb)) loop
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
    v_merged := coalesce(v_old.behavior->'items','[]'::jsonb) || p_items;
    select jsonb_agg(distinct it) into v_merged from (select it from jsonb_array_elements(v_merged) it) x;
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

-- 授权（与 93 号一致）
revoke execute on function public.submit_today(text,text,text,jsonb) from anon;
grant  execute on function public.submit_today(text,text,text,jsonb) to authenticated;

-- ============================================================
-- 验证（手动 RPC，替换班级/姓名；空提交应返回 ok:false reason:empty_items）
-- ============================================================
-- select public.submit_today('六年级一班','杨鑫','normal','[]'::jsonb);
-- 期望：{"ok": false, "reason": "empty_items"}，且 daily_record 无新增
