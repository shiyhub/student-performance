-- ============================================================
-- 138 · 教师端「商店订单」增强筛选
--
-- 目的：在 135 号的基础上给 get_shop_orders 增加筛选维度，
--       让教师能按关键字、商品类型、回退状态、星光区间筛选，并支持排序。
--
-- 新增参数：
--   p_keyword    学生姓名 / 商品名 / 商品键 模糊匹配
--   p_item_type  avatar / frame / theme / daily
--   p_min_star   单笔消耗星光下限（含）
--   p_max_star   单笔消耗星光上限（含）
--   p_refund     none 未回退 / refunded 已回退 / refundable 可回退
--   p_sort       time_desc(默认) / time_asc / star_desc / star_asc
--
-- 之所以要换函数签名：PostgreSQL 的 create or replace 不能改参数表，
-- 所以先 drop 旧的 8 参版本，再建 14 参版本。前端已同步，旧调用不再存在。
--
-- 依赖：135-shop-order-refund.sql（shop_order 表、shop_admin_guard）
-- 执行位置：Supabase Dashboard → SQL Editor → 整段粘贴 → Run
-- 幂等，可重复执行。
-- ============================================================

drop function if exists public.get_shop_orders(text, text, date, date, text, text, integer, integer);

create or replace function public.get_shop_orders(
  p_class     text    default null,
  p_student   text    default null,
  p_from      date    default null,
  p_to        date    default null,
  p_item_key  text    default null,
  p_status    text    default null,
  p_limit     integer default 20,
  p_offset    integer default 0,
  p_keyword   text    default null,
  p_item_type text    default null,
  p_min_star  integer default null,
  p_max_star  integer default null,
  p_refund    text    default null,
  p_sort      text    default null
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
  v_kw    text := btrim(coalesce(p_keyword, ''));
  v_type  text := btrim(coalesce(p_item_type, ''));
  v_rfd   text := btrim(coalesce(p_refund, ''));
  v_sort  text := btrim(coalesce(p_sort, 'time_desc'));
  v_limit int  := greatest(1, least(coalesce(p_limit, 20), 200));
  v_off   int  := greatest(0, coalesce(p_offset, 0));
  v_out   jsonb;
begin
  if (public.shop_admin_guard()->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  if v_sort not in ('time_desc', 'time_asc', 'star_desc', 'star_asc') then
    v_sort := 'time_desc';
  end if;
  if v_rfd not in ('none', 'refunded', 'refundable') then
    v_rfd := '';
  end if;
  if v_type not in ('avatar', 'frame', 'theme', 'daily') then
    v_type := '';
  end if;

  with f as (
    select o.*
      from public.shop_order o
     where (v_class = '' or btrim(o.class) = v_class)
       and (v_name  = '' or o.student_name = v_name)
       and (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Asia/Shanghai'))
       and (p_to   is null or o.created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Shanghai'))
       and (v_item  = '' or o.item_key = v_item)
       and (v_st    = '' or v_st = 'all' or o.status = v_st)
       and (v_type  = '' or o.item_type = v_type)
       and (v_kw    = '' or o.student_name ilike '%' || v_kw || '%'
                        or o.item_name    ilike '%' || v_kw || '%'
                        or o.item_key     ilike '%' || v_kw || '%')
       and (p_min_star is null or o.star_spent >= p_min_star)
       and (p_max_star is null or o.star_spent <= p_max_star)
       and (v_rfd = '' or
            (v_rfd = 'refunded'   and o.refund_status = 'refunded') or
            (v_rfd = 'none'       and o.refund_status <> 'refunded') or
            (v_rfd = 'refundable' and o.status = 'active' and o.refund_status <> 'refunded'))
  ),
  page as (
    select f.*
      from f
     order by
       case when v_sort = 'star_desc' then f.star_spent end desc nulls last,
       case when v_sort = 'star_asc'  then f.star_spent end asc  nulls last,
       case when v_sort = 'time_asc'  then f.created_at end asc  nulls last,
       f.created_at desc
     limit v_limit offset v_off
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
             ) order by
               case when v_sort = 'star_desc' then p.star_spent end desc nulls last,
               case when v_sort = 'star_asc'  then p.star_spent end asc  nulls last,
               case when v_sort = 'time_asc'  then p.created_at end asc  nulls last,
               p.created_at desc)
        from page p), '[]'::jsonb),
    'total',           (select count(*) from f),
    'star_total',      coalesce((select sum(star_spent) from f), 0),
    'refunded_count',  (select count(*) from f where status = 'refunded'),
    'refunded_star',   coalesce((select sum(star_spent) from f where status = 'refunded'), 0),
    'student_count',   (select count(distinct student_name) from f),
    'limit', v_limit,
    'offset', v_off,
    'sort', v_sort
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.get_shop_orders(text, text, date, date, text, text, integer, integer,
                                                 text, text, integer, integer, text, text) from public, anon;
grant  execute on function public.get_shop_orders(text, text, date, date, text, text, integer, integer,
                                                 text, text, integer, integer, text, text) to authenticated;

-- 便于按筛选维度加速
create index if not exists idx_shop_order_item_type on public.shop_order (item_type);
create index if not exists idx_shop_order_refund_status on public.shop_order (refund_status);
create index if not exists idx_shop_order_star on public.shop_order (star_spent);

-- ============================================================
-- 自检（可选）：跑完可执行下面这句确认参数表已更新（应看到 14 个参数）
--   select proname, pronargs from pg_proc where proname = 'get_shop_orders';
-- ============================================================
