-- ============================================================
-- 17-tag-once.sql  标签"每日唯一"开关
--   once_per_day = true 的标签，学生当天只能选一次，选完变灰
-- 可重复执行。
-- ============================================================

alter table public.behavior_tags
  add column if not exists once_per_day boolean not null default false;
