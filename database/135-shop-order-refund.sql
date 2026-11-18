-- ============================================================
-- 135-shop-order-refund.sql
-- 星光商店 · 购买记录与教师回退（撤销）
--
-- 解决的问题：
--   1) 原来一次兑换只在 student_inventory / student_coupon 里留一行"物品"，
--      star_ledger 只记一条扣分流水，教师无法按时间/学生/商品查"买了什么、
--      花了多少、什么时候买的"。
--   2) 学生误点兑换后没有正规的回退通道：手工删库存会留下脏账，
--      星光值也不会退回。
--
-- 本脚本：
--   1) 新建 shop_order（订单）与 shop_refund_audit（回退审计）两张表
--   2) 把历史兑换（库存 + 日常卡）回填成订单（幂等，可重复执行）
--   3) 改写 buy_shop_item：每次兑换在同一事务内写一条订单
--   4) get_shop_orders：按 班级 / 学生 / 时间范围 / 商品 / 订单状态 分页查询 + 汇总
--   5) shop_refund_impact：回退前的影响范围预览（只读，不落库）
--   6) refund_shop_order：执行回退（退星光值、删物品、卸装扮、改订单状态、写审计）
--   7) get_shop_refund_audit：回退审计日志查询
--
-- 一致性口径：
--   · 回退 = 把「这一次兑换」完整倒回去：星光值退回余额、物品移出衣柜、
--     若正在佩戴则自动卸下（头像回落到按姓名自动分配、头像框回 none、主题清空）
--   · student_info.xp（累计获得星光值）不回退，等级与班级星光值不受影响
--   · student_wallet.total_spent 同步减掉；balance 只增不减，永不为负
--   · 同一条订单只能回退一次（行锁 + 状态校验，防重复点击/并发）
--   · 日常卡（免作业卡）一旦已使用，不允许回退，避免"既用了又退钱"
--
-- 执行位置：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- 幂等，可重复执行。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 订单表
-- ------------------------------------------------------------
create table if not exists public.shop_order (
  id            uuid primary key default gen_random_uuid(),
  class         text not null,
  student_name  text not null,
  item_key      text not null,
  item_type     text not null,                       -- avatar / frame / daily / theme
  item_name     text not null default '',            -- 下单时的商品名快照（改价改名不影响历史）
  qty           integer not null default 1,          -- 购买数量
  unit_price    integer not null default 0,          -- 下单时单价（含首次半价后的实付价）
  star_spent    integer not null default 0,          -- 本单消耗星光值 = unit_price * qty
  status        text not null default 'active',      -- active 已生效 / refunded 已回退 / void 已作废
  refund_status text not null default 'none',        -- none 未回退 / refunded 已回退
  source        text not null default 'purchase',    -- purchase 正常兑换 / backfill 历史回填
  ref_key       text,                                -- 幂等键：历史回填 inv:... / 日常卡 coupon:... / 新单 buy:<uuid>
  coupon_id     uuid,                                -- 日常卡对应的 student_coupon.id
  created_at    timestamptz not null default now(),
  refunded_at   timestamptz,
  refunded_by   text,
  refund_reason text
);

-- 兼容旧版本（若曾建过表但缺列）
alter table public.shop_order add column if not exists qty            integer not null default 1;
alter table public.shop_order add column if not exists unit_price     integer not null default 0;
alter table public.shop_order add column if not exists star_spent     integer not null default 0;
alter table public.shop_order add column if not exists status         text not null default 'active';
alter table public.shop_order add column if not exists refund_status  text not null default 'none';
alter table public.shop_order add column if not exists source         text not null default 'purchase';
alter table public.shop_order add column if not exists ref_key        text;
alter table public.shop_order add column if not exists coupon_id      uuid;
alter table public.shop_order add column if not exists refunded_at    timestamptz;
alter table public.shop_order add column if not exists refunded_by    text;
alter table public.shop_order add column if not exists refund_reason  text;

alter table public.shop_order drop constraint if exists shop_order_status_check;
alter table public.shop_order
  add constraint shop_order_status_check
  check (status in ('active', 'refunded', 'void'));

alter table public.shop_order drop constraint if exists shop_order_refund_status_check;
alter table public.shop_order
  add constraint shop_order_refund_status_check
  check (refund_status in ('none', 'refunded'));

