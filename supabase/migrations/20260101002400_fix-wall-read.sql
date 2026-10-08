-- ============================================================
-- 24-fix-wall-read.sql  修复学生墙/家长读取 daily_record 被 RLS 拦空的问题
-- 可重复执行。
-- ============================================================

-- 允许匿名读取表现记录（学生墙、老师后台都用这个 key）
drop policy if exists "anon read daily_record" on public.daily_record;
create policy "anon read daily_record" on public.daily_record
  for select to anon using (true);

grant select on public.daily_record to anon;
