-- ============================================================================
-- 116-exam-score-star-visibility.sql
-- 成绩上传改造：星光值加成倍数 / 不发送给家长 / 成绩单原子保存 / 星光值回退
-- ----------------------------------------------------------------------------
-- 1) 字段
--    exam_batch.star_multiplier   本次考试选的加成倍数（0.25/0.5/0.75/1/1.5/2）
--    exam_batch.visible_parent    是否对家长可见（不发送给家长 = false）
--    exam_score.star_awarded      该生本次实发星光值（发完即定值，重算与删除都靠它）
--    exam_paper.*                 单张试卷同样三件套
-- 2) RPC
--    exam_batch_save(...)         校验 + 建批次 + 写分数 + 发星光（一个事务）
--    exam_batch_delete(p_id)      先扣回星光，再删批次（分数级联删）
--    exam_paper_save(...)         单张试卷：校验 + 写记录 + 发星光
--    exam_paper_delete(p_id)      扣回星光 + 删除
-- 3) 家长端
--    get_student_exam_batches / get_student_papers 均过滤 visible_parent = false
-- 4) 重算
--    recalc_all_xp 增加两路来源：exam_score.star_awarded / exam_paper.star_awarded
--    （否则「一键重算」会把成绩加分抹掉）
--
-- 星光值口径：基础值 = 分数 ÷ 10（保留小数）→ × 倍数 → 四舍五入取整。
--   例：92 分 ×0.5 = 4.6 → 5；92 分 ×1 = 9.2 → 9；100 分 ×2 = 20。
--   分数为空 → 0 星光；发 0 的不写流水。
-- 计入维度：智（xp_zhi），与「学业成绩」语义一致；总 xp 同步增加，
--   钱包/流水/班级经验由既有触发器 trg_star_sync_wallet 自动处理。
--
-- 执行：Supabase SQL Editor 整段执行，可重复执行（幂等）。
-- ============================================================================

-- ---------- 1. 字段 ----------------------------------------------------------
alter table public.exam_batch add column if not exists star_multiplier numeric(3,2) not null default 1;
alter table public.exam_batch add column if not exists visible_parent   boolean not null default true;
alter table public.exam_score add column if not exists star_awarded     integer not null default 0;
alter table public.exam_paper add column if not exists star_multiplier  numeric(3,2) not null default 1;
alter table public.exam_paper add column if not exists star_awarded     integer not null default 0;
alter table public.exam_paper add column if not exists visible_parent   boolean not null default true;

comment on column public.exam_batch.star_multiplier is '本次成绩单的星光加成倍数：0.25/0.5/0.75/1/1.5/2';
comment on column public.exam_batch.visible_parent  is 'false = 本次成绩不发送给家长（家长端完全不显示）';
comment on column public.exam_score.star_awarded    is '该生本次实发星光值 = round(分数/10 × 倍数)';
comment on column public.exam_paper.visible_parent  is 'false = 这份试卷与分数不对家长可见';

-- ---------- 2. 工具函数 ------------------------------------------------------
-- 同一班同一天的同名考试只允许一条（防止重复录入把星光发两遍）。
-- 若库里已有历史重复数据，则不建索引，改由 RPC 里的查重分支拦截。
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'exam_batch_uniq_name_date') then
    if not exists (
      select 1 from public.exam_batch
       group by class, exam_name, exam_date
      having count(*) > 1
    ) then
      execute 'create unique index exam_batch_uniq_name_date on public.exam_batch (class, exam_name, exam_date)';
    end if;
  end if;
end $$;

-- 六档合法倍数
create or replace function public.is_valid_star_multiplier(p numeric)
returns boolean
language sql
immutable
as $$
  select coalesce(p, 1)::numeric in (0.25, 0.5, 0.75, 1, 1.5, 2);
$$;

-- 分数 + 倍数 → 星光值（四舍五入）
create or replace function public.star_from_score(p_score numeric, p_multiplier numeric)
returns integer
language plpgsql
immutable
as $$
declare
  v_mult numeric := coalesce(p_multiplier, 1);
begin
  if p_score is null then
    return 0;
  end if;
  if v_mult <= 0 then
    v_mult := 1;
  end if;
  return greatest(0, round((p_score / 10.0) * v_mult)::int);
end;
$$;

