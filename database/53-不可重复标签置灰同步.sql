-- ============================================================
-- 53-tag-done-sync.sql  不可重复标签学生端同步置灰（教师批量评价）
-- ------------------------------------------------------------
-- 背景：教师「一键批量评价」写入 daily_record 时 item.value 固定为 null，
--       学生端 loadDoneItems 以 `if (it.value)` 过滤，导致：
--         ① 教师批量评价的「不可重复」标签，学生端不置灰；
--         ② 无二级项的一级「不可重复」标签，任何路径都不置灰。
-- 修复：
--   1.（SQL 侧，本迁移）batch_award_tag 把选中的二级项写入 value
--      —— 学生端可精确置灰该二级项；未选二级项时保持 null（整标签置灰）；
--   2.（前端侧，随学生端更新包）student.js 置灰逻辑改为"出现过即置灰"：
--      value 为空（教师批量/一级标签）以 null 标记 → 整标签置灰；
--      value 非空 → 仅置灰该具体二级项。
-- 可重复执行（create or replace）。
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
            'id',v_tag.id,'label',v_label,'type','check',
            -- v53：选中的二级项写入 value（精确置灰）；未选二级项保持 null（整标签置灰）
            'value', case when nullif(btrim(p_label),'') is not null then v_label else null end,
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
