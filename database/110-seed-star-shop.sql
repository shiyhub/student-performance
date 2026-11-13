-- ============================================================
-- 110-seed-star-shop.sql
-- 星光商店商品（头像 / 头像框）与班级抽奖奖池
-- 可重复执行：按 item_key / prize_key 覆盖价格与排序
-- ============================================================

-- ---------- 1. 头像商品 ----------
-- 小动物 animal1-24 为免费默认款，不进商店（学生端「免费头像」区直接可选）
insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled)
select g.prefix || i,
       'avatar',
       g.name_cn || i,
       g.price,
       g.name_cn,
       g.base + i,
       true
from (values
  ('girl',    '校园女生', 8,  80,  100),
  ('boy',     '校园男生', 8,  80,  200),
  ('neutral', '校园中性', 8,  80,  300),
  ('sweet',   '甜美少女', 22, 120, 400),
  ('game',    '游戏风',   17, 120, 500),
  ('nature',  '森系田园', 8,  160, 600),
  ('chibi',   '萌趣Q版',  4,  180, 700),
  ('moe',     '萌系日常', 10, 170, 800),
  ('mecha',   '机甲战士', 4,  240, 900),
  ('warrior', '次元武士', 4,  240, 1000),
  ('fantasy', '奇幻神域', 11, 300, 1100),
  ('xian',    '国风仙韵', 5,  340, 1200)
) as g(prefix, name_cn, cnt, price, base)
cross join lateral generate_series(1, g.cnt) as i
on conflict (item_key) do update
  set item_type = excluded.item_type,
      name = excluded.name,
      price = excluded.price,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      enabled = true,
      updated_at = now();

-- 传说神将（从原等级池拆出，单独定价）
insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled) values
  ('mecha5',   'avatar', '机甲·传说', 420, '传说神将', 1301, true),
  ('warrior5', 'avatar', '武士·传说', 420, '传说神将', 1302, true),
  ('warrior6', 'avatar', '武士·神话', 460, '传说神将', 1303, true)
on conflict (item_key) do update
  set name = excluded.name, price = excluded.price, group_name = excluded.group_name,
      sort_order = excluded.sort_order, enabled = true, updated_at = now();

-- ---------- 2. 头像框商品 ----------
insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled) values
  ('none',      'frame', '无框',       0,   '基础', 2000, true),
  ('bronze',    'frame', '铜环',       60,  '基础', 2001, true),
  ('silver',    'frame', '银环',       100, '基础', 2002, true),
  ('gold',      'frame', '金环',       140, '基础', 2003, true),
  ('rainbow',   'frame', '彩虹环',     200, '基础', 2004, true),
  ('star',      'frame', '星光环',     160, '基础', 2005, true),
  ('heart',     'frame', '爱心环',     180, '基础', 2006, true),
  ('crown',     'frame', '皇冠环',     260, '基础', 2007, true),

  ('tac',       'frame', '军事战术',   120, '游戏风', 2101, true),
  ('sakura',    'frame', '樱花甜心',   120, '游戏风', 2102, true),
  ('gun',       'frame', '射击战士',   120, '游戏风', 2103, true),
  ('pixie',     'frame', '花漾精灵',   120, '游戏风', 2104, true),
  ('mecha',     'frame', '雷霆机甲',   160, '游戏风', 2105, true),
  ('magic',     'frame', '魔法星梦',   160, '游戏风', 2106, true),
  ('wolf',      'frame', '战狼之王',   180, '游戏风', 2107, true),
  ('rose',      'frame', '玫瑰公主',   180, '游戏风', 2108, true),
  ('fairy',     'frame', '花灵仙子',   180, '游戏风', 2109, true),
  ('dragon',    'frame', '龙魂战甲',   220, '游戏风', 2110, true),
  ('queen',     'frame', '星光女王',   220, '游戏风', 2111, true),
  ('princess',  'frame', '梦幻公主',   220, '游戏风', 2112, true),

  ('huadian',   'frame', '鎏金蝶舞',   260, '进阶', 2201, true),
  ('blossom',   'frame', '樱吹雪',     260, '进阶', 2202, true),
  ('ink',       'frame', '水墨国韵',   260, '进阶', 2203, true),
  ('spring',    'frame', '春日芳菲',   260, '进阶', 2204, true),
  ('redlily',   'frame', '彼岸绯红',   300, '进阶', 2205, true),
  ('mask',      'frame', '暗夜鬼面',   300, '进阶', 2206, true),
  ('neonwolf',  'frame', '霓虹狼影',   360, '进阶', 2207, true),

  ('ice',       'frame', '冰晶雪翼',   280, '魔法星空', 2301, true),
  ('moon',      'frame', '月神羽翼',   280, '魔法星空', 2302, true),
  ('crystal',   'frame', '水晶星梦',   280, '魔法星空', 2303, true),
  ('silk',      'frame', '丝带蝶舞',   280, '魔法星空', 2304, true),
  ('goldwing',  'frame', '鎏金圣翼',   280, '魔法星空', 2305, true),
  ('kitty',     'frame', '月眠猫咪',   280, '魔法星空', 2306, true),

  ('devilcat',  'frame', '恶魔小猫',   220, '兽耳小铺', 2401, true),
  ('angelcat',  'frame', '天使小猫',   220, '兽耳小铺', 2402, true),
  ('clover',    'frame', '四叶祝福',   220, '兽耳小铺', 2403, true),
  ('neko',      'frame', '奇幻猫耳',   220, '兽耳小铺', 2404, true),
  ('sweets',    'frame', '甜心点心',   220, '兽耳小铺', 2405, true),
  ('goth',      'frame', '暗黑哥特',   220, '兽耳小铺', 2406, true),
  ('broken',    'frame', '破碎之心',   220, '兽耳小铺', 2407, true),
  ('mono',      'frame', '黑白猫耳',   220, '兽耳小铺', 2408, true),
  ('tech',      'frame', '机能兽耳',   220, '兽耳小铺', 2409, true),
  ('ribbon',    'frame', '紫晶蝶梦',   260, '兽耳小铺', 2410, true),

  ('cyber',     'frame', '赛博幻梦',   380, '典藏', 2501, true),
  ('pulse',     'frame', '霓虹脉冲',   380, '典藏', 2502, true),
  ('unicorn',   'frame', '彩虹独角兽', 380, '典藏', 2503, true),
  ('onyx',      'frame', '黑金曜石',   380, '典藏', 2504, true),
  ('rosefeather','frame','白玫瑰黑羽', 320, '典藏', 2505, true)
