-- ============================================================
-- 70-personal-task-deadline-fill.sql
-- 个人任务：截止日期 + 教师代填
--   1) personal_task 加列 deadline（截止日期）、filled_by（student/teacher）
--   2) create_personal_tasks 增加 p_deadline 参数（默认=任务日期，旧调用兼容）
--   3) confirm_personal_task 增加截止校验（学生端截止后不能确认）
--   4) 新增 teacher_fill_personal_task：教师代未及时填报的学生完成并加分
-- 可重复执行。
-- ============================================================

alter table public.personal_task
  add column if not exists deadline date;
alter table public.personal_task
  add column if not exists filled_by text not null default 'student';

-- 存量任务：截止日期 = 任务当天（保持原行为）
update public.personal_task set deadline = task_date where deadline is null;

-- ------------------------------------------------------------
-- 2) 发布个人任务（批量，带截止日期）
-- ------------------------------------------------------------
create or replace function public.create_personal_tasks(
  p_class text,
  p_content text,
  p_dim text,
  p_xp_value int,
  p_date date,
  p_deadline date default null,
  p_students jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stu    jsonb;
  v_name   text;
  v_ex     boolean;
  v_created int := 0;
  v_skipped int := 0;
  v_dl     date := coalesce(p_deadline, p_date);
begin
  if p_class is null or p_content is null or p_date is null then
    return jsonb_build_object('ok', false, 'reason', '参数不完整');
  end if;
  if v_dl < p_date then
    return jsonb_build_object('ok', false, 'reason', '截止日期不能早于任务日期');
  end if;
  for v_stu in select * from jsonb_array_elements(coalesce(p_students, '[]'::jsonb))
  loop
    v_name := v_stu ->> 'value';
    if v_name is null or v_name = '' then
      continue;
    end if;
    select exists(
      select 1 from public.personal_task
       where class = p_class and student_name = v_name
         and content = p_content and status = 'pending'
    ) into v_ex;
    if v_ex then
      v_skipped := v_skipped + 1;
    else
      insert into public.personal_task
        (class, student_name, content, dim, xp_value, task_date, deadline, status)
      values
        (p_class, v_name, p_content, p_dim, p_xp_value, p_date, v_dl, 'pending');
      v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
end;
$function$;

-- ------------------------------------------------------------
-- 3) 学生确认完成（增加截止校验；截止后不可再填）
-- ------------------------------------------------------------
create or replace function public.confirm_personal_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t   public.personal_task%rowtype;
  v_xp  int;
  v_lv  int;
  v_col text;
begin
  select * into v_t from public.personal_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '任务不存在或已删除');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '该任务已完成');
  end if;
  if v_t.deadline is not null
     and v_t.deadline < (now() at time zone 'Asia/Shanghai')::date then
    return jsonb_build_object('ok', false, 'reason', '任务已截止，请联系老师');
  end if;

  v_col := case v_t.dim
             when 'de'  then 'xp_de'
             when 'zhi' then 'xp_zhi'
             when 'ti'  then 'xp_ti'
             when 'mei' then 'xp_mei'
             when 'lao' then 'xp_lao'
             else 'xp_zhi'
           end;
  execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) + $1) where class = $2 and student_name = $3',
                 v_col, v_col) using v_t.xp_value, v_t.class, v_t.student_name;
  update public.student_info
     set xp = greatest(0, coalesce(xp, 0) + v_t.xp_value)
   where class = v_t.class and student_name = v_t.student_name
   returning xp into v_xp;
  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp)
     where class = v_t.class and student_name = v_t.student_name;
    select level into v_lv from public.student_info
     where class = v_t.class and student_name = v_t.student_name;
  end if;

  update public.personal_task
     set status = 'done', confirm_at = now(), filled_by = 'student'
   where id = p_task_id;
  return jsonb_build_object('ok', true, 'xp_delta', v_t.xp_value, 'level', v_lv);
end;
$function$;

-- ------------------------------------------------------------
-- 4) 教师代填（不校验截止，可补过期任务；标记 filled_by='teacher'）
-- ------------------------------------------------------------
create or replace function public.teacher_fill_personal_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t   public.personal_task%rowtype;
  v_xp  int;
  v_lv  int;
  v_col text;
begin
  select * into v_t from public.personal_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '任务不存在或已删除');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '该任务已完成');
  end if;

  v_col := case v_t.dim
             when 'de'  then 'xp_de'
             when 'zhi' then 'xp_zhi'
             when 'ti'  then 'xp_ti'
             when 'mei' then 'xp_mei'
             when 'lao' then 'xp_lao'
             else 'xp_zhi'
           end;
  execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) + $1) where class = $2 and student_name = $3',
                 v_col, v_col) using v_t.xp_value, v_t.class, v_t.student_name;
  update public.student_info
     set xp = greatest(0, coalesce(xp, 0) + v_t.xp_value)
   where class = v_t.class and student_name = v_t.student_name
   returning xp into v_xp;
  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp)
     where class = v_t.class and student_name = v_t.student_name;
    select level into v_lv from public.student_info
     where class = v_t.class and student_name = v_t.student_name;
  end if;

  update public.personal_task
     set status = 'done', confirm_at = now(), filled_by = 'teacher'
   where id = p_task_id;
  return jsonb_build_object('ok', true, 'xp_delta', v_t.xp_value, 'level', v_lv);
end;
$function$;
