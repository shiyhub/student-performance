-- ============================================================
-- 19-semester.sql
--   1) behavior_tags 增加 history_unique：二级项打过一次永久置灰
--   2) 各业务表增加 semester 字段，支持学期切换
-- 可重复执行。
-- ============================================================

alter table public.behavior_tags
  add column if not exists history_unique boolean not null default true;

alter table public.daily_record   add column if not exists semester text;
alter table public.daily_task     add column if not exists semester text;
alter table public.task_submission add column if not exists semester text;

-- 默认学期
update public.daily_record   set semester = '2026秋' where semester is null;
update public.daily_task     set semester = '2026秋' where semester is null;
update public.task_submission set semester = '2026秋' where semester is null;

create index if not exists idx_daily_record_semester on public.daily_record (semester, class, record_date);
create index if not exists idx_daily_task_semester on public.daily_task (semester, class);
