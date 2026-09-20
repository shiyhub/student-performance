-- ============================================================================
-- 学生在校表现记录平台 · Supabase 建表 + RLS 行级安全 + RPC 函数（多家长版）
-- 适用环境：Supabase 免费版（PostgreSQL 15+）
-- 使用方法：Supabase 控制台 → SQL Editor → New query → 粘贴本文件全部内容 → Run
-- 可重复执行；全新空库直接跑本脚本。
-- 结构：4 张表（student_info / student_parent / daily_record / behavior_tags）
--       + 1 个视图（student_directory）
-- 规则：一个学生可绑定任意数量家长，任一登记家长姓名均可查询该生记录。
-- ============================================================================


-- ============================================================================
-- 第 1 部分：建表
-- ============================================================================

create extension if not exists pgcrypto;

-- 1.1 学生名单表（一个班内学生姓名唯一；家长独立成表）------------------------
create table if not exists public.student_info (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,                   -- 班级，如：三年级2班
  student_name text not null,                   -- 学生姓名
  created_at   timestamptz not null default now(),
  constraint uq_student unique (class, student_name)   -- 同班不允许重名重复录入
);

comment on table public.student_info is '学生名单：仅老师可读写，匿名端不可直接访问';

-- 1.2 学生—家长关联表（一个学生可对应多个家长）--------------------------------
create table if not exists public.student_parent (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_info(id) on delete cascade,
  parent_name text not null,                   -- 家长姓名（家长查询的校验口令之一）
  created_at  timestamptz not null default now(),
  constraint uq_student_parent unique (student_id, parent_name)  -- 同一学生下同个家长不重复
);

create index if not exists idx_student_parent_student
  on public.student_parent (student_id);

comment on table public.student_parent is '学生家长：一对多；仅老师可读写，家长经 RPC 匹配校验，匿名端不可直接访问';

-- 1.3 每日表现记录表（每日可多条，故不加"每人每天唯一"约束）-------------------
create table if not exists public.daily_record (
  id              uuid primary key default gen_random_uuid(),
  student_name    text not null,
  class           text not null,
  record_date     date not null default current_date,
  self_evaluation smallint not null,            -- 综合星级 1~5
  behavior        jsonb not null default '{}'::jsonb,
  teacher_comment text,
  create_at       timestamptz not null default now(),
  constraint chk_self_eval check (self_evaluation between 1 and 5),
  constraint chk_behavior_object check (jsonb_typeof(behavior) = 'object')
);

create index if not exists idx_daily_record_lookup
  on public.daily_record (class, student_name, record_date desc);

comment on table public.daily_record is '每日在校表现：学生仅可新增（限名单内学生），家长经RPC匹配查询，老师全权';

-- 1.4 表现标签表 --------------------------------------------------------------
create table if not exists public.behavior_tags (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  tag_type   text not null default 'check',     -- check=勾选型；text=填写型
  options    jsonb not null default '[]'::jsonb, -- 勾选型二级选项（如科目），字符串数组；空数组=无二级
  category   text not null default 'positive',  -- positive=积极(+1)；negative=消极(-1)
  score      int  not null default 1,            -- 对心情的分值（积极 +1 / 消极 -1）
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint uq_tag_label unique (label),
  constraint chk_tag_type check (tag_type in ('check', 'text')),
  constraint chk_tag_options_array check (jsonb_typeof(options) = 'array'),
  constraint chk_tag_category check (category in ('positive', 'negative'))
);

comment on table public.behavior_tags is '教师自定义表现标签：老师全权；学生仅可读启用中的标签';

-- 1.5 班级通讯录视图（学生端"班级头像墙"使用；不含家长信息）-------------------
create or replace view public.student_directory as
  select id, class, student_name
  from public.student_info;

comment on view public.student_directory is '学生端班级墙只读视图：仅含班级与学生姓名';


-- ============================================================================
-- 第 2 部分：开启 RLS 行级安全
-- ============================================================================

alter table public.student_info   enable row level security;
alter table public.student_parent enable row level security;
alter table public.daily_record   enable row level security;
alter table public.behavior_tags  enable row level security;


-- ============================================================================
-- 第 3 部分：SECURITY DEFINER 函数
-- ============================================================================

-- 3.1 学生端提交前校验：班级 + 学生姓名 是否在名单中
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

-- 3.2 家长端查询：班级 + 学生姓名 + 任一家长姓名 匹配，即返回该生全部记录
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
      select 1
      from public.student_info s
      join public.student_parent p on p.student_id = s.id
      where s.class        = r.class
        and s.student_name = r.student_name
        and p.parent_name  = p_parent
    )
  order by r.record_date desc, r.create_at desc;
