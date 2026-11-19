-- ============================================================================
-- 137-exam-star-reconcile.sql
-- 修复「试卷分数产生的星光值被误判为异常」+ 收口标签识别与提交防重复
-- ----------------------------------------------------------------------------
-- 问题根因（对应截图）：
--   ① 考试成绩的星光值由 award_exam_stars() 直接写 student_info.xp，
--      **从不写 xp_log 流水**；而「异常星光值排查」用 sum(xp_log) 当应得值，
--      于是每一次考试加分都被算成「星光值偏多」，分值正好等于该次考试得分。
--   ② inject_xp_log() 也只重建 5 类来源（日常/每日任务/个人/挑战/手动任务），
--      同样没有考试，所以「注入流水」也补不回来。
--   ③ 教师手动调分 set_student_xp() 直接改 xp，同样不写流水，必然长期误报。
--
-- 本脚本做什么：
--   1) 考试星光实时入流水：exam_score / exam_paper 触发器 + 补写函数
--   2) 手动调分入流水 + 审计表（xp_adjust_audit）
--   3) 异常排查 v2：按来源分解（日常/任务/考试/手动/其它），考试单独列，
--      只对"无法解释的差额"报异常；历史差额可「核准豁免」，不再反复误报
--   4) 标签识别 v2：合法区间与录入上限对齐（0~100，原来 30 就报错）、补维度校验
--   5) 提交防重复：submit_today v3（同标签去重、未知标签丢弃、合并替换旧项、
--      重建流水不留孤儿）、submit_task v2（任务归属/日期校验、教师评级后锁定、
--      事务级锁）、挑战提交同档位唯一
--   6) 补齐 get_xp_log（此前仓库里没有这个函数的定义，查流水可能直接报错）
--
-- 依赖：01/09/90/93/100/101/102/105/109/116/126/135 已执行。
-- 可重复执行；若之后重跑 116/126，请再执行本文件一次（它们会覆盖本文件的封装）。
-- ============================================================================

-- ---------- 0. 前置断言：核心表必须存在 ----------
do $$
begin
  if to_regclass('public.xp_log') is null then
    raise exception '缺少 xp_log 表，请先执行 93-xp-precision.sql';
  end if;
  if to_regclass('public.exam_score') is null then
    raise exception '缺少 exam_score 表，请先执行 105-exam-batch.sql';
  end if;
  if to_regclass('public.student_wallet') is null then
    raise exception '缺少 student_wallet 表，请先执行 109-star-currency.sql';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'exam_score'
                    and column_name = 'star_awarded') then
    raise exception 'exam_score 缺少 star_awarded 字段，请先执行 116-exam-score-star-visibility.sql';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'exam_paper'
                    and column_name = 'star_awarded') then
    raise exception 'exam_paper 缺少 star_awarded 字段，请先执行 116-exam-score-star-visibility.sql';
  end if;
end $$;

-- ---------- 1. 工具函数 ----------
create or replace function public.xp_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Shanghai')::date $$;

comment on function public.xp_today() is '业务日期（中国时区），流水与任务截止统一口径';

-- 考试流水的 label 必须「稳定」：不能带分数/倍数，
-- 否则改一次分数就换一个 label，唯一键失效 → 同一场考试记两条流水。
create or replace function public.xp_exam_label(p_name text, p_subject text, p_date date, p_prefix text default '')
returns text
language sql
immutable
as $$
  select coalesce(nullif(btrim(p_prefix), ''), '') ||
         coalesce(nullif(btrim(p_name), ''), '考试') ||
         case when nullif(btrim(p_subject), '') is null then ''
              else '·' || btrim(p_subject) end ||
         '（' || coalesce(to_char(p_date, 'YYYY-MM-DD'), '—') || '）';
$$;

comment on function public.xp_exam_label(text, text, date, text)
  is '考试流水说明：名称·科目（日期），不含分数与倍数，保证同一场考试只有一条流水';

-- ---------- 2. 考试星光 → 流水（触发器） ----------
create or replace function public.exam_score_xp_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text; v_subject text; v_date date; v_label text;
begin
  if tg_op = 'DELETE' then
    delete from public.xp_log where source = 'exam' and ref_id = old.id;
    return old;
  end if;

  select b.exam_name, b.subject, b.exam_date
    into v_name, v_subject, v_date
    from public.exam_batch b
   where b.id = new.batch_id;

  v_label := public.xp_exam_label(v_name, v_subject, coalesce(v_date, new.create_at::date));

  -- 先清掉同一条记录下的旧 label（考试改名/改日期后不留双份）
  delete from public.xp_log
   where source = 'exam' and ref_id = new.id and coalesce(label, '') <> v_label;

  if coalesce(new.star_awarded, 0) > 0 then
    insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
    values (new.class, new.student_name, 'exam', new.id, v_label, 'zhi',
            new.star_awarded, coalesce(v_date, new.create_at::date))
    on conflict (source, ref_id, label) do update
       set xp = excluded.xp, dim = 'zhi', record_date = excluded.record_date;
  else
    -- 星光被扣回 / 改成 0：流水同步清零，避免"应得"比实际多
    delete from public.xp_log where source = 'exam' and ref_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.exam_paper_xp_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_label text;
begin
  if tg_op = 'DELETE' then
    delete from public.xp_log where source = 'exam' and ref_id = old.id;
    return old;
  end if;

  v_label := public.xp_exam_label(coalesce(nullif(btrim(new.subject), ''), '试卷'),
                                  new.subject, coalesce(new.record_date, new.create_at::date));

  delete from public.xp_log
   where source = 'exam' and ref_id = new.id and coalesce(label, '') <> v_label;

  if coalesce(new.star_awarded, 0) > 0 then
    insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
    values (new.class, new.student_name, 'exam', new.id, v_label, 'zhi',
            new.star_awarded, coalesce(new.record_date, new.create_at::date))
    on conflict (source, ref_id, label) do update
       set xp = excluded.xp, dim = 'zhi', record_date = excluded.record_date;
  else
    delete from public.xp_log where source = 'exam' and ref_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_exam_score_xp_log_ins on public.exam_score;
