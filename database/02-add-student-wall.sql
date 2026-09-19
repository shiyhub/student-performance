-- ============================================================================
-- 增量迁移：新增"学生班级头像墙"（开放学生端只读）
-- 适用：已经执行过 01-schema-rls.sql 旧版本（没有 student_directory 视图）的项目
-- 全新部署直接跑 01-schema-rls.sql 即可，不需要本文件。
-- 可重复执行。
-- ============================================================================

-- 1) 班级通讯录视图：只含班级和学生姓名，不含家长姓名
create or replace view public.student_directory as
  select id, class, student_name
  from public.student_info;

comment on view public.student_directory is '学生端班级墙只读视图：仅含班级与学生姓名，不含家长姓名';

-- 2) 学生（anon）可读取全班表现记录
drop policy if exists anon_read_all_records on public.daily_record;
create policy anon_read_all_records on public.daily_record
  for select
  to anon
  using (true);

-- 3) SQL 层授权（与 RLS 双重生效）
revoke all on public.student_directory from anon, authenticated;
grant select on public.student_directory to anon, authenticated;
grant select on public.daily_record to anon;

-- 验证：
--   select * from public.student_directory limit 3;          -- 应只有 id/class/student_name 三列
--   select count(*) from public.daily_record;                -- anon 密钥下应可查询
-- ============================================================================
