-- ============================================================================
-- 131-test-student.sql
-- 虚拟测试学生：一个由教师端创建、管理的模拟学生账号，用于测试与排查。
--
-- 设计口径：
--   1) student_info.is_test 标记；默认不进学生墙、不计入班级星光值，
--      因此不影响真实学生统计与正常教学流程。
--   2) 学生端加 ?test=1 才把测试学生并入班级墙（同一套渲染/提交流程），
--      其数据与真实学生同结构：daily_record / xp_log / star_ledger / 钱包。
--   3) 教师端「测试工具」页统一管理：创建、启用/停用、生成测试数据、查看、清理。
--   4) 所有管理动作写 test_student_log，便于追溯是谁在什么时候做了什么。
--   5) 停用后由触发器拦截写入，避免绕过界面继续产生数据。
--
-- 可重复执行（幂等）。执行位置：Supabase → SQL Editor。
-- ============================================================================

-- ---------------------------------------------------------------- 1. 标记列
alter table public.student_info add column if not exists is_test           boolean not null default false;
alter table public.student_info add column if not exists test_enabled     boolean not null default true;
alter table public.student_info add column if not exists test_show_on_wall boolean not null default false;
alter table public.student_info add column if not exists test_config      jsonb   not null default '{}'::jsonb;
alter table public.student_info add column if not exists test_note        text;
alter table public.student_info add column if not exists test_created_at  timestamptz;

comment on column public.student_info.is_test is '仅用于测试的模拟学生：默认不出现在学生墙、不计入班级星光值';

create index if not exists idx_student_info_is_test
  on public.student_info (class) where is_test;

-- ---------------------------------------------------------------- 2. 审计表
create table if not exists public.test_student_log (
  id           bigserial primary key,
  class        text not null,
  student_name text not null,
  action       text not null,                       -- create / update / generate / clear / delete
  detail       jsonb not null default '{}'::jsonb,
  actor        text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_test_student_log_class
  on public.test_student_log (class, created_at desc);

alter table public.test_student_log enable row level security;
drop policy if exists teacher_all_test_student_log on public.test_student_log;
create policy teacher_all_test_student_log on public.test_student_log
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------- 3. 名单视图
-- 追加 is_test / test_enabled / test_show_on_wall，供学生墙给测试卡打标
drop view if exists public.student_directory;
create view public.student_directory as
  select id, class, student_name, avatar, frame, xp, level,
         is_test, test_enabled, test_show_on_wall
  from public.student_info;
comment on view public.student_directory is '学生端班级墙只读视图：班级、姓名、头像、头像框、经验、等级、测试标记';
grant select on public.student_directory to anon, authenticated;

-- ---------------------------------------------------------------- 4. 班级墙聚合
-- 新增 p_include_test：默认 false，测试学生完全不进入名单与记录，
-- 因此平均星级、今日人数、排名都不受影响。
drop function if exists public.get_wall_data(text, text);

create or replace function public.get_wall_data(
  p_class        text,
  p_semester     text default null,
  p_include_test boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_roster  jsonb;
  v_records jsonb;
  v_tasks   jsonb;
  v_seat    jsonb;
  v_subs    jsonb;
  v_today   date := (now() at time zone 'Asia/Shanghai')::date;
  v_since   date := v_today - 30;
  v_task_ids uuid[];
begin
  -- 1) 名单：测试学生仅在 include_test 或显式允许上墙时出现
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'class', i.class, 'student_name', i.student_name,
           'avatar', i.avatar, 'frame', i.frame, 'xp', i.xp, 'level', i.level,
           'is_test', i.is_test, 'test_enabled', i.test_enabled,
           'test_show_on_wall', i.test_show_on_wall)
           order by i.student_name), '[]'::jsonb)
    into v_roster
    from public.student_directory i
   where btrim(i.class) = btrim(p_class)
     and (i.is_test = false
          or (i.test_enabled = true
              and (p_include_test = true or i.test_show_on_wall = true)));

  -- 2) 近 30 天记录：与名单同口径过滤，避免测试记录混进平均星级/今日人数
  select coalesce(jsonb_agg(x), '[]'::jsonb)
    into v_records
    from (
      select jsonb_build_object(
               'id', r.id, 'student_name', r.student_name, 'class', r.class,
               'record_date', r.record_date, 'self_evaluation', r.self_evaluation,
               'mood', coalesce(r.behavior->>'mood', ''), 'create_at', r.create_at)
        from public.daily_record r
       where btrim(r.class) = btrim(p_class)
         and r.record_date >= v_since
         and (p_semester is null or r.semester = p_semester)
         and not exists (
               select 1 from public.student_info ti
                where btrim(ti.class) = btrim(r.class)
                  and btrim(ti.student_name) = btrim(r.student_name)
                  and ti.is_test = true
                  and p_include_test = false)
       order by r.record_date desc, r.create_at desc
       limit 500
    ) x;

  -- 3) 今日任务
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'task_type', t.task_type)
           order by t.id), '[]'::jsonb)
    into v_tasks
    from public.daily_task t
   where btrim(t.class) = btrim(p_class)
     and t.task_date = v_today;

  -- 4) 座位表
  select coalesce(jsonb_agg(jsonb_build_object(
           'student_name', s.student_name, 'seat_row', s.seat_row, 'seat_col', s.seat_col)), '[]'::jsonb)
    into v_seat
    from public.seat_grid s
   where btrim(s.class) = btrim(p_class);

  -- 5) 今日任务提交
  v_task_ids := (select coalesce(array_agg(t.id), '{}'::uuid[])
                   from public.daily_task t
                  where btrim(t.class) = btrim(p_class) and t.task_date = v_today);
  if cardinality(v_task_ids) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'student_name', su.student_name, 'task_id', su.task_id, 'grade', su.grade)), '[]'::jsonb)
      into v_subs
      from public.task_submission su
     where su.task_id = any(v_task_ids);
  else
    v_subs := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'ok', true, 'roster', v_roster, 'records', v_records,
    'tasks', v_tasks, 'seat', v_seat, 'subs', v_subs);
