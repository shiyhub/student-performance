-- ============================================================
-- 127-task-grade-star.sql
-- 每日任务星光值：按完成等级改为一组固定值
--
--   未完成 none    → 0
--   完成   done    → 2
--   优秀A  good    → 4
--   完美A+ perfect → 6
--
-- 旧值：0 / 1 / 2 / 3。本次只改映射函数，submit_task 与
-- batch_grade_task 都走它，无需改动调用方。
--
-- 可重复执行。执行位置：Supabase Dashboard → SQL Editor
-- ============================================================

create or replace function public.task_grade_xp(p_grade text)
returns int
language sql
immutable
as $$
  select case p_grade
           when 'perfect' then 6
           when 'good'    then 4
           when 'done'    then 2
           else 0
         end;
$$;

comment on function public.task_grade_xp(text)
  is '任务等级 → 星光值：none 0 / done 2 / good 4 / perfect 6';

-- ------------------------------------------------------------
-- 说明：历史提交记录不回填
--
-- task_submission.xp_awarded 保存的是当时发放的数值。本次不回填，
-- 因为回填需要同时改 student_info.xp，会连带触发钱包、流水与班级经验，
-- 等同于给全体学生补发一笔星光值，属于业务决策而非技术修正。
--
-- 差额机制已能自愈：学生或老师重新评定同一档位时，
-- submit_task 会用新值减旧值，按新口径补齐差额。
-- 例：某记录原为 perfect（旧 3），重新点一次 perfect → 补 3，累计 6。
--
-- 若确实要给历史记录整体补差，先跑下面的预估，再执行回填段。
-- ------------------------------------------------------------

-- 预估：按新口径应补多少（只读）
-- select count(*)                                        as 待调整记录数,
--        sum(public.task_grade_xp(grade) - coalesce(xp_awarded, 0)) as 合计补发星光值
--   from public.task_submission
--  where public.task_grade_xp(grade) <> coalesce(xp_awarded, 0);

-- 回填（确认后再取消注释执行；会更新 xp 并触发钱包与班级经验同步）
-- do $rebuild$
-- declare
--   r record;
--   v_delta int;
-- begin
--   for r in
--     select class, student_name,
--            sum(public.task_grade_xp(grade) - coalesce(xp_awarded, 0)) as delta
--       from public.task_submission
--      group by class, student_name
--     having sum(public.task_grade_xp(grade) - coalesce(xp_awarded, 0)) <> 0
--   loop
--     v_delta := r.delta;
--     update public.task_submission t
--        set xp_awarded = public.task_grade_xp(t.grade)
--      where t.class = r.class and t.student_name = r.student_name
--        and coalesce(t.xp_awarded, 0) <> public.task_grade_xp(t.grade);
--     update public.student_info
--        set xp = coalesce(xp, 0) + v_delta
--      where class = r.class and student_name = r.student_name;
--     raise notice '% % 补发 % 星光值', r.class, r.student_name, v_delta;
--   end loop;
-- end;
-- $rebuild$;

-- 核对
-- select g, public.task_grade_xp(g) as stars
--   from (values ('none'), ('done'), ('good'), ('perfect')) v(g);
-- 预期：0 / 2 / 4 / 6