alter table public.shop_order drop constraint if exists shop_order_qty_check;
alter table public.shop_order
  add constraint shop_order_qty_check check (qty > 0);

alter table public.shop_order drop constraint if exists shop_order_money_check;
alter table public.shop_order
  add constraint shop_order_money_check check (unit_price >= 0 and star_spent >= 0);

create index if not exists idx_shop_order_stu    on public.shop_order(class, student_name, created_at desc);
create index if not exists idx_shop_order_time   on public.shop_order(created_at desc);
create index if not exists idx_shop_order_item   on public.shop_order(item_key, created_at desc);
create index if not exists idx_shop_order_status on public.shop_order(status, created_at desc);
create unique index if not exists uq_shop_order_ref on public.shop_order(ref_key);

comment on table public.shop_order is '星光商店购买订单：一次兑换一行，供教师端查询与回退';

-- ------------------------------------------------------------
-- 2. 回退审计表
-- ------------------------------------------------------------
create table if not exists public.shop_refund_audit (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid,
  action          text not null default 'refund',   -- refund 回退 / void 作废（预留）
  class           text not null,
  student_name    text not null,
  item_key        text not null,
  item_name       text not null default '',
  item_type       text not null default '',
  qty             integer not null default 1,
  stars_refunded  integer not null default 0,
  balance_before  integer,
  balance_after   integer,
  status_before   text,
  status_after    text,
  equip_action    text default '',                  -- 空 / unequip_avatar / unequip_frame / unequip_theme
  inventory_action text default '',                 -- 空 / removed
  coupon_action   text default '',                  -- 空 / removed
  ledger_id       uuid,
  operator        text not null default '',         -- 操作人（教师邮箱）
  reason          text not null default '',
  detail          jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_refund_audit_time on public.shop_refund_audit(created_at desc);
create index if not exists idx_refund_audit_stu  on public.shop_refund_audit(class, student_name, created_at desc);
create index if not exists idx_refund_audit_order on public.shop_refund_audit(order_id);

comment on table public.shop_refund_audit is '星光商店回退审计日志：谁、什么时候、为什么回退了哪一单，影响多少星光值';

-- ------------------------------------------------------------
-- 3. RLS 与授权（与 109 号其它表同口径：authenticated 全权；anon 不可见）
-- ------------------------------------------------------------
alter table public.shop_order enable row level security;
drop policy if exists p_shop_order_teacher on public.shop_order;
create policy p_shop_order_teacher on public.shop_order
  for all to authenticated using (true) with check (true);

alter table public.shop_refund_audit enable row level security;
drop policy if exists p_shop_refund_audit_teacher on public.shop_refund_audit;
create policy p_shop_refund_audit_teacher on public.shop_refund_audit
  for all to authenticated using (true) with check (true);

revoke all on public.shop_order from public, anon;
revoke all on public.shop_refund_audit from public, anon;
grant select, insert, update, delete on public.shop_order to authenticated;
grant select, insert on public.shop_refund_audit to authenticated;

-- ------------------------------------------------------------
-- 4. 历史兑换回填成订单（幂等）
--    4.1 普通物品：student_inventory 一行 = 一单
--    4.2 日常卡：student_coupon 一行 = 一单（可重复购买，故不能按物品去重）
-- ------------------------------------------------------------
insert into public.shop_order(class, student_name, item_key, item_type, item_name,
                              qty, unit_price, star_spent, status, refund_status,
                              source, ref_key, coupon_id, created_at)
select btrim(iv.class), iv.student_name, iv.item_key, iv.item_type,
       coalesce(si.name, iv.item_key),
       1, greatest(0, coalesce(iv.price_paid, 0)), greatest(0, coalesce(iv.price_paid, 0)),
       'active', 'none', 'backfill',
       'inv:' || btrim(iv.class) || '|' || iv.student_name || '|' || iv.item_type || '|' || iv.item_key,
       null, coalesce(iv.acquired_at, now())
  from public.student_inventory iv
  left join public.shop_item si on si.item_key = iv.item_key
 where coalesce(iv.source, 'purchase') in ('purchase', 'migrate')
on conflict (ref_key) do nothing;

insert into public.shop_order(class, student_name, item_key, item_type, item_name,
                              qty, unit_price, star_spent, status, refund_status,
                              source, ref_key, coupon_id, created_at)
select btrim(c.class), c.student_name, c.item_key,
       coalesce(si.item_type, 'daily'), coalesce(si.name, c.name),
       1, greatest(0, coalesce(c.price_paid, 0)), greatest(0, coalesce(c.price_paid, 0)),
       'active', 'none', 'backfill',
       'coupon:' || c.id::text,
       c.id, coalesce(c.issued_at, now())
  from public.student_coupon c
  left join public.shop_item si on si.item_key = c.item_key
on conflict (ref_key) do nothing;

-- ------------------------------------------------------------
-- 5. 兑换：写订单（在 115 号版本基础上只加"写订单"，其余逻辑不动）
-- ------------------------------------------------------------
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
  v_pay   int;
  v_first boolean;
  v_held  int;
  v_cid   uuid;
  v_oid   uuid;
begin
  if v_class = '' or v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;
  if not exists (select 1 from public.student_info where class = v_class and student_name = v_name) then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  -- 串行化同一学生的并发兑换，避免首次半价被重复使用
  perform 1 from public.student_wallet
   where class = v_class and student_name = v_name
   for update;

  select * into it from public.shop_item where item_key = btrim(p_item_key) and enabled;
  if it.item_key is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_item');
  end if;

  -- 首次购买：从未有过「付过钱」的兑换，也没买过日常卡
  v_first := not exists (
               select 1 from public.student_inventory
                where class = v_class and student_name = v_name
                  and source = 'purchase' and price_paid > 0)
             and not exists (
               select 1 from public.student_coupon
                where class = v_class and student_name = v_name);

  v_pay := case when v_first and it.price > 0 then ceil(it.price / 2.0)::int else it.price end;

  -- 日常卡：可重复购买，不进库存表
  if it.item_type = 'daily' then
    if v_pay > 0 then
      v_sp := public.star_spend(v_class, v_name, v_pay, '兑换：' || it.name, 'spend');
      if not coalesce((v_sp->>'ok')::boolean, false) then
        return jsonb_build_object('ok', false, 'reason', 'not_enough',
                                  'balance', coalesce((v_sp->>'balance')::int, 0), 'price', v_pay);
      end if;
    end if;

    insert into public.student_coupon(class, student_name, item_key, name, price_paid)
    values (v_class, v_name, it.item_key, it.name, v_pay)
    returning id into v_cid;

    insert into public.shop_order(class, student_name, item_key, item_type, item_name,
                                  qty, unit_price, star_spent, status, refund_status,
                                  source, ref_key, coupon_id)
    values (v_class, v_name, it.item_key, it.item_type, it.name,
            1, v_pay, v_pay, 'active', 'none',
            'purchase', 'buy:' || gen_random_uuid()::text, v_cid)
    returning id into v_oid;

    select count(*) into v_held from public.student_coupon
     where class = v_class and student_name = v_name
       and item_key = it.item_key and status = 'unused';

    return jsonb_build_object(
      'ok', true,
      'order_id', v_oid,
      'item_key', it.item_key,
      'item_type', it.item_type,
      'name', it.name,
      'price', v_pay,
      'first_discount_used', v_first,
      'held', v_held,
      'balance', case when v_sp is null then null else (v_sp->>'balance')::int end
    );
  end if;

  if exists (select 1 from public.student_inventory
              where class = v_class and student_name = v_name
                and item_type = it.item_type and item_key = it.item_key) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  if v_pay > 0 then
    v_sp := public.star_spend(v_class, v_name, v_pay, '兑换：' || it.name, 'spend');
    if not coalesce((v_sp->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'not_enough',
                                'balance', coalesce((v_sp->>'balance')::int, 0), 'price', v_pay);
    end if;
  end if;

  insert into public.student_inventory(class, student_name, item_type, item_key, price_paid, source)
  values (v_class, v_name, it.item_type, it.item_key, v_pay, 'purchase')
  on conflict do nothing;

  insert into public.shop_order(class, student_name, item_key, item_type, item_name,
                                qty, unit_price, star_spent, status, refund_status,
                                source, ref_key, coupon_id)
  values (v_class, v_name, it.item_key, it.item_type, it.name,
          1, v_pay, v_pay, 'active', 'none',
          'purchase', 'buy:' || gen_random_uuid()::text, null)
  returning id into v_oid;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_oid,
    'item_key', it.item_key,
    'item_type', it.item_type,
    'name', it.name,
    'price', v_pay,
    'first_discount_used', v_first,
    'balance', case when v_sp is null then null else (v_sp->>'balance')::int end
  );
end;
$$;

grant execute on function public.buy_shop_item(text, text, text) to anon, authenticated;

-- 便捷判定：当前调用是否具备教师（登录）身份。
-- SQL Editor 里手工执行时没有 JWT，直接放行；经 anon key 调用的匿名请求一律拒绝。
create or replace function public.shop_admin_guard()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_uid    text := null;
  v_role   text := '';
begin
  if coalesce(v_claims, '') = '' then
    return jsonb_build_object('ok', true, 'uid', '', 'role', 'sql');
  end if;

  begin
    v_uid  := coalesce(v_claims::jsonb ->> 'sub', '');
    v_role := coalesce(v_claims::jsonb ->> 'role', '');
  exception when others then
    v_uid := '';
  end;

  if v_uid = '' or v_role = 'anon' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  return jsonb_build_object('ok', true, 'uid', v_uid, 'role', v_role);
end;
$$;

revoke execute on function public.shop_admin_guard() from public, anon;
grant execute on function public.shop_admin_guard() to authenticated;

-- ------------------------------------------------------------
-- 6. 购买记录查询（分页 + 汇总）
--    p_status：'' / 'all' 全部；'active' 已生效；'refunded' 已回退；'void' 已作废
-- ------------------------------------------------------------
create or replace function public.get_shop_orders(
  p_class    text default null,
  p_student  text default null,
  p_from     date default null,
  p_to       date default null,
  p_item_key text default null,
  p_status   text default null,
  p_limit    integer default 20,
  p_offset   integer default 0
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_item  text := btrim(coalesce(p_item_key, ''));
  v_st    text := btrim(coalesce(p_status, ''));
  v_limit int  := greatest(1, least(coalesce(p_limit, 20), 200));
  v_off   int  := greatest(0, coalesce(p_offset, 0));
  v_out   jsonb;
begin
  if (public.shop_admin_guard()->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  with f as (
    select o.*
      from public.shop_order o
     where (v_class = '' or btrim(o.class) = v_class)
       and (v_name = '' or o.student_name = v_name)
       and (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Asia/Shanghai'))
       and (p_to is null or o.created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Shanghai'))
       and (v_item = '' or o.item_key = v_item)
       and (v_st = '' or v_st = 'all' or o.status = v_st)
  ),
  page as (
    select * from f order by created_at desc limit v_limit offset v_off
  )
  select jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'class', p.class,
               'student_name', p.student_name,
               'item_key', p.item_key,
               'item_type', p.item_type,
               'item_name', p.item_name,
               'qty', p.qty,
               'unit_price', p.unit_price,
               'star_spent', p.star_spent,
               'status', p.status,
               'refund_status', p.refund_status,
               'source', p.source,
               'created_at', p.created_at,
               'refunded_at', p.refunded_at,
               'refunded_by', p.refunded_by,
               'refund_reason', p.refund_reason,
               'coupon_status', (select c.status from public.student_coupon c where c.id = p.coupon_id),
               'in_inventory', exists (
                  select 1 from public.student_inventory iv
                   where btrim(iv.class) = btrim(p.class)
                     and iv.student_name = p.student_name
                     and iv.item_type = p.item_type
                     and iv.item_key = p.item_key),
               'equipped_now', coalesce((
                  select case
                           when p.item_type = 'avatar' then (coalesce(i.avatar, '') = p.item_key)
                           when p.item_type = 'frame'  then (coalesce(i.frame, 'none') = p.item_key)
                           when p.item_type = 'theme'  then (coalesce(i.card_theme, '') = p.item_key)
                           else false
                         end
                    from public.student_info i
                   where btrim(i.class) = btrim(p.class)
                     and i.student_name = p.student_name
                   limit 1), false)
             ) order by p.created_at desc)
        from page p), '[]'::jsonb),
    'total',           (select count(*) from f),
    'star_total',      coalesce((select sum(star_spent) from f), 0),
    'refunded_count',  (select count(*) from f where status = 'refunded'),
    'refunded_star',   coalesce((select sum(star_spent) from f where status = 'refunded'), 0),
    'student_count',   (select count(distinct student_name) from f),
    'limit', v_limit,
    'offset', v_off
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.get_shop_orders(text, text, date, date, text, text, integer, integer) from public, anon;
grant  execute on function public.get_shop_orders(text, text, date, date, text, text, integer, integer) to authenticated;

-- ------------------------------------------------------------
-- 7. 回退影响预览（只读）
-- ------------------------------------------------------------
create or replace function public.shop_refund_impact(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  o        record;
  v_bal    int := 0;
  v_earned int := 0;
  v_spent  int := 0;
  v_av     text;
  v_fr     text;
  v_ct     text;
  v_coupon_id     uuid;
  v_coupon_status text := '';
  v_equip  text := '';
  v_equip_to text := '';
  v_block  text := '';
  v_inv    boolean := false;
begin
  if (public.shop_admin_guard()->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select * into o from public.shop_order where id = p_order_id;
  if o.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_order');
  end if;

  select coalesce(balance, 0), coalesce(total_earned, 0), coalesce(total_spent, 0)
    into v_bal, v_earned, v_spent
    from public.student_wallet
   where btrim(class) = btrim(o.class) and student_name = o.student_name;

  v_bal   := coalesce(v_bal, 0);
  v_earned := coalesce(v_earned, 0);
  v_spent := coalesce(v_spent, 0);

  select avatar, coalesce(frame, 'none'), coalesce(card_theme, '')
    into v_av, v_fr, v_ct
    from public.student_info
   where btrim(class) = btrim(o.class) and student_name = o.student_name
   limit 1;

  v_inv := exists (
    select 1 from public.student_inventory iv
     where btrim(iv.class) = btrim(o.class) and iv.student_name = o.student_name
       and iv.item_type = o.item_type and iv.item_key = o.item_key);

  if o.coupon_id is not null then
    select c.id, c.status into v_coupon_id, v_coupon_status
      from public.student_coupon c where c.id = o.coupon_id;
  elsif o.item_type = 'daily' then
    select c.id, c.status into v_coupon_id, v_coupon_status
      from public.student_coupon c
     where btrim(c.class) = btrim(o.class) and c.student_name = o.student_name
       and c.item_key = o.item_key and c.status = 'unused'
     order by c.issued_at desc limit 1;
  end if;

  if o.item_type = 'avatar' and coalesce(v_av, '') = o.item_key then
    v_equip := 'avatar'; v_equip_to := '回落到按姓名自动分配的头像';
  elsif o.item_type = 'frame' and coalesce(v_fr, 'none') = o.item_key then
    v_equip := 'frame'; v_equip_to := '取下头像框';
  elsif o.item_type = 'theme' and coalesce(v_ct, '') = o.item_key then
    v_equip := 'theme'; v_equip_to := '清空卡片主题';
  end if;

  if o.status = 'refunded' then
    v_block := 'already_refunded';
  elsif o.status <> 'active' then
    v_block := 'order_not_active';
  elsif o.item_type = 'daily' and v_coupon_id is not null and coalesce(v_coupon_status, '') = 'used' then
    v_block := 'coupon_used';
  end if;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', o.id, 'class', o.class, 'student_name', o.student_name,
      'item_key', o.item_key, 'item_type', o.item_type, 'item_name', o.item_name,
      'qty', o.qty, 'unit_price', o.unit_price, 'star_spent', o.star_spent,
      'status', o.status, 'refund_status', o.refund_status,
      'source', o.source, 'created_at', o.created_at,
      'refunded_at', o.refunded_at, 'refunded_by', o.refunded_by,
      'refund_reason', o.refund_reason),
    'refundable', (v_block = ''),
    'block_reason', v_block,
    'stars', o.star_spent,
    'balance_before', v_bal,
    'balance_after', v_bal + o.star_spent,
    'total_earned', v_earned,
    'total_spent_before', v_spent,
    'total_spent_after', greatest(0, v_spent - o.star_spent),
    'in_inventory', v_inv,
    'inventory_action', case when v_inv then 'removed' else '' end,
    'equip_action', case when v_equip = '' then '' else 'unequip_' || v_equip end,
    'equip_field', v_equip,
    'equip_current', case when v_equip = 'avatar' then coalesce(v_av, '')
                          when v_equip = 'frame'  then coalesce(v_fr, '')
                          when v_equip = 'theme'  then coalesce(v_ct, '')
                          else '' end,
    'equip_reset_to', v_equip_to,
    'coupon_status', coalesce(v_coupon_status, ''),
    'coupon_action', case when o.item_type = 'daily' and v_coupon_id is not null
                           and coalesce(v_coupon_status, '') = 'unused' then 'removed' else '' end,
    'ledger_action', case when o.star_spent > 0 then 'add' else '' end
  );
end;
$$;

revoke execute on function public.shop_refund_impact(uuid) from public, anon;
grant  execute on function public.shop_refund_impact(uuid) to authenticated;

-- ------------------------------------------------------------
-- 8. 执行回退（事务内完成：退星光值 → 删物品 → 卸装扮 → 改订单 → 写审计）
-- ------------------------------------------------------------
create or replace function public.refund_shop_order(
  p_order_id uuid,
  p_operator text default null,
  p_reason   text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  o         record;
  v_guard   jsonb := public.shop_admin_guard();
  v_op      text;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_bal     int := 0;
  v_before  int := 0;
  v_spent   int := 0;
  v_coupon_id     uuid;
  v_coupon_status text := '';
  v_av      text;
  v_fr      text;
  v_ct      text;
  v_equip   text := '';
  v_inv     text := '';
  v_cpn     text := '';
  v_ledger  uuid;
  v_sid     uuid;
begin
  if coalesce((v_guard->>'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  -- 操作人：优先取登录邮箱，其次取调用方传入，最后兜底为"教师"
  v_op := nullif(btrim(coalesce(p_operator, '')), '');
  if v_op is null then
    begin
      v_op := nullif(btrim(coalesce(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'), '');
    exception when others then
      v_op := null;
    end;
  end if;
  v_op := coalesce(v_op, '教师');

  if v_reason = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_reason');
  end if;

  -- 行锁：同一订单并发回退只会成功一次
  select * into o from public.shop_order where id = p_order_id for update;
  if o.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_order');
  end if;
  if o.status = 'refunded' then
    return jsonb_build_object('ok', false, 'reason', 'already_refunded');
  end if;
  if o.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'order_not_active');
  end if;

  -- 日常卡：已使用不允许回退
  if o.coupon_id is not null then
    select c.id, c.status into v_coupon_id, v_coupon_status
      from public.student_coupon c where c.id = o.coupon_id for update;
  elsif o.item_type = 'daily' then
    select c.id, c.status into v_coupon_id, v_coupon_status
      from public.student_coupon c
     where btrim(c.class) = btrim(o.class) and c.student_name = o.student_name
       and c.item_key = o.item_key and c.status = 'unused'
     order by c.issued_at desc limit 1
     for update;
  end if;

  if o.item_type = 'daily' and v_coupon_id is not null and coalesce(v_coupon_status, '') = 'used' then
    return jsonb_build_object('ok', false, 'reason', 'coupon_used');
  end if;

  -- 钱包行锁（没有则先建）
  select coalesce(balance, 0), coalesce(total_spent, 0)
    into v_bal, v_spent
    from public.student_wallet
   where btrim(class) = btrim(o.class) and student_name = o.student_name
   for update;

  if v_bal is null then
    insert into public.student_wallet(class, student_name, balance, total_earned, total_spent)
    values (btrim(o.class), o.student_name, 0, 0, 0)
    on conflict (class, student_name) do nothing;
    v_bal := 0; v_spent := 0;
  end if;

  v_before := coalesce(v_bal, 0);

  -- ① 星光值退回余额（累计获得 xp 不回退）
  update public.student_wallet
     set balance     = balance + o.star_spent,
         total_spent = greatest(0, total_spent - o.star_spent),
         updated_at  = now()
   where btrim(class) = btrim(o.class) and student_name = o.student_name
  returning balance into v_bal;

  if o.star_spent > 0 then
    insert into public.star_ledger(class, student_name, amount, balance_after, reason, source, ref_table, ref_id)
    values (btrim(o.class), o.student_name, o.star_spent, coalesce(v_bal, 0),
            '回退：' || coalesce(nullif(o.item_name, ''), o.item_key) || '（' || v_reason || '）',
            'refund', 'shop_order', o.id)
    returning id into v_ledger;
  end if;

  -- ② 移出衣柜 / 收回日常卡
  if o.item_type <> 'daily' then
    delete from public.student_inventory
     where btrim(class) = btrim(o.class) and student_name = o.student_name
       and item_type = o.item_type and item_key = o.item_key;
    if found then v_inv := 'removed'; end if;
  else
    if v_coupon_id is not null and coalesce(v_coupon_status, '') = 'unused' then
      delete from public.student_coupon where id = v_coupon_id;
      v_cpn := 'removed';
    end if;
  end if;

  -- ③ 正在佩戴则卸下
  select avatar, coalesce(frame, 'none'), coalesce(card_theme, '')
    into v_av, v_fr, v_ct
    from public.student_info
   where btrim(class) = btrim(o.class) and student_name = o.student_name
   limit 1;

  if o.item_type = 'avatar' and coalesce(v_av, '') = o.item_key then
    v_equip := 'unequip_avatar';
    update public.student_info set avatar = null
     where btrim(class) = btrim(o.class) and student_name = o.student_name;
  elsif o.item_type = 'frame' and coalesce(v_fr, 'none') = o.item_key then
    v_equip := 'unequip_frame';
    update public.student_info set frame = 'none'
     where btrim(class) = btrim(o.class) and student_name = o.student_name;
  elsif o.item_type = 'theme' and coalesce(v_ct, '') = o.item_key then
    v_equip := 'unequip_theme';
    update public.student_info set card_theme = null
     where btrim(class) = btrim(o.class) and student_name = o.student_name;
  end if;

  -- ④ 订单状态
  update public.shop_order
     set status        = 'refunded',
         refund_status = 'refunded',
         refunded_at   = now(),
         refunded_by   = v_op,
         refund_reason = v_reason
   where id = o.id;

  -- ⑤ 审计日志
  insert into public.shop_refund_audit(
    order_id, action, class, student_name, item_key, item_name, item_type, qty,
    stars_refunded, balance_before, balance_after, status_before, status_after,
    equip_action, inventory_action, coupon_action, ledger_id, operator, reason, detail)
  values (
    o.id, 'refund', btrim(o.class), o.student_name, o.item_key, o.item_name, o.item_type, o.qty,
    o.star_spent, v_before, coalesce(v_bal, 0), o.status, 'refunded',
    v_equip, v_inv, v_cpn, v_ledger, v_op, v_reason,
    jsonb_build_object(
      'order', to_jsonb(o),
      'balance_before', v_before,
      'balance_after', v_bal,
      'total_spent_after', greatest(0, v_spent - o.star_spent),
      'equip_action', v_equip,
      'inventory_action', v_inv,
      'coupon_action', v_cpn));

  return jsonb_build_object(
    'ok', true,
    'order_id', o.id,
    'student_name', o.student_name,
    'class', btrim(o.class),
    'item_name', o.item_name,
    'stars_refunded', o.star_spent,
    'balance_before', v_before,
    'balance_after', coalesce(v_bal, 0),
    'equip_action', v_equip,
    'inventory_action', v_inv,
    'coupon_action', v_cpn,
    'operator', v_op,
    'reason', v_reason,
    'refunded_at', now()
  );
end;
$$;

revoke execute on function public.refund_shop_order(uuid, text, text) from public, anon;
grant  execute on function public.refund_shop_order(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 9. 回退审计日志
-- ------------------------------------------------------------
create or replace function public.get_shop_refund_audit(
  p_class text default null,
  p_limit integer default 30,
  p_offset integer default 0
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_limit int := greatest(1, least(coalesce(p_limit, 30), 200));
  v_off   int := greatest(0, coalesce(p_offset, 0));
begin
  if (public.shop_admin_guard()->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (select * from public.shop_refund_audit
               where (v_class = '' or btrim(class) = v_class)
               order by created_at desc
               limit v_limit offset v_off) x), '[]'::jsonb),
    'total', (select count(*) from public.shop_refund_audit
               where (v_class = '' or btrim(class) = v_class))
  );
end;
$$;

revoke execute on function public.get_shop_refund_audit(text, integer, integer) from public, anon;
grant  execute on function public.get_shop_refund_audit(text, integer, integer) to authenticated;

-- ------------------------------------------------------------
-- 10. 校验
-- ------------------------------------------------------------
select count(*) as 订单总数,
       count(*) filter (where status = 'active')   as 已生效,
       count(*) filter (where status = 'refunded') as 已回退,
       coalesce(sum(star_spent), 0)                as 消耗星光合计
  from public.shop_order;

select count(*) as 审计日志条数 from public.shop_refund_audit;

notify pgrst, 'reload schema';
