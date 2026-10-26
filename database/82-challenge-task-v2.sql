-- ============================================================
-- 82-challenge-task-v2.sql  挑战任务功能【独立重写】（v152，可重复执行）
--
-- 背景（80/81 号旧实现的缺陷，本次整体重写，不再依赖 80/81）：
--   ① 学生端调用 confirm_challenge_levels(p_task_id, p_levels 数组)，
--      但 80/81 号只定义了 confirm_challenge_task(p_task_id, p_level 单值) → 学生提交必失败
--   ② challenge_task 表没有 done_levels 列，两端前端却都在读 t.done_levels → 进度永远 0
--   ③ 旧 confirm 一次性把整条挑战置为 done，不支持分次提交多个档位（多选一次提交）
--   ④ 教师端 create_challenge_tasks 带 p_levels 参数，若库中只执行过 80 号（无 p_levels 参数版本）
--      则 RPC 报"函数不存在" → 教师端发布失败、列表无记录
--
-- 本文件自包含：建表（含 levels / done_levels）+ RLS + 三个 RPC：
--   1) create_challenge_tasks   教师批量布置（含自定义档位方案）
--   2) confirm_challenge_levels 学生提交本次新达成的多个档位（增量合并，支持多次提交）
--   3) delete_challenge_task    教师取消未完成挑战（已加经验的不允许取消）
-- 已执行过 80/81 的库可直接覆盖执行；全新库只跑本文件即可。
-- ============================================================

-- ---------- 1) 表结构（幂等） ----------
create table if not exists public.challenge_task (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,
  student_name text not null,
  title        text not null,                 -- 挑战名称，如"英语默写挑战"
  dim          text not null default 'zhi',   -- de/zhi/ti/mei/lao
  max_level    int,                           -- 最高达成档位（兼容旧列，新逻辑主要用 done_levels）
  status       text not null default 'pending', -- pending / done / cancelled
  task_date    date not null,
  create_at    timestamptz not null default now(),
  confirm_at   timestamptz,
  filled_by    text not null default 'student',
  levels       jsonb not null default '[[10,2],[15,3],[20,4],[25,5],[30,6],[35,7],[40,8],[45,9],[50,10],[55,11],[60,12],[65,13],[70,14],[75,15],[80,16],[85,17],[90,18],[95,19],[100,20],[105,21],[110,22]]'::jsonb,
  done_levels  jsonb not null default '[]'::jsonb   -- 该挑战已达成档位数组 [10,15,...]
);

-- 旧库补列
alter table public.challenge_task add column if not exists done_levels jsonb not null default '[]'::jsonb;
alter table public.challenge_task add column if not exists levels jsonb;
alter table public.challenge_task alter column levels set default '[[10,2],[15,3],[20,4],[25,5],[30,6],[35,7],[40,8],[45,9],[50,10],[55,11],[60,12],[65,13],[70,14],[75,15],[80,16],[85,17],[90,18],[95,19],[100,20],[105,21],[110,22]]'::jsonb;
alter table public.challenge_task alter column done_levels set default '[]'::jsonb;
-- 存量数据兜底
update public.challenge_task set levels = '[[10,2],[15,3],[20,4],[25,5],[30,6],[35,7],[40,8],[45,9],[50,10],[55,11],[60,12],[65,13],[70,14],[75,15],[80,16],[85,17],[90,18],[95,19],[100,20],[105,21],[110,22]]'::jsonb
 where levels is null;
update public.challenge_task set done_levels = '[]'::jsonb where done_levels is null;

alter table public.challenge_task enable row level security;

-- 学生端 / 教师端直查（前端按 class+student_name 过滤；教师端看全班）
-- v152 修复：旧 80/81 号策略只授权 anon，教师端登录后是 authenticated 角色 → 教师端列表永远为空
drop policy if exists "challenge_select_all" on public.challenge_task;
create policy "challenge_select_all" on public.challenge_task
  for select to anon, authenticated using (true);

