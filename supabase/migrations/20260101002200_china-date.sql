-- ============================================================
-- 22-china-date.sql  统一按北京时间算"今天"，修复凌晨提交日期错位
-- 可重复执行。
-- ============================================================

-- 提交合并 RPC：用北京时间的当天日期
create or replace function public.submit_today(
  p_class text, p_student text, p_mood text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_sid uuid; v_xp int; v_old public.daily_record%rowtype;
  v_old_xp int := 0; v_new_xp int; v_delta int; v_merged jsonb; v_it jsonb; v_tag_xp int; v_rec_id uuid;
begin
  select id, xp into v_sid, v_xp from public.student_info
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) limit 1;
  if v_sid is null then return jsonb_build_object('ok',false,'reason','no_student'); end if;
  p_items := coalesce(p_items,'[]'::jsonb);

  select * into v_old from public.daily_record
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) and record_date=v_today;

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

  insert into public.daily_record(class,student_name,record_date,self_evaluation,behavior)
  values (btrim(p_class),btrim(p_student),v_today,null,jsonb_build_object('mood',p_mood,'items',p_items))
  returning id into v_rec_id;
  select xp,level into v_xp from public.student_info where id=v_sid;
  return jsonb_build_object('ok',true,'merged',false,'xp_delta',0,'xp',v_xp,'level',public.level_from_xp(v_xp));
end; $$;

grant execute on function public.submit_today(text,text,text,jsonb) to anon, authenticated;
