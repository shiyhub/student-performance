-- ============================================================
-- 37-load-optimize.sql  加载提速：数据量增长后的查询索引（v127）
-- ------------------------------------------------------------
-- 背景：三端查询 daily_record / home_note / task_submission 时
--       按 class + record_date desc 排序、按 student_name 过滤，
--       数据量增长后（每班每学期数千条）无索引会全表扫、加载变慢。
-- 本脚本为这些高频查询路径补充索引，可重复执行（幂等）。
-- ============================================================

-- 学生端班级墙：按班级取记录（class + record_date/create_at 倒序 limit 1000）
create index if not exists idx_daily_record_cls_date
  on public.daily_record (class, record_date desc, create_at desc);

-- 学生端详情/统计：按学生过滤历史记录
create index if not exists idx_daily_record_stu_date
  on public.daily_record (student_name, record_date desc);

-- 教师端记录页：class + 日期/关键词筛选
create index if not exists idx_daily_record_cls_only
  on public.daily_record (class, create_at desc);

-- 教师端在家表现：home_note 按日期倒序
create index if not exists idx_home_note_date
  on public.home_note (record_date desc, create_at desc);

-- 学生端今日任务：按 task_id 查提交
create index if not exists idx_task_sub_task
  on public.task_submission (task_id);

-- 座位表：按班级查
create index if not exists idx_seat_class
  on public.seat_grid (class);