end;
$$;

revoke execute on function public.get_wall_data(text, text, boolean) from public;
grant  execute on function public.get_wall_data(text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------- 5. 班级星光值隔离
-- 复刻 109 号的 star_sync_wallet，唯一改动：测试学生的星光值不转化为班级经验。
create or replace function public.star_sync_wallet()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_delta int := 0;
  v_rate  int := 1;
  v_bal   int;
begin
  if tg_op = 'INSERT' then
    v_delta := greatest(0, coalesce(new.xp, 0));
  else
    v_delta := coalesce(new.xp, 0) - coalesce(old.xp, 0);
  end if;

  if tg_op = 'INSERT' and v_delta <= 0 then
    insert into public.student_wallet(class, student_name, balance, total_earned, total_spent)
    values (new.class, new.student_name, 0, 0, 0)
    on conflict (class, student_name) do nothing;
    return new;
  end if;

  if v_delta > 0 then
    insert into public.student_wallet(class, student_name, balance, total_earned, total_spent)
    values (new.class, new.student_name, v_delta, v_delta, 0)
    on conflict (class, student_name) do update
      set balance = public.student_wallet.balance + v_delta,
          total_earned = public.student_wallet.total_earned + v_delta,
          updated_at = now()
    returning balance into v_bal;

    insert into public.star_ledger(class, student_name, amount, balance_after, reason, source)
    values (new.class, new.student_name, v_delta, coalesce(v_bal, v_delta), '在校表现获得', 'earn');

    select coalesce(value, 1)::int into v_rate from public.star_config where key = 'star_to_class_xp';
    -- v131：测试学生只记个人星光值，不推高班级等级/抽奖机会
    if coalesce(v_rate, 1) > 0 and coalesce(new.is_test, false) = false then
      perform public.class_add_xp(new.class, v_delta * v_rate);
    end if;

  elsif v_delta < 0 then
    update public.student_wallet
       set balance = greatest(0, balance + v_delta),
           updated_at = now()
     where class = new.class and student_name = new.student_name
    returning balance into v_bal;

    if v_bal is not null then
      insert into public.star_ledger(class, student_name, amount, balance_after, reason, source)
      values (new.class, new.student_name, v_delta, v_bal, '记录调整扣减', 'adjust');
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------- 6. 停用拦截
create or replace function public.guard_test_student_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from public.student_info si
     where btrim(si.class) = btrim(new.class)
       and btrim(si.student_name) = btrim(new.student_name)
       and si.is_test = true
       and si.test_enabled = false
  ) then
    raise exception '测试学生已停用，不能写入数据';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_test_student_daily on public.daily_record;
create trigger trg_guard_test_student_daily
  before insert or update on public.daily_record
  for each row execute function public.guard_test_student_write();

drop trigger if exists trg_guard_test_student_task on public.task_submission;
create trigger trg_guard_test_student_task
  before insert or update on public.task_submission
  for each row execute function public.guard_test_student_write();

