-- ============================================================================
-- 105-exam-batch.sql —— 成绩单批量导入（考试批次 + 每人分数）
-- ----------------------------------------------------------------------------
-- 背景：原「试卷拍照」是"1 个学生 1 张图 1 个分数"。
--       新增需求：老师输入考试名称（可附说明），一次导入整班成绩——
--       ① 上传成绩单图片，OCR 识别"姓名+分数"多行；
--       ② 或用 Excel 模板导入分数。
--
-- 结构：
--   exam_batch  一次考试（班级、考试名称、科目、日期、说明、可选成绩单图片）
--   exam_score  该次考试下每名学生的分数（batch_id 级联删除）
--
-- 权限：与 exam_paper 一致 —— 仅登录老师（authenticated）可直连读写；
--       家长经 security definer RPC get_student_exam_batches 严格校验后查看。
--       学生端不引入本表、不查询。
--
-- 执行：Supabase SQL Editor 整段执行，可重复执行（幂等）。
-- ============================================================================

-- 1) 考试批次 ----------------------------------------------------------------
create table if not exists public.exam_batch (
  id          uuid primary key default gen_random_uuid(),
  class       text not null,
  exam_name   text not null,                     -- 考试名称，如 期中考试
  subject     text,                              -- 科目，如 数学
  exam_date   date not null default current_date,
  note        text,                              -- 老师附加说明（家长可见）
  image_url   text,                              -- 成绩单原图（可选，Storage 公开短链）
  create_at   timestamptz not null default now()
);

create index if not exists idx_exam_batch_lookup
  on public.exam_batch (class, exam_date desc, create_at desc);

comment on table public.exam_batch is
  '成绩单批次：老师录入考试名称/科目/日期/说明，可附成绩单图片；仅老师可直连，家长经 RPC 查看';

-- 2) 批次内每人成绩 ----------------------------------------------------------
create table if not exists public.exam_score (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.exam_batch(id) on delete cascade,
  student_id   uuid references public.student_info(id) on delete cascade,
  class        text not null,
  student_name text not null,
  score        numeric(6,1),
  create_at    timestamptz not null default now(),
  constraint exam_score_batch_student_uniq unique (batch_id, student_name)
);

create index if not exists idx_exam_score_batch on public.exam_score (batch_id);
create index if not exists idx_exam_score_student on public.exam_score (class, student_name);

comment on table public.exam_score is
  '成绩单批次内每名学生的分数；与 exam_batch 级联删除';

-- 3) RLS：仅登录老师 ---------------------------------------------------------
alter table public.exam_batch enable row level security;
alter table public.exam_score enable row level security;

drop policy if exists exam_batch_teacher_all on public.exam_batch;
create policy exam_batch_teacher_all on public.exam_batch
  for all to authenticated using (true) with check (true);

drop policy if exists exam_score_teacher_all on public.exam_score;
create policy exam_score_teacher_all on public.exam_score
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.exam_batch to authenticated;
grant select, insert, update, delete on public.exam_score to authenticated;

-- 4) 家长查询：按 班级+学生+出生日期/学生密码 严格校验 ---------------------
--    返回该生每一次考试的批次信息与本人分数；家长只能看到自己孩子。
drop function if exists public.get_student_exam_batches(text, text, text);
create or replace function public.get_student_exam_batches(
  p_class   text,
  p_student text,
  p_birth   text
)
returns table (
  batch_id    uuid,
  exam_name   text,
  subject     text,
  exam_date   date,
  note        text,
  image_url   text,
  score       numeric,
  create_at   timestamptz
)
language sql
security definer
set search_path = public
as $$
  select b.id, b.exam_name, b.subject, b.exam_date, b.note, b.image_url,
         s.score, b.create_at
  from public.exam_batch b
  join public.exam_score s on s.batch_id = b.id
  where b.class = btrim(coalesce(p_class, ''))
    and s.student_name = btrim(coalesce(p_student, ''))
    and exists (
      select 1
      from public.student_info si
      where si.class = b.class
        and si.student_name = s.student_name
        and (
          btrim(si.birth_date) = btrim(coalesce(p_birth, ''))
          or btrim(si.access_code) = btrim(coalesce(p_birth, ''))
        )
    )
  order by b.exam_date desc, b.create_at desc;
$$;

revoke execute on function public.get_student_exam_batches(text, text, text) from public;
grant  execute on function public.get_student_exam_batches(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- 自检（可选，在 SQL Editor 单独执行）：
--   select count(*) from public.exam_batch;
--   select b.exam_name, b.exam_date, count(s.id), round(avg(s.score),1)
--     from public.exam_batch b left join public.exam_score s on s.batch_id=b.id
--     group by b.id order by b.exam_date desc limit 5;
-- ============================================================================
