-- ============================================================
-- 标记已有数据库的迁移历史（GitHub 自动部署前置步骤）
-- ------------------------------------------------------------
-- 你的数据库是手动一步步建起来的，库里没有迁移历史记录。
-- GitHub 集成第一次部署时会把 supabase/migrations/ 里 29 个
-- 迁移全部当作"新迁移"执行 → 表已存在 → 报错。
-- 执行本脚本：把这 29 个迁移标记为"已经应用过"，
-- 集成首次部署就会跳过它们，只部署以后新增的迁移。
-- 在 Supabase 控制台 → SQL Editor 执行一次即可。
-- ============================================================

create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  statements text[] default '{}',
  name       text
);

insert into supabase_migrations.schema_migrations (version, name) values
('20260101000100','schema-rls'),
('20260101000200','add-student-wall'),
('20260101000300','multi-parents'),
('20260101000400','tag-options'),
('20260101000500','tag-category-mood'),
('20260101000600','student-avatar'),
('20260101000700','home-note'),
('20260101000800','level-exam'),
('20260101000900','xp-tuning'),
('20260101001000','level6-legend'),
('20260101001100','daily-task'),
('20260101001200','task-multi'),
('20260101001300','batch-award'),
('20260101001400','batch-task-grade'),
('20260101001500','task-due-time'),
('20260101001600','fix-submit-parent'),
('20260101001700','tag-once'),
('20260101001800','verify-parent'),
('20260101001900','semester'),
('20260101002000','level7'),
('20260101002100','harden'),
('20260101002200','china-date'),
('20260101002300','batch-award2'),
('20260101002400','fix-wall-read'),
('20260101002500','fix-semester'),
('20260101002600','move-recite'),
('20260101002700','seat'),
('20260101002800','task-type'),
('20260101002900','avatar-frames-achievements'),
('20260101003000','parent-birth-login'),
('20260101003100','student-access-code'),
('20260101003200','student-directory-fix'),
('20260101003300','submit-dedupe'),
('20260101003400','fix-semester-write'),
('20260101003500','semester-boundary')
on conflict (version) do nothing;
