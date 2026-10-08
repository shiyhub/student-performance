-- ============================================================
-- 30-parent-birth-login.sql  家长端改为"学生姓名 + 出生年月日8位"登录
-- ------------------------------------------------------------
-- 1) student_info 增加出生日期列
-- 2) 批量导入六年级一班 40 名学生出生日期（来源：六年级学生基本信息.xlsx）
-- 3) 重建 verify_parent / get_student_records / get_student_papers / get_student_tasks：
--    家长身份校验从"家长姓名"改为"学生出生年月日8位"
-- 可重复执行（幂等）
-- ============================================================

alter table public.student_info add column if not exists birth_date text;
comment on column public.student_info.birth_date is '出生年月日8位（家长端登录校验用），如 20150901';

update public.student_info set birth_date = '20150205' where btrim(class) = '六年级一班' and btrim(student_name) = '梁雅茹' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150222' where btrim(class) = '六年级一班' and btrim(student_name) = '刘翼婷' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150225' where btrim(class) = '六年级一班' and btrim(student_name) = '卢杨洋' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150509' where btrim(class) = '六年级一班' and btrim(student_name) = '卿梦雅' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150608' where btrim(class) = '六年级一班' and btrim(student_name) = '卿诺晨' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151014' where btrim(class) = '六年级一班' and btrim(student_name) = '卿伟林' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150730' where btrim(class) = '六年级一班' and btrim(student_name) = '卿瑶' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151115' where btrim(class) = '六年级一班' and btrim(student_name) = '卿泽懿' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150710' where btrim(class) = '六年级一班' and btrim(student_name) = '卿芷妍' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151117' where btrim(class) = '六年级一班' and btrim(student_name) = '卿梓桐' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150831' where btrim(class) = '六年级一班' and btrim(student_name) = '谭文博' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151122' where btrim(class) = '六年级一班' and btrim(student_name) = '谭欣龙' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150522' where btrim(class) = '六年级一班' and btrim(student_name) = '谭雪琪' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151004' where btrim(class) = '六年级一班' and btrim(student_name) = '谭奕婷' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150731' where btrim(class) = '六年级一班' and btrim(student_name) = '谭意霖' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151016' where btrim(class) = '六年级一班' and btrim(student_name) = '谭芸熙' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150122' where btrim(class) = '六年级一班' and btrim(student_name) = '王星宇' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150713' where btrim(class) = '六年级一班' and btrim(student_name) = '王玥' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151016' where btrim(class) = '六年级一班' and btrim(student_name) = '谢慕芸' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150220' where btrim(class) = '六年级一班' and btrim(student_name) = '杨宸' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151125' where btrim(class) = '六年级一班' and btrim(student_name) = '杨晨磊' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151111' where btrim(class) = '六年级一班' and btrim(student_name) = '杨嘉豪' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150630' where btrim(class) = '六年级一班' and btrim(student_name) = '杨丽琪' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150418' where btrim(class) = '六年级一班' and btrim(student_name) = '杨沐晴' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150604' where btrim(class) = '六年级一班' and btrim(student_name) = '杨千慧' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150131' where btrim(class) = '六年级一班' and btrim(student_name) = '杨书鸿' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151007' where btrim(class) = '六年级一班' and btrim(student_name) = '杨思琪' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151221' where btrim(class) = '六年级一班' and btrim(student_name) = '杨素菲' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150412' where btrim(class) = '六年级一班' and btrim(student_name) = '杨桃花' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150313' where btrim(class) = '六年级一班' and btrim(student_name) = '杨文卓' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151016' where btrim(class) = '六年级一班' and btrim(student_name) = '杨鑫' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20141218' where btrim(class) = '六年级一班' and btrim(student_name) = '杨妍晰' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150708' where btrim(class) = '六年级一班' and btrim(student_name) = '杨叶珊' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150202' where btrim(class) = '六年级一班' and btrim(student_name) = '杨依依' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151210' where btrim(class) = '六年级一班' and btrim(student_name) = '杨艺彤' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20141207' where btrim(class) = '六年级一班' and btrim(student_name) = '杨雨婷' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150616' where btrim(class) = '六年级一班' and btrim(student_name) = '杨悦' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151120' where btrim(class) = '六年级一班' and btrim(student_name) = '杨紫菡' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20151222' where btrim(class) = '六年级一班' and btrim(student_name) = '杨紫睿' and (birth_date is null or birth_date = '');
update public.student_info set birth_date = '20150303' where btrim(class) = '六年级一班' and btrim(student_name) = '周劲苗' and (birth_date is null or birth_date = '');
-- ---------------------------------------------------------------------------
-- 家长端三要素校验：班级 + 学生姓名 + 出生年月日8位
-- ---------------------------------------------------------------------------
-- 参数名已变更，先删旧函数再重建（PG 不允许 create or replace 改参数名）
drop function if exists public.verify_parent(text, text, text) cascade;

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
         and btrim(s.birth_date) = btrim(p_birth)
    ) then jsonb_build_object('ok', false, 'reason', 'no_birth')
    else jsonb_build_object('ok', true)
  end;
$$;
revoke execute on function public.verify_parent(text, text, text) from public;
grant  execute on function public.verify_parent(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 家长查表现记录：校验改为出生日期
-- ---------------------------------------------------------------------------
-- 参数名已变更，先删旧函数再重建（PG 不允许 create or replace 改参数名）
drop function if exists public.get_student_records(text, text, text) cascade;

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
        and btrim(s.birth_date) = btrim(p_birth)
    )
  order by r.record_date desc, r.create_at desc;
$$;
revoke execute on function public.get_student_records(text, text, text) from public;
grant  execute on function public.get_student_records(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 家长查考试试卷：校验改为出生日期
-- ---------------------------------------------------------------------------
-- 参数名已变更，先删旧函数再重建（PG 不允许 create or replace 改参数名）
drop function if exists public.get_student_papers(text, text, text) cascade;

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
        and btrim(s.birth_date) = btrim(coalesce(p_birth, ''))
    )
  order by e.record_date desc, e.create_at desc;
$$;
revoke execute on function public.get_student_papers(text, text, text) from public;
grant  execute on function public.get_student_papers(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 家长查近7天任务：校验改为出生日期
-- ---------------------------------------------------------------------------
-- 参数名已变更，先删旧函数再重建（PG 不允许 create or replace 改参数名）
drop function if exists public.get_student_tasks(text, text, text, int) cascade;

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
     and btrim(si.birth_date) = btrim(p_birth)
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

-- ---------------------------------------------------------------------------
-- 家长在家留言：校验改为出生日期（留言归属记出生日期）
-- ---------------------------------------------------------------------------
-- 参数名已变更，先删旧函数再重建（PG 不允许 create or replace 改参数名）
drop function if exists public.add_home_note(text, text, text, text, date) cascade;

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
    and btrim(si.birth_date) = v_birth
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
