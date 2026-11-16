-- ============================================================
-- 126-exam-star-1to1.sql
-- 试卷成绩 → 星光值：由「分数 ÷ 10 × 倍数」改为「分数 × 倍数」
--
--   80 分 · 1 倍 → 80 星光值
--   80 分 · 2 倍 → 160 星光值
--   结果四舍五入取整；倍率选项保持 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 不变
--
-- 可重复执行。执行位置：Supabase Dashboard → SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 1. 换算函数（唯一口径来源，单条录入与批量录入都走它）
-- ------------------------------------------------------------
create or replace function public.star_from_score(p_score numeric, p_multiplier numeric)
returns integer
language plpgsql
immutable
as $$
declare
  v_mult numeric := coalesce(p_multiplier, 1);
begin
  if p_score is null then
    return 0;
  end if;
  if v_mult <= 0 then
    v_mult := 1;
  end if;
  return greatest(0, round(p_score * v_mult)::int);
end;
$$;

comment on function public.star_from_score(numeric, numeric)
  is '分数 × 倍数，四舍五入取整（2026-11 起 1:1 换算）';

-- ------------------------------------------------------------
-- 2. 说明文案同步
-- ------------------------------------------------------------
comment on column public.exam_batch.star_multiplier
  is '本次成绩单的星光加成倍数：0.25/0.5/0.75/1/1.5/2，星光值 = 分数 × 倍数';

-- ------------------------------------------------------------
-- 3. 核对（默认注释，需要时取消注释）
-- ------------------------------------------------------------
-- select s as score, m as mult, public.star_from_score(s, m) as stars
--   from (values (80::numeric, 1::numeric), (80, 2), (95, 1), (59.5, 1), (0, 2)) v(s, m);
-- 预期：80 / 160 / 95 / 60 / 0
