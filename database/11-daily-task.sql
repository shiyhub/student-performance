-- ============================================================================
-- 增量升级 11：每日学习任务
--   表 daily_task：老师按班级+日期发布任务（标题+说明）
--   表 task_submission：学生按任务自评等级
--     grade: none=未完成 / done=完成 / good=优秀A / perfect=完美A+
--     经验：0 / 1 / 2 / 3；心情：none=不加，其余 +1
--   经验差值结算：学生改评时按新旧等级差额增减 student_info.xp
-- 可重复执行。
-- ============================================================================

-- 1) 任务表
create table if not exists public.daily_task (
  id         uuid primary key default gen_random_uuid(),
  class      text not null,
  task_date  date not null default current_date,
  title      text not null,
  detail     text,
  create_at  timestamptz not null default now()
);

create index if not exists idx_daily_task_class_date
  on public.daily_task (class, task_date desc);

-- 2) 任务完成表
create table if not exists public.task_submission (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.daily_task(id) on delete cascade,
  class         text not null,
  student_name  text not null,
  grade         text not null default 'none'
                check (grade in ('none','done','good','perfect')),
  xp_awarded    int not null default 0,
  mood_awarded  boolean not null default false,
  create_at     timestamptz not null default now(),
  update_at     timestamptz not null default now(),
  unique (task_id, student_name)
);

create index if not exists idx_task_sub_task on public.task_submission (task_id);
create index if not exists idx_task_sub_class_date
  on public.task_submission (class, student_name);

-- 3) RLS
alter table public.daily_task      enable row level security;
alter table public.task_submission enable row level security;

drop policy if exists "daily_task select all"   on public.daily_task;
drop policy if exists "daily_task manage teacher" on public.daily_task;
create policy "daily_task select all"   on public.daily_task      for select to anon, authenticated using (true);
create policy "daily_task manage teacher" on public.daily_task     for all  to authenticated using (true) with check (true);

drop policy if exists "task_submission teacher all" on public.task_submission;
create policy "task_submission teacher all" on public.task_submission for all to authenticated using (true) with check (true);
-- 学生/家长读写都走 RPC，表本身不开放直连

-- 4) 经验换算函数
create or replace function public.task_grade_xp(p_grade text)
returns int language sql immutable as $$
  select case p_grade
           when 'perfect' then 3
           when 'good'    then 2
           when 'done'    then 1
           else 0
         end;
$$;

-- 5) 学生提交 / 老师调整评级：差额结算经验
create or replace function public.submit_task(
  p_class   text,
  p_student text,
  p_task_id uuid,
  p_grade   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task    public.daily_task%rowtype;
  v_old     public.task_submission%rowtype;
  v_old_xp  int := 0;
  v_new_xp  int;
  v_delta   int;
  v_mood    boolean;
  v_sid     uuid;
  v_xp      int;
  v_level   int;
begin
  if p_grade not in ('none','done','good','perfect') then
    return jsonb_build_object('ok', false, 'reason', 'bad_grade');
  end if;

  select * into v_task from public.daily_task where id = p_task_id;
  if v_task.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_task');
  end if;

  -- 学生身份校验（老师用 RPC 改任意学生也走这里，不强制校验学生存在——
  -- 但为安全仍校验该生在班级名单里）
  select id, xp into v_sid, v_xp from public.student_info
   where class = btrim(p_class) and student_name = btrim(p_student);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  select * into v_old from public.task_submission
   where task_id = p_task_id and student_name = btrim(p_student);

  v_old_xp := coalesce(v_old.xp_awarded, 0);
  v_new_xp := public.task_grade_xp(p_grade);
  v_delta  := v_new_xp - v_old_xp;
  v_mood   := (p_grade <> 'none');

  insert into public.task_submission
    (task_id, class, student_name, grade, xp_awarded, mood_awarded)
  values
    (p_task_id, btrim(p_class), btrim(p_student), p_grade, v_new_xp, v_mood)
  on conflict (task_id, student_name) do update
     set grade = excluded.grade,
         xp_awarded = excluded.xp_awarded,
         mood_awarded = excluded.mood_awarded,
         update_at = now();

  if v_delta <> 0 then
    update public.student_info
       set xp = xp + v_delta,
           level = public.level_from_xp(xp + v_delta)
     where id = v_sid
    returning xp, level into v_xp, v_level;
  else
    v_xp := v_xp;
    v_level := public.level_from_xp(v_xp);
  end if;

  return jsonb_build_object(
    'ok', true,
    'grade', p_grade,
    'xp_delta', v_delta,
    'xp', v_xp,
    'level', v_level,
    'mood_awarded', v_mood
  );
end;
$$;

revoke execute on function public.submit_task(text,text,uuid,text) from public;
grant  execute on function public.submit_task(text,text,uuid,text) to anon, authenticated;

-- 6) 学生端：取今天本班任务 + 自己已选等级
create or replace function public.get_today_task(
  p_class   text,
  p_student text,
  p_date    date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_date, current_date);
  v_task record;
  v_sub  record;
