-- ============================================================
-- 113-reset-avatar-frame.sql
-- 一次性数据调整：全班头像统一为小狗，头像框全部取消佩戴
--
--   ① 所有学生头像 → animal1（柴犬，免费款）
--   ② 所有学生头像框 → none（不再佩戴）；已兑换的框保留在库存，随时可换回
--   ③ 动物头像 permanent 免费：把误入商店的 animal 商品记录清掉
--      （前端「🐾 免费头像」区 + set_student_avatar 的白名单本就放开 animal1-24）
--
-- 只改 student_info 的 avatar / frame 两列，不碰星光值、等级、记录、库存。
-- 可重复执行，结果一致。
-- 说明：本库启用了 pg_safeupdate，全表 UPDATE 必须显式带 WHERE，故统一写 where true。
-- ============================================================

-- ① 执行前看一眼现状（只读）
select coalesce(frame, '(空)') as 头像框, count(*) as 人数
  from public.student_info
 group by 1
 order by 2 desc;

select coalesce(avatar, '(空)') as 头像, count(*) as 人数
  from public.student_info
 group by 1
 order by 2 desc;

-- ② 执行调整
-- 头像框：全部取消佩戴（库存 student_inventory 不动）
update public.student_info
   set frame = 'none'
 where true
   and coalesce(frame, 'none') <> 'none';

-- 头像：全部换成柴犬（animal1）
update public.student_info
   set avatar = 'animal1'
 where true
   and coalesce(avatar, '') <> 'animal1';

-- 动物头像不售卖：清掉可能存在的 animal 商品记录，避免商店里出现带价格的动物头像
delete from public.shop_item
 where item_type = 'avatar'
   and item_key ~ '^animal([1-9]|1[0-9]|2[0-4])$';

-- ③ 执行后自查（应看到：头像框只有 none、头像只有 animal1）
select coalesce(frame, '(空)') as 头像框, count(*) as 人数
  from public.student_info
 group by 1;

select coalesce(avatar, '(空)') as 头像, count(*) as 人数
  from public.student_info
 group by 1;

-- 应返回 0 行：商店里不应再有 animal 头像商品
select item_key, price, enabled
  from public.shop_item
 where item_type = 'avatar'
   and item_key ~ '^animal([1-9]|1[0-9]|2[0-4])$';
