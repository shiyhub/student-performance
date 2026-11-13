-- ============================================================
-- 109-star-currency.sql
-- 星光值体系（替代经验值）＋星光商店＋班级经验/等级/抽奖＋数据封存
-- 设计原则：
--   1) 保留 student_info.xp 作为「累计获得星光值」（只增不减，供等级与统计使用）
--   2) 新增 student_wallet.balance 作为「可消费余额」（货币），兑换只扣余额
--   3) 任何 xp 增加 → 同步钱包 + 写流水 + 按比例转化为班级经验
--   4) 班级升级 → 自动发放 1 次抽奖机会（class_draw_chance）
-- 可重复执行（幂等）。
-- ============================================================

-- ---------- 0. 配置 ----------
create table if not exists public.star_config (
  key        text primary key,
  value      numeric not null,
  note       text,
  updated_at timestamptz not null default now()
);

insert into public.star_config(key, value, note) values
  ('star_to_class_xp', 1, '学生每获得 1 点星光值，转化为 1 点班级经验'),
  ('shop_refund_on_reset', 0, '封存重置时是否退还已消费星光值（0=不退）')
on conflict (key) do nothing;

-- ---------- 1. 钱包与流水 ----------
create table if not exists public.student_wallet (
  class        text not null,
  student_name text not null,
  balance      integer not null default 0 check (balance >= 0),
  total_earned integer not null default 0,
  total_spent  integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (class, student_name)
);