-- 发放：只改 xp 与 xp_zhi，钱包/流水/班级经验交给触发器
create or replace function public.award_exam_stars(p_class text, p_student text, p_stars integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.student_info
     set xp     = coalesce(xp, 0)     + p_stars,
         xp_zhi = coalesce(xp_zhi, 0) + p_stars
   where class = p_class
     and student_name = p_student
     and p_stars > 0;
$$;

-- 扣回：删批次/删试卷时按实发值回收（累计获得不回退，只扣可消费余额）
create or replace function public.revoke_exam_stars(p_class text, p_student text, p_stars integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.student_info
     set xp     = greatest(0, coalesce(xp, 0)     - p_stars),
         xp_zhi = greatest(0, coalesce(xp_zhi, 0) - p_stars)
   where class = p_class
     and student_name = p_student
     and p_stars > 0;
$$;

-- ---------- 3. 成绩单：保存 --------------------------------------------------
-- 返回值统一为 jsonb：
--   {ok:true, batch_id, awarded, students, multiplier, visible_parent, fallback:false}
--   {ok:false, code, message}   code ∈ class / exam_name / multiplier / rows / duplicate / score
-- exam_batch_save：整批一个事务，任一校验失败则整批不落库
create or replace function public.exam_batch_save(
  p_class      text,
  p_exam_name  text,
  p_subject    text,
  p_exam_date  date,
  p_note       text,
  p_image_url  text,
  p_multiplier numeric,
  p_visible    boolean,
  p_rows       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mult    numeric := coalesce(p_multiplier, 1);
  v_date    date    := coalesce(p_exam_date, current_date);
  v_batch   uuid;
  v_row     jsonb;
  v_name    text;
  v_sid     uuid;
  v_score   numeric;
  v_stars   int;
  v_total   int := 0;
  v_people  int := 0;
  v_dup     uuid;
begin
  if btrim(coalesce(p_class, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'class', 'message', '请先选择班级');
  end if;
  if btrim(coalesce(p_exam_name, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'exam_name', 'message', '请先填写考试名称');
  end if;
  if not public.is_valid_star_multiplier(v_mult) then
    return jsonb_build_object('ok', false, 'code', 'multiplier',
      'message', '星光加成倍数只能是 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', false, 'code', 'rows', 'message', '没有可保存的分数');
  end if;

  -- 逐行校验（先全量校验，再落库，避免半批入库）
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_name := btrim(coalesce(v_row ->> 'student_name', ''));
    if v_name = '' then
      return jsonb_build_object('ok', false, 'code', 'rows', 'message', '存在没有姓名的行，无法保存');
    end if;
    if nullif(btrim(coalesce(v_row ->> 'score', '')), '') is null then
      return jsonb_build_object('ok', false, 'code', 'score',
        'message', '「' || v_name || '」没有填写分数');
    end if;
    begin
      v_score := (v_row ->> 'score')::numeric;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'score',
        'message', '「' || v_name || '」的分数不是数字');
    end;
    if v_score < 0 or v_score > 150 then
      return jsonb_build_object('ok', false, 'code', 'score',
        'message', '「' || v_name || '」的分数 ' || v_score::text || ' 超出 0~150');
    end if;
  end loop;

  -- 同名同日同班重复录入：拦住，避免同一场考试重复发星光
  select id into v_dup
    from public.exam_batch
   where class = btrim(p_class)
     and exam_name = btrim(p_exam_name)
     and exam_date = v_date
   limit 1;
  if v_dup is not null then
    return jsonb_build_object('ok', false, 'code', 'duplicate',
      'message', '该班在这一天已有同名考试「' || btrim(p_exam_name) || '」，请改考试名称或先删除原批次');
  end if;

  begin
    insert into public.exam_batch(class, exam_name, subject, exam_date, note, image_url,
                                  star_multiplier, visible_parent)
    values (btrim(p_class), btrim(p_exam_name),
            nullif(btrim(coalesce(p_subject, '')), ''),
            v_date,
            nullif(btrim(coalesce(p_note, '')), ''),
            nullif(btrim(coalesce(p_image_url, '')), ''),
            v_mult,
            coalesce(p_visible, true))
    returning id into v_batch;
  exception when unique_violation then
    -- 唯一索引兜底（两位老师同时保存同一场考试）
    return jsonb_build_object('ok', false, 'code', 'duplicate',
      'message', '该班在这一天已有同名考试「' || btrim(p_exam_name) || '」，请改考试名称或先删除原批次');
  end;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_name  := btrim(coalesce(v_row ->> 'student_name', ''));
    v_score := (v_row ->> 'score')::numeric;
    v_sid   := null;
    begin
      v_sid := nullif(btrim(coalesce(v_row ->> 'student_id', '')), '')::uuid;
    exception when others then
      v_sid := null;
    end;
    if v_sid is null then
      select id into v_sid
        from public.student_info
       where class = btrim(p_class) and student_name = v_name
       limit 1;
    end if;

    v_stars := public.star_from_score(v_score, v_mult);

    insert into public.exam_score(batch_id, student_id, class, student_name, score, star_awarded)
    values (v_batch, v_sid, btrim(p_class), v_name, v_score, v_stars)
    on conflict (batch_id, student_name) do update
      set score = excluded.score,
          star_awarded = excluded.star_awarded,
          student_id = coalesce(excluded.student_id, public.exam_score.student_id);

    if v_stars > 0 then
      perform public.award_exam_stars(btrim(p_class), v_name, v_stars);
      v_total  := v_total + v_stars;
      v_people := v_people + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_batch,
    'awarded', v_total,
    'students', v_people,
    'multiplier', v_mult,
    'visible_parent', coalesce(p_visible, true)
  );
end;
$$;

revoke execute on function public.exam_batch_save(text, text, text, date, text, text, numeric, boolean, jsonb) from public;
grant  execute on function public.exam_batch_save(text, text, text, date, text, text, numeric, boolean, jsonb) to authenticated;

-- ---------- 4. 成绩单：删除（先扣回星光） -----------------------------------
create or replace function public.exam_batch_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund int := 0;
  v_row    record;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'message', '缺少批次 ID');
  end if;
  if not exists (select 1 from public.exam_batch where id = p_id) then
    return jsonb_build_object('ok', false, 'message', '这次成绩单不存在或已删除');
  end if;

  for v_row in
    select class, student_name, coalesce(star_awarded, 0) as stars
      from public.exam_score
     where batch_id = p_id and coalesce(star_awarded, 0) > 0
  loop
    perform public.revoke_exam_stars(v_row.class, v_row.student_name, v_row.stars);
    v_refund := v_refund + v_row.stars;
  end loop;

  delete from public.exam_batch where id = p_id;   -- exam_score 级联删除

  return jsonb_build_object('ok', true, 'refund', v_refund);
end;
$$;

revoke execute on function public.exam_batch_delete(uuid) from public;
grant  execute on function public.exam_batch_delete(uuid) to authenticated;

-- ---------- 5. 单张试卷：保存 / 删除 ----------------------------------------
create or replace function public.exam_paper_save(
  p_student_id   uuid,
  p_class        text,
  p_student_name text,
  p_record_date  date,
  p_subject      text,
  p_score        numeric,
  p_score_text   text,
  p_note         text,
  p_image_url    text,
  p_multiplier   numeric,
  p_visible      boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mult   numeric := coalesce(p_multiplier, 1);
  v_score  numeric := p_score;
  v_stars  int;
  v_id     uuid;
  v_sid    uuid := p_student_id;
begin
  if btrim(coalesce(p_class, '')) = '' or btrim(coalesce(p_student_name, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'student', 'message', '请先选择班级和学生');
  end if;
  if btrim(coalesce(p_image_url, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'image', 'message', '试卷图片上传失败，请重试');
  end if;
  if not public.is_valid_star_multiplier(v_mult) then
    return jsonb_build_object('ok', false, 'code', 'multiplier',
      'message', '星光加成倍数只能是 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2');
  end if;
  if v_score is not null and (v_score < 0 or v_score > 150) then
    return jsonb_build_object('ok', false, 'code', 'score', 'message', '分数需在 0~150 之间');
  end if;

  if v_sid is null then
    select id into v_sid
      from public.student_info
     where class = btrim(p_class) and student_name = btrim(p_student_name)
     limit 1;
  end if;
  if v_sid is null then
    return jsonb_build_object('ok', false, 'code', 'student', 'message', '找不到该学生，请刷新名单');
  end if;

  v_stars := public.star_from_score(v_score, v_mult);

  insert into public.exam_paper(student_id, class, student_name, record_date, subject,
                                score, score_text, image_url, note, star_multiplier, visible_parent)
  values (v_sid, btrim(p_class), btrim(p_student_name), coalesce(p_record_date, current_date),
          nullif(btrim(coalesce(p_subject, '')), ''), v_score,
          nullif(btrim(coalesce(p_score_text, '')), ''),
          btrim(p_image_url),
          nullif(btrim(coalesce(p_note, '')), ''),
          v_mult, coalesce(p_visible, true))
  returning id into v_id;

  -- star_awarded 先写回本行，再发星光（发 0 也写 0，便于重算）
  update public.exam_paper set star_awarded = v_stars where id = v_id;
  perform public.award_exam_stars(btrim(p_class), btrim(p_student_name), v_stars);

  return jsonb_build_object('ok', true, 'id', v_id, 'awarded', v_stars,
                            'multiplier', v_mult, 'visible_parent', coalesce(p_visible, true));
end;
$$;

revoke execute on function public.exam_paper_save(uuid, text, text, date, text, numeric, text, text, text, numeric, boolean) from public;
grant  execute on function public.exam_paper_save(uuid, text, text, date, text, numeric, text, text, text, numeric, boolean) to authenticated;

create or replace function public.exam_paper_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.exam_paper%rowtype;
begin
  select * into v_row from public.exam_paper where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', '这份试卷不存在或已删除');
  end if;

  perform public.revoke_exam_stars(v_row.class, v_row.student_name, coalesce(v_row.star_awarded, 0));
  delete from public.exam_paper where id = p_id;

  return jsonb_build_object('ok', true, 'refund', coalesce(v_row.star_awarded, 0));
end;
$$;

revoke execute on function public.exam_paper_delete(uuid) from public;
grant  execute on function public.exam_paper_delete(uuid) to authenticated;

-- ---------- 6. 家长端：过滤「不发送给家长」 ---------------------------------
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
    and coalesce(b.visible_parent, true)                 -- 不发送给家长的批次，家长端完全不出现
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

create or replace function public.get_student_papers(
  p_class   text,
  p_student text,
  p_birth   text
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
    and coalesce(e.visible_parent, true)                 -- 不发送给家长的试卷，家长端完全不出现
    and exists (
      select 1
      from public.student_info s
      where s.class = e.class
        and s.student_name = e.student_name
        and (
          btrim(s.birth_date) = btrim(coalesce(p_birth, ''))
          or btrim(s.access_code) = btrim(coalesce(p_birth, ''))
        )
    )
  order by e.record_date desc, e.create_at desc;
$$;

revoke execute on function public.get_student_papers(text, text, text) from public;
grant  execute on function public.get_student_papers(text, text, text) to anon, authenticated;

-- ---------- 7. 一键重算：补上成绩单来源 -------------------------------------
-- 不补这一段的话，「重算星光值」会把成绩加分整体抹掉。
create or replace function public.recalc_all_xp()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stu  record;
  v_rec  record;
  v_item record;
  v_tag_xp int;
  v_dim  text;
  v_xp int;
  v_de int; v_zhi int; v_ti int; v_mei int; v_lao int;
  v_tmp int;
  v_cnt int := 0;
begin
  -- 暂停头像/成就兜底触发器：避免重算时按等级变化重置学生头像（v152.8 修复）
  alter table public.student_info disable trigger trg_student_unlock_guard;
  begin
  -- 全班清零（总经验 + 五维 + 等级）；where true 满足 Supabase「禁止无 WHERE 更新」安全设置
  update public.student_info
     set xp = 0, level = 1,
         xp_de = 0, xp_zhi = 0, xp_ti = 0, xp_mei = 0, xp_lao = 0
   where true;

  for v_stu in select id, class, student_name from public.student_info loop
    v_xp := 0; v_de := 0; v_zhi := 0; v_ti := 0; v_mei := 0; v_lao := 0;

    -- ① 日常表现提交（含自动任务/手动任务已写入 daily_record 的记录）
    for v_rec in
      select behavior from public.daily_record
       where class = v_stu.class and student_name = v_stu.student_name
    loop
      for v_item in
        select e ->> 'id' as tag_id, e ->> 'category' as category
          from jsonb_array_elements(
                 case when jsonb_typeof(v_rec.behavior) = 'object'
                       and jsonb_typeof(v_rec.behavior -> 'items') = 'array'
                      then v_rec.behavior -> 'items'
                      else '[]'::jsonb end
               ) as e
      loop
        select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi')
          into v_tag_xp, v_dim
          from public.behavior_tags t
         where t.id::text = v_item.tag_id;
        if v_tag_xp is null then
          v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
        end if;
        v_xp := v_xp + v_tag_xp;
        case v_dim
          when 'de'  then v_de  := v_de  + v_tag_xp;
          when 'ti'  then v_ti  := v_ti  + v_tag_xp;
          when 'mei' then v_mei := v_mei + v_tag_xp;
          when 'lao' then v_lao := v_lao + v_tag_xp;
          else            v_zhi := v_zhi + v_tag_xp;
        end case;
        v_cnt := v_cnt + 1;
      end loop;
    end loop;

    -- ② 每日任务：xp_awarded 净值（改评后同步），只加总经验，不进五维（与原逻辑一致）
    for v_rec in
      select xp_awarded from public.task_submission
       where class = v_stu.class and student_name = v_stu.student_name
    loop
      v_xp := v_xp + coalesce(v_rec.xp_awarded, 0);
      v_cnt := v_cnt + 1;
    end loop;

    -- ③ 个人任务：status=done（含教师代填），按任务 dim 分五维
    for v_rec in
      select xp_value, dim from public.personal_task
       where class = v_stu.class and student_name = v_stu.student_name
         and status = 'done'
    loop
      v_tmp := coalesce(v_rec.xp_value, 0);
      v_xp := v_xp + v_tmp;
      case coalesce(v_rec.dim, 'zhi')
        when 'de'  then v_de  := v_de  + v_tmp;
        when 'ti'  then v_ti  := v_ti  + v_tmp;
        when 'mei' then v_mei := v_mei + v_tmp;
        when 'lao' then v_lao := v_lao + v_tmp;
        else            v_zhi := v_zhi + v_tmp;
      end case;
      v_cnt := v_cnt + 1;
    end loop;

    -- ④ 挑战任务：challenge_submission status='active'（已取消的不算）
    for v_rec in
      select xp, dim from public.challenge_submission
       where class = v_stu.class and student_name = v_stu.student_name
         and status = 'active'
    loop
      v_tmp := coalesce(v_rec.xp, 0);
      v_xp := v_xp + v_tmp;
      case coalesce(v_rec.dim, 'zhi')
        when 'de'  then v_de  := v_de  + v_tmp;
        when 'ti'  then v_ti  := v_ti  + v_tmp;
        when 'mei' then v_mei := v_mei + v_tmp;
        when 'lao' then v_lao := v_lao + v_tmp;
        else            v_zhi := v_zhi + v_tmp;
      end case;
      v_cnt := v_cnt + 1;
    end loop;

    -- ⑤ 成绩单：按每行实发星光值回放，归入「智」（v116 新增，缺此段重算会抹掉成绩加分）
    for v_rec in
      select coalesce(star_awarded, 0) as stars from public.exam_score
       where class = v_stu.class and student_name = v_stu.student_name
    loop
      v_tmp := v_rec.stars;
      if v_tmp <> 0 then
        v_xp  := v_xp  + v_tmp;
        v_zhi := v_zhi + v_tmp;
        v_cnt := v_cnt + 1;
      end if;
    end loop;

    -- ⑥ 单张试卷：同上（v116 新增）
    for v_rec in
      select coalesce(star_awarded, 0) as stars from public.exam_paper
       where class = v_stu.class and student_name = v_stu.student_name
    loop
      v_tmp := v_rec.stars;
      if v_tmp <> 0 then
        v_xp  := v_xp  + v_tmp;
        v_zhi := v_zhi + v_tmp;
        v_cnt := v_cnt + 1;
      end if;
    end loop;

    -- ⑦ 手动分配任务：不单独处理（confirm_manual_task 若写 daily_record 已含于①）

    update public.student_info
       set xp = v_xp,
           level = public.level_from_xp(v_xp),
           xp_de = v_de, xp_zhi = v_zhi,
           xp_ti = v_ti, xp_mei = v_mei, xp_lao = v_lao
     where id = v_stu.id;
  end loop;

  exception when others then
    alter table public.student_info enable trigger trg_student_unlock_guard;
    raise;
  end;
  -- 重算完成：用最终经验/等级统一校验头像与头像框（匹配保留、不匹配回退）
  for v_stu in select id from public.student_info loop
    perform public.enforce_student_unlocks(v_stu.id);
  end loop;
  alter table public.student_info enable trigger trg_student_unlock_guard;
  return jsonb_build_object('ok', true, 'records_replayed', v_cnt);
end;
$$;

revoke execute on function public.recalc_all_xp() from anon;
grant  execute on function public.recalc_all_xp() to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- 自检（可选，在 SQL Editor 单独执行）
--   1) 字段是否就位：
--      select table_name, column_name, data_type, column_default
--        from information_schema.columns
--       where table_name in ('exam_batch','exam_score','exam_paper')
--         and column_name in ('star_multiplier','visible_parent','star_awarded')
--       order by table_name, column_name;
--   2) 星光口径抽查：
--      select s, m, public.star_from_score(s, m) as stars
--        from (values (92,0.25),(92,0.5),(92,0.75),(92,1),(92,1.5),(92,2),(100,2),(0,2)) v(s,m);
--      预期：2 / 5 / 7 / 9 / 14 / 18 / 20 / 0
--   3) 已发星光与批次核对：
--      select b.class, b.exam_name, b.exam_date, b.star_multiplier, b.visible_parent,
--             count(s.id) as 人数, sum(s.star_awarded) as 星光合计
--        from public.exam_batch b left join public.exam_score s on s.batch_id = b.id
--       group by b.id order by b.exam_date desc limit 10;
-- ============================================================================