begin
  select id, title, detail, task_date into v_task
    from public.daily_task
   where class = btrim(p_class) and task_date = v_date
   order by create_at desc limit 1;

  if v_task.id is null then
    return jsonb_build_object('task', null);
  end if;

  select grade, mood_awarded into v_sub
    from public.task_submission
   where task_id = v_task.id and student_name = btrim(p_student);

  return jsonb_build_object(
    'task', jsonb_build_object(
      'id', v_task.id,
      'title', v_task.title,
      'detail', v_task.detail,
      'task_date', v_task.task_date
    ),
    'my_grade', coalesce(v_sub.grade, 'none'),
    'mood_awarded', coalesce(v_sub.mood_awarded, false)
  );
end;
$$;

revoke execute on function public.get_today_task(text,text,date) from public;
grant  execute on function public.get_today_task(text,text,date) to anon, authenticated;

-- 7) 家长端：取某学生近期任务表现（默认最近 14 天）
create or replace function public.get_student_tasks(
  p_class   text,
  p_student text,
  p_parent  text,
  p_days    int default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid;
begin
  -- 家长三要素校验
  select si.id into v_sid
    from public.student_info si
    join public.student_parent sp on sp.student_id = si.id
   where si.class = btrim(p_class)
     and si.student_name = btrim(p_student)
     and sp.parent_name = btrim(p_parent)
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
           and d.task_date >= current_date - (coalesce(p_days,14) || ' days')::interval
         order by d.task_date desc, d.create_at desc
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_student_tasks(text,text,text,int) from public;
grant  execute on function public.get_student_tasks(text,text,text,int) to anon, authenticated;

-- 8) 老师端：某班某日任务 + 全班提交情况
create or replace function public.get_class_task_report(
  p_class text,
  p_date  date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_date, current_date);
  v_task record;
begin
  select id, title, detail, task_date into v_task
    from public.daily_task
   where class = btrim(p_class) and task_date = v_date
   order by create_at desc limit 1;

  if v_task.id is null then
    return jsonb_build_object('task', null, 'students', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'task', jsonb_build_object('id',v_task.id,'title',v_task.title,'detail',v_task.detail,'task_date',v_task.task_date),
    'students', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select s.student_name,
               coalesce(sub.grade, 'none') as grade,
               sub.mood_awarded
          from public.student_info s
          left join public.task_submission sub
            on sub.task_id = v_task.id and sub.student_name = s.student_name
         where s.class = btrim(p_class)
         order by s.student_name
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_class_task_report(text,date) from public;
grant  execute on function public.get_class_task_report(text,date) to authenticated;

-- 9) 表级授权：老师(authenticated)可读写任务表；anon 只读任务列表（提交走 RPC）
grant select on public.daily_task      to anon, authenticated;
grant all    on public.daily_task      to authenticated;
grant select on public.task_submission to authenticated;
grant all    on public.task_submission to authenticated;

notify pgrst, 'reload schema';