create table if not exists public.star_ledger (
  id            uuid primary key default gen_random_uuid(),
  class         text not null,
  student_name  text not null,
  amount        integer not null,               -- 正=获得，负=消费/扣减
  balance_after integer not null default 0,
  reason        text not null default '星光值变动',
  source        text not null default 'earn',    -- earn / spend / draw / archive / adjust
  ref_table     text,
  ref_id        uuid,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_star_ledger_stu on public.star_ledger(class, student_name, created_at desc);
create index if not exists idx_star_ledger_time on public.star_ledger(created_at desc);

-- ---------- 2. 班级经验 / 等级 / 抽奖机会 ----------
create table if not exists public.class_level_rule (
  level   integer primary key,
  need_xp integer not null
);
insert into public.class_level_rule(level, need_xp)
select g, (g - 1) * 3000 from generate_series(1, 99) g
on conflict (level) do nothing;

create table if not exists public.class_progress (
  class      text primary key,
  xp         integer not null default 0,
  level      integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.class_draw_log (
  id         uuid primary key default gen_random_uuid(),
  class      text not null,
  level      integer not null,
  prize_key  text,
  prize_name text,
  prize_icon text,
  prize_type text,
  prize_value integer default 0,
  student_name text,
  drawn_at   timestamptz not null default now()
);
create index if not exists idx_class_draw_log_class on public.class_draw_log(class, drawn_at desc);

create table if not exists public.class_draw_chance (
  id          uuid primary key default gen_random_uuid(),
  class       text not null,
  level       integer not null,
  granted_at  timestamptz not null default now(),
  used_at     timestamptz,
  prize_key   text,
  draw_log_id uuid,
  unique (class, level)
);

-- ---------- 3. 商店与库存 ----------
create table if not exists public.shop_item (
  item_key   text primary key,
  item_type  text not null check (item_type in ('avatar', 'frame')),
  name       text not null,
  price      integer not null default 0 check (price >= 0),
  group_name text,
  sort_order integer not null default 100,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists idx_shop_item_type on public.shop_item(item_type, sort_order);

create table if not exists public.student_inventory (
  class        text not null,
  student_name text not null,
  item_type    text not null check (item_type in ('avatar', 'frame')),
  item_key     text not null,
  price_paid   integer not null default 0,
  source       text not null default 'purchase',  -- purchase / draw / gift / migrate
  acquired_at  timestamptz not null default now(),
  primary key (class, student_name, item_type, item_key)
);
create index if not exists idx_inventory_stu on public.student_inventory(class, student_name);

-- ---------- 4. 抽奖奖池 ----------
create table if not exists public.lottery_prize (
  prize_key   text primary key,
  name        text not null,
  icon        text not null default '🎁',
  prize_type  text not null check (prize_type in ('star', 'class_star', 'avatar', 'frame', 'none')),
  prize_value integer not null default 0,
  prize_item  text,
  weight      numeric not null default 1 check (weight > 0),
  enabled     boolean not null default true
);

-- ---------- 5. 归档表（结构与业务表一致，仅追加 archive_batch_id / archived_at） ----------
create table if not exists public.archive_batch (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  note       text,
  stats      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.archive_student (
  like public.student_info including defaults
);
alter table public.archive_student add column if not exists archive_batch_id uuid;
alter table public.archive_student add column if not exists archived_at timestamptz not null default now();

create table if not exists public.archive_daily_record (like public.daily_record including defaults);
alter table public.archive_daily_record add column if not exists archive_batch_id uuid;
alter table public.archive_daily_record add column if not exists archived_at timestamptz not null default now();

create table if not exists public.archive_task_submission (like public.task_submission including defaults);
alter table public.archive_task_submission add column if not exists archive_batch_id uuid;

create table if not exists public.archive_challenge_submission (like public.challenge_submission including defaults);
alter table public.archive_challenge_submission add column if not exists archive_batch_id uuid;

create table if not exists public.archive_exam_paper (like public.exam_paper including defaults);
alter table public.archive_exam_paper add column if not exists archive_batch_id uuid;

create table if not exists public.archive_exam_score (like public.exam_score including defaults);
alter table public.archive_exam_score add column if not exists archive_batch_id uuid;

create table if not exists public.archive_home_note (like public.home_note including defaults);
alter table public.archive_home_note add column if not exists archive_batch_id uuid;

create table if not exists public.archive_xp_log (like public.xp_log including defaults);
alter table public.archive_xp_log add column if not exists archive_batch_id uuid;

create table if not exists public.archive_star_ledger (like public.star_ledger including defaults);
alter table public.archive_star_ledger add column if not exists archive_batch_id uuid;

create table if not exists public.archive_inventory (like public.student_inventory including defaults);
alter table public.archive_inventory add column if not exists archive_batch_id uuid;

create table if not exists public.archive_personal_task (like public.personal_task including defaults);
alter table public.archive_personal_task add column if not exists archive_batch_id uuid;

create table if not exists public.archive_manual_task (like public.manual_task including defaults);
alter table public.archive_manual_task add column if not exists archive_batch_id uuid;

create table if not exists public.archive_challenge_task (like public.challenge_task including defaults);
alter table public.archive_challenge_task add column if not exists archive_batch_id uuid;

create table if not exists public.archive_home_note_reply (like public.home_note_reply including defaults);
alter table public.archive_home_note_reply add column if not exists archive_batch_id uuid;

create table if not exists public.archive_xp_anomaly (like public.xp_anomaly including defaults);
alter table public.archive_xp_anomaly add column if not exists archive_batch_id uuid;

-- 归档表统一索引
create index if not exists idx_arch_stu on public.archive_student(archive_batch_id, class, student_name);
create index if not exists idx_arch_rec on public.archive_daily_record(archive_batch_id, class, student_name, record_date desc);

-- ============================================================
-- 6. 班级经验累计与升级
-- ============================================================
create or replace function public.class_level_of(p_xp integer)
returns integer
language sql
stable
as $$
  select coalesce(max(level), 1) from public.class_level_rule where need_xp <= greatest(0, coalesce(p_xp, 0));
$$;

create or replace function public.class_add_xp(p_class text, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_xp    integer;
  v_old   integer;
  v_new   integer;
  v_i     integer;
begin
  if v_class = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_class');
  end if;
  if coalesce(p_amount, 0) = 0 then
    select xp, level into v_xp, v_old from public.class_progress where class = v_class;
    return jsonb_build_object('ok', true, 'xp', coalesce(v_xp, 0), 'level', coalesce(v_old, 1), 'gained_level', 0);
  end if;

  insert into public.class_progress(class, xp, level)
  values (v_class, greatest(0, p_amount), 1)
  on conflict (class) do update
    set xp = greatest(0, public.class_progress.xp + p_amount),
        updated_at = now();

  select xp, level into v_xp, v_old from public.class_progress where class = v_class;
  v_new := public.class_level_of(v_xp);

  if v_new > coalesce(v_old, 1) then
    update public.class_progress set level = v_new, updated_at = now() where class = v_class;
    for v_i in select generate_series(coalesce(v_old, 1) + 1, v_new) loop
      insert into public.class_draw_chance(class, level) values (v_class, v_i)
      on conflict (class, level) do nothing;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'xp', v_xp,
    'level', greatest(coalesce(v_new, 1), coalesce(v_old, 1)),
    'gained_level', greatest(0, v_new - coalesce(v_old, 1))
  );
end;
$$;

-- ============================================================
-- 7. 星光值 → 钱包 / 流水 / 班级经验 同步触发器
-- ============================================================
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

  -- 新学生：即使 0 星光值也先建钱包，保证后续兑换/抽奖有余额行
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
    if coalesce(v_rate, 1) > 0 then
      perform public.class_add_xp(new.class, v_delta * v_rate);
    end if;

  elsif v_delta < 0 then
    -- 记录被删除/改小：只扣可消费余额，累计获得不回退（避免等级掉落）
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

drop trigger if exists trg_star_sync_wallet on public.student_info;
create trigger trg_star_sync_wallet
after insert or update of xp on public.student_info
for each row execute function public.star_sync_wallet();

-- 关闭旧的「等级解锁」强制回退（本次改造彻底移除等级解锁条件）
create or replace function public.enforce_student_unlocks(p_sid uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- 等级不再作为头像/头像框解锁条件：本函数保留为空实现，兼容历史调用
  return jsonb_build_object('ok', true, 'skipped', 'level_unlock_removed');
end;
$$;

drop trigger if exists trg_student_unlock_guard on public.student_info;

-- ============================================================
-- 8. 商店：购买 / 目录 / 佩戴
-- ============================================================
create or replace function public.star_spend(
  p_class text, p_student text, p_amount integer, p_reason text, p_source text default 'spend'
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_bal int;
begin
  if coalesce(p_amount, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;

  update public.student_wallet
     set balance = balance - p_amount,
         total_spent = total_spent + p_amount,
         updated_at = now()
   where class = btrim(p_class) and student_name = btrim(p_student) and balance >= p_amount
  returning balance into v_bal;

  if v_bal is null then
    select balance into v_bal from public.student_wallet
     where class = btrim(p_class) and student_name = btrim(p_student);
    return jsonb_build_object('ok', false, 'reason', 'not_enough', 'balance', coalesce(v_bal, 0));
  end if;

  insert into public.star_ledger(class, student_name, amount, balance_after, reason, source)
  values (btrim(p_class), btrim(p_student), -p_amount, v_bal, coalesce(p_reason, '星光值消费'), coalesce(p_source, 'spend'));

  return jsonb_build_object('ok', true, 'balance', v_bal);
end;
$$;

create or replace function public.buy_shop_item(p_class text, p_student text, p_item_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  it      record;
  v_sp    jsonb;
  v_paid  int;
begin
  if v_class = '' or v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;
  if not exists (select 1 from public.student_info where class = v_class and student_name = v_name) then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  select * into it from public.shop_item where item_key = btrim(p_item_key) and enabled;
  if it.item_key is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_item');
  end if;

  if exists (select 1 from public.student_inventory
              where class = v_class and student_name = v_name
                and item_type = it.item_type and item_key = it.item_key) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  if it.price > 0 then
    v_sp := public.star_spend(v_class, v_name, it.price, '兑换：' || it.name, 'spend');
    if not coalesce((v_sp->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'not_enough', 'balance', coalesce((v_sp->>'balance')::int, 0), 'price', it.price);
    end if;
    v_paid := it.price;
  else
    v_paid := 0;
  end if;

  insert into public.student_inventory(class, student_name, item_type, item_key, price_paid, source)
  values (v_class, v_name, it.item_type, it.item_key, v_paid, 'purchase')
  on conflict do nothing;

  return jsonb_build_object(
    'ok', true,
    'item_key', it.item_key,
    'item_type', it.item_type,
    'name', it.name,
    'price', v_paid,
    'balance', case when v_sp is null then null else (v_sp->>'balance')::int end
  );
end;
$$;

create or replace function public.get_shop_catalog(p_class text, p_student text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_av    text;
  v_fr    text;
  v_bal   int;
  v_items jsonb;
begin
  select avatar, coalesce(frame, 'none'), coalesce(xp, 0)
    into v_av, v_fr, v_bal
    from public.student_info
   where class = v_class and student_name = v_name
   limit 1;

  select coalesce(balance, 0) into v_bal from public.student_wallet
   where class = v_class and student_name = v_name;

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_key', s.item_key,
           'item_type', s.item_type,
           'name', s.name,
           'price', s.price,
           'group_name', s.group_name,
           'sort_order', s.sort_order,
           'owned', (s.item_key = v_av and s.item_type = 'avatar')
                    or (s.item_key = v_fr and s.item_type = 'frame')
                    or exists (select 1 from public.student_inventory iv
                                where iv.class = v_class and iv.student_name = v_name
                                  and iv.item_type = s.item_type and iv.item_key = s.item_key),
           'equipped', (s.item_type = 'avatar' and s.item_key = v_av)
                       or (s.item_type = 'frame' and s.item_key = v_fr)
         ) order by s.sort_order, s.item_key), '[]'::jsonb)
    into v_items
    from public.shop_item s
   where s.enabled;

  return jsonb_build_object(
    'ok', true,
    'balance', coalesce(v_bal, 0),
    'avatar', v_av,
    'frame', coalesce(v_fr, 'none'),
    'items', v_items
  );
end;
$$;

create or replace function public.get_student_wallet(p_class text, p_student text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  w       record;
  v_xp    int;
  v_level int;
  v_inv   jsonb;
  v_cls   jsonb;
begin
  select coalesce(xp, 0), coalesce(level, 1) into v_xp, v_level
    from public.student_info where class = v_class and student_name = v_name limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  select * into w from public.student_wallet where class = v_class and student_name = v_name;

  select coalesce(jsonb_agg(jsonb_build_object('item_type', item_type, 'item_key', item_key)), '[]'::jsonb)
    into v_inv
    from public.student_inventory where class = v_class and student_name = v_name;

  v_cls := public.get_class_progress(v_class);

  return jsonb_build_object(
    'ok', true,
    'balance', coalesce(w.balance, 0),
    'total_earned', coalesce(w.total_earned, 0),
    'total_spent', coalesce(w.total_spent, 0),
    'xp', v_xp,
    'level', v_level,
    'inventory', v_inv,
    'class', v_cls
  );
end;
$$;

create or replace function public.get_class_progress(p_class text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_xp    integer := 0;
  v_level integer := 1;
  v_next  integer;
  v_prev  integer;
  v_chance integer := 0;
  v_pending jsonb := '[]'::jsonb;
begin
  select coalesce(xp, 0), coalesce(level, 1) into v_xp, v_level
    from public.class_progress where class = v_class;
  if v_xp is null then v_xp := 0; end if;
  if v_level is null then v_level := 1; end if;

  select need_xp into v_next from public.class_level_rule where level = v_level + 1;
  select need_xp into v_prev from public.class_level_rule where level = v_level;
  if v_prev is null then v_prev := 0; end if;

  select count(*) into v_chance from public.class_draw_chance
   where class = v_class and used_at is null;

  select coalesce(jsonb_agg(level order by level), '[]'::jsonb) into v_pending
    from public.class_draw_chance
   where class = v_class and used_at is null;

  return jsonb_build_object(
    'ok', true,
    'class', v_class,
    'xp', v_xp,
    'level', v_level,
    'prev_need', v_prev,
    'next_need', v_next,
    'pct', case when v_next is null then 100
                else round(least(100, greatest(0, (v_xp - v_prev)::numeric
                     / greatest(1, v_next - v_prev) * 100)), 1) end,
    'chances', v_chance,
    'pending_levels', v_pending,
    'next_level_need', case when v_next is null then 0 else greatest(0, v_next - v_xp) end
  );
end;
$$;

-- ============================================================
-- 9. 抽奖
-- ============================================================
create or replace function public.class_lottery_draw(p_class text, p_student text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class  text := btrim(coalesce(p_class, ''));
  v_name   text := btrim(coalesce(p_student, ''));
  ch       record;
  pr       record;
  v_log    uuid;
  v_granted jsonb := '[]'::jsonb;
  v_stu    record;
  v_bal    int;
begin
  if v_class = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_class');
  end if;

  select * into ch from public.class_draw_chance
   where class = v_class and used_at is null
   order by level asc
   limit 1
   for update skip locked;

  if ch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_chance');
  end if;

  select * into pr from public.lottery_prize
   where enabled and weight > 0
   order by (-ln(greatest(random(), 1e-9)) / weight)
   limit 1;

  if pr.prize_key is null then
    return jsonb_build_object('ok', false, 'reason', 'no_prize');
  end if;

  insert into public.class_draw_log(class, level, prize_key, prize_name, prize_icon, prize_type, prize_value, student_name)
  values (v_class, ch.level, pr.prize_key, pr.name, pr.icon, pr.prize_type, pr.prize_value, nullif(v_name, ''))
  returning id into v_log;

  if pr.prize_type = 'star' and pr.prize_value > 0 and v_name <> '' then
    update public.student_wallet
       set balance = balance + pr.prize_value, total_earned = total_earned + pr.prize_value, updated_at = now()
     where class = v_class and student_name = v_name
    returning balance into v_bal;
    insert into public.star_ledger(class, student_name, amount, balance_after, reason, source, ref_id)
    values (v_class, v_name, pr.prize_value, coalesce(v_bal, 0), '抽奖奖励：' || pr.name, 'draw', v_log);
    v_granted := v_granted || jsonb_build_object('type', 'star', 'value', pr.prize_value);

  elsif pr.prize_type = 'class_star' and pr.prize_value > 0 then
    for v_stu in select student_name from public.student_info where class = v_class loop
      update public.student_wallet
         set balance = balance + pr.prize_value, total_earned = total_earned + pr.prize_value, updated_at = now()
       where class = v_class and student_name = v_stu.student_name
      returning balance into v_bal;
      insert into public.star_ledger(class, student_name, amount, balance_after, reason, source, ref_id)
      values (v_class, v_stu.student_name, pr.prize_value, coalesce(v_bal, 0), '班级抽奖：' || pr.name, 'draw', v_log);
    end loop;
    v_granted := v_granted || jsonb_build_object('type', 'class_star', 'value', pr.prize_value, 'count',
                   (select count(*) from public.student_info where class = v_class));

  elsif pr.prize_type in ('avatar', 'frame') and v_name <> '' and coalesce(pr.prize_item, '') <> '' then
    insert into public.student_inventory(class, student_name, item_type, item_key, price_paid, source)
    values (v_class, v_name, pr.prize_type, pr.prize_item, 0, 'draw')
    on conflict do nothing;
    v_granted := v_granted || jsonb_build_object('type', pr.prize_type, 'item_key', pr.prize_item);
  end if;

  update public.class_draw_chance
     set used_at = now(), prize_key = pr.prize_key, draw_log_id = v_log
   where id = ch.id;

  select coalesce(balance, 0) into v_bal from public.student_wallet
   where class = v_class and student_name = v_name;

  return jsonb_build_object(
    'ok', true,
    'level', ch.level,
    'prize_key', pr.prize_key,
    'name', pr.name,
    'icon', pr.icon,
    'prize_type', pr.prize_type,
    'prize_value', pr.prize_value,
    'granted', v_granted,
    'balance', coalesce(v_bal, 0),
    'chances_left', (select count(*) from public.class_draw_chance where class = v_class and used_at is null)
  );
end;
$$;

create or replace function public.get_lottery_prizes()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'prize_key', p.prize_key, 'name', p.name, 'icon', p.icon, 'prize_type', p.prize_type
  ) order by p.prize_key), '[]'::jsonb)
  from public.lottery_prize p
  where p.enabled;
$$;

create or replace function public.get_class_draw_history(p_class text, p_limit integer default 20)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', d.id, 'level', d.level, 'prize_key', d.prize_key, 'name', d.prize_name,
      'icon', d.prize_icon, 'prize_type', d.prize_type, 'prize_value', d.prize_value,
      'student_name', d.student_name, 'drawn_at', d.drawn_at) x
    from public.class_draw_log d
    where d.class = btrim(p_class)
    order by d.drawn_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 200))
  ) t;
$$;

-- ============================================================
-- 10. 头像 / 头像框：改为「拥有即可用」，彻底移除等级解锁
-- ============================================================
create or replace function public.set_student_avatar(p_class text, p_student text, p_avatar text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_key   text := nullif(btrim(coalesce(p_avatar, '')), '');
  v_sid   uuid;
  v_cur   text;
  v_free  boolean;
  v_owned boolean;
  v_xp    int;
  v_level int;
  v_bal   int;
begin
  if v_key is null or length(v_key) > 24 then
    return jsonb_build_object('ok', false, 'reason', 'bad_key', 'changed', false);
  end if;

  select id, avatar, coalesce(xp, 0), coalesce(level, 1)
    into v_sid, v_cur, v_xp, v_level
    from public.student_info where class = v_class and student_name = v_name;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student', 'changed', false);
  end if;

  select coalesce(balance, 0) into v_bal from public.student_wallet
   where class = v_class and student_name = v_name;

  if v_key is not distinct from v_cur then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'same',
                              'level', v_level, 'xp', v_xp, 'balance', coalesce(v_bal, 0));
  end if;

  -- 免费头像：小动物 24 款（默认拥有，无需购买）
  v_free := v_key ~ '^animal([1-9]|1[0-9]|2[0-4])$';

  -- 其他头像必须在商店目录内（或已拥有）
  if not v_free then
    if not exists (select 1 from public.shop_item where item_key = v_key and item_type = 'avatar' and enabled) then
      return jsonb_build_object('ok', false, 'reason', 'bad_key', 'changed', false);
    end if;
    select exists (select 1 from public.student_inventory
                    where class = v_class and student_name = v_name
                      and item_type = 'avatar' and item_key = v_key) into v_owned;
    if not v_owned then
      return jsonb_build_object('ok', false, 'reason', 'not_owned', 'changed', false,
                                'level', v_level, 'xp', v_xp, 'balance', coalesce(v_bal, 0));
    end if;
  end if;

  update public.student_info set avatar = v_key where id = v_sid;

  return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                            'level', v_level, 'xp', v_xp, 'balance', coalesce(v_bal, 0));
end;
$$;

create or replace function public.set_student_frame(p_class text, p_student text, p_frame text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_key   text := coalesce(nullif(btrim(coalesce(p_frame, '')), ''), 'none');
  v_sid   uuid;
  v_level int;
  v_bal   int;
begin
  select id, coalesce(level, 1) into v_sid, v_level
    from public.student_info where class = v_class and student_name = v_name;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  select coalesce(balance, 0) into v_bal from public.student_wallet
   where class = v_class and student_name = v_name;

  if v_key <> 'none' then
    if not exists (select 1 from public.shop_item where item_key = v_key and item_type = 'frame' and enabled) then
      return jsonb_build_object('ok', false, 'reason', 'bad_frame');
    end if;
    if not exists (select 1 from public.student_inventory
                    where class = v_class and student_name = v_name
                      and item_type = 'frame' and item_key = v_key) then
      return jsonb_build_object('ok', false, 'reason', 'not_owned', 'balance', coalesce(v_bal, 0));
    end if;
  end if;

  update public.student_info set frame = v_key where id = v_sid;

  return jsonb_build_object('ok', true, 'frame', v_key, 'balance', coalesce(v_bal, 0));
end;
$$;

-- ============================================================
-- 11. 班级墙数据（补充星光余额与班级进度）
-- ============================================================
create or replace function public.get_wall_data(p_class text, p_semester text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_roster  jsonb;
  v_records jsonb;
  v_tasks   jsonb;
  v_seat    jsonb;
  v_subs    jsonb;
  v_prog    jsonb;
  v_today   date := (now() at time zone 'Asia/Shanghai')::date;
  v_since   date := v_today - 30;
  v_task_ids uuid[];
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'class', i.class, 'student_name', i.student_name,
           'avatar', i.avatar, 'frame', i.frame, 'xp', i.xp, 'level', i.level,
           'star', coalesce(w.balance, 0))
           order by i.student_name), '[]'::jsonb)
    into v_roster
    from public.student_directory i
    left join public.student_wallet w
      on w.class = i.class and w.student_name = i.student_name
   where btrim(i.class) = btrim(p_class);

  select coalesce(jsonb_agg(x), '[]'::jsonb)
    into v_records
    from (
      select jsonb_build_object(
               'id', r.id, 'student_name', r.student_name, 'class', r.class,
               'record_date', r.record_date, 'self_evaluation', r.self_evaluation,
               'mood', coalesce(r.behavior->>'mood', ''), 'create_at', r.create_at) x
        from public.daily_record r
       where btrim(r.class) = btrim(p_class)
         and r.record_date >= v_since
         and (p_semester is null or r.semester = p_semester)
       order by r.record_date desc, r.create_at desc
       limit 500
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'task_type', t.task_type)
           order by t.id), '[]'::jsonb)
    into v_tasks
    from public.daily_task t
   where btrim(t.class) = btrim(p_class) and t.task_date = v_today;

  select coalesce(jsonb_agg(jsonb_build_object(
           'student_name', s.student_name, 'seat_row', s.seat_row, 'seat_col', s.seat_col)), '[]'::jsonb)
    into v_seat
    from public.seat_grid s
   where btrim(s.class) = btrim(p_class);

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

  v_prog := public.get_class_progress(p_class);

  return jsonb_build_object(
    'ok', true, 'roster', v_roster, 'records', v_records,
    'tasks', v_tasks, 'seat', v_seat, 'subs', v_subs, 'progress', v_prog
  );
