-- ============================================================================
-- 学生在校表现记录平台 · Supabase 建表 + RLS 行级安全 + RPC 函数（多家长版）
-- 适用环境：Supabase 免费版（PostgreSQL 15+）
-- 使用方法：Supabase 控制台 → SQL Editor → New query → 粘贴本文件全部内容 → Run
-- 可重复执行；全新空库直接跑本脚本。
-- 结构：6 张表（student_info / student_parent / daily_record / behavior_tags /
--              home_note / exam_paper）
--       + 1 个视图（student_directory）+ 经验等级 + 试卷存储桶 exam-papers
-- 规则：一个学生可绑定任意数量家长，任一登记家长姓名均可查询该生记录。
-- ============================================================================


-- ============================================================================
-- 第 1 部分：建表
-- ============================================================================

create extension if not exists pgcrypto;

-- 1.1 学生名单表（一个班内学生姓名唯一；家长独立成表）------------------------
create table if not exists public.student_info (
  id                   uuid primary key default gen_random_uuid(),
  class                text not null,                   -- 班级，如：三年级2班
  student_name         text not null,                   -- 学生姓名
  avatar               text,                            -- 头像：emoji 或校园头像key(girl1..)
  xp                   int not null default 0,          -- 经验值（每积极项 +2）
  level                int not null default 1,          -- 等级 1~5（3级解锁校园头像）
  avatar_changed_at    timestamptz,                     -- 最近一次换表情头像时间
  avatar_changes_today smallint not null default 0,     -- 当日已换表情头像次数（上限2）
  created_at           timestamptz not null default now(),
  constraint uq_student unique (class, student_name),   -- 同班不允许重名重复录入
  constraint chk_student_level check (level between 1 and 5),
  constraint chk_student_xp    check (xp >= 0)
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
  self_evaluation smallint,                      -- 综合星级 1~5（选填；NULL=本次未打星）
  behavior        jsonb not null default '{}'::jsonb,
  teacher_comment text,
  create_at       timestamptz not null default now(),
  constraint chk_self_eval check (self_evaluation is null or self_evaluation between 1 and 5),
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
  xp_value   int  not null default 2,            -- 学生选这个表现加多少经验（老师可调，消极建议0）
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint uq_tag_label unique (label),
  constraint chk_tag_type check (tag_type in ('check', 'text')),
  constraint chk_tag_options_array check (jsonb_typeof(options) = 'array'),
  constraint chk_tag_category check (category in ('positive', 'negative'))
);

comment on table public.behavior_tags is '教师自定义表现标签：老师全权；学生仅可读启用中的标签';

-- 1.5 家长填写的"在家表现"表（内容仅老师可见；家长只能经校验 RPC 写入）------
create table if not exists public.home_note (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_info(id) on delete cascade,
  parent_name text not null,
  content     text not null,
  record_date date not null default current_date,
  create_at   timestamptz not null default now()
);

create index if not exists idx_home_note_student
  on public.home_note (student_id, record_date desc);

comment on table public.home_note is '家长填写的学生在家表现：匿名端只能经校验RPC写入、不能读取；仅老师可查看与管理';

-- 1.6 教师上传的学生试卷照片与分数（仅家长经 RPC 可见，学生端不开放）------------
create table if not exists public.exam_paper (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.student_info(id) on delete cascade,
  class        text not null,
  student_name text not null,
  record_date  date not null default current_date,
  subject      text,                              -- 科目，如 数学
  score        numeric(6,1),                      -- OCR/老师确认后的分数（可空）
  score_text   text,                              -- 识别到的原始分数文字
  image_url    text not null,                     -- Storage 图片地址（随机文件名）
  note         text,
  create_at    timestamptz not null default now()
);

create index if not exists idx_exam_paper_lookup
  on public.exam_paper (class, student_name, record_date desc);

comment on table public.exam_paper is '教师上传的学生试卷照片与分数：仅老师可直连；家长经三要素RPC查看；学生端不开放';

