-- ============================================================
-- 114-add-avatar-20261113.sql
-- v170：新增 7 款独立命名头像，按风格并入现有专辑
--   bunny  哥特·兔偶      暗黑哥特（新建专辑）
--   gothic 哥特·夜蔷薇    暗黑哥特（新建专辑）
--   doll   甜美·人偶      甜美少女
--   flower 甜美·花冠      甜美少女
--   twin   甜美·双马尾    甜美少女
--   lotus  国风·荷塘      国风仙韵
--   horn   奇幻·金角      奇幻神域
-- 可重复执行：按 item_key 覆盖名称/价格/分组，不会重复插入
-- 价格可随时在教师端「星光商店 → 商店价格管理」里改
-- ============================================================

insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled) values
  ('doll',   'avatar', '甜美·人偶',   120, '甜美少女', 1401, true),
  ('flower', 'avatar', '甜美·花冠',   120, '甜美少女', 1402, true),
  ('twin',   'avatar', '甜美·双马尾', 120, '甜美少女', 1403, true),
  ('lotus',  'avatar', '国风·荷塘',   340, '国风仙韵', 1404, true),
  ('horn',   'avatar', '奇幻·金角',   300, '奇幻神域', 1405, true),
  ('bunny',  'avatar', '哥特·兔偶',   260, '暗黑哥特', 1406, true),
  ('gothic', 'avatar', '哥特·夜蔷薇', 260, '暗黑哥特', 1407, true)
on conflict (item_key) do update
  set item_type  = excluded.item_type,
      name       = excluded.name,
      price      = excluded.price,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      enabled    = true,
      updated_at = now();

-- 校验：应返回 7 行
select item_key, name, price, group_name, sort_order
  from public.shop_item
 where item_type = 'avatar'
   and item_key in ('doll','flower','twin','lotus','horn','bunny','gothic')
 order by sort_order;
