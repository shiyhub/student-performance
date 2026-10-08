-- ============================================================
-- 18-verify-parent.sql  家长三要素校验，返回具体原因
-- ============================================================

create or replace function public.verify_parent(
  p_class text, p_student text, p_parent text
) returns jsonb language sql security definer set search_path = public as $$
  select case
    when not exists (
      select 1 from public.student_info s
       where btrim(lower(s.class)) = btrim(lower(p_class))
         and btrim(lower(s.student_name)) = btrim(lower(p_student))
    ) then jsonb_build_object('ok', false, 'reason', 'no_student')
    when not exists (
      select 1 from public.student_info s
      join public.student_parent p on p.student_id = s.id
       where btrim(lower(s.class)) = btrim(lower(p_class))
         and btrim(lower(s.student_name)) = btrim(lower(p_student))
         and btrim(lower(p.parent_name)) = btrim(lower(p_parent))
    ) then jsonb_build_object('ok', false, 'reason', 'no_parent')
    else jsonb_build_object('ok', true)
  end;
$$;

grant execute on function public.verify_parent(text, text, text) to anon, authenticated;