end;
$$;

-- ============================================================
-- 12. 家长端历史：当前学期 + 历史归档
-- ============================================================
drop function if exists public.get_student_records(text, text, text);
create or replace function public.get_student_records(p_class text, p_student text, p_birth text)
returns table(id uuid, student_name text, class text, record_date date, self_evaluation smallint,
              behavior jsonb, teacher_comment text, create_at timestamptz)
language sql
security definer
set search_path to 'public'
as $$
  select r.id, r.student_name, r.class, r.record_date,
         r.self_evaluation, r.behavior, r.teacher_comment, r.create_at
  from public.daily_record r
  where r.class = p_class
    and r.student_name = p_student
    and exists (
      select 1 from public.student_info s
      where s.class = r.class and s.student_name = r.student_name
        and (btrim(s.birth_date) = btrim(p_birth) or btrim(s.access_code) = btrim(p_birth))
    )
  union all
  select a.id, a.student_name, a.class, a.record_date,
         a.self_evaluation, a.behavior, a.teacher_comment, a.create_at
  from public.archive_daily_record a
  where a.class = p_class
    and a.student_name = p_student
    and exists (
      select 1 from public.student_info s
      where s.class = a.class and s.student_name = a.student_name
        and (btrim(s.birth_date) = btrim(p_birth) or btrim(s.access_code) = btrim(p_birth))
    )
  order by record_date desc, create_at desc;