on conflict (item_key) do update
  set name = excluded.name, price = excluded.price, group_name = excluded.group_name,
      sort_order = excluded.sort_order, enabled = true, updated_at = now();

-- ---------- 3. 抽奖奖池 ----------
insert into public.lottery_prize(prize_key, name, icon, prize_type, prize_value, prize_item, weight, enabled) values
  ('star_50',    '星光值 +50',     '⭐', 'star',        50,  null,       22, true),
  ('star_100',   '星光值 +100',    '🌟', 'star',        100, null,       12, true),
  ('star_200',   '星光值 +200',    '💫', 'star',        200, null,        6, true),
  ('class_50',   '全班星光 +50',   '🎊', 'class_star',  50,  null,        8, true),
  ('class_100',  '全班星光 +100',  '🎉', 'class_star',  100, null,        3, true),
  ('frame_bronze','铜环头像框',    '🥉', 'frame',       0,   'bronze',    8, true),
  ('frame_gold', '金环头像框',     '🥇', 'frame',       0,   'gold',      5, true),
  ('frame_rainbow','彩虹环头像框', '🌈', 'frame',       0,   'rainbow',   3, true),
  ('frame_crown','皇冠环头像框',   '👑', 'frame',       0,   'crown',     2, true),
  ('avatar_sweet','甜美头像',      '🎀', 'avatar',      0,   'sweet1',    4, true),
  ('avatar_nature','森系头像',     '🌿', 'avatar',      0,   'nature1',   4, true),
  ('avatar_fantasy','奇幻头像',    '✨', 'avatar',      0,   'fantasy1',  2, true),
  ('thanks',     '谢谢参与',       '🍀', 'none',        0,   null,        9, true)
on conflict (prize_key) do update
  set name = excluded.name, icon = excluded.icon, prize_type = excluded.prize_type,
      prize_value = excluded.prize_value, prize_item = excluded.prize_item,
      weight = excluded.weight, enabled = true;

-- ---------- 4. 兼容：把现有头像/头像框登记为已拥有 ----------
insert into public.student_inventory(class, student_name, item_type, item_key, price_paid, source)
select class, student_name, 'avatar', avatar, 0, 'migrate'
  from public.student_info
 where coalesce(avatar, '') <> ''
   and avatar !~ '^animal([1-9]|1[0-9]|2[0-4])$'
on conflict do nothing;

insert into public.student_inventory(class, student_name, item_type, item_key, price_paid, source)
select class, student_name, 'frame', frame, 0, 'migrate'
  from public.student_info
 where coalesce(frame, 'none') not in ('', 'none')
on conflict do nothing;

-- 校验输出
select item_type, count(*) as 商品数, min(price) as 最低价, max(price) as 最高价
  from public.shop_item group by item_type order by item_type;

select count(*) as 奖池数量 from public.lottery_prize where enabled;
