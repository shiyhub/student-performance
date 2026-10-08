-- ============================================================
-- 31-student-access-code.sql  学生密码管理 + 个人二维码
-- ------------------------------------------------------------
-- 1) student_info 增加 access_code（6 位学生密码，教师生成/重置）
-- 2) set_student_code：教师为学生设置/重置密码（仅登录教师可调）
-- 3) 家长端校验函数扩展：凭据 = 出生年月日 或 学生密码，任一匹配即可
--    个人二维码内容：parent.html?class=..&student=..&code=密码 → 扫码零输入
-- 可重复执行（幂等）
-- ============================================================

alter table public.student_info add column if not exists access_code text;
comment on column public.student_info.access_code is '学生个人密码（6位，教师生成/重置），家长扫码/输入均可查看';

-- ---------------------------------------------------------------------------
-- 教师设置/重置学生密码（仅 authenticated 教师可调）
-- ---------------------------------------------------------------------------
create or replace function public.set_student_code(
  p_class  text,
  p_student text,
  p_code   text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
begin
  if auth.role() <> 'authenticated' then
    return false;   -- 仅登录教师可设置/重置密码
  end if;
  -- 清洗：只接受 6 位数字
  v := nullif(btrim(coalesce(p_code, '')), '');
  if v is null or v !~ '^\d{6}$' then
    return false;
  end if;
  update public.student_info
     set access_code = v
   where btrim(class) = btrim(coalesce(p_class, ''))
     and btrim(student_name) = btrim(coalesce(p_student, ''));
  return found;
end;
$$;
revoke execute on function public.set_student_code(text, text, text) from public;
grant  execute on function public.set_student_code(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 家长端校验/查询：凭据 = 出生年月日8位 或 学生密码，任一匹配即通过
-- （参数名保持 p_birth 不变，避免 PG 42P13；值可以是出生日期或学生密码）
-- ---------------------------------------------------------------------------

create or replace function public.verify_parent(
  p_class text, p_student text, p_birth text
) returns jsonb language sql security definer set search_path = public as $$
  select case
    when not exists (
      select 1 from public.student_info s
       where btrim(lower(s.class)) = btrim(lower(p_class))
         and btrim(lower(s.student_name)) = btrim(lower(p_student))
    ) then jsonb_build_object('ok', false, 'reason', 'no_student')
    when not exists (
      select 1 from public.student_info s
       where btrim(lower(s.class)) = btrim(lower(p_class))
         and btrim(lower(s.student_name)) = btrim(lower(p_student))
         and (btrim(s.birth_date) = btrim(p_birth) or btrim(s.access_code) = btrim(p_birth))
    ) then jsonb_build_object('ok', false, 'reason', 'no_birth')
    else jsonb_build_object('ok', true)
  end;
$$;
revoke execute on function public.verify_parent(text, text, text) from public;
grant  execute on function public.verify_parent(text, text, text) to anon, authenticated;

create or replace function public.get_student_records(
  p_class   text,
  p_student text,
  p_birth   text
)
returns table (
  id              uuid,
  student_name    text,
  class           text,
  record_date     date,
  self_evaluation smallint,
  behavior        jsonb,
  teacher_comment text,
  create_at       timestamptz
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.student_name, r.class, r.record_date,
         r.self_evaluation, r.behavior, r.teacher_comment, r.create_at
  from public.daily_record r
  where r.class = p_class
    and r.student_name = p_student
    and exists (
      select 1
      from public.student_info s
      where s.class        = r.class
        and s.student_name = r.student_name
        and (btrim(s.birth_date) = btrim(p_birth) or btrim(s.access_code) = btrim(p_birth))
    )
  order by r.record_date desc, r.create_at desc;
$$;
revoke execute on function public.get_student_records(text, text, text) from public;
grant  execute on function public.get_student_records(text, text, text) to anon, authenticated;

create or replace function public.get_student_papers(
  p_class   text,
  p_student text,
  p_birth   text
)
returns table (
  id           uuid,
  record_date  date,
  subject      text,
  score        numeric,
  score_text   text,
  image_url    text,
  note         text,
  create_at    timestamptz
)
language sql
security definer
set search_path = public
as $$
  select e.id, e.record_date, e.subject, e.score, e.score_text, e.image_url, e.note, e.create_at
  from public.exam_paper e
  where e.class = btrim(coalesce(p_class, ''))
    and e.student_name = btrim(coalesce(p_student, ''))
    and exists (
      select 1
      from public.student_info s
      where s.class = e.class
        and s.student_name = e.student_name
        and (btrim(s.birth_date) = btrim(coalesce(p_birth, '')) or btrim(s.access_code) = btrim(coalesce(p_birth, '')))
    )
  order by e.record_date desc, e.create_at desc;
$$;
revoke execute on function public.get_student_papers(text, text, text) from public;
grant  execute on function public.get_student_papers(text, text, text) to anon, authenticated;

create or replace function public.get_student_tasks(
  p_class   text,
  p_student text,
  p_birth   text,
  p_days    int default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid;
begin
  select si.id into v_sid
    from public.student_info si
   where si.class = btrim(p_class)
     and si.student_name = btrim(p_student)
     and (btrim(si.birth_date) = btrim(p_birth) or btrim(si.access_code) = btrim(p_birth))
   limit 1;
  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'mismatch');
  end if;

  return jsonb_build_object(
    'ok', true,
    'tasks', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select d.task_date, d.title, d.detail,
               coalesce(s.grade, 'none') as grade,
               s.mood_awarded
          from public.daily_task d
          left join public.task_submission s
            on s.task_id = d.id and s.student_name = btrim(p_student)
         where d.class = btrim(p_class)
           and d.task_date >= current_date - (coalesce(p_days,7) || ' days')::interval
         order by d.task_date desc, d.create_at desc
      ) t
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.get_student_tasks(text,text,text,int) from public;
grant  execute on function public.get_student_tasks(text,text,text,int) to anon, authenticated;

create or replace function public.add_home_note(
  p_class   text,
  p_student text,
  p_birth   text,
  p_content text,
  p_date    date default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid     uuid;
  v_content text;
  v_birth   text;
  v_date    date;
begin
  v_content := nullif(left(btrim(coalesce(p_content, '')), 500), '');
  if v_content is null then
    return false;
  end if;

  v_birth := btrim(coalesce(p_birth, ''));
  v_date  := coalesce(p_date, current_date);

  select si.id
    into v_sid
  from public.student_info si
  where si.class        = btrim(coalesce(p_class, ''))
    and si.student_name = btrim(coalesce(p_student, ''))
    and (btrim(si.birth_date) = v_birth or btrim(si.access_code) = v_birth)
  limit 1;

  if v_sid is null then
    return false;
  end if;

  insert into public.home_note (student_id, parent_name, content, record_date)
  values (v_sid, v_birth, v_content, v_date);

  return true;
end;
$$;
revoke execute on function public.add_home_note(text, text, text, text, date) from public;
grant  execute on function public.add_home_note(text, text, text, text, date) to anon, authenticated;

-- 让 PostgREST 立即识别新函数
notify pgrst, 'reload schema';