$$;

-- ============================================================
-- 13. 封存并重置（教师端执行，anon 不可调用）
-- ============================================================
create or replace function public.archive_all_and_reset(
  p_label text default null,
  p_note  text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_batch uuid;
  v_label text := coalesce(nullif(btrim(coalesce(p_label, '')), ''), '历史封存 ' || to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI'));
  s jsonb := '{}'::jsonb;
  n int;
begin
  insert into public.archive_batch(label, note) values (v_label, p_note) returning id into v_batch;

  -- 学生档案快照
  insert into public.archive_student(archive_batch_id, id, class, student_name, created_at, avatar, xp, level,
                                     avatar_changed_at, avatar_changes_today, frame, birth_date, access_code,
                                     code_fails, code_locked_at, xp_de, xp_zhi, xp_ti, xp_mei, xp_lao)
  select v_batch, id, class, student_name, created_at, avatar, xp, level,
         avatar_changed_at, avatar_changes_today, frame, birth_date, access_code,
         code_fails, code_locked_at, xp_de, xp_zhi, xp_ti, xp_mei, xp_lao
    from public.student_info;
  get diagnostics n = row_count; s := s || jsonb_build_object('student', n);

  insert into public.archive_daily_record(archive_batch_id, id, student_name, class, record_date, self_evaluation,
                                          behavior, teacher_comment, create_at, semester)
  select v_batch, id, student_name, class, record_date, self_evaluation, behavior, teacher_comment, create_at, semester
    from public.daily_record;
  get diagnostics n = row_count; s := s || jsonb_build_object('daily_record', n);

  insert into public.archive_task_submission(archive_batch_id, id, task_id, class, student_name, grade, xp_awarded,
                                             mood_awarded, create_at, update_at, semester, task_date)
  select v_batch, id, task_id, class, student_name, grade, xp_awarded, mood_awarded, create_at, update_at, semester, task_date
    from public.task_submission;
  get diagnostics n = row_count; s := s || jsonb_build_object('task_submission', n);

  insert into public.archive_challenge_submission(archive_batch_id, id, challenge_id, class, student_name, dim, levels,
                                                  xp, submitted_at, status)
  select v_batch, id, challenge_id, class, student_name, dim, levels, xp, submitted_at, status
    from public.challenge_submission;
  get diagnostics n = row_count; s := s || jsonb_build_object('challenge_submission', n);

  insert into public.archive_exam_paper(archive_batch_id, id, student_id, class, student_name, record_date, subject,
                                        score, score_text, image_url, note, create_at)
  select v_batch, id, student_id, class, student_name, record_date, subject, score, score_text, image_url, note, create_at
    from public.exam_paper;
  get diagnostics n = row_count; s := s || jsonb_build_object('exam_paper', n);

  insert into public.archive_exam_score(archive_batch_id, id, batch_id, student_id, class, student_name, score, create_at)
  select v_batch, id, batch_id, student_id, class, student_name, score, create_at
    from public.exam_score;
  get diagnostics n = row_count; s := s || jsonb_build_object('exam_score', n);

  insert into public.archive_home_note(archive_batch_id, id, student_id, parent_name, content, record_date, create_at, class)
  select v_batch, id, student_id, parent_name, content, record_date, create_at, class
    from public.home_note;
  get diagnostics n = row_count; s := s || jsonb_build_object('home_note', n);

  insert into public.archive_xp_log(archive_batch_id, id, class, student_name, source, ref_id, label, dim, xp,
                                    record_date, note, created_at)
  select v_batch, id, class, student_name, source, ref_id, label, dim, xp, record_date, note, created_at
    from public.xp_log;
  get diagnostics n = row_count; s := s || jsonb_build_object('xp_log', n);

  insert into public.archive_star_ledger(archive_batch_id, id, class, student_name, amount, balance_after, reason,
                                         source, ref_table, ref_id, note, created_at)
  select v_batch, id, class, student_name, amount, balance_after, reason, source, ref_table, ref_id, note, created_at
    from public.star_ledger;
  get diagnostics n = row_count; s := s || jsonb_build_object('star_ledger', n);

  insert into public.archive_inventory(archive_batch_id, class, student_name, item_type, item_key, price_paid, source, acquired_at)
  select v_batch, class, student_name, item_type, item_key, price_paid, source, acquired_at
    from public.student_inventory;
  get diagnostics n = row_count; s := s || jsonb_build_object('inventory', n);

  insert into public.archive_personal_task(archive_batch_id, id, class, student_name, content, dim, xp_value,
                                           task_date, status, confirm_at, create_at, deadline, filled_by)
  select v_batch, id, class, student_name, content, dim, xp_value, task_date, status, confirm_at, create_at, deadline, filled_by
    from public.personal_task;
  get diagnostics n = row_count; s := s || jsonb_build_object('personal_task', n);

  insert into public.archive_manual_task(archive_batch_id, id, class, student_name, tag_id, task_date, status, confirm_at, create_at)
  select v_batch, id, class, student_name, tag_id, task_date, status, confirm_at, create_at
    from public.manual_task;
  get diagnostics n = row_count; s := s || jsonb_build_object('manual_task', n);

  insert into public.archive_challenge_task(archive_batch_id, id, class, student_name, title, dim, max_level, status,
                                            task_date, create_at, confirm_at, filled_by, levels, done_levels)
  select v_batch, id, class, student_name, title, dim, max_level, status, task_date, create_at, confirm_at, filled_by, levels, done_levels
    from public.challenge_task;
  get diagnostics n = row_count; s := s || jsonb_build_object('challenge_task', n);

  insert into public.archive_home_note_reply(archive_batch_id, id, note_id, sender, content, create_at)
  select v_batch, id, note_id, sender, content, create_at from public.home_note_reply;
  get diagnostics n = row_count; s := s || jsonb_build_object('home_note_reply', n);

  insert into public.archive_xp_anomaly(archive_batch_id, id, class, student_name, record_date, source, anomaly_type,
                                        reason, detail, status, create_at, resolved_at)
  select v_batch, id, class, student_name, record_date, source, anomaly_type, reason, detail, status, create_at, resolved_at
    from public.xp_anomaly;
  get diagnostics n = row_count; s := s || jsonb_build_object('xp_anomaly', n);

  -- 清理业务数据（保留名单、标签、任务定义、座位）
  delete from public.home_note_reply;
  delete from public.home_note;
  delete from public.exam_score;
  delete from public.exam_paper;
  delete from public.challenge_submission;
  delete from public.challenge_task;
  delete from public.task_submission;
  delete from public.manual_task;
  delete from public.personal_task;
  delete from public.auto_bonus_log;
  delete from public.daily_record;          -- 触发 apply_record_xp，同步把 xp 归零
  delete from public.student_achievements;
  delete from public.xp_log;
  delete from public.xp_anomaly;
  delete from public.star_ledger;
  delete from public.student_wallet;
  delete from public.class_draw_log;
  delete from public.class_draw_chance;
  delete from public.student_inventory;

  -- 学生档案重置为全新状态（保留姓名/头像/头像框/家长凭据）
  update public.student_info
     set xp = 0, level = 1,
         xp_de = 0, xp_zhi = 0, xp_ti = 0, xp_mei = 0, xp_lao = 0,
         avatar_changes_today = 0, avatar_changed_at = null, code_fails = 0, code_locked_at = null;

  -- 新钱包（0 起步）
  insert into public.student_wallet(class, student_name, balance, total_earned, total_spent)
  select class, student_name, 0, 0, 0 from public.student_info
  on conflict (class, student_name) do nothing;

  -- 保留当前头像/头像框的拥有权（去掉等级，但仍属于自己）
  insert into public.student_inventory(class, student_name, item_type, item_key, price_paid, source)
  select class, student_name, 'avatar', avatar, 0, 'migrate'
    from public.student_info
   where coalesce(avatar, '') <> '' and avatar !~ '^animal([1-9]|1[0-9]|2[0-4])$'
  on conflict do nothing;
  insert into public.student_inventory(class, student_name, item_type, item_key, price_paid, source)
  select class, student_name, 'frame', frame, 0, 'migrate'
    from public.student_info
   where coalesce(frame, 'none') not in ('', 'none')
  on conflict do nothing;

  -- 班级经验归零
  delete from public.class_progress;
  insert into public.class_progress(class, xp, level)
  select distinct class, 0, 1 from public.student_info
  on conflict (class) do nothing;

  update public.archive_batch set stats = s where id = v_batch;

  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'label', v_label, 'stats', s);
end;
$$;

revoke all on function public.archive_all_and_reset(text, text) from public;
revoke all on function public.archive_all_and_reset(text, text) from anon;
grant execute on function public.archive_all_and_reset(text, text) to authenticated;

create or replace function public.get_archive_batches()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'label', b.label, 'note', b.note, 'stats', b.stats, 'created_at', b.created_at
  ) order by b.created_at desc), '[]'::jsonb)
  from public.archive_batch b;
