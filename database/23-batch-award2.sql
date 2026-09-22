-- ============================================================
-- 23-batch-award2.sql  批量打标签支持二级选项（如优秀数学作业）
-- 可重复执行。
--   batch_award_tag(班级, 日期数组, 学生数组, 标签id[uuid], 覆盖label[可空])
-- ============================================================

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
    foreach v_name in array p_students loop
      select coalesce(sum((it->>'score')::int),0) into v_sum_score
        from public.daily_record r,
             jsonb_array_elements(coalesce(r.behavior->'items','[]'::jsonb)) it
       where r.class=p_class and r.student_name=v_name and r.record_date=v_date;
      v_sum_score := v_sum_score + coalesce(v_tag.score,
                     case when v_tag.category='negative' then -1 else 1 end);
      v_mood_level := least(5, greatest(1, 3+v_sum_score));
      v_mood_key := (array['','sad','down','normal','good','happy'])[v_mood_level];

      insert into public.daily_record(class,student_name,record_date,self_evaluation,behavior)
      values (p_class,v_name,v_date,null,
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

grant execute on function public.batch_award_tag(text, date[], text[], uuid, text) to anon, authenticated;
