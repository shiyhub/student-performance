-- ============================================================
-- 118-purge-legacy-frame-unlocks.sql
--
-- 问题：部分学生从未在星光商店消费过，头像框却显示「使用」（即已解锁）。
--       例：六年级一班 王玥 · 花灵仙子（38 星光值）。
--
-- 根因：
--   ① 109 / 110 号把「迁移前学生正在佩戴的头像、头像框」写进了
--      student_inventory，标记 source='migrate'、price_paid=0。
--   ② 但那时的头像框并不是买来的 —— 旧版（43~108 号）按等级 / 累计天数
--      自动解锁，学生可以自由佩戴。迁移只做了「佩戴即登记」，
--      等于把旧机制的免费解锁固化成了「已拥有」。
--   ③ 113 号把 student_info.frame 统一清成 'none'，但注释里写明
--      「已兑换的框保留在库存」，于是这批 migrate 记录全部留了下来。
--   ④ 前端 owned 判定只看 student_inventory 有没有记录、不看来源，
--      于是这些框在「头像框」页和商店里都显示为已拥有。
--
-- 处理：
--   备份 → 删除「migrate 且未付费」的库存（头像框 + 付费头像）
--        → frame 空值归一 → 校验。
--   不碰 purchase / draw / gift 三种来源，真实兑换与抽奖所得不受影响。
--
-- 可重复执行。执行前建议先跑第 0 步看一眼现状。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 执行前现状（只读，用于留档对比）
-- ------------------------------------------------------------
select source,
       item_type,
       count(*)              as 条数,
       coalesce(sum(price_paid), 0) as 付费合计
  from public.student_inventory
 group by source, item_type
 order by source, item_type;

-- 预期：migrate / frame 一行，条数 25 左右，付费合计 0
select count(*) as 待清理的头像框记录
  from public.student_inventory
 where source = 'migrate'
   and item_type = 'frame'
   and price_paid = 0;

-- 预期：migrate / avatar 一行，条数 30 左右，付费合计 0
select count(*) as 待清理的头像记录
  from public.student_inventory
 where source = 'migrate'
   and item_type = 'avatar'
   and price_paid = 0;

-- 逐条明细：从未消费过、却拥有头像框的学生（source 列应全部是 migrate）
select iv.student_name              as 学生,
       iv.item_key                  as 头像框,
       iv.source                    as 来源,
       iv.price_paid                as 实付,
       coalesce(w.total_spent, 0)   as 累计消费,
       coalesce(w.balance, 0)       as 当前余额
  from public.student_inventory iv
  left join public.student_wallet w
    on w.class = iv.class and w.student_name = iv.student_name
 where iv.item_type = 'frame'
   and coalesce(w.total_spent, 0) = 0
 order by iv.student_name;

-- ------------------------------------------------------------
-- 1. 备份（出问题可据此回滚）
-- ------------------------------------------------------------
create table if not exists public.inventory_bak_118 (
  class        text,
  student_name text,
  item_type    text,
  item_key     text,
  price_paid   integer,
  source       text,
  acquired_at  timestamptz,
  backed_up_at timestamptz not null default now()
);

delete from public.inventory_bak_118 where true;

insert into public.inventory_bak_118
      (class, student_name, item_type, item_key, price_paid, source, acquired_at)
select class, student_name, item_type, item_key, price_paid, source, acquired_at
  from public.student_inventory
 where source = 'migrate'
   and price_paid = 0;

-- ------------------------------------------------------------
-- 2. 删除旧机制遗留的头像框
--    正在佩戴的不删（避免出现「戴着却没有」的反向异常）
-- ------------------------------------------------------------
delete from public.student_inventory iv
 where iv.source = 'migrate'
   and iv.price_paid = 0
   and iv.item_type = 'frame'
   and not exists (
         select 1
           from public.student_info si
          where si.class = iv.class
            and si.student_name = iv.student_name
            and coalesce(si.frame, 'none') = iv.item_key);

-- ------------------------------------------------------------
-- 3. 同类问题：旧机制遗留的付费头像
--    免费动物头像（animal1~24）本来就默认拥有，不写库存，无需处理
-- ------------------------------------------------------------
delete from public.student_inventory iv
 where iv.source = 'migrate'
   and iv.price_paid = 0
   and iv.item_type = 'avatar'
   and iv.item_key !~ '^animal([1-9]|1[0-9]|2[0-4])$'
   and not exists (
         select 1
           from public.student_info si
          where si.class = iv.class
            and si.student_name = iv.student_name
            and coalesce(si.avatar, '') = iv.item_key);

-- ------------------------------------------------------------
-- 4. 头像框字段归一（部分学生该列为 NULL）
-- ------------------------------------------------------------
update public.student_info
   set frame = 'none'
 where frame is null
    or btrim(frame) = '';

-- ------------------------------------------------------------
-- 5. 执行后校验
-- ------------------------------------------------------------

-- 5.1 库存只剩真实所得，migrate 应为 0 行
select source, item_type, count(*) as 条数
  from public.student_inventory
 group by source, item_type
 order by source, item_type;

select count(*) as 残留的旧解锁记录
  from public.student_inventory
 where source = 'migrate';

-- 5.2 没有任何人佩戴头像框
select coalesce(frame, '(空)') as 头像框, count(*) as 人数
  from public.student_info
 group by 1
 order by 2 desc;

-- 5.3 逐个学生复核：应全部返回 0 行
--     （有框但从未付费的学生名单）
select si.class,
       si.student_name,
       iv.item_key
  from public.student_info si
  join public.student_inventory iv
    on iv.class = si.class
   and iv.student_name = si.student_name
   and iv.item_type = 'frame'
 where coalesce(si.frame, 'none') = 'none'
   and iv.source = 'migrate';

-- ------------------------------------------------------------
-- 6. 回滚（仅在需要撤销时手动执行）
-- ------------------------------------------------------------
-- insert into public.student_inventory
--       (class, student_name, item_type, item_key, price_paid, source, acquired_at)
-- select class, student_name, item_type, item_key, price_paid, source, acquired_at
--   from public.inventory_bak_118
--  on conflict do nothing;

-- 说明：
--   清理之后，这 25 名学生的头像框会回到「未解锁」状态，头像框页显示锁 + 星光值价格，
--   商店里相应商品显示可购买。后续学生用星光值兑换，写入 source='purchase'，不会再被本脚本影响。
--   若将来重跑 109 / 110 号脚本，其「佩戴即登记 migrate」的段落在 frame 全为 none 时不会产生新记录；
--   万一再次出现，直接重跑本文件即可。
