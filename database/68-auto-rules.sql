-- ============================================================
-- 68-auto-rules.sql
-- 自动化规则表（教师配置"当天有/没有某标签"自动加分规则）
-- 说明：缺失迁移还原版，依据 63 号函数与 teacher.js 字段反推，可重复执行。
-- 关键：tag_id 外键是 PostgREST 嵌入 behavior_tags(label) 的前提。
-- 63 号 run_auto_bonus 函数运行时读取本表。
-- ============================================================
create table if not exists public.auto_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  trigger_type text not null,                    -- no_tag / has_tag
  tag_id       uuid not null,
  dim          text not null default 'zhi',      -- de/zhi/ti/mei/lao
  xp_value     int  not null default 0,
  start_date   date,
  end_date     date,
  weekdays     int[] not null default '{1,2,3,4,5}'::int[],
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_auto_rules_tag'
  ) then
    alter table public.auto_rules
      add constraint fk_auto_rules_tag
      foreign key (tag_id) references public.behavior_tags(id) on delete cascade;
  end if;
end $$;

alter table public.auto_rules enable row level security;

-- 教师端直接 insert/update/delete（authenticated 全部权限）
drop policy if exists "auto_rules_teacher_all" on public.auto_rules;
create policy "auto_rules_teacher_all" on public.auto_rules
  for all to authenticated using (true) with check (true);
-- 学生端不直连；63 号函数为 security definer 内部读取，无需 anon 策略