-- 1.7 班级通讯录视图（学生端"班级头像墙"使用；不含家长信息）-------------------
create or replace view public.student_directory as
  select id, class, student_name, avatar, xp, level
  from public.student_info;

comment on view public.student_directory is '学生端班级墙只读视图：班级、学生姓名、头像、经验、等级';


-- ============================================================================
-- 第 2 部分：开启 RLS 行级安全
-- ============================================================================

alter table public.student_info   enable row level security;
alter table public.student_parent enable row level security;
alter table public.daily_record   enable row level security;
alter table public.behavior_tags  enable row level security;
alter table public.home_note      enable row level security;
alter table public.exam_paper     enable row level security;


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

-- 3.3 经验等级：阈值 L1=0 / L2=20 / L3=60 / L4=120 / L5=200
create or replace function public.level_from_xp(p_xp int)
returns int
language sql
immutable
as $$
  select case
           when coalesce(p_xp, 0) >= 200 then 5
           when coalesce(p_xp, 0) >= 120 then 4
           when coalesce(p_xp, 0) >= 60  then 3
           when coalesce(p_xp, 0) >= 20  then 2
           else 1
         end;
$$;

-- 提交表现：按各标签配置的 xp_value 累加经验；删除记录时回扣
create or replace function public.apply_record_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec    record;
  v_item   record;
  v_tag_xp int;
  v_delta  int := 0;
  v_xp     int;
begin
  v_rec := case when tg_op = 'DELETE' then old else new end;

  for v_item in
    select e ->> 'id' as tag_id, e ->> 'category' as category
    from jsonb_array_elements(coalesce(v_rec.behavior -> 'items', '[]'::jsonb)) as e
  loop
    select t.xp_value into v_tag_xp
      from public.behavior_tags t
     where t.id::text = v_item.tag_id;
    if v_tag_xp is null then
      v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
    end if;
    v_delta := v_delta + coalesce(v_tag_xp, 0);
  end loop;

  if coalesce(v_delta, 0) = 0 then
    return v_rec;
  end if;

  if tg_op = 'DELETE' then
    v_delta := -v_delta;
  end if;

  update public.student_info
     set xp = greatest(0, coalesce(xp, 0) + v_delta)
   where class = v_rec.class
     and student_name = v_rec.student_name
  returning xp into v_xp;

  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp)
     where class = v_rec.class
       and student_name = v_rec.student_name;
  end if;

  return v_rec;
end;
$$;

drop trigger if exists trg_apply_record_xp     on public.daily_record;
drop trigger if exists trg_apply_record_xp_ins on public.daily_record;
drop trigger if exists trg_apply_record_xp_del on public.daily_record;
create trigger trg_apply_record_xp_ins after insert on public.daily_record
  for each row execute function public.apply_record_xp();
create trigger trg_apply_record_xp_del after delete on public.daily_record
  for each row execute function public.apply_record_xp();

-- 3.3b 测试工具：一键重算全班经验 / 老师手动调学生经验
create or replace function public.recalc_all_xp()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_rec record; v_item record; v_tag_xp int; v_delta int; v_touched int := 0;
begin
  update public.student_info set xp = 0, level = 1;
  for v_rec in select class, student_name, behavior, record_date, create_at
                 from public.daily_record order by record_date, create_at loop
    v_delta := 0;
    for v_item in select e ->> 'id' as tag_id, e ->> 'category' as category
                    from jsonb_array_elements(coalesce(v_rec.behavior -> 'items', '[]'::jsonb)) e loop
      select t.xp_value into v_tag_xp from public.behavior_tags t where t.id::text = v_item.tag_id;
      if v_tag_xp is null then
        v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
      end if;
      v_delta := v_delta + coalesce(v_tag_xp, 0);
    end loop;
    if v_delta <> 0 then
      update public.student_info
         set xp = coalesce(xp, 0) + v_delta,
             level = public.level_from_xp(coalesce(xp, 0) + v_delta)
       where class = v_rec.class and student_name = v_rec.student_name;
      v_touched := v_touched + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'records_replayed', v_touched);
