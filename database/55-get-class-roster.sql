-- ============================================================
-- 55-get-class-roster.sql  学生端班级名单校验（deviceGate）
-- ------------------------------------------------------------
-- 背景（2026-10-12 全面测试发现）：
--   student_info 含 birth_date 等敏感字段，匿名 SELECT 被拒（42501），
--   RLS 设计即"匿名端不可直接访问"。学生端 deviceGate（js/student.js
--   showDeviceGate）直查 student_info 校验姓名 → 在线校验必然失败，
--   只能回退本机缓存名单（首次新设备无缓存时校验形同虚设）。
--
-- 修复：get_class_roster(p_class) security definer RPC，只返回
--       该班姓名列表（不暴露 birth_date/xp 等），授予 anon。
--       学生端 deviceGate 改调此 RPC。
-- 可重复执行。
-- ============================================================

create or replace function public.get_class_roster(p_class text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster jsonb;
begin
  select coalesce(jsonb_agg(
           jsonb_build_object('student_name', i.student_name)
           order by i.student_name), '[]'::jsonb)
    into v_roster
    from public.student_info i
   where btrim(i.class) = btrim(p_class);
  return v_roster;
end;
$$;

revoke execute on function public.get_class_roster(text) from public;
grant  execute on function public.get_class_roster(text) to anon, authenticated;

notify pgrst, 'reload schema';