drop trigger if exists trg_exam_score_xp_log_del on public.exam_score;
create trigger trg_exam_score_xp_log_ins
  after insert or update on public.exam_score
  for each row execute function public.exam_score_xp_log();
create trigger trg_exam_score_xp_log_del
  after delete on public.exam_score
  for each row execute function public.exam_score_xp_log();

drop trigger if exists trg_exam_paper_xp_log_ins on public.exam_paper;
drop trigger if exists trg_exam_paper_xp_log_del on public.exam_paper;
create trigger trg_exam_paper_xp_log_ins
  after insert or update on public.exam_paper
  for each row execute function public.exam_paper_xp_log();
create trigger trg_exam_paper_xp_log_del
  after delete on public.exam_paper
  for each row execute function public.exam_paper_xp_log();

-- ---------- 2b. 历史数据补写 ----------
create or replace function public.sync_exam_xp_log(p_class text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ins int := 0;
  v_cls text := nullif(btrim(coalesce(p_class, '')), '');
  v_clean int := 0;
begin
  -- ① 成绩单（exam_batch + exam_score）
  insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
  select s.class, s.student_name, 'exam', s.id,
         public.xp_exam_label(b.exam_name, b.subject, coalesce(b.exam_date, s.create_at::date)),
         'zhi', s.star_awarded, coalesce(b.exam_date, s.create_at::date)
    from public.exam_score s
    join public.exam_batch b on b.id = s.batch_id
   where coalesce(s.star_awarded, 0) > 0
     and (v_cls is null or btrim(s.class) = v_cls)
  on conflict (source, ref_id, label) do update
     set xp = excluded.xp, dim = 'zhi', record_date = excluded.record_date;
  get diagnostics v_ins = row_count;

  -- ② 单张试卷
  insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
  select p.class, p.student_name, 'exam', p.id,
         public.xp_exam_label(coalesce(nullif(btrim(p.subject), ''), '试卷'), p.subject,
                              coalesce(p.record_date, p.create_at::date)),
         'zhi', p.star_awarded, coalesce(p.record_date, p.create_at::date)
    from public.exam_paper p
   where coalesce(p.star_awarded, 0) > 0
     and (v_cls is null or btrim(p.class) = v_cls)
  on conflict (source, ref_id, label) do update
     set xp = excluded.xp, dim = 'zhi', record_date = excluded.record_date;
  get diagnostics v_clean = row_count;
  v_ins := v_ins + v_clean;

  -- ③ 清理孤儿流水（考试记录已删除/已回退，流水不该留着）
  with gone as (
    delete from public.xp_log l
     where l.source = 'exam'
       and (v_cls is null or btrim(l.class) = v_cls)
       and not exists (select 1 from public.exam_score s where s.id = l.ref_id)
       and not exists (select 1 from public.exam_paper p where p.id = l.ref_id)
    returning 1
  )
  select count(*) into v_clean from gone;

  return jsonb_build_object('ok', true, 'injected', v_ins, 'cleaned', coalesce(v_clean, 0));
end;
$$;

comment on function public.sync_exam_xp_log(text)
  is '把考试成绩的星光值补写进 xp_log（只补缺，幂等），并清理已删除考试的孤儿流水';

-- ---------- 3. 教师手动调分 → 流水 + 审计 ----------
create table if not exists public.xp_adjust_audit (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,
  student_name text not null,
  xp_before    int  not null default 0,
  xp_after     int  not null default 0,
  delta        int  not null default 0,
  reason       text,
  operator_uid uuid,
  created_at   timestamptz not null default now()
);
create index if not exists idx_xp_adjust_audit_stu
  on public.xp_adjust_audit (class, student_name, created_at desc);
alter table public.xp_adjust_audit enable row level security;
drop policy if exists "xpadj teacher all" on public.xp_adjust_audit;
create policy "xpadj teacher all" on public.xp_adjust_audit
  for all to authenticated using (true) with check (true);

-- 旧的三参版本必须先删掉，否则新增默认参数会形成重载歧义
drop function if exists public.set_student_xp(text, text, int);

create or replace function public.set_student_xp(
  p_class   text,
  p_student text,
  p_xp      int,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_old int;
  v_new int;
  v_delta int;
  v_level int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'teacher_only');
  end if;

  select xp into v_old
    from public.student_info
   where btrim(class) = btrim(coalesce(p_class, ''))
     and btrim(student_name) = btrim(coalesce(p_student, ''));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  v_old   := coalesce(v_old, 0);
  v_new   := greatest(0, least(99999, coalesce(p_xp, 0)));
  v_delta := v_new - v_old;

  update public.student_info
     set xp = v_new,
         level = public.level_from_xp(v_new)
   where btrim(class) = btrim(coalesce(p_class, ''))
     and btrim(student_name) = btrim(coalesce(p_student, ''))
  returning level into v_level;

  -- 差额记入流水：这样「流水应得」能解释这次调整，不再被当成异常
  if v_delta <> 0 then
    insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
    values (btrim(p_class), btrim(p_student), 'adjust', gen_random_uuid(),
            '教师手动调整' ||
            case when nullif(btrim(coalesce(p_reason, '')), '') is null then ''
                 else '：' || btrim(p_reason) end ||
            '（' || v_old || '→' || v_new || '）',
            null, v_delta, public.xp_today());

    insert into public.xp_adjust_audit
      (class, student_name, xp_before, xp_after, delta, reason, operator_uid)
    values (btrim(p_class), btrim(p_student), v_old, v_new, v_delta,
            nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'xp', v_new, 'level', v_level,
                            'delta', v_delta, 'xp_before', v_old);
end;
$$;

revoke execute on function public.set_student_xp(text, text, int, text) from public;
grant  execute on function public.set_student_xp(text, text, int, text) to authenticated;

-- ---------- 4. 差额核准（审查机制：人工确认过的历史差额不再反复误报） ----------
create table if not exists public.xp_diff_ack (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,
  student_name text not null,
  ack_diff     int  not null,
  reason       text,
  active       boolean not null default true,
  operator_uid uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (class, student_name)
);
alter table public.xp_diff_ack enable row level security;
drop policy if exists "xpack teacher all" on public.xp_diff_ack;
create policy "xpack teacher all" on public.xp_diff_ack
  for all to authenticated using (true) with check (true);

create or replace function public.ack_xp_diff(p_class text, p_student text, p_diff int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'teacher_only');
  end if;
  if coalesce(p_diff, 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'zero_diff');
  end if;

  insert into public.xp_diff_ack (class, student_name, ack_diff, reason, active, operator_uid)
  values (btrim(p_class), btrim(p_student), p_diff, nullif(btrim(coalesce(p_reason, '')), ''), true, auth.uid())
  on conflict (class, student_name) do update
     set ack_diff = excluded.ack_diff,
         reason = excluded.reason,
         active = true,
         operator_uid = excluded.operator_uid,
         updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.revoke_xp_diff_ack(p_class text, p_student text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'teacher_only');
  end if;
  update public.xp_diff_ack
     set active = false, updated_at = now()
   where btrim(class) = btrim(p_class) and btrim(student_name) = btrim(p_student);
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.ack_xp_diff(text, text, int, text) from public, anon;
revoke execute on function public.revoke_xp_diff_ack(text, text) from public, anon;
grant  execute on function public.ack_xp_diff(text, text, int, text) to authenticated;
grant  execute on function public.revoke_xp_diff_ack(text, text) to authenticated;

-- ---------- 5. 异常排查 v2 ----------
-- 应得 = 非考试流水 + 考试实发（直接读 exam_score/exam_paper，不依赖流水是否补齐）
--      + 教师手动调整流水
-- 差额 = 当前星光值 − 应得；再减去「已核准差额」得到最终 diff。
-- 这样：考试星光无论有没有入流水，都不会被算成异常（这是本次修复的核心）。
create or replace function public.get_xp_anomalies(p_class text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rows jsonb;
  v_anom int := 0;
  v_acked int := 0;
  v_gap int := 0;
  v_has_exam_log boolean := false;
  v_sources jsonb := '[]'::jsonb;
  v_cls text := btrim(coalesce(p_class, ''));
begin
  with log as (
    select student_name,
           sum(xp)                                                     as log_total,
           sum(case when source = 'exam'   then xp else 0 end)          as exam_log,
           sum(case when source = 'adjust' then xp else 0 end)          as adjust_log,
           sum(case when source not in ('exam', 'adjust') then xp else 0 end) as base_log
      from public.xp_log
     where btrim(class) = v_cls
     group by student_name
  ),
  exam as (
    select student_name, sum(stars) as exam_total
      from (
        select student_name, coalesce(star_awarded, 0) as stars
          from public.exam_score where btrim(class) = v_cls
        union all
        select student_name, coalesce(star_awarded, 0) as stars
          from public.exam_paper where btrim(class) = v_cls
      ) x
     group by student_name
  ),
  judged as (
    select s.student_name,
           coalesce(s.xp, 0) as cur_xp,
           s.level,
           coalesce(l.base_log, 0)   as base_log,
           coalesce(l.exam_log, 0)   as exam_log,
           coalesce(l.adjust_log, 0) as adjust_log,
           coalesce(l.log_total, 0)  as log_total,
           coalesce(e.exam_total, 0) as exam_total,
           greatest(coalesce(e.exam_total, 0) - coalesce(l.exam_log, 0), 0) as exam_gap,
           coalesce(a.ack_diff, 0)   as ack_diff,
           (a.id is not null and a.active) as acked,
           coalesce(s.xp, 0) - (coalesce(l.base_log, 0) + coalesce(e.exam_total, 0) + coalesce(l.adjust_log, 0)) as diff_raw
      from public.student_info s
      left join log  l on l.student_name = s.student_name
      left join exam e on e.student_name = s.student_name
      left join public.xp_diff_ack a
             on btrim(a.class) = v_cls and a.student_name = s.student_name
     where btrim(s.class) = v_cls
  ),
  final as (
    select j.*,
           j.diff_raw - case when j.acked then j.ack_diff else 0 end as diff
      from judged j
  ),
  classified as (
    select f.*,
           case
             when f.acked and f.diff = 0 then 'acked'
             when f.diff > 0 then 'positive'
             when f.diff < 0 then 'negative'
             else 'acked'
           end as kind,
           case
             when f.acked and f.diff = 0
               then '已核准差额 ' || f.ack_diff || '（不计入异常；情况有变可撤销核准）'
             when f.diff_raw > 0
               then '比应得多 ' || f.diff_raw ||
                    case when f.acked then '（差 ' || f.ack_diff || ' 已核准，实际新增 ' || f.diff || '）' else '' end ||
                    '：可能手动调分、删除记录未回退、或外部导入'
             else '比应得少 ' || abs(f.diff_raw) ||
                  case when f.acked then '（差 ' || f.ack_diff || ' 已核准，实际新增 ' || f.diff || '）' else '' end ||
                  '：可能回退过头、手动扣减、或流水重复'
           end as reason
      from final f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'student',    c.student_name,
           'cur_xp',     c.cur_xp,
           'level',      c.level,
           'log_total',  c.log_total,
           'exam_log',   c.exam_log,
           'exam_total', c.exam_total,
           'exam_gap',   c.exam_gap,
           'adjust_total', c.adjust_log,
           'base_total', c.base_log,
           'expected',   c.base_log + c.exam_total + c.adjust_log,
           'diff_raw',   c.diff_raw,
           'diff',       c.diff,
           'acked',      c.acked,
           'ack_diff',   c.ack_diff,
           'kind',       c.kind,
           'reason',     c.reason
         ) order by abs(c.diff) desc, c.student_name), '[]'::jsonb),
         count(*) filter (where c.kind in ('positive', 'negative')),
         count(*) filter (where c.kind = 'acked')
    into v_rows, v_anom, v_acked
    from classified c
   where c.diff <> 0 or (c.kind = 'acked' and c.ack_diff <> 0);

  select count(*) into v_gap
    from (
      select s.student_name,
             greatest(coalesce(e.exam_total, 0) - coalesce(l.exam_log, 0), 0) as gap
        from public.student_info s
        left join (select student_name, sum(case when source = 'exam' then xp else 0 end) as exam_log
                     from public.xp_log where btrim(class) = v_cls group by student_name) l
          on l.student_name = s.student_name
        left join (select student_name, sum(stars) as exam_total from (
                     select student_name, coalesce(star_awarded, 0) as stars from public.exam_score where btrim(class) = v_cls
                     union all
                     select student_name, coalesce(star_awarded, 0) as stars from public.exam_paper where btrim(class) = v_cls
                   ) y group by student_name) e
          on e.student_name = s.student_name
       where btrim(s.class) = v_cls
    ) g
   where g.gap > 0;

  select exists(select 1 from public.xp_log where btrim(class) = v_cls and source = 'exam')
    into v_has_exam_log;
  select coalesce(jsonb_agg(distinct source), '[]'::jsonb)
    into v_sources
    from public.xp_log where btrim(class) = v_cls;

  return jsonb_build_object(
    'rows', coalesce(v_rows, '[]'::jsonb),
    'anomaly_count', coalesce(v_anom, 0),
    'acked_count', coalesce(v_acked, 0),
    'exam_gap_count', coalesce(v_gap, 0),
    'has_exam_log', v_has_exam_log,
    'log_sources', coalesce(v_sources, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_xp_anomalies(text) from public;
grant  execute on function public.get_xp_anomalies(text) to authenticated;

-- ---------- 6. 查流水（补齐此前缺失的定义） ----------
create or replace function public.get_xp_log(p_class text, p_student text)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with l as (
    select record_date, source, label, dim, xp, created_at
      from public.xp_log
     where btrim(class) = btrim(coalesce(p_class, ''))
       and btrim(student_name) = btrim(coalesce(p_student, ''))
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date',   record_date,
               'source', source,
               'label',  label,
               'dim',    dim,
               'xp',     xp
             ) order by record_date nulls last, created_at)
        from l), '[]'::jsonb),
    'total', coalesce((select sum(xp) from l), 0)
  );
