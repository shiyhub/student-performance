-- ============================================================================
-- 增量升级脚本：单家长 → 多家长（一个学生可绑定任意数量家长）
-- 在已部署旧版（student_info 含 parent_name 列）的库上运行一次即可，安全可重复执行。
-- 做法：
--   1) 新建 student_parent 家长表
--   2) 把原 student_info.parent_name 迁移为每个学生的第一位家长
--   3) 学生唯一约束改为 (班级, 学生姓名)，并删除旧 parent_name 列
--   4) 重建家长查询 RPC（匹配任一家长）
--   5) 补齐 RLS 策略与授权
-- ============================================================================

-- 1) 家长关联表 ---------------------------------------------------------------
create table if not exists public.student_parent (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_info(id) on delete cascade,
  parent_name text not null,
  created_at  timestamptz not null default now(),
  constraint uq_student_parent unique (student_id, parent_name)
);

create index if not exists idx_student_parent_student
  on public.student_parent (student_id);

comment on table public.student_parent is '学生家长：一对多；仅老师可读写，家长经 RPC 匹配校验';

-- 2) 迁移旧家长姓名（仅当旧列还存在时执行）------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'student_info'
      and column_name = 'parent_name'
  ) then
    execute $sql$
      insert into public.student_parent (student_id, parent_name)
      select id, parent_name
      from public.student_info
      where parent_name is not null and btrim(parent_name) <> ''
      on conflict do nothing
    $sql$;
  end if;
end $$;

-- 3) 学生唯一约束改为 (班级, 学生姓名)，再删除旧家长列 -------------------------
alter table public.student_info drop constraint if exists uq_student;
alter table public.student_info add constraint uq_student unique (class, student_name);
alter table public.student_info drop column if exists parent_name;

-- 4) 重建家长查询函数（任一登记家长匹配即可）----------------------------------
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

-- 5) RLS 与授权 ---------------------------------------------------------------
alter table public.student_parent enable row level security;

drop policy if exists teacher_all_student_parent on public.student_parent;
create policy teacher_all_student_parent on public.student_parent
  for all to authenticated using (true) with check (true);

revoke all on public.student_parent from anon, authenticated;
grant all on public.student_parent to authenticated;   -- 匿名端刻意不授权

-- 标签防重复（顺带补齐，重复执行安全）
alter table public.behavior_tags drop constraint if exists uq_tag_label;
alter table public.behavior_tags add constraint uq_tag_label unique (label);

revoke execute on function public.get_student_records(text, text, text) from public;
grant  execute on function public.get_student_records(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- 完成后可选自检：
--   select s.class, s.student_name, p.parent_name
--   from student_info s left join student_parent p on p.student_id = s.id
--   order by s.class, s.student_name;
