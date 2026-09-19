-- ============================================================================
-- 学生在校表现记录平台 · Supabase 建表 + RLS 行级安全 + RPC 函数 完整脚本
-- 适用环境：Supabase 免费版（PostgreSQL 15+）
-- 使用方法：Supabase 控制台 → SQL Editor → New query → 粘贴本文件全部内容 → Run
-- 可重复执行：建表/策略/函数均使用 if exists / or replace，重跑安全
-- ============================================================================


-- ============================================================================
-- 第 1 部分：建表（3 张表 + 1 个班级通讯录视图）
-- ============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()，Supabase 默认已装

-- 1.1 学生名单表 -------------------------------------------------------------
create table if not exists public.student_info (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,                   -- 班级，如：三年级2班
  student_name text not null,                   -- 学生姓名
  parent_name  text not null,                   -- 家长姓名（家长查询的校验口令）
  created_at   timestamptz not null default now(),   -- 工程辅助列：录入时间
  constraint uq_student unique (class, student_name, parent_name)  -- 防重复录入
);

comment on table public.student_info is '学生名单：仅老师可读写，匿名端不可直接访问';

-- 1.2 每日表现记录表（每日可多条，故不加"每人每天唯一"约束）-------------------
create table if not exists public.daily_record (
  id              uuid primary key default gen_random_uuid(),
  student_name    text not null,
  class           text not null,
  record_date     date not null default current_date,
  self_evaluation smallint not null,            -- 综合星级 1~5
  -- behavior JSON 契约（前端按此结构写入，家长页/老师页按此渲染）：
  -- {
  --   "mood": "happy | good | normal | sad",
  --   "items": [
  --     {"id":"标签uuid","label":"优秀数学作业","type":"check","value":null},
  --     {"id":"标签uuid","label":"今日背诵了什么古诗","type":"text","value":"静夜思"}
  --   ]
  -- }
  -- 说明：items 中冗余保存标签文字快照，老师日后修改/删除标签不影响历史记录展示
  behavior        jsonb not null default '{}'::jsonb,
  teacher_comment text,                         -- 教师评语，学生端无权写入（见第5部分列授权）
  create_at       timestamptz not null default now(),
  constraint chk_self_eval check (self_evaluation between 1 and 5),
  constraint chk_behavior_object check (jsonb_typeof(behavior) = 'object')
);

create index if not exists idx_daily_record_lookup
  on public.daily_record (class, student_name, record_date desc);

comment on table public.daily_record is '每日在校表现：学生仅可新增（限名单内学生），家长经RPC匹配查询，老师全权';

-- 1.3 表现标签表（新增第 3 张表：支撑老师自定义标签）-------------------------
create table if not exists public.behavior_tags (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,                     -- 标签文字，如：优秀数学作业
  tag_type   text not null default 'check',     -- check=勾选型；text=填写型（如：今日背诵了什么古诗）
  is_active  boolean not null default true,     -- 停用后学生端不再显示，历史记录不受影响
  sort_order int not null default 0,            -- 展示顺序，数字越小越靠前
  created_at timestamptz not null default now(),
  constraint chk_tag_type check (tag_type in ('check', 'text'))
);

comment on table public.behavior_tags is '教师自定义表现标签：老师全权；学生仅可读启用中的标签';

-- 1.4 班级通讯录视图（学生端"班级头像墙"使用）--------------------------------
-- 只暴露 id / 班级 / 学生姓名 三个安全字段；刻意不含 parent_name（家长姓名是
-- 家长查询口令，绝不能出现在学生端）。普通视图以视图属主身份执行，可绕过底表
-- RLS，因此只需对视图授权，student_info 底表对 anon 依旧完全不可见。
create or replace view public.student_directory as
  select id, class, student_name
  from public.student_info;

comment on view public.student_directory is '学生端班级墙只读视图：仅含班级与学生姓名，不含家长姓名';


-- ============================================================================
-- 第 2 部分：开启 RLS 行级安全（开启后默认拒绝一切访问，必须靠策略放行）
-- ============================================================================

alter table public.student_info enable row level security;
alter table public.daily_record enable row level security;
alter table public.behavior_tags enable row level security;


-- ============================================================================
-- 第 3 部分：SECURITY DEFINER 函数（以表属主身份执行，可绕过 RLS）
-- 作用：让匿名端在"不直接读名单表"的前提下完成校验 / 匹配查询
-- ============================================================================

-- 3.1 学生端提交前校验：班级 + 学生姓名 是否在名单中（只返回 true/false，不泄露名单）
create or replace function public.is_valid_student(p_class text, p_student text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.student_info
    where class = p_class
      and student_name = p_student
  );
$$;