$$;

revoke execute on function public.get_xp_log(text, text) from public;
grant  execute on function public.get_xp_log(text, text) to anon, authenticated;

-- ---------- 7. 重建入口：原注入 + 考试补写 ----------
create or replace function public.rebuild_xp_log()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a jsonb;
  v_b jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'teacher_only');
  end if;
  if to_regprocedure('public.inject_xp_log()') is null then
    -- 没有旧注入函数就不敢清表，避免把流水清空
    return jsonb_build_object('ok', false, 'reason', 'inject_missing',
                              'hint', '请先执行 97-xp-log-fix.sql');
  end if;
  -- 表现流水先整体清空再重建：标签改过分/改过名时不会残留两条（旧label + 新label）
  delete from public.xp_log where source = 'daily';
  v_a := public.inject_xp_log();   -- 日常/每日任务/个人/挑战/手动任务
  v_b := public.sync_exam_xp_log(null);
  return jsonb_build_object(
    'ok', true,
    'injected', coalesce((v_a ->> 'injected')::int, 0) + coalesce((v_b ->> 'injected')::int, 0),
    'exam_injected', coalesce((v_b ->> 'injected')::int, 0),
    'exam_cleaned', coalesce((v_b ->> 'cleaned')::int, 0),
    'base_injected', coalesce((v_a ->> 'injected')::int, 0)
  );
