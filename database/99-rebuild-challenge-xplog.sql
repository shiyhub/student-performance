-- ============================================================
-- 99-rebuild-challenge-xplog.sql
-- 挑战经验流水重建（彻底清除重复/孤儿/悬空记录）
-- 2026-10-30
--
-- 原理：以「有效填报 challenge_submission(status=active, xp>0)」为唯一基准，
--       先删除全部挑战流水，再按填报重新写一条带档位流水。
--       全程不碰 student_info → 当前经验、五维、等级完全不变。
--
-- 安全：
--   ① 先备份到 xp_log_challenge_backup（可回查，确认无误后可自行删除）
--   ② 单事务执行，失败整体回滚
--   ③ 末尾自带验证查询
--
-- 可重复执行。
-- ============================================================

begin;

-- ---------- 1) 备份现有挑战流水（带重建时间戳） ----------
create table if not exists public.xp_log_challenge_backup (
  like public.xp_log including all,
  backed_up_at timestamptz not null default now()
);
insert into public.xp_log_challenge_backup
  (id, class, student_name, source, ref_id, label, dim, xp, record_date, note, created_at)
select id, class, student_name, source, ref_id, label, dim, xp, record_date, note, created_at
  from public.xp_log
 where source = 'challenge';

-- ---------- 2) 删除全部挑战流水 ----------
delete from public.xp_log where source = 'challenge';

-- ---------- 3) 按有效填报重新写入（label 口径与 93 号实时流水完全一致） ----------
insert into public.xp_log
  (class, student_name, source, ref_id, label, dim, xp, record_date)
select cs.class,
       cs.student_name,
       'challenge',
       cs.id,
       coalesce(ct.title, '挑战任务')
         || '（'
         || coalesce((select string_agg(x, '/')
                        from jsonb_array_elements_text(cs.levels) x), '')
         || '档）',
       coalesce(nullif(cs.dim, ''), 'zhi'),
       cs.xp,
       (cs.submitted_at)::date
  from public.challenge_submission cs
  left join public.challenge_task ct on ct.id = cs.challenge_id
 where cs.status = 'active'
   and coalesce(cs.xp, 0) > 0;

-- ---------- 4) 验证（执行后看结果） ----------
-- 4.1 重建后流水条数应 = 有效填报数（1:1）
select (select count(*) from public.xp_log where source='challenge') as 重建后流水条数,
       (select count(*) from public.challenge_submission
         where status='active' and coalesce(xp,0)>0) as 有效填报数;

-- 4.2 应查不到任何重复（结果为空）
select ref_id, count(*) from public.xp_log
 where source='challenge' group by ref_id having count(*)>1;

-- 4.3 应查不到泛化'挑战任务' / 悬空记录（结果为空）
select id from public.xp_log x
 where x.source='challenge'
   and (x.label = '挑战任务'
        or not exists (select 1 from public.challenge_submission s
                        where s.id = x.ref_id));

commit;

-- ============================================================
-- 5) 对账（事务外单独跑，替换班级/姓名；流水合计应等于当前经验，
--    若仍有差额，说明其他渠道 daily/task/personal 也有残留，再发我排查）
-- ============================================================
-- select (select coalesce(sum(xp),0) from public.xp_log
--          where class='六年级一班' and student_name='杨悦') as 流水合计,
--        (select xp from public.student_info
--          where class='六年级一班' and student_name='杨悦') as 当前经验;

-- 确认无误后，删除备份表：
-- drop table public.xp_log_challenge_backup;