$$;

create or replace function public.get_archive_records(p_batch uuid, p_class text default null, p_student text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'student_name', r.student_name, 'class', r.class,
           'record_date', r.record_date, 'self_evaluation', r.self_evaluation,
           'behavior', r.behavior, 'teacher_comment', r.teacher_comment, 'create_at', r.create_at)
           order by r.record_date desc, r.create_at desc), '[]'::jsonb)
    into v_rows
    from public.archive_daily_record r
   where r.archive_batch_id = p_batch
     and (p_class is null or btrim(r.class) = btrim(p_class))
     and (p_student is null or btrim(r.student_name) = btrim(p_student));

  return jsonb_build_object('ok', true, 'records', v_rows);
end;
$$;

revoke all on function public.get_archive_batches() from anon;
revoke all on function public.get_archive_records(uuid, text, text) from anon;
grant execute on function public.get_archive_batches() to authenticated;
grant execute on function public.get_archive_records(uuid, text, text) to authenticated;

-- ============================================================
-- 14. RLS 与授权
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'star_config','student_wallet','star_ledger','class_level_rule','class_progress',
    'class_draw_log','class_draw_chance','shop_item','student_inventory','lottery_prize',
    'archive_batch','archive_student','archive_daily_record','archive_task_submission',
    'archive_challenge_submission','archive_exam_paper','archive_exam_score','archive_home_note',
    'archive_xp_log','archive_star_ledger','archive_inventory',
    'archive_personal_task','archive_manual_task','archive_challenge_task',
    'archive_home_note_reply','archive_xp_anomaly'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists p_%s_teacher on public.%I', t, t);
    execute format('create policy p_%s_teacher on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- 商店目录允许匿名只读（学生端展示价格用；不暴露任何学生数据）
drop policy if exists p_shop_item_read on public.shop_item;
create policy p_shop_item_read on public.shop_item for select to anon, authenticated using (true);
grant select on public.shop_item to anon;

-- RPC 授权
grant execute on function public.get_shop_catalog(text, text) to anon, authenticated;
grant execute on function public.get_student_wallet(text, text) to anon, authenticated;
grant execute on function public.get_class_progress(text) to anon, authenticated;
grant execute on function public.buy_shop_item(text, text, text) to anon, authenticated;
grant execute on function public.class_lottery_draw(text, text) to anon, authenticated;
grant execute on function public.get_class_draw_history(text, integer) to anon, authenticated;
grant execute on function public.get_lottery_prizes() to anon, authenticated;
grant execute on function public.class_add_xp(text, integer) to authenticated;
grant execute on function public.class_level_of(integer) to anon, authenticated;
grant execute on function public.set_student_avatar(text, text, text) to anon, authenticated;
grant execute on function public.set_student_frame(text, text, text) to anon, authenticated;
grant execute on function public.get_student_records(text, text, text) to anon, authenticated;
grant execute on function public.get_wall_data(text, text) to anon, authenticated;

-- 初始化：已有学生建档钱包（xp 作为初始余额）
insert into public.student_wallet(class, student_name, balance, total_earned, total_spent)
select class, student_name, greatest(0, coalesce(xp, 0)), greatest(0, coalesce(xp, 0)), 0
  from public.student_info
on conflict (class, student_name) do nothing;

insert into public.class_progress(class, xp, level)
select distinct class, 0, 1 from public.student_info
on conflict (class) do nothing;
