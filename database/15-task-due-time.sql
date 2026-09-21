-- ============================================================
-- 15-task-due-time.sql  家庭作业截止时间
-- 可重复执行。
--   daily_task 增加 due_time（文本，如 "21:00"）。
--   家庭作业(task_type='homework')可设截止时间，学生端展示。
-- ============================================================

alter table public.daily_task add column if not exists due_time text;
