-- ============================================================
-- 111-archive-now.sql
-- 一次性：封存当前全部学生数据并重置为全新统计
-- ⚠️ 此脚本会清空当前业务数据（先整体归档，可回看），执行一次即可。
--    推荐做法：教师后台 →「⭐ 星光管理」→「封存并重置」按钮（带二次确认）。
--    只有无法登录后台时才使用本 SQL。
-- ============================================================

-- ① 先看将被封存的数据量（只读，可反复执行）
select 'student_info'      as 表, count(*) as 行数 from public.student_info
union all select 'daily_record',        count(*) from public.daily_record
union all select 'task_submission',     count(*) from public.task_submission
union all select 'challenge_submission',count(*) from public.challenge_submission
union all select 'personal_task',       count(*) from public.personal_task
union all select 'xp_log',              count(*) from public.xp_log
union all select 'student_achievements',count(*) from public.student_achievements
order by 1;

-- ② 执行封存与重置（确认上面的行数无误后，取消下面两行注释并运行）
-- select public.archive_all_and_reset(
--   '2026秋 第一学期（封存）',
--   '由 111 号脚本执行：封存历史并开启新一轮星光值统计'
-- );

-- ③ 执行后自查（应看到 0 记录、0 星光值、Lv.1 班级）
-- select count(*) as 记录数 from public.daily_record;
-- select coalesce(sum(balance),0) as 星光值合计 from public.student_wallet;
-- select class, xp, level from public.class_progress order by class;
-- select count(*) as 归档批次数 from public.archive_batch;
