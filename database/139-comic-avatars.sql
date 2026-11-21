-- 139-comic-avatars.sql
-- 上架 7 张漫画头像：comic1..comic7，统一定价 36 星光值，无等级门槛，兑换即用。
--
-- 素材：site/assets/avatars/comicN.webp（512）+ comicN-s.webp（256）
-- 清理：comic1 左上「王者荣耀」水印靠面部裁切排除；comic5 左下圆形对话框已填平修补。
-- 前端：js/student.js 的 AVATAR_SM_KEYS 已加 comic1..comic7；sw.js 已登记 14 个文件。
--
-- 幂等：可重复执行，已存在则更新价格/名称/分组/排序。

insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled) values
  ('comic1', 'avatar', '花灵少女', 36, '漫画头像', 1340, true),
  ('comic2', 'avatar', '钢笔少女', 36, '漫画头像', 1341, true),
  ('comic3', 'avatar', '紫眸少女', 36, '漫画头像', 1342, true),
  ('comic4', 'avatar', '金发回眸', 36, '漫画头像', 1343, true),
  ('comic5', 'avatar', '黑白少女', 36, '漫画头像', 1344, true),
  ('comic6', 'avatar', '雪地围巾', 36, '漫画头像', 1345, true),
  ('comic7', 'avatar', '蛋蛋笑脸', 36, '漫画头像', 1346, true)
on conflict (item_key) do update
  set item_type  = excluded.item_type,
      name       = excluded.name,
      price      = excluded.price,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      enabled    = excluded.enabled,
      updated_at = now();

notify pgrst, 'reload schema';
