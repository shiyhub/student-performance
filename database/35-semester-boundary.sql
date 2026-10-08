-- ============================================================
-- 35-semester-boundary.sql  学期边界修正：以 2027-01-07 为界
-- ------------------------------------------------------------
-- 新口径（与 teacher.js semOf 一致）：
--   9月1日 ~ 次年1月7日  → 秋学期（2026-09-01 ~ 2027-01-07 → 2026秋）
--   1月8日 ~ 8月31日     → 春学期（2027-01-08 起 → 2027春）
-- 覆盖 34 号：batch_award_tag 按"记录日期"算学期（原按当前时间，批量补历史日期会写错）；
--            submit_today 按当天日期算。
-- 可重复执行（create or replace）。
-- ============================================================

-- ① 批量评价：按每条记录日期计算学期
create or replace function public.batch_award_tag(
  p_class     text,
  p_dates     date[],
  p_students  text[],
  p_tag_id    uuid,
  p_label     text default null
)
returns table(ok_count int, fail_count int, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_tag        record;
  v_date       date;
  v_name       text;
  v_sum_score  int;
  v_mood_level int;
  v_mood_key   text;
  v_sem        text;
  v_ok         int := 0;
  v_fail       int := 0;
  v_label      text;
begin
  select * into v_tag from public.behavior_tags where id = p_tag_id and is_active = true;
  if v_tag.id is null then raise exception '标签不存在或未启用'; end if;
  if p_class is null or coalesce(array_length(p_dates,1),0)=0
     or coalesce(array_length(p_students,1),0)=0 then
    raise exception '请选择班级、日期和学生';
  end if;
  v_label := coalesce(nullif(btrim(p_label),''), v_tag.label);

  foreach v_date in array p_dates loop
    v_sem := case
      when to_char(v_date,'MM-DD') >= '09-01' then to_char(v_date,'YYYY') || '秋'
      when to_char(v_date,'MM-DD') >= '01-08' then to_char(v_date,'YYYY') || '春'
      else to_char(v_date - interval '1 year','YYYY') || '秋'
    end;
    foreach v_name in array p_students loop
      select coalesce(sum((it->>'score')::int),0) into v_sum_score
        from public.daily_record r,
             jsonb_array_elements(coalesce(r.behavior->'items','[]'::jsonb)) it
       where r.class=p_class and r.student_name=v_name and r.record_date=v_date;
      v_sum_score := v_sum_score + coalesce(v_tag.score,
                     case when v_tag.category='negative' then -1 else 1 end);
      v_mood_level := least(5, greatest(1, 3+v_sum_score));
      v_mood_key := (array['','sad','down','normal','good','happy'])[v_mood_level];

      insert into public.daily_record(class,student_name,record_date,semester,self_evaluation,behavior)
      values (p_class,v_name,v_date,v_sem,null,
        jsonb_build_object('mood',v_mood_key,'items',
          jsonb_build_array(jsonb_build_object(
            'id',v_tag.id,'label',v_label,'type','check','value',null,
            'category',v_tag.category,
            'score',coalesce(v_tag.score,case when v_tag.category='negative' then -1 else 1 end),
            'xp',v_tag.xp_value,'by','teacher'))));
      v_ok := v_ok+1;
    end loop;
  end loop;
  ok_count := v_ok; fail_count := v_fail;
  message := '已批量写入 '||v_ok||' 条';
  return next;
end $$;

grant execute on function public.batch_award_tag(text,date[],text[],uuid,text) to anon, authenticated;

-- ② submit_today：按当天日期计算学期（其余逻辑与 34 号一致：跨天去重 + 新插入经验 + semester 写入）
create or replace function public.submit_today(
  p_class text, p_student text, p_mood text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_sem text := case
    when to_char(v_today,'MM-DD') >= '09-01' then to_char(v_today,'YYYY') || '秋'
    when to_char(v_today,'MM-DD') >= '01-08' then to_char(v_today,'YYYY') || '春'
    else to_char(v_today - interval '1 year','YYYY') || '秋'
  end;
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

  -- ② 当天已有记录：合并新增项
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
       set behavior=jsonb_build_object('mood',p_mood,'items',v_merged),
           semester=coalesce(v_old.semester,v_sem), create_at=now()
     where id=v_old.id returning id into v_rec_id;
    if v_delta<>0 then
      update public.student_info set xp=greatest(0,coalesce(xp,0)+v_delta),
        level=public.level_from_xp(greatest(0,coalesce(xp,0)+v_delta))
       where id=v_sid returning xp,level into v_xp;
    end if;
    return jsonb_build_object('ok',true,'merged',true,'xp_delta',v_delta,'xp',v_xp,'level',public.level_from_xp(v_xp));
  end if;

  -- ③ 当天无记录：新插入（带 semester），正确计算经验
  insert into public.daily_record(class,student_name,record_date,semester,self_evaluation,behavior)
  values (btrim(p_class),btrim(p_student),v_today,v_sem,null,jsonb_build_object('mood',p_mood,'items',p_items))
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