end;
$$;
revoke execute on function public.recalc_all_xp() from public;
grant  execute on function public.recalc_all_xp() to authenticated;

create or replace function public.set_student_xp(p_class text, p_student text, p_xp int)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_xp int; v_level int;
begin
  v_xp := greatest(0, least(99999, coalesce(p_xp, 0)));
  update public.student_info set xp = v_xp, level = public.level_from_xp(v_xp)
   where class = btrim(coalesce(p_class,'')) and student_name = btrim(coalesce(p_student,''))
  returning xp, level into v_xp, v_level;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_student'); end if;
  return jsonb_build_object('ok', true, 'xp', v_xp, 'level', v_level);
end;
$$;
revoke execute on function public.set_student_xp(text, text, int) from public;
grant  execute on function public.set_student_xp(text, text, int) to authenticated;

-- 3.4 学生保存自选头像：
--     校园图片头像(girl/boy/neutral1~8) 需 3 级解锁且不限次数；
--     表情头像每天最多更换 2 次（选回当前头像不计数）。
create or replace function public.set_student_avatar(
  p_class   text,
  p_student text,
  p_avatar  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid        uuid;
  v_cur        text;
  v_xp         int;
  v_level      int;
  v_changed_at timestamptz;
  v_changes    smallint;
  v_key        text;
  v_is_image   boolean;
  v_left       int;
begin
  v_key := nullif(btrim(coalesce(p_avatar, '')), '');
  if v_key is null or length(v_key) > 16 then
    return jsonb_build_object('ok', false, 'reason', 'bad_key', 'changed', false);
  end if;

  select id, avatar, xp, level, avatar_changed_at, avatar_changes_today
    into v_sid, v_cur, v_xp, v_level, v_changed_at, v_changes
  from public.student_info
  where class = btrim(coalesce(p_class, ''))
    and student_name = btrim(coalesce(p_student, ''));

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student', 'changed', false);
  end if;

  v_is_image := v_key ~ '^(girl|boy|neutral)[1-8]$';

  if v_key is not distinct from v_cur then
    v_left := case when v_changed_at::date = current_date then greatest(0, 2 - coalesce(v_changes,0)) else 2 end;
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'same',
                              'level', v_level, 'xp', v_xp, 'changes_left', v_left);
  end if;

  if v_is_image then
    if coalesce(v_level, 1) < 3 then
      return jsonb_build_object('ok', false, 'reason', 'locked', 'changed', false,
                                'level', v_level, 'xp', v_xp, 'changes_left', 0);
    end if;

    update public.student_info set avatar = v_key where id = v_sid;
    return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                              'level', v_level, 'xp', v_xp, 'changes_left', -1);
  end if;

  if v_changed_at::date is distinct from current_date then
    v_changes := 0;
  end if;

  if coalesce(v_changes, 0) >= 2 then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'changed', false,
                              'level', v_level, 'xp', v_xp, 'changes_left', 0);
  end if;

  v_changes := coalesce(v_changes, 0) + 1;
  update public.student_info
     set avatar = v_key,
         avatar_changed_at = now(),
         avatar_changes_today = v_changes
   where id = v_sid;

  return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                            'level', v_level, 'xp', v_xp,
                            'changes_left', greatest(0, 2 - v_changes));
end;
$$;

