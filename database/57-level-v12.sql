-- ============================================================
-- 57-level-v12.sql  学生个人等级上限提升至 Lv.12
--   现有 7 级阈值不变（已上线学生等级不倒退），在 600 之上扩展 Lv.8~Lv.12
--   L1=0 / L2=20 / L3=60 / L4=120 / L5=200 / L6=400 / L7=600
--   L8=900 / L9=1300 / L10=1800 / L11=2500 / L12=3500
-- 可重复执行。跑完后到老师后台刷新，学生等级即按新曲线显示。
-- 班级等级为前端计算（10 级），无需数据库变更。
-- ============================================================

create or replace function public.level_from_xp(p_xp int)
returns int language sql immutable as $$
  select case
           when coalesce(p_xp, 0) >= 3500 then 12
           when coalesce(p_xp, 0) >= 2500 then 11
           when coalesce(p_xp, 0) >= 1800 then 10
           when coalesce(p_xp, 0) >= 1300 then 9
           when coalesce(p_xp, 0) >= 900  then 8
           when coalesce(p_xp, 0) >= 600  then 7
           when coalesce(p_xp, 0) >= 400  then 6
           when coalesce(p_xp, 0) >= 200  then 5
           when coalesce(p_xp, 0) >= 120  then 4
           when coalesce(p_xp, 0) >= 60   then 3
           when coalesce(p_xp, 0) >= 20   then 2
           else 1
         end;
$$;

-- 自检（可选）：
--   select public.level_from_xp(0);    -- 1
--   select public.level_from_xp(599);  -- 6
--   select public.level_from_xp(600);  -- 7
--   select public.level_from_xp(899);  -- 7
--   select public.level_from_xp(900);  -- 8
--   select public.level_from_xp(1299); -- 8
--   select public.level_from_xp(1300); -- 9
--   select public.level_from_xp(1799); -- 9
--   select public.level_from_xp(1800); -- 10
--   select public.level_from_xp(2499); -- 10
--   select public.level_from_xp(2500); -- 11
--   select public.level_from_xp(3499); -- 11
--   select public.level_from_xp(3500); -- 12
--   select public.level_from_xp(99999);-- 12
