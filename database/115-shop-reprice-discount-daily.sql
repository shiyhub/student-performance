-- ============================================================
-- 115-shop-reprice-discount-daily.sql
-- 1) 头像 / 头像框全面降价：非免费商品一律不超过 80 星光值
-- 2) 首次购买半价（每位学生仅一次，按「第一次付过钱的兑换」计）
-- 3) 星光商店新增「日常」分类，上架免作业卡（40 星光值，可重复购买）
-- 可重复执行（幂等）。
-- ============================================================

-- ------------------------------------------------------------
-- 0. shop_item.item_type 放开 daily
--    （原约束是列级 check，名字可能是 shop_item_item_type_check，
--      这里按定义内容查找，避免版本差异导致改名失败）
-- ------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.shop_item'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%item_type%'
  loop
    execute format('alter table public.shop_item drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.shop_item
  add constraint shop_item_item_type_check
  check (item_type in ('avatar', 'frame', 'daily'));

-- ------------------------------------------------------------
-- 1. 头像重新定价（全部为偶数，半价后仍为整数）
--    定价口径：普通校园款 20–24 / 日常萌系 30–34 / 风格款 44–46
--              机甲·武士 52 / 哥特 56 / 奇幻 60 / 国风 64 / 传说 76–80
-- ------------------------------------------------------------
update public.shop_item set price = 24, updated_at = now()
 where item_type = 'avatar' and item_key ~ '^(girl|boy|neutral)[0-9]+$';

update public.shop_item set price = 20, updated_at = now()
 where item_type = 'avatar' and item_key ~ '^chibi[0-9]+$';

update public.shop_item set price = 30, updated_at = now()
 where item_type = 'avatar' and item_key ~ '^moe[0-9]+$';

update public.shop_item set price = 34, updated_at = now()
 where item_type = 'avatar' and item_key ~ '^nature[0-9]+$';

update public.shop_item set price = 44, updated_at = now()
 where item_type = 'avatar' and item_key ~ '^game[0-9]+$';

update public.shop_item set price = 46, updated_at = now()
 where item_type = 'avatar' and item_key ~ '^sweet[0-9]+$';

update public.shop_item set price = 52, updated_at = now()
 where item_type = 'avatar' and item_key ~ '^mecha[0-9]+$';

update public.shop_item set price = 52, updated_at = now()
 where item_type = 'avatar' and item_key ~ '^warrior[0-9]+$';

update public.shop_item set price = 60, updated_at = now()
 where item_type = 'avatar' and item_key ~ '^fantasy[0-9]+$';

update public.shop_item set price = 64, updated_at = now()
 where item_type = 'avatar' and item_key ~ '^xian[0-9]+$';

-- 单独命名的款式：跟随所属专辑
update public.shop_item set price = 46, updated_at = now()
 where item_type = 'avatar' and item_key in ('doll', 'flower', 'twin');
update public.shop_item set price = 56, updated_at = now()
 where item_type = 'avatar' and item_key in ('bunny', 'gothic');
update public.shop_item set price = 60, updated_at = now()
 where item_type = 'avatar' and item_key = 'horn';
update public.shop_item set price = 64, updated_at = now()
 where item_type = 'avatar' and item_key = 'lotus';

-- 传说神将：全店最高价
update public.shop_item set price = 76, updated_at = now()
 where item_type = 'avatar' and item_key in ('mecha5', 'warrior5');
update public.shop_item set price = 80, updated_at = now()
 where item_type = 'avatar' and item_key = 'warrior6';

-- ------------------------------------------------------------
-- 2. 头像框重新定价
--    基础 16–50 / 游戏风 26–46 / 进阶 52–66 / 魔法星空 56
--    兽耳小铺 44–54 / 典藏 72–78
-- ------------------------------------------------------------
update public.shop_item set price = 0,  updated_at = now() where item_type = 'frame' and item_key = 'none';
update public.shop_item set price = 16, updated_at = now() where item_type = 'frame' and item_key = 'bronze';
update public.shop_item set price = 22, updated_at = now() where item_type = 'frame' and item_key = 'silver';
update public.shop_item set price = 28, updated_at = now() where item_type = 'frame' and item_key = 'gold';
update public.shop_item set price = 34, updated_at = now() where item_type = 'frame' and item_key = 'star';
update public.shop_item set price = 38, updated_at = now() where item_type = 'frame' and item_key = 'heart';
update public.shop_item set price = 44, updated_at = now() where item_type = 'frame' and item_key = 'rainbow';
update public.shop_item set price = 50, updated_at = now() where item_type = 'frame' and item_key = 'crown';

update public.shop_item set price = 26, updated_at = now()
 where item_type = 'frame' and item_key in ('tac', 'sakura', 'gun', 'pixie');
update public.shop_item set price = 32, updated_at = now()
 where item_type = 'frame' and item_key in ('mecha', 'magic');
update public.shop_item set price = 38, updated_at = now()
 where item_type = 'frame' and item_key in ('wolf', 'rose', 'fairy');
update public.shop_item set price = 46, updated_at = now()
 where item_type = 'frame' and item_key in ('dragon', 'queen', 'princess');

update public.shop_item set price = 52, updated_at = now()
 where item_type = 'frame' and item_key in ('huadian', 'blossom', 'ink', 'spring');
update public.shop_item set price = 58, updated_at = now()
 where item_type = 'frame' and item_key in ('redlily', 'mask');
update public.shop_item set price = 66, updated_at = now()
 where item_type = 'frame' and item_key = 'neonwolf';

update public.shop_item set price = 56, updated_at = now()
 where item_type = 'frame' and item_key in ('ice', 'moon', 'crystal', 'silk', 'goldwing', 'kitty');

update public.shop_item set price = 44, updated_at = now()
 where item_type = 'frame' and item_key in ('devilcat', 'angelcat', 'clover', 'neko', 'sweets', 'goth', 'broken', 'mono', 'tech');
update public.shop_item set price = 54, updated_at = now()
 where item_type = 'frame' and item_key = 'ribbon';

update public.shop_item set price = 72, updated_at = now()
 where item_type = 'frame' and item_key = 'rosefeather';
update public.shop_item set price = 78, updated_at = now()
 where item_type = 'frame' and item_key in ('cyber', 'pulse', 'unicorn', 'onyx');

-- ------------------------------------------------------------
-- 3. 兜底：任何未覆盖到的装扮一律压到 80 以内
-- ------------------------------------------------------------
update public.shop_item set price = 80, updated_at = now()
 where item_type in ('avatar', 'frame') and price > 80;

-- ------------------------------------------------------------
-- 4. 日常分类：免作业卡
-- ------------------------------------------------------------
insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled)
values ('no_homework', 'daily', '免作业卡', 40, '日常', 3000, true)
on conflict (item_key) do update
  set item_type  = excluded.item_type,
      name       = excluded.name,
      price      = excluded.price,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      enabled    = true,
      updated_at = now();