-- 3.4 家长提交在家表现：班级 + 学生 + 任一家长姓名 匹配成功才写入 home_note
create or replace function public.add_home_note(
  p_class   text,
  p_student text,
  p_parent  text,
  p_content text,
  p_date    date default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid     uuid;
  v_content text;
  v_parent  text;
  v_date    date;
begin
  v_content := nullif(left(btrim(coalesce(p_content, '')), 500), '');
  if v_content is null then
    return false;
  end if;

  v_parent := btrim(coalesce(p_parent, ''));
  v_date   := coalesce(p_date, current_date);

  select si.id
    into v_sid
  from public.student_info si
  join public.student_parent sp on sp.student_id = si.id
  where si.class        = btrim(coalesce(p_class, ''))
    and si.student_name = btrim(coalesce(p_student, ''))
    and sp.parent_name  = v_parent
  limit 1;

  if v_sid is null then
    return false;
  end if;

  insert into public.home_note (student_id, parent_name, content, record_date)
  values (v_sid, v_parent, v_content, v_date);

  return true;
end;
$$;

-- 3.6 家长三要素匹配后查看该生试卷（学生端不调用）
create or replace function public.get_student_papers(
  p_class   text,
  p_student text,
  p_parent  text
)
returns table (
  id           uuid,
  record_date  date,
  subject      text,
  score        numeric,
  score_text   text,
  image_url    text,
  note         text,
  create_at    timestamptz
)
language sql
security definer
set search_path = public
as $$
  select e.id, e.record_date, e.subject, e.score, e.score_text, e.image_url, e.note, e.create_at
  from public.exam_paper e
  where e.class = btrim(coalesce(p_class, ''))
    and e.student_name = btrim(coalesce(p_student, ''))
    and exists (
      select 1
      from public.student_info s
      join public.student_parent p on p.student_id = s.id
      where s.class = e.class
        and s.student_name = e.student_name
        and p.parent_name = btrim(coalesce(p_parent, ''))
    )
  order by e.record_date desc, e.create_at desc;
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

-- home_note —— 仅登录老师；匿名端无策略 = 完全不可直连（家长只能经 add_home_note RPC 写入）
drop policy if exists home_note_teacher_all on public.home_note;
create policy home_note_teacher_all on public.home_note
  for all to authenticated using (true) with check (true);

-- exam_paper —— 仅登录老师；匿名端无策略（家长只能经 get_student_papers RPC 查看）
drop policy if exists exam_paper_teacher_all on public.exam_paper;
create policy exam_paper_teacher_all on public.exam_paper
  for all to authenticated using (true) with check (true);


-- ============================================================================
-- 第 5 部分：SQL 层显式授权
-- ============================================================================

revoke all on public.student_info, public.student_parent, public.daily_record, public.behavior_tags, public.home_note, public.exam_paper from anon;
revoke all on public.student_info, public.student_parent, public.daily_record, public.behavior_tags, public.home_note, public.exam_paper from authenticated;
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
grant all on public.student_info, public.student_parent, public.daily_record, public.behavior_tags, public.home_note, public.exam_paper to authenticated;
grant select on public.student_directory to authenticated;

-- 函数执行权限
revoke execute on function public.is_valid_student(text, text) from public;
grant  execute on function public.is_valid_student(text, text) to anon, authenticated;

revoke execute on function public.get_student_records(text, text, text) from public;
grant  execute on function public.get_student_records(text, text, text) to anon, authenticated;

revoke execute on function public.set_student_avatar(text, text, text) from public;
grant  execute on function public.set_student_avatar(text, text, text) to anon, authenticated;

revoke execute on function public.add_home_note(text, text, text, text, date) from public;
grant  execute on function public.add_home_note(text, text, text, text, date) to anon, authenticated;

revoke execute on function public.get_student_papers(text, text, text) from public;
grant  execute on function public.get_student_papers(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 试卷存储桶：public 桶 + 随机 UUID 文件名；老师可读写，匿名不能列举/上传
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('exam-papers', 'exam-papers', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists exam_papers_bucket_teacher on storage.objects;
create policy exam_papers_bucket_teacher on storage.objects
  for all to authenticated
  using (bucket_id = 'exam-papers')
  with check (bucket_id = 'exam-papers');

notify pgrst, 'reload schema';


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
