-- ============================================================
-- 13-batch-award.sql  教师端：按标签批量给学生打表现
-- 可重复执行。
--   batch_award_tag(班级, 日期数组, 学生姓名数组, 标签id)
--   - 为每个学生×日期插入一条 daily_record，behavior.items 里带这一个标签
--   - XP 由现有触发器自动累加（按标签 xp_value）
--   - 心情按当天全部标签 score 汇总：3 起步，积极 +1，消极 -1，钳制 1~5
--   - 只有老师（已登录 Supabase Auth）能调用
-- ============================================================

create or replace function public.batch_award_tag(
  p_class     text,
  p_dates     date[],
  p_students  text[],
  p_tag_id    bigint
)
returns table(ok_count int, fail_count int, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag        record;
  v_date       date;
  v_name       text;
  v_sum_score  int;
  v_mood_level int;
  v_mood_key   text;
  v_ok         int := 0;
  v_fail       int := 0;
begin
  -- 必须是老师登录
  if auth.uid() is null then
    raise exception '请先以老师身份登录';
  end if;

  select * into v_tag from public.behavior_tags where id = p_tag_id and is_active = true;
  if v_tag.id is null then
    raise exception '标签不存在或未启用';
  end if;

  if p_class is null or coalesce(array_length(p_dates,1),0) = 0
     or coalesce(array_length(p_students,1),0) = 0 then
    raise exception '请选择班级、日期和学生';
  end if;

  foreach v_date in array p_dates loop
    foreach v_name in array p_students loop
      -- 汇总该学生当天已有记录的 score（积极+1 / 消极-1）
      select coalesce(sum((it ->> 'score')::int), 0) into v_sum_score
        from public.daily_record r,
             jsonb_array_elements(coalesce(r.behavior -> 'items', '[]'::jsonb)) as it
       where r.class = p_class
         and r.student_name = v_name
         and r.record_date = v_date;

      -- 加上本次这一条
      v_sum_score := v_sum_score + coalesce(v_tag.score, case when v_tag.category = 'negative' then -1 else 1 end);
      v_mood_level := least(5, greatest(1, 3 + v_sum_score));
      v_mood_key := (array['','sad','down','normal','good','happy'])[v_mood_level];

      insert into public.daily_record(class, student_name, record_date, self_evaluation, behavior)
      values (
        p_class, v_name, v_date, null,
        jsonb_build_object(
          'mood', v_mood_key,
          'items', jsonb_build_array(jsonb_build_object(
            'id', v_tag.id,
            'label', v_tag.label,
            'type', 'check',
            'value', null,
            'category', v_tag.category,
            'score', coalesce(v_tag.score, case when v_tag.category = 'negative' then -1 else 1 end),
            'xp', v_tag.xp_value,
            'by', 'teacher'
          ))
        )
      );
      v_ok := v_ok + 1;
    end loop;
  end loop;

  ok_count := v_ok; fail_count := v_fail;
  message := '已批量写入 ' || v_ok || ' 条';
  return next;
end;
$$;

-- 老师调用权限（service role 绕过；这里限制任何已登录老师可调用）
grant execute on function public.batch_award_tag(text, date[], text[], bigint) to authenticated;
