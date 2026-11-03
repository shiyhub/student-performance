-- ============================================================
-- 69-auto-bonus-log.sql
-- 自动结算流水表（run_auto_bonus 每次加分的幂等记录）
-- 说明：缺失迁移还原版，依据 63 号反推，可重复执行。
-- 唯一约束 (rule_id, student_name, bonus_date) 保证同规则同生同日不重复。
-- ============================================================
create table if not exists public.auto_bonus_log (
  id           uuid primary key default gen_random_uuid(),
  rule_id      uuid not null,
  class        text not null,
  student_name text not null,
  dim          text not null default 'zhi',
  xp_value     int  not null,
  bonus_date   date not null
);

-- 规则删除时历史流水一并清理（与前端"删除规则会一并删除历史加分"口径一致）
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_auto_bonus_log_rule'
  ) then
    alter table public.auto_bonus_log
      add constraint fk_auto_bonus_log_rule
      foreign key (rule_id) references public.auto_rules(id) on delete cascade;
  end if;
end $$;

-- 幂等：同规则+学生+日期唯一
drop index if exists uq_auto_bonus_log;
create unique index if not exists uq_auto_bonus_log
  on public.auto_bonus_log (rule_id, student_name, bonus_date);

create index if not exists idx_auto_bonus_log_date
  on public.auto_bonus_log (bonus_date);

-- 前端不直连，仅 security definer 函数内部读写：启用 RLS 但不建策略
alter table public.auto_bonus_log enable row level security;