-- ------------------------------------------------------------
-- 5. 卡片持有表（免作业卡可重复购买，故不占用 student_inventory）
-- ------------------------------------------------------------
create table if not exists public.student_coupon (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,
  student_name text not null,
  item_key     text not null,
  name         text not null,
  price_paid   integer not null default 0,
  status       text not null default 'unused' check (status in ('unused', 'used')),
  issued_at    timestamptz not null default now(),
  used_at      timestamptz
);
create index if not exists idx_coupon_stu on public.student_coupon(class, student_name, item_key);
create index if not exists idx_coupon_used on public.student_coupon(used_at desc);

alter table public.student_coupon enable row level security;
drop policy if exists p_student_coupon_teacher on public.student_coupon;
create policy p_student_coupon_teacher on public.student_coupon
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 6. 购买：首次半价 + 日常卡入库
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
    values (v_class, v_name, it.item_key, it.name, v_pay);

    select count(*) into v_held from public.student_coupon
     where class = v_class and student_name = v_name
       and item_key = it.item_key and status = 'unused';

    return jsonb_build_object(
      'ok', true,
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

  return jsonb_build_object(
    'ok', true,
    'item_key', it.item_key,
    'item_type', it.item_type,
    'name', it.name,
    'price', v_pay,
    'first_discount_used', v_first,
    'balance', case when v_sp is null then null else (v_sp->>'balance')::int end
  );
end;
$$;

-- ------------------------------------------------------------
-- 7. 商店目录：带上半价后的现价、是否仍享首次半价、日常卡持有数
-- ------------------------------------------------------------
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
  v_first boolean;
  v_items jsonb;
begin
  select avatar, coalesce(frame, 'none')
    into v_av, v_fr
    from public.student_info
   where class = v_class and student_name = v_name
   limit 1;

  select coalesce(balance, 0) into v_bal from public.student_wallet
   where class = v_class and student_name = v_name;

  v_first := not exists (
               select 1 from public.student_inventory
                where class = v_class and student_name = v_name
                  and source = 'purchase' and price_paid > 0)
             and not exists (
               select 1 from public.student_coupon
                where class = v_class and student_name = v_name);

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_key', s.item_key,
           'item_type', s.item_type,
           'name', s.name,
           'price', s.price,
           'pay_price', case when v_first and s.price > 0 then ceil(s.price / 2.0)::int else s.price end,
           'group_name', s.group_name,
           'sort_order', s.sort_order,
           'held', case when s.item_type = 'daily' then (
                     select count(*) from public.student_coupon c
                      where c.class = v_class and c.student_name = v_name
                        and c.item_key = s.item_key and c.status = 'unused')::int
                   else 0 end,
           'owned', case when s.item_type = 'daily' then false else
                      (s.item_key = v_av and s.item_type = 'avatar')
                      or (s.item_key = v_fr and s.item_type = 'frame')
                      or exists (select 1 from public.student_inventory iv
                                  where iv.class = v_class and iv.student_name = v_name
                                    and iv.item_type = s.item_type and iv.item_key = s.item_key)
                    end,
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
    'first_discount', v_first,
    'items', v_items
  );