-- ---------------------------------------------------------------- 7. 管理接口
-- 7.1 读取测试学生（含统计）
create or replace function public.test_student_get(p_class text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_row   public.student_info%rowtype;
  v_stats jsonb;
  v_wallet jsonb;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select * into v_row
    from public.student_info
   where btrim(class) = btrim(p_class) and is_test = true
   order by test_created_at nulls last
   limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', true, 'exists', false);
  end if;

  select jsonb_build_object(
           'records',   (select count(*) from public.daily_record
                          where class = v_row.class and student_name = v_row.student_name),
           'today',     (select count(*) from public.daily_record
                          where class = v_row.class and student_name = v_row.student_name
                            and record_date = v_today),
           'submissions', (select count(*) from public.task_submission
                          where class = v_row.class and student_name = v_row.student_name),
           'ledger',    (select count(*) from public.star_ledger
                          where class = v_row.class and student_name = v_row.student_name),
           'last_record', (select max(record_date) from public.daily_record
                          where class = v_row.class and student_name = v_row.student_name))
    into v_stats;

  select jsonb_build_object('balance', coalesce(balance, 0),
                            'total_earned', coalesce(total_earned, 0),
                            'total_spent', coalesce(total_spent, 0))
    into v_wallet
    from public.student_wallet
   where class = v_row.class and student_name = v_row.student_name;
  v_wallet := coalesce(v_wallet, jsonb_build_object('balance', 0, 'total_earned', 0, 'total_spent', 0));

  return jsonb_build_object(
    'ok', true, 'exists', true,
    'student', jsonb_build_object(
      'id', v_row.id, 'class', v_row.class, 'name', v_row.student_name,
      'avatar', v_row.avatar, 'frame', v_row.frame,
      'xp', v_row.xp, 'level', v_row.level,
      'enabled', v_row.test_enabled, 'show_on_wall', v_row.test_show_on_wall,
      'note', v_row.test_note, 'created_at', v_row.test_created_at,
      'config', v_row.test_config),
    'wallet', v_wallet,
    'stats', v_stats);
end;
$$;

-- 7.2 创建 / 更新（每个班级只保留 1 个测试学生）
create or replace function public.test_student_save(
  p_class        text,
  p_name         text default '测试学生',
  p_enabled      boolean default true,
  p_show_on_wall boolean default false,
  p_note         text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_row public.student_info%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_actor text := coalesce(auth.jwt()->>'email', '');
begin
  if btrim(coalesce(p_class, '')) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_class');
  end if;
  v_name := coalesce(v_name, '测试学生');

  -- 与真实学生重名直接拒绝，避免把真实学生的数据当成测试数据
  if exists (select 1 from public.student_info
              where btrim(class) = btrim(p_class)
                and btrim(student_name) = btrim(v_name)
                and is_test = false) then
    return jsonb_build_object('ok', false, 'reason', 'name_conflict');
  end if;

  select * into v_row
    from public.student_info
   where btrim(class) = btrim(p_class) and is_test = true
   limit 1;

  if v_row.id is null then
    insert into public.student_info(class, student_name, avatar, is_test,
                                    test_enabled, test_show_on_wall, test_note, test_created_at)
    values (btrim(p_class), v_name, null, true,
            coalesce(p_enabled, true), coalesce(p_show_on_wall, false), p_note, now())
    returning * into v_row;

    insert into public.test_student_log(class, student_name, action, detail, actor)
    values (v_row.class, v_row.student_name, 'create',
            jsonb_build_object('enabled', v_row.test_enabled, 'show_on_wall', v_row.test_show_on_wall), v_actor);
  else
    -- 创建后不允许改名：钱包/库存/流水都以姓名为键，改名会让历史数据脱钩
    if v_name <> v_row.student_name then
      return jsonb_build_object('ok', false, 'reason', 'rename_blocked');
    end if;

    update public.student_info
       set student_name = v_name,
           test_enabled = coalesce(p_enabled, test_enabled),
           test_show_on_wall = coalesce(p_show_on_wall, test_show_on_wall),
           test_note = p_note
     where id = v_row.id
     returning * into v_row;

    insert into public.test_student_log(class, student_name, action, detail, actor)
    values (v_row.class, v_row.student_name, 'update',
            jsonb_build_object('enabled', v_row.test_enabled, 'show_on_wall', v_row.test_show_on_wall), v_actor);
  end if;

  return public.test_student_get(v_row.class);
end;
$$;

-- 7.3 生成测试数据：近 N 天每天 M 条记录，标签随机取自启用中的积极标签
create or replace function public.test_student_generate(
  p_class    text,
  p_days     int default 7,
  p_per_day  int default 1,
  p_star_min int default 3,
  p_star_max int default 5,
  p_mood     text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_row    public.student_info%rowtype;
  v_days   int := least(greatest(coalesce(p_days, 7), 1), 60);
  v_per    int := least(greatest(coalesce(p_per_day, 1), 1), 5);
  v_min    int := least(greatest(coalesce(p_star_min, 3), 1), 5);
  v_max    int := least(greatest(coalesce(p_star_max, 5), 1), 5);
  v_today  date := (now() at time zone 'Asia/Shanghai')::date;
  v_sem    text;
  v_tags   uuid[];
  v_date   date;
  v_mood   text;
  v_star   int;
  v_items  jsonb;
  v_tag    uuid;
  v_i      int;
  v_i2     int;
  v_k      int;
  v_n      int := 0;
  v_actor  text := coalesce(auth.jwt()->>'email', '');
begin
  if v_min > v_max then v_min := v_max; end if;

  select * into v_row from public.student_info
   where btrim(class) = btrim(p_class) and is_test = true limit 1;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_test_student');
  end if;
  if v_row.test_enabled = false then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  select array_agg(id) into v_tags
    from public.behavior_tags
   where is_active = true and category = 'positive' and xp_value > 0;

  v_sem := case
    when to_char(v_today, 'MM-DD') >= '09-01' then to_char(v_today, 'YYYY') || '秋'
    when to_char(v_today, 'MM-DD') >= '01-08' then to_char(v_today, 'YYYY') || '春'
    else to_char(v_today - interval '1 year', 'YYYY') || '秋'
  end;

  for v_i in 0 .. v_days - 1 loop
    v_date := v_today - v_i;
    -- 同一天已有记录就跳过，避免重复叠加
    if exists (select 1 from public.daily_record
                where class = v_row.class and student_name = v_row.student_name
                  and record_date = v_date) then
      continue;
    end if;

    v_mood := coalesce(nullif(btrim(coalesce(p_mood, '')), ''),
                       (array['happy','good','normal','down','sad'])[1 + floor(random() * 5)::int]);
    v_star := v_min + floor(random() * (v_max - v_min + 1))::int;
    v_items := '[]'::jsonb;

    if v_tags is not null and array_length(v_tags, 1) > 0 then
      v_k := 1 + floor(random() * 3)::int;
      for v_i2 in 1 .. v_k loop
        v_tag := v_tags[1 + floor(random() * array_length(v_tags, 1))::int];
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'id', v_tag, 'category', 'positive', 'value', '测试'));
      end loop;
      -- 去重，避免同一标签重复计分
      select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
        into v_items
        from jsonb_array_elements(v_items) e;
    end if;

    insert into public.daily_record(student_name, class, record_date, self_evaluation,
                                    behavior, teacher_comment, semester)
    values (v_row.student_name, v_row.class, v_date, v_star,
            jsonb_build_object('mood', v_mood, 'items', v_items),
            '测试数据（自动生成）', v_sem);
    v_n := v_n + 1;

    -- 每天只生成 1 条时直接下一天；多条时重复当前日期
    if v_per > 1 then
      for v_i2 in 2 .. v_per loop
        insert into public.daily_record(student_name, class, record_date, self_evaluation,
                                        behavior, teacher_comment, semester)
        values (v_row.student_name, v_row.class, v_date,
                v_min + floor(random() * (v_max - v_min + 1))::int,
                jsonb_build_object('mood', v_mood, 'items', v_items),
                '测试数据（自动生成）', v_sem);
        v_n := v_n + 1;
      end loop;
    end if;
  end loop;

  update public.student_info
     set test_config = jsonb_build_object(
           'days', v_days, 'per_day', v_per, 'star_min', v_min, 'star_max', v_max,
           'mood', p_mood, 'last_generated_at', now())
   where id = v_row.id;

  insert into public.test_student_log(class, student_name, action, detail, actor)
  values (v_row.class, v_row.student_name, 'generate',
          jsonb_build_object('records', v_n, 'days', v_days, 'per_day', v_per,
                             'star_min', v_min, 'star_max', v_max), v_actor);

  return public.test_student_get(v_row.class) || jsonb_build_object('generated', v_n);
end;
$$;

-- 7.4 清空测试数据（保留账号，可继续测试）
create or replace function public.test_student_clear(
  p_class text,
  p_keep_account boolean default true
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_row   public.student_info%rowtype;
  v_sid   uuid;
  v_name  text;
  v_cls   text;
  v_actor text := coalesce(auth.jwt()->>'email', '');
  v_n     int := 0;
begin
  select * into v_row from public.student_info
   where btrim(class) = btrim(p_class) and is_test = true limit 1;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_test_student');
  end if;
  v_sid := v_row.id; v_name := v_row.student_name; v_cls := v_row.class;

  delete from public.task_submission   where class = v_cls and student_name = v_name;
  delete from public.daily_record      where class = v_cls and student_name = v_name;  -- 触发器回退经验
  delete from public.personal_task     where class = v_cls and student_name = v_name;
  delete from public.manual_task       where class = v_cls and student_name = v_name;
  delete from public.challenge_submission where class = v_cls and student_name = v_name;
  delete from public.auto_bonus_log    where class = v_cls and student_name = v_name;
  delete from public.xp_log            where class = v_cls and student_name = v_name;
  delete from public.xp_anomaly        where class = v_cls and student_name = v_name;
  delete from public.record_undo       where class = v_cls and student_name = v_name;
  delete from public.seat_grid         where class = v_cls and student_name = v_name;
  delete from public.class_draw_log    where class = v_cls and student_name = v_name;
  delete from public.exam_score        where class = v_cls and student_name = v_name;
  delete from public.exam_paper        where student_id = v_sid;
  delete from public.home_note         where student_id = v_sid;
  delete from public.student_achievements where student_id = v_sid;
  delete from public.student_coupon    where class = v_cls and student_name = v_name;
  delete from public.student_inventory where class = v_cls and student_name = v_name;
  delete from public.archive_daily_record  where class = v_cls and student_name = v_name;
  delete from public.archive_task_submission where class = v_cls and student_name = v_name;
  delete from public.archive_star_ledger   where class = v_cls and student_name = v_name;
  delete from public.archive_inventory     where class = v_cls and student_name = v_name;
  delete from public.archive_student       where id = v_sid;

  if p_keep_account then
    update public.student_info
       set xp = 0, xp_de = 0, xp_zhi = 0, xp_ti = 0, xp_mei = 0, xp_lao = 0,
           level = 1, avatar_changes_today = 0
     where id = v_sid;
  end if;

  delete from public.star_ledger    where class = v_cls and student_name = v_name;
  delete from public.student_wallet where class = v_cls and student_name = v_name;

  if p_keep_account = false then
    delete from public.student_info where id = v_sid;
  end if;

  insert into public.test_student_log(class, student_name, action, detail, actor)
  values (v_cls, v_name, case when p_keep_account then 'clear' else 'delete' end,
          jsonb_build_object('keep_account', p_keep_account), v_actor);

  if p_keep_account = false then
    return jsonb_build_object('ok', true, 'deleted', true);
  end if;
  return public.test_student_get(v_cls);
end;
$$;

-- 7.5 查看最近记录（教师端展示用）
create or replace function public.test_student_data(
  p_class text,
  p_limit int default 20
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_row public.student_info%rowtype;
  v_rows jsonb;
begin
  select * into v_row from public.student_info
   where btrim(class) = btrim(p_class) and is_test = true limit 1;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_test_student');
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object(
               'date', r.record_date, 'star', r.self_evaluation,
               'mood', coalesce(r.behavior->>'mood', ''),
               'items', jsonb_array_length(coalesce(r.behavior->'items', '[]'::jsonb)),
               'comment', r.teacher_comment, 'created_at', r.create_at) x
        from public.daily_record r
       where r.class = v_row.class and r.student_name = v_row.student_name
       order by r.record_date desc, r.create_at desc
       limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) s;

  return jsonb_build_object('ok', true, 'records', v_rows);
end;
$$;

-- ---------------------------------------------------------------- 8. 权限
revoke all on function public.test_student_get(text) from public, anon;
revoke all on function public.test_student_save(text, text, boolean, boolean, text) from public, anon;
revoke all on function public.test_student_generate(text, int, int, int, int, text) from public, anon;
revoke all on function public.test_student_clear(text, boolean) from public, anon;
revoke all on function public.test_student_data(text, int) from public, anon;
grant execute on function public.test_student_get(text) to authenticated;
grant execute on function public.test_student_save(text, text, boolean, boolean, text) to authenticated;
grant execute on function public.test_student_generate(text, int, int, int, int, text) to authenticated;
grant execute on function public.test_student_clear(text, boolean) to authenticated;
grant execute on function public.test_student_data(text, int) to authenticated;

-- ---------------------------------------------------------------- 9. 自查
select 'test_student_ready' as result,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'student_info'
           and column_name in ('is_test','test_enabled','test_show_on_wall','test_config','test_note','test_created_at')) as cols,
       (select count(*) from pg_proc
         where pronamespace = 'public'::regnamespace and proname like 'test_student_%') as funcs;

notify pgrst, 'reload schema';
