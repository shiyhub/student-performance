-- ============================================================================
-- 增量升级 50：家长留言支持教师评论 + 多轮交流
--   - 新表 home_note_reply：家长留言（home_note）的回复线程
--     sender: 'teacher' 教师评论 / 'parent' 家长回复
--   - 家长（anon）不能直接读写，只能经 RPC：
--       add_home_note_reply 回复（三要素 + 留言归属校验）
--       get_my_home_notes   查看自己的留言与全部回复（三要素校验）
--   - 老师（authenticated）对该表拥有全部读写权限（教师评论直连写入）
-- 安全可重复执行。
-- ============================================================================

-- 1) 回复线程表
create table if not exists public.home_note_reply (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.home_note(id) on delete cascade,
  sender     text not null check (sender in ('teacher','parent')),
  content    text not null,
  create_at  timestamptz not null default now()
);

create index if not exists idx_home_note_reply_note
  on public.home_note_reply (note_id, create_at);

comment on table public.home_note_reply is '家长留言的回复线程：教师评论/家长回复多轮交流；匿名端只能经校验RPC写入与读取自己的，仅老师可全权管理';

-- 2) 开启 RLS
alter table public.home_note_reply enable row level security;

-- 3) 仅老师（authenticated）可全权访问；anon 不建任何策略 = 完全不可直连
drop policy if exists home_note_reply_teacher_all on public.home_note_reply;
create policy home_note_reply_teacher_all on public.home_note_reply
  for all
  to authenticated
  using (true)
  with check (true);

-- 4) 表级权限：先收回再精确授予
revoke all on public.home_note_reply from anon;
revoke all on public.home_note_reply from authenticated;
grant all on public.home_note_reply to authenticated;

-- 5) 家长回复：三要素校验 + 留言归属校验（只能回复自己孩子的留言）
create or replace function public.add_home_note_reply(
  p_class   text,
  p_student text,
  p_birth   text,
  p_note_id uuid,
  p_content text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid     uuid;
  v_content text;
begin
  v_content := nullif(left(btrim(coalesce(p_content, '')), 500), '');
  if v_content is null then
    return false;
  end if;

  select si.id
    into v_sid
  from public.student_info si
  where si.class        = btrim(coalesce(p_class, ''))
    and si.student_name = btrim(coalesce(p_student, ''))
    and btrim(si.birth_date) = btrim(coalesce(p_birth, ''))
  limit 1;

  if v_sid is null then
    return false;
  end if;

  -- 留言必须属于该学生
  if not exists (
    select 1 from public.home_note
     where id = p_note_id and student_id = v_sid
  ) then
    return false;
  end if;

  insert into public.home_note_reply (note_id, sender, content)
  values (p_note_id, 'parent', v_content);

  return true;
end;
$$;

revoke execute on function public.add_home_note_reply(text, text, text, uuid, text) from public;
grant  execute on function public.add_home_note_reply(text, text, text, uuid, text) to anon, authenticated;

-- 6) 家长查看自己的留言与回复（多轮对话，按时间排序）
create or replace function public.get_my_home_notes(
  p_class   text,
  p_student text,
  p_birth   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid;
begin
  select si.id
    into v_sid
  from public.student_info si
  where si.class        = btrim(coalesce(p_class, ''))
    and si.student_name = btrim(coalesce(p_student, ''))
    and btrim(si.birth_date) = btrim(coalesce(p_birth, ''))
  limit 1;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'mismatch');
  end if;

  return jsonb_build_object(
    'ok', true,
    'notes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',          hn.id,
          'parent_name', hn.parent_name,
          'content',     hn.content,
          'record_date', hn.record_date,
          'create_at',   hn.create_at,
          'replies', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id',        r.id,
                'sender',    r.sender,
                'content',   r.content,
                'create_at', r.create_at
              ) order by r.create_at, r.id
            )
            from public.home_note_reply r
            where r.note_id = hn.id
          ), '[]'::jsonb)
        ) order by hn.create_at desc, hn.id desc
      )
      from public.home_note hn
      where hn.student_id = v_sid
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_my_home_notes(text, text, text) from public;
grant  execute on function public.get_my_home_notes(text, text, text) to anon, authenticated;

-- 7) 让 PostgREST 立即识别新表/新函数
notify pgrst, 'reload schema';

-- 完成后自检（老师账号视角）：
--   select hn.content, r.sender, r.content, r.create_at
--   from home_note hn
--   left join home_note_reply r on r.note_id = hn.id
--   order by hn.create_at desc, r.create_at limit 20;