end;
$$;

-- ------------------------------------------------------------
-- 8. 使用日常卡
-- ------------------------------------------------------------
create or replace function public.use_coupon(p_class text, p_student text, p_item_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_id    uuid;
  v_left  int;
begin
  if v_class = '' or v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  select id into v_id from public.student_coupon
   where class = v_class and student_name = v_name
     and item_key = btrim(coalesce(p_item_key, ''))
     and status = 'unused'
   order by issued_at
   limit 1
   for update;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_owned');
  end if;

  update public.student_coupon
     set status = 'used', used_at = now()
   where id = v_id;

  select count(*) into v_left from public.student_coupon
   where class = v_class and student_name = v_name
     and item_key = btrim(p_item_key) and status = 'unused';

  return jsonb_build_object('ok', true, 'remaining', v_left);
end;
$$;

-- ------------------------------------------------------------
-- 9. 教师端：今日已使用的日常卡
-- ------------------------------------------------------------
create or replace function public.get_today_coupons(p_class text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_out   jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'student_name', student_name,
           'name', name,
           'used_at', used_at
         ) order by used_at desc), '[]'::jsonb)
    into v_out
    from public.student_coupon
   where (v_class = '' or class = v_class)
     and status = 'used'
     and (used_at at time zone 'Asia/Shanghai')::date = v_today;

  return jsonb_build_object('ok', true, 'today', v_today, 'items', v_out);
end;
$$;

grant execute on function public.buy_shop_item(text, text, text) to anon, authenticated;
grant execute on function public.get_shop_catalog(text, text) to anon, authenticated;
grant execute on function public.use_coupon(text, text, text) to anon, authenticated;
grant execute on function public.get_today_coupons(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 10. 校验
-- ------------------------------------------------------------
select item_type,
       count(*) as 商品数,
       min(price) as 最低价,
       max(price) as 最高价,
       count(*) filter (where price > 80) as 超过80的数量
  from public.shop_item
 where item_type in ('avatar', 'frame')
 group by item_type
 order by item_type;

select item_key, item_type, name, price, group_name from public.shop_item where item_type = 'daily';
