-- ============================================================
-- 66-manual-task.sql
-- 手动分配任务表（教师基于 behavior_tags 标签分配，学生确认完成
-- 按标签真实分值/维度加分）
-- 说明：缺失迁移还原版，依据 teacher.js/student.js/97 号反推，可重复执行。
-- 关键：tag_id 外键是 PostgREST 嵌入 behavior_tags(label) 的前提。
-- 函数见 67 号。
-- ============================================================
create table if not exists public.manual_task (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,
  student_name text not null,
  tag_id       uuid not null,
  task_date    date not null,
  status       text not null default 'pending',  -- pending / done
  create_at    timestamptz not null default now()
);

-- 外键：关联标签（标签删除时任务一并清理，避免悬挂）
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_manual_task_tag'
  ) then
    alter table public.manual_task
      add constraint fk_manual_task_tag
      foreign key (tag_id) references public.behavior_tags(id) on delete cascade;
  end if;
end $$;

-- 索引：按学生/日期查询、教师列表按日期排序
create index if not exists idx_manual_task_student
  on public.manual_task (class, student_name, task_date);

alter table public.manual_task enable row level security;

-- 学生端直查（anon 可读）、教师端列表（authenticated 可读）
drop policy if exists "manual_task_select_all" on public.manual_task;
create policy "manual_task_select_all" on public.manual_task
  for select to anon, authenticated using (true);
-- 教师兜底写权限（实际写入走 67 号 security definer 函数）
drop policy if exists "manual_task_teacher_all" on public.manual_task;
create policy "manual_task_teacher_all" on public.manual_task
  for all to authenticated using (true) with check (true);
