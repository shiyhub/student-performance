-- ============================================================
-- 41-fix-anon-task-submission.sql  修复学生端往日任务提交读取
-- ------------------------------------------------------------
-- 背景（2026-10-09 线上故障）：
--   11-daily-task.sql 对 task_submission 开启 RLS，policy 只放行
--   authenticated。学生端网页无登录（anon key），loadPastTasks 直查
--   task_submission 被 RLS 过滤为空数组 → 往日任务永远显示"已截止"，
--   看不到自己的历史提交等级（如"完美A+"）。
--   教师端有 Supabase Auth 登录（authenticated，policy 放行），不受影响；
--   家长端走 RPC（security definer），也不受影响。
--
-- 修复：新增学生专用只读 RPC get_my_task_subs(p_student)，
--       security definer 绕过 RLS，只返回该学生自己的提交（task_id+grade），
--       授予 anon。学生端 loadPastTasks 改调此 RPC（v129 / RSK-09）。
--       —— 不放开对全班成绩的匿名直读，保持项目原有安全收紧设计。
-- 可重复执行。
-- ============================================================

create or replace function public.get_my_task_subs(p_student text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subs jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('task_id', s.task_id, 'grade', s.grade) order by s.create_at), '[]'::jsonb)
    into v_subs
    from public.task_submission s
   where s.student_name = btrim(p_student);
  return v_subs;
end;
$$;

revoke execute on function public.get_my_task_subs(text) from public;
grant  execute on function public.get_my_task_subs(text) to anon, authenticated;

notify pgrst, 'reload schema';
