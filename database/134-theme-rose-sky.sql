-- ============================================================================
-- 134-theme-rose-sky.sql
--   上架两套新的卡片主题商品：
--     · feather-rose  樱羽星砂  —— 粉紫羽毛 + 珠光闪片
--     · sky-pastel    云海晨光  —— 粉蓝天空云海油画
--
--   配套改动（需一起上传到仓库才会生效）：
--     · assets/themes/feather-rose.webp、sky-pastel.webp
--     · js/student.js 的 CARD_THEMES 已加入两者
--     · css/student.css 的 v199 区块已加入两者的背景图与配色
--     · sw.js 预缓存清单已加入两者
--
--   说明：set_student_card_theme 的校验是「shop_item 里存在该 theme 且学生已拥有」，
--         不写死主题名单，所以只插商品行就能佩戴，无需改函数。
--   可重复执行（幂等）。
-- ============================================================================

-- ------------------------------------------------------------
-- 1. 两件主题商品
-- 定价：38 / 30（117 号脚本约定主题一律 ≤ 40，首次半价后仍为整数 19 / 15）
-- ------------------------------------------------------------
insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled)
values
  ('feather-rose', 'theme', '樱羽星砂', 38, '卡片主题', 4040, true),
  ('sky-pastel',   'theme', '云海晨光', 30, '卡片主题', 4050, true)
on conflict (item_key) do update
  set item_type  = excluded.item_type,
      name       = excluded.name,
      price      = excluded.price,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      enabled    = true,
      updated_at = now();

-- ------------------------------------------------------------
-- 2. 兜底：主题价格不超过 40（沿用 117 号口径）
-- ------------------------------------------------------------
update public.shop_item set price = 40, updated_at = now()
 where item_type = 'theme' and price > 40;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3. 自检（执行后应看到 5 行卡片主题）
-- ------------------------------------------------------------
select item_key, name, price, sort_order, enabled
  from public.shop_item
 where item_type = 'theme'
 order by sort_order;
