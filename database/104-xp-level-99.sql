-- ============================================================
-- 104-xp-level-99.sql（更新版 v2）
-- 学生个人经验等级上限提升至 Lv.99（与前端 student.js XP_LEVELS 同口径）
--
-- 口径（与前端 v164 一致）：
--   前 9 级保留原节奏：0/20/60/120/200/400/600/900/1300
--   Lv.10 起每级固定 500 经验升级（不再递增，升级需求不过多）
--   Lv.99 阈值 = 46300
--
-- 执行位置：Supabase Dashboard → SQL Editor → 运行（对 prod 库）
-- 幂等：函数 create or replace、约束先 drop 再 add，可重复执行；
--       若此前已执行过旧版 104，直接重新执行本文件即可覆盖。
-- ============================================================

-- ---------- 1) 等级换算函数：12 级 → 99 级（Lv.10 起每级 500） ----------
create or replace function public.level_from_xp(p_xp int)
returns int language sql immutable as $$
  select least(99, case
           when coalesce(p_xp, 0) >= 1800  then 10 + ((coalesce(p_xp, 0) - 1800) / 500)::int
           when coalesce(p_xp, 0) >= 1300  then 9
           when coalesce(p_xp, 0) >= 900   then 8
           when coalesce(p_xp, 0) >= 600   then 7
           when coalesce(p_xp, 0) >= 400   then 6
           when coalesce(p_xp, 0) >= 200   then 5
           when coalesce(p_xp, 0) >= 120   then 4
           when coalesce(p_xp, 0) >= 60    then 3
           when coalesce(p_xp, 0) >= 20    then 2
           else 1
         end);
$$;

-- ---------- 2) 等级约束：1~12 → 1~99（防旧脚本覆盖回归） ----------
alter table public.student_info drop constraint if exists chk_student_level;
alter table public.student_info
  add constraint chk_student_level check (level between 1 and 99);

-- ---------- 自检（应全部通过） ----------
-- ① 等级换算边界：
--    select public.level_from_xp(0)     -- 1
--    select public.level_from_xp(1300)  -- 9
--    select public.level_from_xp(1799)  -- 9
--    select public.level_from_xp(1800)  -- 10
--    select public.level_from_xp(2299)  -- 10
--    select public.level_from_xp(2300)  -- 11
--    select public.level_from_xp(2800)  -- 12
--    select public.level_from_xp(46300) -- 99
--    select public.level_from_xp(999999) -- 99（封顶）
-- ② 约束生效：
--    select pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.student_info'::regclass and conname = 'chk_student_level';
--    -- 期望 CHECK ((level >= 1) AND (level <= 99))
-- ③ 存量数据无越界（应返回 0 行）：
--    select count(*) from public.student_info where level < 1 or level > 99;
