-- ============================================================
-- 33-submit-dedupe.sql  submit_today 跨天去重 + 新插入经验修正
-- ------------------------------------------------------------
-- 1) 历史唯一标签（history_unique 非 false）：历史任意日期已打过
--    同"标签+具体项" → 本次提交直接跳过，不插入、不计经验。
--    彻底杜绝"昨天填过、今天再填同样内容还加分"（即使前端置灰被绕过）。
-- 2) 修复：当天无记录首次插入时正确计算经验并累加到学生（原实现返回 xp_delta=0）。
-- 可重复执行（create or replace）。
-- ============================================================

create or replace function public.submit_today(
  p_class text, p_student text, p_mood text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_sid uuid; v_xp int; v_old public.daily_record%rowtype;
  v_old_xp int := 0; v_new_xp int; v_delta int; v_merged jsonb; v_it jsonb; v_tag_xp int; v_rec_id uuid;
  v_items jsonb := '[]'::jsonb; v_unique boolean;
begin
  select id, xp into v_sid, v_xp from public.student_info
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) limit 1;
  if v_sid is null then return jsonb_build_object('ok',false,'reason','no_student'); end if;
  p_items := coalesce(p_items,'[]'::jsonb);

  -- ① 跨天去重：历史唯一标签，历史任意日期已打过同 id+value → 跳过
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

  select * into v_old from public.daily_record
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) and record_date=v_today;

  -- ② 当天已有记录：合并新增项（跨天去重后 p_items 已过滤）
  if v_old.id is not null then
    for v_it in select * from jsonb_array_elements(coalesce(v_old.behavior->'items','[]'::jsonb)) loop
      select coalesce(xp_value, case when (v_it->>'category')='negative' then 0 else 2 end) into v_tag_xp
        from public.behavior_tags where id::text=(v_it->>'id');
      v_old_xp := v_old_xp + coalesce(v_tag_xp,0);
    end loop;
    v_merged := coalesce(v_old.behavior->'items','[]'::jsonb) || p_items;
    select jsonb_agg(distinct it) into v_merged from (select it from jsonb_array_elements(v_merged) it) x;
    v_new_xp := 0;
    for v_it in select * from jsonb_array_elements(v_merged) loop
      select coalesce(xp_value, case when (v_it->>'category')='negative' then 0 else 2 end) into v_tag_xp
        from public.behavior_tags where id::text=(v_it->>'id');
      v_new_xp := v_new_xp + coalesce(v_tag_xp,0);
    end loop;
    v_delta := v_new_xp - v_old_xp;
    update public.daily_record
       set behavior=jsonb_build_object('mood',p_mood,'items',v_merged), create_at=now()
     where id=v_old.id returning id into v_rec_id;
    if v_delta<>0 then
      update public.student_info set xp=greatest(0,coalesce(xp,0)+v_delta),
        level=public.level_from_xp(greatest(0,coalesce(xp,0)+v_delta))
       where id=v_sid returning xp,level into v_xp;
    end if;
    return jsonb_build_object('ok',true,'merged',true,'xp_delta',v_delta,'xp',v_xp,'level',public.level_from_xp(v_xp));
  end if;

  -- ③ 当天无记录：新插入，并正确计算经验
  insert into public.daily_record(class,student_name,record_date,self_evaluation,behavior)
  values (btrim(p_class),btrim(p_student),v_today,null,jsonb_build_object('mood',p_mood,'items',p_items))
  returning id into v_rec_id;
  v_new_xp := 0;
  for v_it in select * from jsonb_array_elements(p_items) loop
    select coalesce(xp_value, case when (v_it->>'category')='negative' then 0 else 2 end) into v_tag_xp
      from public.behavior_tags where id::text=(v_it->>'id');
    v_new_xp := v_new_xp + coalesce(v_tag_xp,0);
  end loop;
  update public.student_info set xp=greatest(0,coalesce(xp,0)+v_new_xp),
    level=public.level_from_xp(greatest(0,coalesce(xp,0)+v_new_xp))
   where id=v_sid returning xp,level into v_xp;
  return jsonb_build_object('ok',true,'merged',false,'xp_delta',v_new_xp,'xp',v_xp,'level',public.level_from_xp(v_xp));
end; $$;

grant execute on function public.submit_today(text,text,text,jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
