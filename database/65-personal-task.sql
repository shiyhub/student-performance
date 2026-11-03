-- ============================================================
-- 65-personal-task.sql
-- 个人任务表（教师自定义内容，学生确认完成按教师定分值/维度加分）
-- 说明：本文件为"缺失迁移还原版"，依据前端字段使用与 70/83 号函数
--   反推编写，可重复执行；线上已存在同名表时本语句安全跳过。
-- 后续：70 号会给本表加 deadline/filled_by 列，83 号提供删除回退函数。
-- ============================================================
create table if not exists public.personal_task (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,
  student_name text not null,
  content      text not null,
  dim          text not null default 'zhi',      -- de/zhi/ti/mei/lao
  xp_value     int  not null default 0,
  task_date    date not null default current_date,
  status       text not null default 'pending',  -- pending / done
  confirm_at   timestamptz
);

-- 旧库补列（幂等，防早期缺列）
alter table public.personal_task add column if not exists confirm_at timestamptz;

-- 索引：按学生/日期查询
create index if not exists idx_personal_task_student
  on public.personal_task (class, student_name, task_date);

alter table public.personal_task enable row level security;

-- 学生端直查（anon 可读，前端按班级姓名过滤）
drop policy if exists "personal_task_select_all" on public.personal_task;
create policy "personal_task_select_all" on public.personal_task
  for select to anon, authenticated using (true);
-- 教师全部权限（写操作主要走 security definer 函数，这里兜底）
drop policy if exists "personal_task_teacher_all" on public.personal_task;
create policy "personal_task_teacher_all" on public.personal_task
  for all to authenticated using (true) with check (true);
