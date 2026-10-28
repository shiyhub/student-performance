-- ============================================================
-- 92-fix-old-trigger.sql
-- v154：修复「08号旧触发器残留导致日常提交经验双计」+ 等级体系幂等收敛
-- 根因：
--   08-level-exam.sql 曾创建旧版触发器 trg_apply_record_xp（按 positive 项数 ×2 加分）；
--   后续 09/64/90 号只 drop/重建了 trg_apply_record_xp_ins/_del（新版按标签分值加分），
--   **均未 drop 08 号的单数触发器 trg_apply_record_xp**。
--   若线上执行顺序中 08 号跑到 09 号之后（补跑/重跑/顺序变动），旧触发器复活，
--   与新版 _ins 触发器同时生效 → 同一条日常记录被加两次分（+4 而非 +2）→ 经验虚增。
--   90 号异常区会捕获为 xp_mismatch（实加4 vs 应得2）。
-- 修复：
--   ① drop 08 号旧触发器 trg_apply_record_xp，并幂等重建 _ins/_del（任何顺序都只有一套加分触发器）
--   ② 收敛 level_from_xp 到 Lv.12（防 08 号旧版 1~5 覆盖 57 号的 12 级）
--   ③ 收敛 chk_student_level 到 1~12（防 08 号旧版 1~5 覆盖 91 号的 1~12）
-- 可重复执行。
-- ============================================================

-- ---------- 1) 清理 08 号旧版触发器（关键修复） ----------
drop trigger if exists trg_apply_record_xp     on public.daily_record;
drop trigger if exists trg_apply_record_xp_ins on public.daily_record;
drop trigger if exists trg_apply_record_xp_del on public.daily_record;

-- ---------- 2) 幂等重建唯一一套加分触发器（新版：按标签分值，含五维/等级） ----------
create trigger trg_apply_record_xp_ins after insert on public.daily_record
  for each row execute function public.apply_record_xp();
create trigger trg_apply_record_xp_del after delete on public.daily_record
  for each row execute function public.apply_record_xp();

-- ---------- 3) 收敛等级函数到 Lv.12（与 57 号 v142 口径一致，防旧脚本覆盖回归） ----------
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

-- ---------- 4) 收敛等级约束到 1~12（防旧脚本覆盖回归） ----------
alter table public.student_info drop constraint if exists chk_student_level;
alter table public.student_info
  add constraint chk_student_level check (level between 1 and 12);

-- ---------- 自检 ----------
-- ① 触发器应只剩 _ins/_del 一套：
--    select tgname from pg_trigger where tgrelid='public.daily_record'::regclass and not tgisinternal;
--    -- 期望：trg_apply_record_xp_ins / trg_apply_record_xp_del（无 trg_apply_record_xp）
-- ② 等级函数最高 12：select public.level_from_xp(3500);  -- 12
-- ③ 约束 1~12：select pg_get_constraintdef(oid) from pg_constraint
--      where conrelid='public.student_info'::regclass and conname='chk_student_level';
--      -- 期望 CHECK ((level >= 1) AND (level <= 12))
-- ④ 校准历史虚增：select * from public.recalc_all_xp();  （86 号提供，按四大渠道真实值重放）
