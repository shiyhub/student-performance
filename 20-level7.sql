-- ============================================================
-- 20-level7.sql  增加 Lv.7（经验 >= 600），解锁大师典藏头像
-- 可重复执行
-- ============================================================

create or replace function public.level_from_xp(p_xp int)
returns int language sql immutable as $$
  select case
           when coalesce(p_xp, 0) >= 600 then 7
           when coalesce(p_xp, 0) >= 400 then 6
           when coalesce(p_xp, 0) >= 200 then 5
           when coalesce(p_xp, 0) >= 120 then 4
           when coalesce(p_xp, 0) >= 60  then 3
           when coalesce(p_xp, 0) >= 20  then 2
           else 1
         end;
$$;
