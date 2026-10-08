-- ============================================================
-- 32-student-directory-fix.sql  修复学生端"联网班级名单无法加载"
-- ------------------------------------------------------------
-- 原因：student_directory 视图曾被建议改成 security_invoker=on，
--       之后 anon 查视图时按匿名身份访问底层 student_info，
--       而 student_info 对 anon 无任何权限 → 名单加载失败。
-- 修复：恢复视图以 owner（postgres）权限执行（security definer 语义）。
--       该视图只暴露白名单字段：id/class/student_name/avatar/xp/level，
--       不含家长姓名、出生日期、密码等敏感信息，供学生端班级墙公开读取。
-- 可重复执行（幂等）。
-- ============================================================

alter view public.student_directory set (security_invoker = off);

-- 显式确认 anon / 登录用户可读（字段白名单见视图定义）
grant select on public.student_directory to anon, authenticated;

-- 让 PostgREST 立即识别变更
notify pgrst, 'reload schema';
