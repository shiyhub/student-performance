-- ============================================================
-- 91-fix-level-check.sql
-- v153.1：修复「等级 CHECK 约束未随 v142 升级」，导致经验 ≥600（Lv.7+）的学生
--         挑战任务 / 个人任务 / 日常提交全部报错（提交失败，请重试）
-- 根因：
--   01-schema-rls.sql 建表约束 chk_student_level check (level between 1 and 6)，
--   10-level6-legend.sql 再次确认 1~6；而 57 号（v142）已把等级上限提升到 Lv.12
--   （level_from_xp 最高返回 12）。所有加分函数（64/70/85/86/90 号）提交后都会
--   执行 update student_info set level = level_from_xp(xp)：
--     当学生经验 ≥600 → level_from_xp 返回 7~12 → 违反 chk_student_level(1~6)
--     → 整个提交事务报错 → 学生端提示「提交失败，请重试」
-- 修复：把等级上限约束从 1~6 放宽到 1~12（与 level_from_xp 口径一致）
-- 可重复执行。
-- ============================================================

alter table public.student_info drop constraint if exists chk_student_level;
alter table public.student_info
  add constraint chk_student_level check (level between 1 and 12);

-- 自检（可选）：
--   ① 确认约束已更新：
--      select conname, pg_get_constraintdef(oid) from pg_constraint
--       where conrelid = 'public.student_info'::regclass and conname = 'chk_student_level';
--      -- 期望：chk_student_level  CHECK ((level >= 1) AND (level <= 12))
--   ② 确认可升级到 Lv.12：
--      update public.student_info set level = public.level_from_xp(3500) where class='一班' and student_name='张三';
--      -- 若成功且 level=12，说明修复生效
--   ③ 提示：若此前有学生经验已 ≥600 但因约束失败而「提交失败」，修复后重新提交即可正常加分升段。