$$;


-- ============================================================================
-- 第 4 部分：RLS 策略（白名单制）
-- ============================================================================

-- student_info：仅登录老师
drop policy if exists teacher_all_student_info on public.student_info;
create policy teacher_all_student_info on public.student_info
  for all to authenticated using (true) with check (true);

-- student_parent：仅登录老师；匿名端无策略 = 完全不可见
drop policy if exists teacher_all_student_parent on public.student_parent;
create policy teacher_all_student_parent on public.student_parent
  for all to authenticated using (true) with check (true);

-- daily_record —— 学生（anon）：仅可 INSERT，且班级+姓名必须在名单中
drop policy if exists student_insert_record on public.daily_record;
create policy student_insert_record on public.daily_record
  for insert to anon
  with check (public.is_valid_student(class, student_name));

-- daily_record —— 学生（anon）：可读全班记录（班级头像墙）
drop policy if exists anon_read_all_records on public.daily_record;
create policy anon_read_all_records on public.daily_record
  for select to anon using (true);

-- daily_record —— 老师：全部权限
drop policy if exists teacher_all_daily_record on public.daily_record;
create policy teacher_all_daily_record on public.daily_record
  for all to authenticated using (true) with check (true);

-- behavior_tags —— 学生仅可读启用中标签
drop policy if exists anon_read_active_tags on public.behavior_tags;
create policy anon_read_active_tags on public.behavior_tags
  for select to anon using (is_active = true);

-- behavior_tags —— 老师全部权限
drop policy if exists teacher_all_tags on public.behavior_tags;
create policy teacher_all_tags on public.behavior_tags
  for all to authenticated using (true) with check (true);


-- ============================================================================
-- 第 5 部分：SQL 层显式授权
-- ============================================================================

revoke all on public.student_info, public.student_parent, public.daily_record, public.behavior_tags from anon;
revoke all on public.student_info, public.student_parent, public.daily_record, public.behavior_tags from authenticated;
revoke all on public.student_directory from anon, authenticated;
grant usage on schema public to anon, authenticated;

-- 学生（anon）
grant insert (
  id, student_name, class, record_date, self_evaluation, behavior, create_at
) on public.daily_record to anon;
grant select on public.daily_record to anon;
grant select on public.student_directory to anon;
grant select on public.behavior_tags to anon;

-- 老师（authenticated）
grant all on public.student_info, public.student_parent, public.daily_record, public.behavior_tags to authenticated;
grant select on public.student_directory to authenticated;

-- 函数执行权限
revoke execute on function public.is_valid_student(text, text) from public;
grant  execute on function public.is_valid_student(text, text) to anon, authenticated;

revoke execute on function public.get_student_records(text, text, text) from public;
grant  execute on function public.get_student_records(text, text, text) to anon, authenticated;


-- ============================================================================
-- 第 6 部分：预置默认标签
-- ============================================================================

insert into public.behavior_tags (label, tag_type, options, category, score, sort_order) values
  ('认真听讲',           'check', '[]'::jsonb, 'positive',  1,  10),
  ('积极发言',           'check', '[]'::jsonb, 'positive',  1,  20),
  ('完成作业',           'check', '[]'::jsonb, 'positive',  1,  30),
  ('乐于助人',           'check', '[]'::jsonb, 'positive',  1,  40),
  ('遵守纪律',           'check', '[]'::jsonb, 'positive',  1,  50),
  ('优秀作业',           'check',
    '["语文课堂作业","语文家庭作业","数学课堂作业","数学家庭作业","英语课堂作业","英语家庭作业"]'::jsonb,
    'positive', 1, 55),
  ('优秀数学作业',       'check', '[]'::jsonb, 'positive',  1,  60),
  ('今日背了什么单词',   'text',  '[]'::jsonb, 'positive',  1,  70),
  ('今日背诵了什么古诗', 'text',  '[]'::jsonb, 'positive',  1,  80),
  ('上课走神',           'check', '[]'::jsonb, 'negative', -1, 110),
  ('未完成作业',         'check', '[]'::jsonb, 'negative', -1, 120),
  ('扰乱课堂',           'check', '[]'::jsonb, 'negative', -1, 130),
  ('忘记带学具',         'check', '[]'::jsonb, 'negative', -1, 140)
on conflict do nothing;

-- 让 PostgREST 立即识别新结构
notify pgrst, 'reload schema';
