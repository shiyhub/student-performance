-- ============================================================================
-- 136-scene-themes-18-avatar-2.sql
--   一次性上架本批素材：
--     · 18 套「场景」卡片主题（恒星光隧道 / 水墨剑影 / 粉樱少女 …）
--     · 2 张插画头像（portrait1 白发少女、portrait2 白发侧影）
--
--   配套文件（须一起上传到仓库才生效）：
--     · assets/themes/scene-*.webp              18 张，480×452（卡片比例 1.06）
--     · assets/avatars/portrait1.webp / -s.webp  512 / 128
--     · assets/avatars/portrait2.webp / -s.webp
--     · js/student.js   CARD_THEMES 已加 18 项；IMG_KEY_RE / isNewKey / AVATAR_SM_KEYS 已加 portrait1-2
--     · css/student.css v203 区块：18 条背景图 + 配色变量 + 通用层级规则
--     · sw.js           缓存版本 v103，预缓存已加 20 个文件
--
--   定价口径：本批一律 ≤ 40（首次半价后仍为整数）。
--   说明：set_student_card_theme 只校验「商品存在 + 学生已拥有」，不写死主题名单；
--         set_student_avatar 也是在 shop_item 内查（见 133 号），不写死头像名单，
--         所以这里只插商品行即可佩戴，无需改函数。
--   可重复执行（幂等）。
-- ============================================================================

-- ------------------------------------------------------------
-- 1. 18 套场景主题（sort_order 4060 起，接在 5 套羽毛主题 4010-4050 之后）
-- ------------------------------------------------------------
insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled)
values
  ('scene-tunnel',     'theme', '萤光隧道', 26, '场景主题', 4060, true),
  ('scene-snow',       'theme', '雪原红伞', 28, '场景主题', 4070, true),
  ('scene-moonrange',  'theme', '月照苍山', 32, '场景主题', 4080, true),
  ('scene-bamboo',     'theme', '竹影灯暖', 28, '场景主题', 4090, true),
  ('scene-lighthouse', 'theme', '星海灯塔', 36, '场景主题', 4100, true),
  ('scene-stargirl',   'theme', '星夜少女', 34, '场景主题', 4110, true),
  ('scene-sakura',     'theme', '樱湖远山', 30, '场景主题', 4120, true),
  ('scene-nightcat',   'theme', '夜庭黑猫', 30, '场景主题', 4130, true),
  ('scene-meadow',     'theme', '草地白猫', 26, '场景主题', 4140, true),
  ('scene-ink',        'theme', '水墨剑影', 34, '场景主题', 4150, true),
  ('scene-forest',     'theme', '林隙晨光', 26, '场景主题', 4160, true),
  ('scene-cloudfield', 'theme', '花田云海', 26, '场景主题', 4170, true),
  ('scene-iceblue',    'theme', '冰蓝幻境', 38, '场景主题', 4180, true),
  ('scene-whitehair',  'theme', '白夜回眸', 38, '场景主题', 4190, true),
  ('scene-sealight',   'theme', '海天光柱', 32, '场景主题', 4200, true),
  ('scene-valley',     'theme', '山谷村庄', 30, '场景主题', 4210, true),
  ('scene-pink',       'theme', '粉樱少女', 36, '场景主题', 4220, true),
  ('scene-lava',       'theme', '熔岩星尘', 34, '场景主题', 4230, true)
on conflict (item_key) do update
  set item_type  = excluded.item_type,
      name       = excluded.name,
      price      = excluded.price,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      enabled    = true,
      updated_at = now();

-- ------------------------------------------------------------
-- 2. 2 张插画头像（sort_order 1320 起，接在海报头像 1310-1319 之后）
-- ------------------------------------------------------------
insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled)
values
  ('portrait1', 'avatar', '插画·白发少女', 40, '插画头像', 1320, true),
  ('portrait2', 'avatar', '插画·白发侧影', 38, '插画头像', 1330, true)
on conflict (item_key) do update
  set item_type  = excluded.item_type,
      name       = excluded.name,
      price      = excluded.price,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      enabled    = true,
      updated_at = now();

-- ------------------------------------------------------------
-- 3. 兜底：本批 20 件一律不超过 40（只约束本批，不动其余商品）
-- ------------------------------------------------------------
update public.shop_item set price = 40, updated_at = now()
 where price > 40
   and item_key in (
     'scene-tunnel','scene-snow','scene-moonrange','scene-bamboo','scene-lighthouse',
     'scene-stargirl','scene-sakura','scene-nightcat','scene-meadow','scene-ink',
     'scene-forest','scene-cloudfield','scene-iceblue','scene-whitehair','scene-sealight',
     'scene-valley','scene-pink','scene-lava','portrait1','portrait2');

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 4. 自检：应返回 20 行，price 全部 ≤ 40
--    themes=18  avatars=2  max_price<=40
-- ------------------------------------------------------------
select item_type, count(*) as 件数, min(price) as 最低价, max(price) as 最高价
  from public.shop_item
 where item_key like 'scene-%' or item_key in ('portrait1','portrait2')
 group by item_type
 order by item_type;

select item_key, name, price, group_name, sort_order, enabled
  from public.shop_item
 where item_key like 'scene-%' or item_key in ('portrait1','portrait2')
 order by sort_order;