end;
$$;

revoke execute on function public.rebuild_xp_log() from public, anon;
grant  execute on function public.rebuild_xp_log() to authenticated;

-- ---------- 8. 标签识别 v2 ----------
-- 与教师端录入上限（0~100）对齐；补维度白名单校验；不再把正常的 31~100 当成误配。
create or replace function public.log_item_anomalies(
  p_class text, p_student text, p_date date, p_source text, p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_it jsonb;
  v_xp int;
  v_label text;
  v_dim text;
begin
  for v_it in
    select e from jsonb_array_elements(
             case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e
     where e is distinct from 'null'::jsonb
  loop
    v_xp := null; v_label := null; v_dim := null;
    select t.xp_value, t.label, nullif(btrim(t.dim), '')
      into v_xp, v_label, v_dim
      from public.behavior_tags t
     where t.id::text = (v_it ->> 'id');

    if not found then
      perform public.log_xp_anomaly(p_class, p_student, p_date, p_source, 'missing_tag',
        '提交的记录引用了已不存在的表现标签（该项未加分，请核对标签是否被删除）',
        jsonb_build_object('tag_id', v_it ->> 'id', 'category', v_it ->> 'category',
                           'label', v_it ->> 'label'));
      continue;
    end if;

    if v_xp is null or v_xp < 0 or v_xp > 100 then
      perform public.log_xp_anomaly(p_class, p_student, p_date, p_source, 'bad_xp_value',
        '标签星光值超出 0~100 合法区间（当前 ' || coalesce(v_xp::text, '空') || '），请到「标签管理」修正',
        jsonb_build_object('tag_id', v_it ->> 'id', 'label', v_label, 'xp_value', v_xp));
    end if;

    if v_dim is not null and v_dim not in ('de', 'zhi', 'ti', 'mei', 'lao') then
      perform public.log_xp_anomaly(p_class, p_student, p_date, p_source, 'bad_dim',
        '标签五维配置非法（应为 德/智/体/美/劳，当前「' || v_dim || '」），已按"智"计',
        jsonb_build_object('tag_id', v_it ->> 'id', 'label', v_label, 'dim', v_dim));
    end if;
  end loop;
end;
$$;

revoke execute on function public.log_item_anomalies(text, text, date, text, jsonb) from public, anon;
grant  execute on function public.log_item_anomalies(text, text, date, text, jsonb) to authenticated;

-- ---------- 9. 提交链路：统一算分 + 去重清洗 ----------
create or replace function public.record_items_agg(p_items jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_it jsonb;
  v_xp int; v_dim text;
  v_sum int := 0;
  v_de int := 0; v_zhi int := 0; v_ti int := 0; v_mei int := 0; v_lao int := 0;
begin
  for v_it in
    select e from jsonb_array_elements(
             case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e
     where e is distinct from 'null'::jsonb
  loop
    v_xp := null; v_dim := null;
    select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi')
      into v_xp, v_dim
      from public.behavior_tags t
     where t.id::text = (v_it ->> 'id');
    if not found then
      v_xp := case when (v_it ->> 'category') = 'negative' then 0 else 2 end;
      v_dim := 'zhi';
    end if;
    v_xp := coalesce(v_xp, 0);
    if v_dim not in ('de', 'zhi', 'ti', 'mei', 'lao') then v_dim := 'zhi'; end if;

    v_sum := v_sum + v_xp;
    case v_dim
      when 'de'  then v_de  := v_de  + v_xp;
      when 'ti'  then v_ti  := v_ti  + v_xp;
      when 'mei' then v_mei := v_mei + v_xp;
      when 'lao' then v_lao := v_lao + v_xp;
      else            v_zhi := v_zhi + v_xp;
    end case;
  end loop;
  return jsonb_build_object('xp', v_sum, 'de', v_de, 'zhi', v_zhi,
                            'ti', v_ti, 'mei', v_mei, 'lao', v_lao);
end;
$$;

comment on function public.record_items_agg(jsonb)
  is '一组表现项应得星光值（总+五维），全链路唯一算分口径';

-- 过滤：未知标签丢弃（并上报）、同一标签只保留最后一次提交
create or replace function public.record_items_clean(
  p_items jsonb, p_class text, p_student text, p_date date, p_source text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_it jsonb;
  v_tid text;
  v_out jsonb := '[]'::jsonb;
  v_drop jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
begin
  for v_it in
    select e from jsonb_array_elements(
             case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
                  with ordinality as t(e, ord)
     where e is distinct from 'null'::jsonb
     order by ord desc
  loop
    v_tid := nullif(btrim(coalesce(v_it ->> 'id', '')), '');
    if v_tid is null then
      v_drop := v_drop || jsonb_build_array(v_it);
      continue;
    end if;
    if not exists (select 1 from public.behavior_tags t where t.id::text = v_tid) then
      v_drop := v_drop || jsonb_build_array(v_it);
      perform public.log_xp_anomaly(p_class, p_student, p_date, p_source, 'missing_tag',
        '提交的记录引用了已不存在的表现标签（该项已忽略、未加分）',
        jsonb_build_object('tag_id', v_tid, 'label', v_it ->> 'label',
                           'category', v_it ->> 'category'));
      continue;
    end if;
    if v_tid = any(v_seen) then
      v_drop := v_drop || jsonb_build_array(v_it);
      continue;
    end if;
    v_seen := v_seen || v_tid;
    v_out := jsonb_build_array(v_it) || v_out;   -- 逆序读、正序出
  end loop;
  return jsonb_build_object('items', v_out, 'dropped', v_drop,
                            'dropped_count', jsonb_array_length(v_drop));
end;
$$;

revoke execute on function public.record_items_clean(jsonb, text, text, date, text) from public, anon;
grant  execute on function public.record_items_clean(jsonb, text, text, date, text) to authenticated;

-- ---------- 9b. 表现记录 → 流水（教师端直接补录也能对上账） ----------
-- 教师后台「表现记录」是直接 insert daily_record，102 号的流水重建只在 UPDATE/DELETE 分支，
-- 新增记录因此没有流水 → 第二天一扫描就是"偏多"。这里补齐 INSERT/UPDATE 两条路径。
create or replace function public.daily_record_xp_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_items jsonb;
  v_it jsonb;
  v_xp int;
  v_dim text;
  v_lbl text;
begin
  if tg_op = 'DELETE' then
    delete from public.xp_log where source = 'daily' and ref_id = old.id;
    return old;
  end if;

  v_items := case when jsonb_typeof(new.behavior -> 'items') = 'array'
                  then new.behavior -> 'items' else '[]'::jsonb end;

  delete from public.xp_log where source = 'daily' and ref_id = new.id;

  for v_it in select e from jsonb_array_elements(v_items) e
              where e is distinct from 'null'::jsonb
  loop
    v_xp := null; v_dim := 'zhi'; v_lbl := v_it ->> 'id';
    select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi'), t.label
      into v_xp, v_dim, v_lbl
      from public.behavior_tags t
     where t.id::text = (v_it ->> 'id');
    if v_xp is null then
      v_xp := case when (v_it ->> 'category') = 'negative' then 0 else 2 end;
      v_dim := 'zhi';
    end if;
    if v_dim not in ('de', 'zhi', 'ti', 'mei', 'lao') then v_dim := 'zhi'; end if;
    if coalesce(v_xp, 0) > 0 then
      insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
      values (new.class, new.student_name, 'daily', new.id,
              v_lbl || case when coalesce(v_it ->> 'value', '') <> '' then '：' || (v_it ->> 'value') else '' end,
              v_dim, v_xp, new.record_date)
      on conflict (source, ref_id, label) do update set xp = excluded.xp, dim = excluded.dim;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_daily_record_xp_log_ins on public.daily_record;
drop trigger if exists trg_daily_record_xp_log_upd on public.daily_record;
create trigger trg_daily_record_xp_log_ins
  after insert on public.daily_record
  for each row execute function public.daily_record_xp_log();
create trigger trg_daily_record_xp_log_upd
  after update on public.daily_record
  for each row execute function public.daily_record_xp_log();

-- ---------- 10. submit_today v3 ----------
create or replace function public.submit_today(p_class text, p_student text, p_mood text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := public.xp_today();
  v_sem text := case
    when to_char(v_today, 'MM-DD') >= '09-01' then to_char(v_today, 'YYYY') || '秋'
    when to_char(v_today, 'MM-DD') >= '01-08' then to_char(v_today, 'YYYY') || '春'
    else to_char(v_today - interval '1 year', 'YYYY') || '秋'
  end;
  v_sid uuid;
  v_xp int; v_xp_before int;
  v_old public.daily_record%rowtype;
  v_old_items jsonb;
  v_clean jsonb; v_items jsonb;
  v_dropped int := 0;
  v_merged jsonb;
  v_old_agg jsonb; v_new_agg jsonb;
  v_delta int;
  v_it jsonb; v_tag_xp int; v_dim2 text; v_lbl text;
  v_unique boolean;
  v_rec_id uuid;
begin
  -- 事务级锁：同一学生同一天串行（行锁在"还没记录"时锁不住，必须用 advisory lock）
  perform pg_advisory_xact_lock(hashtext('submit_today:' || btrim(p_class) || ':' || btrim(p_student)));

  select id, xp into v_sid, v_xp
    from public.student_info
   where btrim(class) = btrim(p_class) and btrim(student_name) = btrim(p_student)
   limit 1 for update;
  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  -- 清洗：去 null / 丢未知标签 / 同标签只留最后一次
  v_clean := public.record_items_clean(p_items, btrim(p_class), btrim(p_student), v_today, 'daily');
  v_items := v_clean -> 'items';
  v_dropped := coalesce((v_clean ->> 'dropped_count')::int, 0);

  -- 历史唯一标签：同标签同取值历史上打过就跳过
  select coalesce(jsonb_agg(it), '[]'::jsonb) into v_items
    from jsonb_array_elements(v_items) it
   where not exists (
           select 1
             from public.behavior_tags bt
            where bt.id::text = (it ->> 'id')
              and bt.history_unique is not false
              and exists (
                    select 1 from public.daily_record dr,
                           lateral jsonb_array_elements(
                             case when jsonb_typeof(dr.behavior -> 'items') = 'array'
                                  then dr.behavior -> 'items' else '[]'::jsonb end) di
                     where btrim(dr.class) = btrim(p_class)
                       and btrim(dr.student_name) = btrim(p_student)
                       and di ->> 'id' = (it ->> 'id')
                       and di ->> 'value' = (it ->> 'value')
                  )
         );

  if coalesce(jsonb_array_length(v_items), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_items', 'dropped', v_dropped);
  end if;

  -- 标签体检（区间/维度/已删除）：两条路径都记，便于事后追查
  perform public.log_item_anomalies(btrim(p_class), btrim(p_student), v_today, 'daily', v_items);

  select * into v_old
    from public.daily_record
   where btrim(class) = btrim(p_class) and btrim(student_name) = btrim(p_student)
     and record_date = v_today;

  if v_old.id is not null then
    v_old_items := case when jsonb_typeof(v_old.behavior -> 'items') = 'array'
                        then v_old.behavior -> 'items' else '[]'::jsonb end;

    -- 合并口径：同一标签以本次提交为准（替换），不同标签追加。
    -- 原来的 distinct 只去"完全相同的对象"，同标签不同取值会并存 → 重复加分。
    select coalesce(jsonb_agg(it), '[]'::jsonb) into v_merged
      from (
        select it from jsonb_array_elements(v_old_items) it
         where it is distinct from 'null'::jsonb
           and coalesce(it ->> 'id', '') not in (
                 select coalesce(n ->> 'id', '') from jsonb_array_elements(v_items) n)
        union all
        select it from jsonb_array_elements(v_items) it
      ) x;

    v_old_agg := public.record_items_agg(v_old_items);
    v_new_agg := public.record_items_agg(v_merged);
    v_delta := coalesce((v_new_agg ->> 'xp')::int, 0) - coalesce((v_old_agg ->> 'xp')::int, 0);

    perform set_config('app.skip_record_xp', 'on', true);
    update public.daily_record
       set behavior = jsonb_build_object('mood', p_mood, 'items', v_merged),
           semester = coalesce(v_old.semester, v_sem),
           create_at = now()
     where id = v_old.id
    returning id into v_rec_id;
    perform set_config('app.skip_record_xp', 'off', true);

    if v_delta <> 0 then
      update public.student_info
         set xp     = greatest(0, coalesce(xp, 0) + v_delta),
             xp_de  = greatest(0, coalesce(xp_de, 0)  + (coalesce((v_new_agg ->> 'de')::int, 0)  - coalesce((v_old_agg ->> 'de')::int, 0))),
             xp_zhi = greatest(0, coalesce(xp_zhi, 0) + (coalesce((v_new_agg ->> 'zhi')::int, 0) - coalesce((v_old_agg ->> 'zhi')::int, 0))),
             xp_ti  = greatest(0, coalesce(xp_ti, 0)  + (coalesce((v_new_agg ->> 'ti')::int, 0)  - coalesce((v_old_agg ->> 'ti')::int, 0))),
             xp_mei = greatest(0, coalesce(xp_mei, 0) + (coalesce((v_new_agg ->> 'mei')::int, 0) - coalesce((v_old_agg ->> 'mei')::int, 0))),
             xp_lao = greatest(0, coalesce(xp_lao, 0) + (coalesce((v_new_agg ->> 'lao')::int, 0) - coalesce((v_old_agg ->> 'lao')::int, 0))),
             level  = public.level_from_xp(greatest(0, coalesce(xp, 0) + v_delta))
       where id = v_sid
      returning xp into v_xp;
    end if;

    -- 重建当天流水：先清后写（旧写法只 upsert，删掉的标签会留孤儿流水 → 长期"偏少"误报）
    delete from public.xp_log where source = 'daily' and ref_id = v_rec_id;
    for v_it in select e from jsonb_array_elements(v_merged) e where e is distinct from 'null'::jsonb loop
      v_tag_xp := null; v_dim2 := 'zhi'; v_lbl := v_it ->> 'id';
      select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi'), t.label
        into v_tag_xp, v_dim2, v_lbl
        from public.behavior_tags t where t.id::text = (v_it ->> 'id');
      if v_tag_xp is null then
        v_tag_xp := case when (v_it ->> 'category') = 'negative' then 0 else 2 end;
        v_dim2 := 'zhi';
      end if;
      if coalesce(v_tag_xp, 0) > 0 then
        insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
        values (btrim(p_class), btrim(p_student), 'daily', v_rec_id,
                v_lbl || case when coalesce(v_it ->> 'value', '') <> '' then '：' || (v_it ->> 'value') else '' end,
                v_dim2, v_tag_xp, v_today)
        on conflict (source, ref_id, label) do update set xp = excluded.xp, dim = excluded.dim;
      end if;
    end loop;

    return jsonb_build_object('ok', true, 'merged', true, 'xp_delta', v_delta,
                              'xp', v_xp, 'level', public.level_from_xp(v_xp),
                              'dropped', v_dropped);
  end if;

  -- 新增路径：INSERT 触发器按同口径加分，这里只做增量校验 + 写流水
  v_new_agg := public.record_items_agg(v_items);
  v_xp_before := v_xp;

  insert into public.daily_record (class, student_name, record_date, semester, self_evaluation, behavior)
  values (btrim(p_class), btrim(p_student), v_today, v_sem, null,
          jsonb_build_object('mood', p_mood, 'items', v_items))
  returning id into v_rec_id;

  select xp into v_xp from public.student_info where id = v_sid;

  if (v_xp - v_xp_before) <> coalesce((v_new_agg ->> 'xp')::int, 0) then
    perform public.log_xp_anomaly(btrim(p_class), btrim(p_student), v_today, 'daily', 'xp_mismatch',
      '提交后星光值增量与表现项应得不符（疑似加分链路异常：双计或漏计）',
      jsonb_build_object('expected', coalesce((v_new_agg ->> 'xp')::int, 0),
                         'actual', v_xp - v_xp_before, 'record_id', v_rec_id));
  end if;

  for v_it in select e from jsonb_array_elements(v_items) e where e is distinct from 'null'::jsonb loop
    v_tag_xp := null; v_dim2 := 'zhi'; v_lbl := v_it ->> 'id';
    select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi'), t.label
      into v_tag_xp, v_dim2, v_lbl
      from public.behavior_tags t where t.id::text = (v_it ->> 'id');
    if v_tag_xp is null then
      v_tag_xp := case when (v_it ->> 'category') = 'negative' then 0 else 2 end;
      v_dim2 := 'zhi';
    end if;
    if coalesce(v_tag_xp, 0) > 0 then
      insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
      values (btrim(p_class), btrim(p_student), 'daily', v_rec_id,
              v_lbl || case when coalesce(v_it ->> 'value', '') <> '' then '：' || (v_it ->> 'value') else '' end,
              v_dim2, v_tag_xp, v_today)
      on conflict (source, ref_id, label) do update set xp = excluded.xp, dim = excluded.dim;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'merged', false,
                            'xp_delta', coalesce((v_new_agg ->> 'xp')::int, 0),
                            'xp', v_xp, 'level', public.level_from_xp(v_xp),
                            'dropped', v_dropped);
end;
$function$;

-- 学生端是匿名访问（无登录态），必须同时授权 anon。
-- 93/100/101/102 曾把 anon 收回，若线上是那套权限，学生会"提交失败但界面像成功"。
revoke execute on function public.submit_today(text, text, text, jsonb) from public;
grant  execute on function public.submit_today(text, text, text, jsonb) to anon, authenticated;

-- ---------- 11. submit_task v2：归属校验 + 评级锁定 + 事务锁 ----------
alter table public.task_submission add column if not exists graded_by  uuid;
alter table public.task_submission add column if not exists graded_at  timestamptz;

create or replace function public.submit_task(
  p_class   text,
  p_student text,
  p_task_id uuid,
  p_grade   text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.daily_task%rowtype;
  v_old  public.task_submission%rowtype;
  v_old_xp int := 0;
  v_new_xp int;
  v_delta int;
  v_mood boolean;
  v_sid uuid;
  v_xp int;
  v_level int;
  v_claims jsonb;
  v_is_teacher boolean := false;
begin
  if p_grade not in ('none', 'done', 'good', 'perfect') then
    return jsonb_build_object('ok', false, 'reason', 'bad_grade');
  end if;

  -- 事务级锁：连点两次 / 两个设备同时提交，第二笔等第一笔提交完再算差额
  perform pg_advisory_xact_lock(hashtext('submit_task:' || p_task_id::text || ':' || btrim(p_student)));

  select * into v_task from public.daily_task where id = p_task_id;
  if v_task.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_task');
  end if;

  -- 任务归属：不能拿别的班的任务 id 给本班学生加分
  if nullif(btrim(v_task.class), '') is not null
     and btrim(v_task.class) <> btrim(p_class) then
    return jsonb_build_object('ok', false, 'reason', 'class_mismatch');
  end if;

  -- 未来任务不能提前提交（离线队列补传历史任务不受影响）
  if v_task.task_date is not null and v_task.task_date > public.xp_today() then
    return jsonb_build_object('ok', false, 'reason', 'future_task');
  end if;

  select id, xp into v_sid, v_xp
    from public.student_info
   where btrim(class) = btrim(p_class) and btrim(student_name) = btrim(p_student);
  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_is_teacher := (v_claims ->> 'role') = 'authenticated'
                  and not coalesce((v_claims ->> 'is_anonymous')::boolean, false);

  select * into v_old
    from public.task_submission
   where task_id = p_task_id and student_name = btrim(p_student);

  -- 状态控制：老师已评定的档位，学生端不允许再自行改（防"交完再改"绕过审核）
  if v_old.id is not null and not v_is_teacher
     and v_old.graded_by is not null and v_old.grade <> p_grade then
    return jsonb_build_object('ok', false, 'reason', 'graded_locked',
                              'grade', v_old.grade, 'xp', v_xp);
  end if;

  v_old_xp := coalesce(v_old.xp_awarded, 0);
  v_new_xp := public.task_grade_xp(p_grade);
  v_delta  := v_new_xp - v_old_xp;
  v_mood   := (p_grade <> 'none');

  insert into public.task_submission
    (task_id, class, student_name, grade, xp_awarded, mood_awarded, graded_by, graded_at)
  values
    (p_task_id, btrim(p_class), btrim(p_student), p_grade, v_new_xp, v_mood,
     case when v_is_teacher then auth.uid() end,
     case when v_is_teacher then now() end)
  on conflict (task_id, student_name) do update
     set grade = excluded.grade,
         xp_awarded = excluded.xp_awarded,
         mood_awarded = excluded.mood_awarded,
         graded_by = coalesce(excluded.graded_by, public.task_submission.graded_by),
         graded_at = coalesce(excluded.graded_at, public.task_submission.graded_at),
         update_at = now();

  if v_delta <> 0 then
    update public.student_info
       set xp = greatest(0, coalesce(xp, 0) + v_delta),
           level = public.level_from_xp(greatest(0, coalesce(xp, 0) + v_delta))
     where id = v_sid
    returning xp, level into v_xp, v_level;
  else
    v_level := public.level_from_xp(v_xp);
  end if;

  return jsonb_build_object('ok', true, 'grade', p_grade, 'xp_delta', v_delta,
                            'xp', v_xp, 'level', v_level, 'mood_awarded', v_mood);
end;
$$;

revoke execute on function public.submit_task(text, text, uuid, text) from public;
grant  execute on function public.submit_task(text, text, uuid, text) to anon, authenticated;

-- ---------- 12. 挑战任务：同一档位不允许重复入库 ----------
create or replace function public.chsub_dedupe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from public.challenge_submission s
     where s.challenge_id = new.challenge_id
       and btrim(s.student_name) = btrim(new.student_name)
       and s.status = 'active'
       and s.levels = new.levels
  ) then
    raise exception '该档位已提交过，请勿重复提交' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chsub_dedupe on public.challenge_submission;
create trigger trg_chsub_dedupe
  before insert on public.challenge_submission
  for each row execute function public.chsub_dedupe();

-- ---------- 12b. 单张试卷：同一张图不允许重复录入 ----------
-- 试卷是"每份一条"，没有天然唯一键；连点两次保存会生成两份并各发一次星光。
-- 同一份上传的 image_url 相同，据此拦住重复提交。
create or replace function public.exam_paper_dedupe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.image_url is not null and btrim(new.image_url) <> '' then
    if exists (
      select 1 from public.exam_paper p
       where btrim(p.class) = btrim(new.class)
         and btrim(p.student_name) = btrim(new.student_name)
         and p.image_url = new.image_url
    ) then
      raise exception '这份试卷已经录入过，请勿重复提交' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_exam_paper_dedupe on public.exam_paper;
create trigger trg_exam_paper_dedupe
  before insert on public.exam_paper
  for each row execute function public.exam_paper_dedupe();

-- ---------- 13. 一键重算：把手动调整算回去 ----------
-- recalc_all_xp 只按业务来源重算（会影响 xp 清零后重加），
-- 若不把手动调整补回来，重算一次就会凭空少掉这部分星光值，又被判成"偏少"。
do $$
begin
  if to_regprocedure('public.recalc_all_xp_core()') is null
     and to_regprocedure('public.recalc_all_xp()') is not null then
    execute 'alter function public.recalc_all_xp() rename to recalc_all_xp_core';
  end if;
end $$;

create or replace function public.recalc_all_xp()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_res jsonb;
  v_cnt int := 0;
begin
  if to_regprocedure('public.recalc_all_xp_core()') is null then
    return jsonb_build_object('ok', false, 'reason', 'core_missing');
  end if;

  v_res := public.recalc_all_xp_core();

  with adj as (
    select class, student_name, sum(xp) as dx
      from public.xp_log
     where source = 'adjust'
     group by class, student_name
  )
  update public.student_info s
     set xp    = greatest(0, coalesce(s.xp, 0) + a.dx),
         level = public.level_from_xp(greatest(0, coalesce(s.xp, 0) + a.dx))
    from adj a
   where btrim(s.class) = btrim(a.class)
     and btrim(s.student_name) = btrim(a.student_name)
     and a.dx <> 0;
  get diagnostics v_cnt = row_count;

  return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('adjust_applied', coalesce(v_cnt, 0));
end;
$$;

revoke execute on function public.recalc_all_xp() from anon;
grant  execute on function public.recalc_all_xp() to authenticated;

-- ---------- 14. 授权与缓存刷新 ----------
revoke execute on function public.sync_exam_xp_log(text) from public, anon;
grant  execute on function public.sync_exam_xp_log(text) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- 自检（需要时取消注释逐条执行）：
--
-- ① 考试星光是否已进流水（应等于 exam_score.star_awarded 合计）
-- select (select coalesce(sum(star_awarded),0) from exam_score where class='六年级一班') as 成绩单应发,
--        (select coalesce(sum(xp),0) from xp_log where class='六年级一班' and source='exam') as 流水已记;
--
-- ② 补写历史 + 重建
-- select public.rebuild_xp_log();
--
-- ③ 异常排查（anomaly_count 应为 0 或只剩真实差额）
-- select public.get_xp_anomalies('六年级一班');
-- ============================================================================
