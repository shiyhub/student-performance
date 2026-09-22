-- ============================================================
-- 21-harden.sql  安全加固：把只有老师能用的 RPC 从匿名权限收回
-- 可重复执行。跑完不影响学生/家长正常使用。
-- ============================================================

-- 这些函数只能登录老师(authenticated)用，匿名(anon)不应能调用
do $$ begin
  revoke execute on function public.recalc_all_xp() from anon;
exception when others then null; end $$;

do $$ begin
  revoke execute on function public.set_student_xp(text, text, int) from anon;
exception when others then null; end $$;

-- 这些是学生/家长公开用的，保持 anon 可执行：
-- submit_today / submit_task / verify_parent / get_student_records /
-- get_student_papers / get_student_tasks / is_valid_student / add_home_note
