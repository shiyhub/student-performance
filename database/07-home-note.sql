-- ============================================================================
-- 增量升级：家长端"在家表现"
--   - 新表 home_note：家长记录孩子在家表现（内容只有老师能看）
--   - 家长（anon）不能直接读写该表，只能经 RPC add_home_note 写入，
--     且必须通过"班级 + 学生 + 家长姓名"三要素校验（任一登记家长均可）
--   - 老师（authenticated）对该表拥有全部读写权限，可在教师后台查看/删除
-- 安全可重复执行。
-- ============================================================================

-- 1) 在家表现表
create table if not exists public.home_note (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_info(id) on delete cascade,
  parent_name text not null,                   -- 提交家长姓名（便于老师识别是谁写的）
  content     text not null,                   -- 在家表现内容（限 500 字，函数内裁剪）
  record_date date not null default current_date,
  create_at   timestamptz not null default now()
);

create index if not exists idx_home_note_student
  on public.home_note (student_id, record_date desc);

comment on table public.home_note is '家长填写的学生在家表现：匿名端只能经校验RPC写入、不能读取；仅老师可查看与管理';

-- 2) 开启 RLS
alter table public.home_note enable row level security;

-- 3) 仅老师（authenticated）可全权访问；anon 不建任何策略 = 完全不可直连
drop policy if exists home_note_teacher_all on public.home_note;
create policy home_note_teacher_all on public.home_note
  for all
  to authenticated
  using (true)
  with check (true);

-- 4) 表级权限：先收回再精确授予
revoke all on public.home_note from anon;
revoke all on public.home_note from authenticated;
grant all on public.home_note to authenticated;

-- 5) 家长提交在家表现的校验函数
--    班级+学生+家长三要素在 student_info / student_parent 中匹配成功才写入
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

revoke execute on function public.add_home_note(text, text, text, text, date) from public;
grant  execute on function public.add_home_note(text, text, text, text, date) to anon, authenticated;

-- 6) 让 PostgREST 立即识别新表/新函数
notify pgrst, 'reload schema';

-- 完成后自检（老师账号视角）：
--   select h.record_date, s.class, s.student_name, h.parent_name, h.content
--   from home_note h join student_info s on s.id = h.student_id
--   order by h.record_date desc, h.create_at desc limit 10;
