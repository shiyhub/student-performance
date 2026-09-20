-- ============================================================================
-- 增量升级：学生可自选头像
--   - student_info 增加 avatar 列（存一个 emoji，空 = 按姓名自动分配）
--   - 班级通讯录视图带上 avatar，学生墙直接读到每个人的自选头像
--   - 新增 RPC set_student_avatar：学生凭"班级+姓名"保存自己的头像
--     （anon 对 student_info 没有直接写权限，只能经此函数，且姓名必须在名单中）
-- 安全可重复执行。
-- ============================================================================

-- 1) 名单表加头像列
alter table public.student_info
  add column if not exists avatar text;

-- 2) 重建班级通讯录视图（多带一列 avatar）
create or replace view public.student_directory as
  select id, class, student_name, avatar
  from public.student_info;

comment on view public.student_directory is '学生端班级墙只读视图：班级、学生姓名、自选头像';

-- 视图权限（create or replace 后对新列重新授权）
grant select on public.student_directory to anon, authenticated;

-- 3) 学生保存自选头像的函数（仅能改"班级+姓名"匹配到的那条记录）
create or replace function public.set_student_avatar(
  p_class  text,
  p_student text,
  p_avatar  text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
begin
  -- 简单清洗：去空白、限长，防止写入乱码
  v := nullif(left(btrim(coalesce(p_avatar, '')), 8), '');
  update public.student_info
     set avatar = v
   where class = btrim(coalesce(p_class, ''))
     and student_name = btrim(coalesce(p_student, ''));
  return found;
end;
$$;

grant execute on function public.set_student_avatar(text, text, text) to anon, authenticated;

-- 4) RLS 策略无需改动：学生不直接写 student_info，全部经上面的 SECURITY DEFINER 函数
notify pgrst, 'reload schema';

-- 完成后自检：
--   select student_name, avatar from student_info order by class, student_name limit 5;
