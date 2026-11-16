-- ============================================================
-- 128-lottery-course-prizes.sql
-- 班级升级抽奖：奖品改为三类课程各一节，且不与系统联动
--
--   体育课一节 / 音乐鉴赏课一节 / 影视鉴赏课一节
--
-- 说明：
--   · 新增 prize_type = 'course'，抽中后不发放星光值、不写入衣柜，
--     只记录一条抽奖流水（class_draw_log），由教师线下安排并公布。
--   · 原奖池全部置为停用（保留记录，历史抽奖日志仍可按 key 追溯）。
--   · 三个奖品等权重，各 1/3。
--
-- 可重复执行。执行位置：Supabase Dashboard → SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 1. 放宽 prize_type 约束，允许 course
--    （先按定义内容找到既有 check 约束再删，避免约束名不一致）
-- ------------------------------------------------------------
do $dropcheck$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.lottery_prize'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%prize_type%'
  loop
    execute format('alter table public.lottery_prize drop constraint %I', c.conname);
  end loop;
end;
$dropcheck$;

alter table public.lottery_prize
  add constraint lottery_prize_prize_type_check
  check (prize_type in ('star', 'class_star', 'avatar', 'frame', 'none', 'course'));

comment on column public.lottery_prize.prize_type
  is '奖品类型：star 个人星光 / class_star 全班星光 / avatar 头像 / frame 头像框 / none 空奖 / course 课程券（不自动发放）';

-- ------------------------------------------------------------
-- 2. 原奖池全部停用
-- ------------------------------------------------------------
update public.lottery_prize
   set enabled = false
 where enabled = true;

-- ------------------------------------------------------------
-- 3. 写入三个课程奖品
--    prize_value = 0：不产生任何自动发放
-- ------------------------------------------------------------
insert into public.lottery_prize
  (prize_key, name, icon, prize_type, prize_value, prize_item, weight, enabled)
values
  ('course_pe',    '体育课一节',     '🏀', 'course', 0, null, 1, true),
  ('course_music', '音乐鉴赏课一节', '🎵', 'course', 0, null, 1, true),
  ('course_film',  '影视鉴赏课一节', '🎬', 'course', 0, null, 1, true)
on conflict (prize_key) do update
  set name        = excluded.name,
      icon        = excluded.icon,
      prize_type  = excluded.prize_type,
      prize_value = excluded.prize_value,
      prize_item  = excluded.prize_item,
      weight      = excluded.weight,
      enabled     = excluded.enabled;

-- ------------------------------------------------------------
-- 4. 核对
-- ------------------------------------------------------------
-- select prize_key, name, prize_type, prize_value, weight, enabled
--   from public.lottery_prize
--  where enabled
--  order by prize_key;
-- 预期：3 行，prize_type 均为 course，prize_value 均为 0