-- ---------- 2) 教师批量布置挑战（可自定义档位方案） ----------
-- 参数名与教师端 teacher.js 调用一致：p_class/p_title/p_dim/p_date/p_students/p_levels
drop function if exists public.create_challenge_tasks(text, text, text, date, jsonb);
create or replace function public.create_challenge_tasks(
  p_class    text,
  p_title    text,
  p_dim      text default 'zhi',
  p_date     date default null,
  p_students jsonb default '[]'::jsonb,
  p_levels   jsonb default null
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
  v_lv jsonb := coalesce(p_levels,
    '[[10,2],[15,3],[20,4],[25,5],[30,6],[35,7],[40,8],[45,9],[50,10],[55,11],[60,12],[65,13],[70,14],[75,15],[80,16],[85,17],[90,18],[95,19],[100,20],[105,21],[110,22]]'::jsonb);
begin
  if p_class is null or p_title is null or btrim(p_title) = '' then
    return jsonb_build_object('ok', false, 'reason', '参数不完整');
  end if;
  if jsonb_typeof(v_lv) <> 'array' or jsonb_array_length(v_lv) = 0 then
    return jsonb_build_object('ok', false, 'reason', '档位方案不能为空');
  end if;
  -- 档位方案格式校验：每项必须是 [档位(>0整数), 经验(>=0整数)]
  if exists (
    select 1 from jsonb_array_elements(v_lv) a
     where jsonb_typeof(a) <> 'array'
        or jsonb_array_length(a) < 2
        or not (a->>0) ~ '^-?[0-9]+$'
        or not (a->>1) ~ '^-?[0-9]+$'
        or (a->>0)::int <= 0
        or (a->>1)::int < 0
  ) then
    return jsonb_build_object('ok', false, 'reason', '档位方案格式错误：需 [[档位,经验],...]');
  end if;

  for v_stu in select * from jsonb_array_elements(coalesce(p_students, '[]'::jsonb))
  loop
    v_name := v_stu ->> 'value';
    if v_name is null or v_name = '' then continue; end if;
    -- 同班同名同标题的"待完成"挑战视为重复，跳过（已完成的允许再次布置新挑战）
    select exists(
      select 1 from public.challenge_task
       where class = p_class and student_name = v_name
         and title = p_title and status = 'pending'
    ) into v_ex;
    if v_ex then
      v_skipped := v_skipped + 1;
    else
      insert into public.challenge_task (class, student_name, title, dim, task_date, status, levels)
      values (p_class, v_name, btrim(p_title), coalesce(p_dim, 'zhi'), v_d, 'pending', v_lv);
      v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.create_challenge_tasks(text, text, text, date, jsonb, jsonb) from public;
grant  execute on function public.create_challenge_tasks(text, text, text, date, jsonb, jsonb) to anon, authenticated;

-- ---------- 3) 学生提交本次新达成的档位（数组，可多次提交） ----------
-- 与 student.js 调用一致：confirm_challenge_levels(p_task_id, p_levels 数组)
-- 行为：
--   · 每个档位必须在挑战档位方案内，且尚未达成过 → 才算新增
--   · 新增档位按方案经验值逐档累加，加到对应维度与总经验，并重算等级
--   · done_levels 增量合并；全部档位达成后 status 置 done（未全部达成仍为 pending，可继续提交）
drop function if exists public.confirm_challenge_task(uuid, int);
create or replace function public.confirm_challenge_levels(p_task_id uuid, p_levels jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_t        public.challenge_task%rowtype;
  v_done     int[] := '{}';
  v_new      int[] := '{}';
  v_item     jsonb;
  v_lv_num   int;
  v_found    boolean;
  v_xp_one   int;
  v_xp_earn  int := 0;
  v_xp_cur   int;
  v_lv       int;
  v_col      text;
  v_done_cnt int;
  v_total    int;
  v_row_ex   boolean;
begin
  select * into v_t from public.challenge_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '挑战不存在或已取消');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '该挑战已全部达成');
  end if;
  if jsonb_typeof(p_levels) <> 'array' or jsonb_array_length(p_levels) = 0 then
    return jsonb_build_object('ok', false, 'reason', '请先勾选本次达成的档位');
  end if;

  -- 已达成档位 → int[]
  select coalesce(array_agg((e#>>'{}')::int), '{}')
    into v_done
    from jsonb_array_elements(coalesce(v_t.done_levels, '[]'::jsonb)) e
   where (e#>>'{}') ~ '^-?[0-9]+$';

  -- 逐个校验：须在方案内且未达成过
  for v_item in select * from jsonb_array_elements(p_levels)
  loop
    if (v_item#>>'{}') ~ '^-?[0-9]+$' then
      v_lv_num := (v_item#>>'{}')::int;
    else
      continue;
    end if;
    if v_lv_num = any(v_done) then continue; end if;
    -- 是否在挑战档位方案内
    select exists(
      select 1 from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)) a
       where (a->>0)::int = v_lv_num
    ) into v_found;
    if not v_found then continue; end if;
    v_new := array_append(v_new, v_lv_num);
    select coalesce((a->>1)::int, 0)
      into v_xp_one
      from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)) a
     where (a->>0)::int = v_lv_num
     limit 1;
    v_xp_earn := v_xp_earn + coalesce(v_xp_one, 0);   -- 逐档累加本次新增经验
  end loop;

  if array_length(v_new, 1) is null then
    return jsonb_build_object('ok', false, 'reason', '没有可新增的达成档位（请勿重复提交）');
  end if;

  select exists(
    select 1 from public.student_info
     where class = v_t.class and student_name = v_t.student_name
  ) into v_row_ex;
  if not v_row_ex then
    return jsonb_build_object('ok', false, 'reason', '名单中未找到该学生，请联系老师');
  end if;

  -- 加分：对应维度列 + 总经验
  v_col := case v_t.dim
             when 'de'  then 'xp_de'
             when 'zhi' then 'xp_zhi'
             when 'ti'  then 'xp_ti'
             when 'mei' then 'xp_mei'
             when 'lao' then 'xp_lao'
             else 'xp_zhi'
           end;
  execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) + $1) where class = $2 and student_name = $3',
                 v_col, v_col) using v_xp_earn, v_t.class, v_t.student_name;
  update public.student_info
     set xp = greatest(0, coalesce(xp, 0) + v_xp_earn)
   where class = v_t.class and student_name = v_t.student_name
   returning xp into v_xp_cur;
  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp_cur)
     where class = v_t.class and student_name = v_t.student_name;
    select level into v_lv from public.student_info
     where class = v_t.class and student_name = v_t.student_name;
  end if;

  -- 合并已达成档位（去重排序）
  v_done := array(select distinct x from unnest(v_done || v_new) x order by 1);
  v_done_cnt := cardinality(v_done);
  v_total := (select count(*)::int from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)));

  update public.challenge_task
     set status = case when v_done_cnt >= v_total then 'done' else 'pending' end,
         max_level = (select max(x) from unnest(v_done) x),
         done_levels = to_jsonb(v_done),
         confirm_at = now(),
         filled_by = 'student'
   where id = p_task_id;

  return jsonb_build_object(
    'ok', true,
    'xp_delta', v_xp_earn,
    'level', v_lv,
    'new_levels', to_jsonb(v_new),
    'done_count', v_done_cnt,
    'total_count', v_total,
    'status', case when v_done_cnt >= v_total then 'done' else 'pending' end
  );
end;
$$;

revoke execute on function public.confirm_challenge_levels(uuid, jsonb) from public;
grant  execute on function public.confirm_challenge_levels(uuid, jsonb) to anon, authenticated;

-- ---------- 4) 教师取消挑战（仅未完成的；已加分的不回退、不允许取消） ----------
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
    return jsonb_build_object('ok', false, 'reason', '已全部达成的挑战不能取消（经验已加）');
  end if;
  delete from public.challenge_task where id = p_task_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.delete_challenge_task(uuid) from public;
grant  execute on function public.delete_challenge_task(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- 自检（可选）：
--   select public.create_challenge_tasks('六年级一班','英语默写挑战','zhi', current_date, '[{"value":"谭欣龙"}]'::jsonb, '[[10,2],[15,3],[20,4]]'::jsonb);
--   select public.confirm_challenge_levels((select id from public.challenge_task where student_name='谭欣龙' and title='英语默写挑战' and status='pending' limit 1), '[10,15]'::jsonb);
--   select * from public.challenge_task order by create_at desc limit 5;
