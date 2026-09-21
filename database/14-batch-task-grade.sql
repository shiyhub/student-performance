-- ============================================================
-- 14-batch-task-grade.sql  教师端：按任务批量给学生打等级
--   batch_grade_task(p_task_id, p_students, p_grade)
--   复用 submit_task 的经验/心情结算逻辑，可重复执行。
-- ============================================================

create or replace function public.batch_grade_task(
  p_task_id  uuid,
  p_students text[],
  p_grade    text
)
returns table(ok_count int, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_task public.daily_task%rowtype;
  v_cls  text;
  v_ok   int := 0;
begin
  if auth.uid() is null then
    raise exception '请先以老师身份登录';
  end if;
  if p_grade not in ('none','done','good','perfect') then
    raise exception '等级无效';
  end if;
  if coalesce(array_length(p_students,1),0) = 0 then
    raise exception '请选择学生';
  end if;

  select * into v_task from public.daily_task where id = p_task_id;
  if v_task.id is null then
    raise exception '任务不存在';
  end if;
  v_cls := v_task.class;

  foreach v_name in array p_students loop
    perform public.submit_task(v_cls, v_name, p_task_id, p_grade);
    v_ok := v_ok + 1;
  end loop;

  ok_count := v_ok;
  message := '已为 ' || v_ok || ' 位同学评定「' || p_grade || '」';
  return next;
end;
$$;

grant execute on function public.batch_grade_task(uuid, text[], text) to authenticated;
