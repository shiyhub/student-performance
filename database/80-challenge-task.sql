-- ============================================================
-- 80-challenge-task.sql  挑战任务（档位制加分）
--   学生端"我的挑战任务"（放在我的个人任务下方）
--   教师端可批量布置挑战（如"英语默写挑战"），学生完成后自选达成档位：
--     档位 10 / 15 / 20 / ... / 110（步长 5，共 21 档）
--     对应经验 = 档位 / 5（即 2 / 3 / 4 / ... / 22）
--   1) 新表 challenge_task
--   2) create_challenge_tasks：教师批量布置
--   3) confirm_challenge_task：学生自选档位确认并加分
--   4) delete_challenge_task：教师取消（未完成的）
-- 可重复执行。
-- ============================================================

create table if not exists public.challenge_task (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,
  student_name text not null,
  title        text not null,                 -- 挑战名称，如"英语默写挑战"
  dim          text not null default 'zhi',   -- de/zhi/ti/mei/lao
  max_level    int,                           -- 学生达成档位（10~110 步5），未完成 null
  status       text not null default 'pending', -- pending / done
  task_date    date not null,
  create_at    timestamptz not null default now(),
  confirm_at   timestamptz,
  filled_by    text not null default 'student'
);

alter table public.challenge_task enable row level security;

-- 学生端 / 教师端直查（前端按 class+student_name 过滤；教师端看全班）
drop policy if exists "challenge_select_all" on public.challenge_task;
create policy "challenge_select_all" on public.challenge_task for select to anon using (true);

-- ------------------------------------------------------------
-- 1) 教师批量布置挑战任务
-- ------------------------------------------------------------
create or replace function public.create_challenge_tasks(
  p_class    text,
  p_title    text,
  p_dim      text default 'zhi',
  p_date     date default null,
  p_students jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_stu jsonb;
  v_name text;
  v_ex boolean;
  v_created int := 0;
  v_skipped int := 0;
  v_d date := coalesce(p_date, (now() at time zone 'Asia/Shanghai')::date);
begin
  if p_class is null or p_title is null or btrim(p_title) = '' then
    return jsonb_build_object('ok', false, 'reason', '参数不完整');
  end if;
  for v_stu in select * from jsonb_array_elements(coalesce(p_students, '[]'::jsonb))
  loop
    v_name := v_stu ->> 'value';
    if v_name is null or v_name = '' then continue; end if;
    select exists(
      select 1 from public.challenge_task
       where class = p_class and student_name = v_name
         and title = p_title and status = 'pending'
    ) into v_ex;
    if v_ex then
      v_skipped := v_skipped + 1;
    else
      insert into public.challenge_task (class, student_name, title, dim, task_date, status)
      values (p_class, v_name, btrim(p_title), coalesce(p_dim, 'zhi'), v_d, 'pending');
      v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.create_challenge_tasks(text, text, text, date, jsonb) from public;
grant  execute on function public.create_challenge_tasks(text, text, text, date, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- 2) 学生自选档位确认（档位 10~110 步5，经验 = 档位/5）
-- ------------------------------------------------------------
create or replace function public.confirm_challenge_task(p_task_id uuid, p_level int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_t   public.challenge_task%rowtype;
  v_xp  int;
  v_lv  int;
  v_col text;
  v_gain int;
begin
  select * into v_t from public.challenge_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '挑战不存在或已取消');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '该挑战已完成');
  end if;
  if p_level is null or p_level < 10 or p_level > 110 or p_level % 5 <> 0 then
    return jsonb_build_object('ok', false, 'reason', '档位需为 10~110 之间、5 的倍数');
  end if;

  v_gain := p_level / 5;

  v_col := case v_t.dim
             when 'de'  then 'xp_de'
             when 'zhi' then 'xp_zhi'
             when 'ti'  then 'xp_ti'
             when 'mei' then 'xp_mei'
             when 'lao' then 'xp_lao'
             else 'xp_zhi'
           end;
  execute format('update public.student_info set %I = greatest(0, coalesce(%I,0) + $1) where class=$2 and student_name=$3',
                 v_col, v_col) using v_gain, v_t.class, v_t.student_name;
  update public.student_info
     set xp = greatest(0, coalesce(xp,0) + v_gain)
   where class = v_t.class and student_name = v_t.student_name
   returning xp into v_xp;
  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp)
     where class = v_t.class and student_name = v_t.student_name;
    select level into v_lv from public.student_info
     where class = v_t.class and student_name = v_t.student_name;
  end if;

  update public.challenge_task
     set status='done', max_level=p_level, confirm_at=now(), filled_by='student'
   where id = p_task_id;
  return jsonb_build_object('ok', true, 'xp_delta', v_gain, 'level', v_lv, 'level_done', p_level);
end;
$$;

revoke execute on function public.confirm_challenge_task(uuid, int) from public;
grant  execute on function public.confirm_challenge_task(uuid, int) to anon, authenticated;

-- ------------------------------------------------------------
-- 3) 教师取消挑战（未完成才取消；已加分的不回退）
-- ------------------------------------------------------------
create or replace function public.delete_challenge_task(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_t public.challenge_task%rowtype;
begin
  select * into v_t from public.challenge_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '挑战不存在');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '已完成的挑战不能取消（经验已加）');
  end if;
  delete from public.challenge_task where id = p_task_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.delete_challenge_task(uuid) from public;
grant  execute on function public.delete_challenge_task(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- 自检（可选）：
--   select public.create_challenge_tasks('六年级一班','英语默写挑战','zhi', current_date, '[{"value":"谭欣龙"}]'::jsonb);
--   select public.confirm_challenge_task((select id from public.challenge_task where student_name='谭欣龙' and title='英语默写挑战' limit 1), 30);
