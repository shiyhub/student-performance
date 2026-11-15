-- ============================================================
-- 120-record-undo-restore.sql
-- v179：教师端「撤销 / 恢复」记录
--
-- 背景：学生端不再设身份校验关卡（40 人共用一台教室白板，效率优先），
--       误填、错人填报、重复提交的兜底改由教师端撤销/恢复承担。
--
-- 设计：
--   撤销 = 快照入库 + 物理删除。
--     删除走的仍是既有路径（AFTER DELETE 触发器 apply_record_xp/102 号），
--     所以经验、五维、星光值、xp_log 流水都会按原逻辑回退，口径零改动。
--   恢复 = 快照原样 INSERT 回 daily_record（含原 id / 原 create_at）。
--     插入触发 AFTER INSERT，经验、五维、星光值、流水按同一套逻辑重新加上，
--     等价于「这条记录从未被删过」。
--
-- 幂等：同一 undo_id 重复恢复 → 第二次返回 already_restored，不重复加分。
-- 权限：三支 RPC 均 security definer，只授 authenticated（教师登录态）。
-- 可重复执行。
-- ============================================================

-- ------------------------------------------------------------
-- ① 撤销快照表
-- ------------------------------------------------------------
create table if not exists public.record_undo (
  id           uuid primary key default gen_random_uuid(),
  record_id    uuid not null,
  class        text not null,
  student_name text not null,
  record_date  date not null,
  snapshot     jsonb not null,
  xp_delta     int  not null default 0,
  reason       text,
  restored_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_record_undo_lookup
  on public.record_undo (class, created_at desc);

comment on table public.record_undo is
  '教师撤销的表现记录快照：恢复时按 snapshot 原样插回 daily_record，经验/五维/星光由触发器自动还原';

-- 只经 RPC 访问：开 RLS 且不建任何策略（anon/authenticated 直连一律空）
alter table public.record_undo enable row level security;
revoke all on table public.record_undo from anon, authenticated;

-- ------------------------------------------------------------
-- ② 撤销一条记录
-- ------------------------------------------------------------
create or replace function public.teacher_undo_record(
  p_record_id uuid,
  p_reason    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rec     public.daily_record%rowtype;
  v_it      record;
  v_tag     int;
  v_xp      int := 0;
  v_undo_id uuid;
begin
  select * into v_rec from public.daily_record where id = p_record_id;
  if v_rec.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- 这条记录带来的经验（与 apply_record_xp 同口径：标签分值，缺失按 +2 / 负向 0）
  for v_it in
    select e ->> 'id' as tag_id, e ->> 'category' as category
      from jsonb_array_elements(
             case when jsonb_typeof(v_rec.behavior -> 'items') = 'array'
                  then v_rec.behavior -> 'items' else '[]'::jsonb end) e
     where e is distinct from 'null'::jsonb
  loop
    select t.xp_value into v_tag from public.behavior_tags t where t.id::text = v_it.tag_id;
    if v_tag is null then
      v_tag := case when v_it.category = 'negative' then 0 else 2 end;
    end if;
    v_xp := v_xp + coalesce(v_tag, 0);
  end loop;

  insert into public.record_undo(record_id, class, student_name, record_date, snapshot, xp_delta, reason)
  values (v_rec.id, v_rec.class, v_rec.student_name, v_rec.record_date, to_jsonb(v_rec), v_xp,
          nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_undo_id;

  -- 物理删除：触发器回退经验/五维/星光并清流水
  delete from public.daily_record where id = v_rec.id;

  return jsonb_build_object(
    'ok', true,
    'undo_id', v_undo_id,
    'student_name', v_rec.student_name,
    'class', v_rec.class,
    'record_date', v_rec.record_date,
    'xp_refunded', v_xp
  );
end;
$function$;

-- ------------------------------------------------------------
-- ③ 恢复（按快照插回，触发器自动加分）
-- ------------------------------------------------------------
create or replace function public.teacher_restore_record(p_undo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_u   public.record_undo%rowtype;
  v_rec public.daily_record%rowtype;
  v_sid uuid;
begin
  select * into v_u from public.record_undo where id = p_undo_id for update;
  if v_u.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_u.restored_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_restored');
  end if;

  -- 记录已存在（同一 id 被手工补回）→ 只标记，不再插入，避免主键冲突
  if exists (select 1 from public.daily_record where id = v_u.record_id) then
    update public.record_undo set restored_at = now() where id = v_u.id;
    return jsonb_build_object('ok', true, 'already_exists', true, 'student_name', v_u.student_name);
  end if;

  -- 撤销期间该生当天已重新提交 → 恢复会产生"同一天两条记录"（submit_today 按天合并会取错）
  -- 这种情形交给老师二选一：要么保留新记录，要么先撤销新的再恢复旧的
  if exists (
    select 1 from public.daily_record
     where btrim(class) = btrim(v_u.class)
       and btrim(student_name) = btrim(v_u.student_name)
       and record_date = v_u.record_date
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_day');
  end if;

  -- 学生已被删除时插回会产生"孤儿记录"，直接拦下
  select id into v_sid from public.student_info
   where btrim(class) = btrim(v_u.class) and btrim(student_name) = btrim(v_u.student_name)
   limit 1;
  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  v_rec := jsonb_populate_record(null::public.daily_record, v_u.snapshot);

  insert into public.daily_record
    (id, student_name, class, record_date, self_evaluation, behavior, teacher_comment, create_at, semester)
  values
    (v_rec.id, v_rec.student_name, v_rec.class, v_rec.record_date, v_rec.self_evaluation,
     v_rec.behavior, v_rec.teacher_comment, v_rec.create_at, v_rec.semester);

  update public.record_undo set restored_at = now() where id = v_u.id;

  return jsonb_build_object(
    'ok', true,
    'student_name', v_u.student_name,
    'class', v_u.class,
    'record_date', v_u.record_date,
    'xp_restored', v_u.xp_delta
  );
end;
$function$;

-- ------------------------------------------------------------
-- ④ 最近撤销列表（教师端「最近撤销」面板）
-- ------------------------------------------------------------
create or replace function public.teacher_list_record_undo(
  p_class text default null,
  p_limit int  default 20
)
returns jsonb
language sql
security definer
set search_path = public
as $function$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    from (
      select u.id as undo_id,
             u.record_id,
             u.class,
             u.student_name,
             u.record_date,
             u.xp_delta,
             u.reason,
             u.created_at,
             u.restored_at,
             coalesce(u.snapshot -> 'behavior' ->> 'mood', '') as mood,
             coalesce((
               select jsonb_agg(jsonb_build_object('label', e ->> 'label', 'value', e ->> 'value'))
                 from jsonb_array_elements(
                        case when jsonb_typeof(u.snapshot -> 'behavior' -> 'items') = 'array'
                             then u.snapshot -> 'behavior' -> 'items' else '[]'::jsonb end) e
                where e is distinct from 'null'::jsonb
             ), '[]'::jsonb) as items
        from public.record_undo u
       where p_class is null or btrim(p_class) = '' or u.class = p_class
       order by u.created_at desc
       limit greatest(1, least(coalesce(p_limit, 20), 100))
    ) x;
$function$;

-- ------------------------------------------------------------
-- ⑤ 授权：只给教师登录态
-- ------------------------------------------------------------
revoke execute on function public.teacher_undo_record(uuid, text)       from public, anon;
revoke execute on function public.teacher_restore_record(uuid)          from public, anon;
revoke execute on function public.teacher_list_record_undo(text, int)   from public, anon;
grant  execute on function public.teacher_undo_record(uuid, text)       to authenticated;
grant  execute on function public.teacher_restore_record(uuid)          to authenticated;
grant  execute on function public.teacher_list_record_undo(text, int)   to authenticated;

-- ------------------------------------------------------------
-- 自检（在 SQL Editor 里单独跑）
-- ------------------------------------------------------------
-- ① 撤销一条今天的记录（换成真实 id）：
--    select public.teacher_undo_record('<记录id>', '测试');
--    -- 期望：ok=true，daily_record 少一条，student_info.xp 减少 xp_refunded，xp_log 对应流水已清
-- ② 看最近撤销：
--    select public.teacher_list_record_undo(null, 10);
-- ③ 恢复：
--    select public.teacher_restore_record('<undo_id>');
--    -- 期望：ok=true，记录回到 daily_record（id/日期/时间不变），xp 加回
--    select public.teacher_restore_record('<undo_id>');  -- 第二次：ok=false, reason=already_restored
-- ④ 对账：撤销+恢复一轮后，学生经验应回到撤销前
--    select student_name, xp, xp_de, xp_zhi, xp_ti, xp_mei, xp_lao
--      from public.student_info where class = '<班级>' and student_name = '<姓名>';
