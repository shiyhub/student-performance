-- ============================================================================
-- 增量升级 08：经验等级系统 + 校园头像鉴权 + 星级选填 + 试卷拍照（家长可见）
--   1. student_info 增加 xp / level / 头像更换计数
--   2. daily_record.self_evaluation 允许为空（学生可不打星提交）
--   3. student_directory 视图补 xp / level
--   4. 提交表现后按"积极项 ×2"自动累加经验并重算等级（触发器）
--   5. 重写 set_student_avatar：校园头像需 3 级解锁；表情头像每天限换 2 次
--   6. 新增 exam_paper 试卷表、Storage 桶 exam-papers、家长查询 RPC
-- 可重复执行。跑完后到 Storage 菜单确认出现 exam-papers 桶。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 学生表：经验、等级、换头像计数
-- ---------------------------------------------------------------------------
alter table public.student_info add column if not exists xp                   int not null default 0;
alter table public.student_info add column if not exists level                int not null default 1;
alter table public.student_info add column if not exists avatar_changed_at    timestamptz;
alter table public.student_info add column if not exists avatar_changes_today smallint not null default 0;

alter table public.student_info drop constraint if exists chk_student_level;
alter table public.student_info add  constraint chk_student_level check (level between 1 and 5);
alter table public.student_info drop constraint if exists chk_student_xp;
alter table public.student_info add  constraint chk_student_xp check (xp >= 0);

-- ---------------------------------------------------------------------------
-- 2) 每日记录：星级改为选填（NULL = 本次未打星）
-- ---------------------------------------------------------------------------
alter table public.daily_record alter column self_evaluation drop not null;
alter table public.daily_record drop constraint if exists chk_self_eval;
alter table public.daily_record add  constraint chk_self_eval
  check (self_evaluation is null or self_evaluation between 1 and 5);

-- ---------------------------------------------------------------------------
-- 3) 通讯录视图补 xp / level（学生墙据此显示等级与经验进度）
-- ---------------------------------------------------------------------------
create or replace view public.student_directory as
  select id, class, student_name, avatar, xp, level
  from public.student_info;

comment on view public.student_directory is '学生端班级墙只读视图：班级、姓名、头像、经验、等级';
grant select on public.student_directory to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) 经验与等级：阈值 L1=0 / L2=20 / L3=60 / L4=120 / L5=200
--    每条记录中每个"积极表现"项 +2 XP，消极项不加；经验只增不减。
-- ---------------------------------------------------------------------------
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

create or replace function public.apply_record_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pos int := 0;
  v_xp  int;
begin
  -- 统计本单 behavior.items 中 category='positive' 的项数
  select count(*) into v_pos
  from jsonb_array_elements(coalesce(new.behavior -> 'items', '[]'::jsonb)) as e
  where e ->> 'category' = 'positive';

  if coalesce(v_pos, 0) > 0 then
    update public.student_info
       set xp = coalesce(xp, 0) + v_pos * 2
     where class = new.class
       and student_name = new.student_name
    returning xp into v_xp;

    if found then
      update public.student_info
         set level = public.level_from_xp(v_xp)
       where class = new.class
         and student_name = new.student_name;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_record_xp on public.daily_record;
create trigger trg_apply_record_xp
  after insert on public.daily_record
  for each row execute function public.apply_record_xp();

-- ---------------------------------------------------------------------------
-- 5) 头像更换：
--    - 校园图片头像 key：girl1~girl8 / boy1~boy8 / neutral1~neutral8，需 level>=3，
--      解锁后不限次数；
--    - 其余视为表情头像(emoji)：同一自然日最多更换 2 次（选回当前头像不计数）。
--    返回 {ok, changed, reason, level, xp, changes_left}
-- ---------------------------------------------------------------------------
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

  -- 选的就是当前头像：幂等成功，不计数
  if v_key is not distinct from v_cur then
    v_left := case when v_changed_at::date = current_date then greatest(0, 2 - coalesce(v_changes,0)) else 2 end;
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'same',
                              'level', v_level, 'xp', v_xp, 'changes_left', v_left);
  end if;

  -- 校园头像：3 级解锁，解锁后随意更换，不占用每日次数
  if v_is_image then
    if coalesce(v_level, 1) < 3 then
      return jsonb_build_object('ok', false, 'reason', 'locked', 'changed', false,
                                'level', v_level, 'xp', v_xp, 'changes_left', 0);
    end if;

    update public.student_info set avatar = v_key where id = v_sid;
    return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                              'level', v_level, 'xp', v_xp, 'changes_left', -1);
  end if;

  -- 表情头像：每日限 2 次（跨天自动重新计数）
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

revoke execute on function public.set_student_avatar(text, text, text) from public;
grant  execute on function public.set_student_avatar(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) 试卷拍照（仅家长端经 RPC 可见，学生端不查询）
-- ---------------------------------------------------------------------------
create table if not exists public.exam_paper (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.student_info(id) on delete cascade,
  class        text not null,
  student_name text not null,
  record_date  date not null default current_date,
  subject      text,                              -- 科目，如 数学
  score        numeric(6,1),                      -- OCR/老师确认后的分数（可空）
  score_text   text,                              -- 识别到的原始分数文字，如 "95分"
  image_url    text not null,                     -- Storage 公共访问地址（随机文件名）
  note         text,
  create_at    timestamptz not null default now()
);

create index if not exists idx_exam_paper_lookup
  on public.exam_paper (class, student_name, record_date desc);

comment on table public.exam_paper is '教师上传的学生试卷照片与分数：仅老师可直连；家长经三要素RPC查看；学生端不开放';

alter table public.exam_paper enable row level security;

revoke all on public.exam_paper from anon, authenticated;
grant all on public.exam_paper to authenticated;

drop policy if exists exam_paper_teacher_all on public.exam_paper;
create policy exam_paper_teacher_all on public.exam_paper
  for all to authenticated using (true) with check (true);
-- anon 无任何策略：学生端无法直连本表

-- 家长三要素匹配后查看该生试卷
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

revoke execute on function public.get_student_papers(text, text, text) from public;
grant  execute on function public.get_student_papers(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) Storage 桶 exam-papers（公开桶 + 随机 UUID 文件名；不开放匿名列举/上传）
--    家长拿到的图片地址只能来自 get_student_papers，学生端代码不查询。
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('exam-papers', 'exam-papers', true)
on conflict (id) do update set public = excluded.public;

-- 先清旧策略，保证可重复执行
drop policy if exists exam_papers_bucket_teacher on storage.objects;
create policy exam_papers_bucket_teacher on storage.objects
  for all to authenticated
  using (bucket_id = 'exam-papers')
  with check (bucket_id = 'exam-papers');

-- 匿名端不给 storage.objects 任何策略：不能上传/列举/删除
-- （public 桶的图片直读地址 /storage/v1/object/public/... 不受 RLS 限制，
--   但文件名为随机 UUID，且仅家长经校验 RPC 才能得到地址）

notify pgrst, 'reload schema';

-- ============================================================================
-- 自检（可选，在 SQL Editor 单独执行查看）：
--   select student_name, xp, level, avatar_changes_today, avatar_changed_at::date from student_info limit 5;
--   select public.set_student_avatar('六年级一班','某学生','girl1');   -- 未到3级应 reason=locked
-- ============================================================================
