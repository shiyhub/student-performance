-- ============================================================
-- 54-get-today-subs.sql  星光墙任务完成徽章（学生端）
-- ------------------------------------------------------------
-- 背景（2026-10-12 全面测试发现）：
--   v129(RSK-09) 用 get_my_task_subs 修好了"往日任务列表"，但学生端
--   星光墙（js/student.js loadWall）直查 task_submission 取全班今日
--   任务提交状态，被 RLS 过滤为空数组 → 全班任务徽章永远显示 0/3
--   （即使学生已提交，如卿泽懿 2/3 却显示 0/3）。
--   按 41 号迁移既有安全原则：不放开匿名直读全班成绩，新增只读 RPC。
--
-- 修复：get_today_subs(p_task_ids) security definer 绕过 RLS，
--       只返回这些任务的提交（task_id+student_name+grade），授予 anon。
--       学生端 loadWall 改调此 RPC。
-- 可重复执行。
-- ============================================================

create or replace function public.get_today_subs(p_task_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subs jsonb;
begin
  select coalesce(jsonb_agg(
           jsonb_build_object('task_id', s.task_id,
                              'student_name', s.student_name,
                              'grade', s.grade)
           order by s.student_name), '[]'::jsonb)
    into v_subs
    from public.task_submission s
   where s.task_id = any(p_task_ids);
  return v_subs;
end;
$$;

revoke execute on function public.get_today_subs(uuid[]) from public;
grant  execute on function public.get_today_subs(uuid[]) to anon, authenticated;

notify pgrst, 'reload schema';
