-- ============================================================
-- 59-index-accelerate.sql  加载加速补充索引（三端加速 · 地基）
-- 学生端/教师端对 daily_record 的核心查询都是
--   where class = ? [and record_date >= ?] [and semester = ?]
--   order by record_date desc, create_at desc limit 500
-- 该复合索引让过滤+排序走索引，避免每次全表扫描。
-- 需在 Supabase SQL Editor 手动执行（与 56/57/58 号 SQL 同流程）。可重复执行。
-- ============================================================

create index if not exists idx_daily_record_class_date
  on public.daily_record (class, record_date desc, create_at desc);

-- 学生端名单墙：按班取 student_directory（视图基于 student_info）
create index if not exists idx_student_info_class_name
  on public.student_info (class, student_name);

-- 家长留言列表（教师端 home_note 列表查询）
create index if not exists idx_home_note_class_date
  on public.home_note (class, record_date desc, create_at desc);

notify pgrst, 'reload schema';