-- 3.2 家长端查询：班级 + 学生姓名 + 家长姓名 三者同时匹配，才返回该生全部记录
--     任一字段错误都只返回空结果集（不区分是哪项错误，防止试探）
create or replace function public.get_student_records(
  p_class   text,
  p_student text,
  p_parent  text
)
returns table (
  id              uuid,
  student_name    text,
  class           text,
  record_date     date,
  self_evaluation smallint,
  behavior        jsonb,
  teacher_comment text,
  create_at       timestamptz
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.student_name, r.class, r.record_date,
         r.self_evaluation, r.behavior, r.teacher_comment, r.create_at
  from public.daily_record r
  where r.class = p_class
    and r.student_name = p_student
    and exists (
      select 1 from public.student_info s
      where s.class        = r.class
        and s.student_name = r.student_name
        and s.parent_name  = p_parent
    )
  order by r.record_date desc, r.create_at desc;
$$;


-- ============================================================================
-- 第 4 部分：RLS 策略（白名单制：只写"允许什么"，其余一律拒绝）
-- ============================================================================

-- 4.1 student_info：仅登录老师可读写；匿名端无任何策略 = 完全不可见
drop policy if exists teacher_all_student_info on public.student_info;
create policy teacher_all_student_info on public.student_info
  for all
  to authenticated
  using (true)
  with check (true);

-- 4.2 daily_record —— 学生（anon）：仅可 INSERT
--     WITH CHECK 在数据库层强制：所写记录的班级+姓名必须存在于名单中
--     （即使有人绕过网页直接调 API，也无法给不存在的学生伪造记录）
drop policy if exists student_insert_record on public.daily_record;
create policy student_insert_record on public.daily_record
  for insert
  to anon
  with check (public.is_valid_student(class, student_name));

-- 4.2 daily_record —— 学生（anon）：可读全班记录（"班级头像墙"，按需求开放）
--     可读到：星级 / 心情 / 表现标签 / 教师评语；本表不含家长姓名等敏感字段。
--     若今后希望恢复"学生只能写、不能看"，删除本策略及第 5 部分对应 GRANT 即可。
drop policy if exists anon_read_all_records on public.daily_record;
create policy anon_read_all_records on public.daily_record
  for select
  to anon
  using (true);

-- 4.2 daily_record —— 老师（authenticated）：全部权限
drop policy if exists teacher_all_daily_record on public.daily_record;
create policy teacher_all_daily_record on public.daily_record
  for all
  to authenticated
  using (true)
  with check (true);

-- 4.3 behavior_tags —— 学生（anon）：仅可读"启用中"的标签
drop policy if exists anon_read_active_tags on public.behavior_tags;
create policy anon_read_active_tags on public.behavior_tags
  for select
  to anon
  using (is_active = true);

-- 4.3 behavior_tags —— 老师：全部权限（增/改/停用/删除）
drop policy if exists teacher_all_tags on public.behavior_tags;
create policy teacher_all_tags on public.behavior_tags
  for all
  to authenticated
  using (true)
  with check (true);


-- ============================================================================
-- 第 5 部分：SQL 层显式授权（权限第二层；与 RLS 同时生效，双重保险）
-- ============================================================================

-- 先全部收回，再按需授予，避免 Supabase 版本间默认权限差异
revoke all on public.student_info, public.daily_record, public.behavior_tags from anon;
revoke all on public.student_info, public.daily_record, public.behavior_tags from authenticated;
revoke all on public.student_directory from anon, authenticated;
grant usage on schema public to anon, authenticated;

-- 学生（anon）
-- 仅授予 daily_record 的"行新增"权限；列清单中刻意排除 teacher_comment，
-- 学生即使绕过前端也无法写入/伪造教师评语
grant insert (
  id, student_name, class, record_date, self_evaluation, behavior, create_at
) on public.daily_record to anon;

-- 学生（anon）可读全班表现记录（班级头像墙）
grant select on public.daily_record to anon;
-- 学生（anon）只能通过精简视图读取"班级+学生姓名"，读不到 parent_name
grant select on public.student_directory to anon;

-- 学生可读取启用中的标签（哪些行可见由 RLS 策略再过滤）
grant select on public.behavior_tags to anon;

-- 老师（authenticated）：三张表全部权限；视图只读即可（名单本体已全权）
grant all on public.student_info, public.daily_record, public.behavior_tags to authenticated;
grant select on public.student_directory to authenticated;

-- 函数执行权限：收回 public 默认执行权，只授予需要的角色
revoke execute on function public.is_valid_student(text, text) from public;
grant  execute on function public.is_valid_student(text, text) to anon, authenticated;

revoke execute on function public.get_student_records(text, text, text) from public;
grant  execute on function public.get_student_records(text, text, text) to anon, authenticated;


-- ============================================================================
-- 第 6 部分：预置默认标签（可选。不需要可整段删除，之后由老师在后台自行维护）
-- ============================================================================

insert into public.behavior_tags (label, tag_type, sort_order) values
  ('认真听讲',           'check', 10),
  ('积极发言',           'check', 20),
  ('完成作业',           'check', 30),
  ('乐于助人',           'check', 40),
  ('遵守纪律',           'check', 50),
  ('优秀数学作业',       'check', 60),
  ('今日背了什么单词',   'text',  70),
  ('今日背诵了什么古诗', 'text',  80)
on conflict do nothing;


-- ============================================================================
-- 执行完成后的验证（可在 SQL Editor 逐条运行检查）
-- ============================================================================
-- 1) 三张表均应显示 row level security = true：
--    select tablename, rowsecurity from pg_tables where schemaname = 'public';
--
-- 2) 策略数量应为 7 条：
--    select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public';
--
-- 3) 函数应能正常调用（返回 true / false，或空结果集）：
--    select public.is_valid_student('测试班级', '测试学生');
--    select * from public.get_student_records('测试班级', '测试学生', '测试家长');
--
-- 4) 班级墙视图应只有 3 列，且不含 parent_name；用 anon 密钥在前端访问正常：
--    select * from public.student_directory limit 3;
-- ============================================================================
