-- ============================================================
-- 125-class-level-curve.sql
-- 班级等级经验曲线重设：500 / 1000 / 1500 / 2000，之后每级 2000，上限 99 级
--
-- 口径（每级升到下一级的「升级经验值」）：
--   Lv1 → Lv2   500
--   Lv2 → Lv3  1000
--   Lv3 → Lv4  1500
--   Lv4 → Lv5  2000
--   Lv5 以上    每级 2000
--   最高 99 级
--
-- 换算成 class_level_rule.need_xp（累计值，class_level_of 按它取等级）：
--   Lv1     0
--   Lv2   500
--   Lv3  1500
--   Lv4  3000
--   Lv5  5000
--   Lv6  7000
--   ...
--   Lv99 193000
--
-- 旧规则为 (level-1)*3000，即每级固定 3000、Lv2 需 3000。
-- 可重复执行（delete + insert，on conflict do nothing）。
-- 执行位置：Supabase Dashboard → SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 0. 执行前对照（可选）：当前班级进度
-- ------------------------------------------------------------
-- select class, xp, level, public.class_level_of(xp) as new_level
--   from public.class_progress order by xp desc;

-- ------------------------------------------------------------
-- 1. 重建等级规则表（1..99）
--    注意：pg_safeupdate 已启用，DELETE 必须带 WHERE
-- ------------------------------------------------------------
delete from public.class_level_rule where true;

insert into public.class_level_rule(level, need_xp)
select g,
       case
         when g = 1 then 0
         when g = 2 then 500
         when g = 3 then 1500
         when g = 4 then 3000
         when g = 5 then 5000
         else 5000 + (g - 5) * 2000
       end
  from generate_series(1, 99) g
on conflict (level) do update
  set need_xp = excluded.need_xp;

-- ------------------------------------------------------------
-- 2. 按新曲线重算已有班级的等级（只升不降）
-- ------------------------------------------------------------
update public.class_progress
   set level      = greatest(coalesce(level, 1), public.class_level_of(xp)),
       updated_at = now()
 where true;

-- ------------------------------------------------------------
-- 3. 补发因曲线下调而跳级产生的抽奖机会
--    已存在（含已用掉）的 (class, level) 记录不受影响
-- ------------------------------------------------------------
insert into public.class_draw_chance(class, level)
select cp.class, g
  from public.class_progress cp
  cross join generate_series(2, 99) g
 where g <= cp.level
on conflict (class, level) do nothing;

-- ------------------------------------------------------------
-- 4. 验证（取消注释后执行）
-- ------------------------------------------------------------
-- ① 规则表：应看到 Lv1=0 / Lv2=500 / Lv3=1500 / Lv4=3000 / Lv5=5000 / Lv6=7000，共 99 行
-- select level, need_xp,
--        need_xp - lag(need_xp, 1, 0) over (order by level) as step   -- step 应为 500,1000,1500,2000,2000...
--   from public.class_level_rule
--  order by level
--  limit 10;

-- ② 班级进度：new_level 必须等于 level，且 next_need 为下一级累计门槛
-- select cp.class, cp.xp, cp.level,
--        public.class_level_of(cp.xp) as calc_level,
--        (select need_xp from public.class_level_rule where level = cp.level + 1) as next_need
--   from public.class_progress cp
--  order by cp.xp desc;

-- ③ 上限：Lv99 封顶（返回 193000 / 99）
-- select (select need_xp from public.class_level_rule where level = 99) as lv99_need,
--        public.class_level_of(999999) as capped_level;
