-- ============================================================
-- 93-xp-precision.sql
-- v154：经验值计算精确性加固（现有功能不变，纯增强）
-- 内容：
--   ① 并发防重：日常/挑战/个人三个提交函数加行锁（FOR UPDATE），
--      避免「连点/多端同时提交」时两个请求同时读到旧状态 → 重复加分双计
--   ② 实时经验流水：加分的同时写入 xp_log（幂等 upsert），
--      使「学生当前经验 = 经验流水合计」恒成立，教师端全班日志 diff 恒为 0，可对账
-- 前提：需先执行 90（异常区/新版加分函数）、92（清理旧触发器、收敛等级）。
--       本文件自带 xp_log 表兜底（若 87 号已执行则跳过）。
-- 可重复执行。
-- ============================================================

-- ---------- 0) 经验流水表兜底（与 87 号同结构，幂等） ----------
create table if not exists public.xp_log (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,
  student_name text not null,
  source       text not null,          -- daily/task/personal/challenge/manual
  ref_id       uuid,                   -- 来源记录 id（可追溯原记录）
  label        text,                   -- 说明（标签名/任务标题/任务内容）
  dim          text,                   -- de/zhi/ti/mei/lao（任务渠道为 null，不进五维）
  xp           int  not null,          -- 真实经验值（仅记加分项，0 分项不记）
  record_date  date,                   -- 发生日期
  note         text,                   -- 备注
  created_at   timestamptz not null default now(),
  unique (source, ref_id, label)       -- 幂等：同一来源记录不重复记流水
);
create index if not exists idx_xp_log_stu on public.xp_log (class, student_name, record_date);
alter table public.xp_log enable row level security;
drop policy if exists "xplog teacher all" on public.xp_log;
create policy "xplog teacher all" on public.xp_log for all to authenticated using (true) with check (true);
drop policy if exists "xplog anon select" on public.xp_log;
create policy "xplog anon select" on public.xp_log for select to anon using (true);

-- ============================================================
-- ① submit_today：加行锁（并发提交同一学生串行化，杜绝重复加分）+ 实时流水
-- ============================================================
create or replace function public.submit_today(p_class text, p_student text, p_mood text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_sem text := case
    when to_char(v_today,'MM-DD') >= '09-01' then to_char(v_today,'YYYY') || '秋'
    when to_char(v_today,'MM-DD') >= '01-08' then to_char(v_today,'YYYY') || '春'
    else to_char(v_today - interval '1 year','YYYY') || '秋'
  end;
  v_sid uuid; v_xp int; v_xp_before int; v_old public.daily_record%rowtype;
  v_old_xp int := 0; v_new_xp int; v_delta int; v_merged jsonb; v_it jsonb; v_tag_xp int; v_dim text; v_rec_id uuid;
  v_items jsonb := '[]'::jsonb; v_unique boolean;
  v_old_de int := 0; v_old_zhi int := 0; v_old_ti int := 0; v_old_mei int := 0; v_old_lao int := 0;
  v_new_de int := 0; v_new_zhi int := 0; v_new_ti int := 0; v_new_mei int := 0; v_new_lao int := 0;
  v_lbl text; v_dim2 text;
begin
  -- 加行锁：同一学生当天提交串行化（防并发双计）
  select id, xp into v_sid, v_xp from public.student_info
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) limit 1 for update;
  if v_sid is null then return jsonb_build_object('ok',false,'reason','no_student'); end if;
  p_items := coalesce(p_items,'[]'::jsonb);
  for v_it in select * from jsonb_array_elements(p_items) loop
    select bt.history_unique is not false into v_unique
      from public.behavior_tags bt where bt.id::text=(v_it->>'id');
    if coalesce(v_unique, false) then
      if exists (
        select 1 from public.daily_record dr,
             lateral jsonb_array_elements(coalesce(dr.behavior->'items','[]'::jsonb)) di
         where dr.class = btrim(p_class)
           and dr.student_name = btrim(p_student)
           and di->>'id' = (v_it->>'id')
           and di->>'value' = (v_it->>'value')
      ) then
        continue;
      end if;
    end if;
    v_items := v_items || jsonb_build_array(v_it);
  end loop;
  p_items := v_items;
  select * into v_old from public.daily_record
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) and record_date=v_today;
  if v_old.id is not null then
    -- 合并路径：先检测提交项异常（标签已删/经验值误配）
    perform public.log_item_anomalies(btrim(p_class), btrim(p_student), v_today, 'daily', p_items);
    for v_it in select * from jsonb_array_elements(coalesce(v_old.behavior->'items','[]'::jsonb)) loop
      v_tag_xp := null;
      select xp_value into v_tag_xp from public.behavior_tags where id::text=(v_it->>'id');
      if v_tag_xp is null then v_tag_xp := case when (v_it->>'category')='negative' then 0 else 2 end; end if;
      v_old_xp := v_old_xp + coalesce(v_tag_xp,0);
      v_dim := null;
      select coalesce(nullif(dim,''),'zhi') into v_dim from public.behavior_tags where id::text=(v_it->>'id');
      if v_dim is null then v_dim := 'zhi'; end if;
      case v_dim
        when 'de'  then v_old_de  := v_old_de  + coalesce(v_tag_xp,0);
        when 'ti'  then v_old_ti  := v_old_ti  + coalesce(v_tag_xp,0);
        when 'mei' then v_old_mei := v_old_mei + coalesce(v_tag_xp,0);
        when 'lao' then v_old_lao := v_old_lao + coalesce(v_tag_xp,0);
        else            v_old_zhi := v_old_zhi + coalesce(v_tag_xp,0);
      end case;
    end loop;
    v_merged := coalesce(v_old.behavior->'items','[]'::jsonb) || p_items;
    select jsonb_agg(distinct it) into v_merged from (select it from jsonb_array_elements(v_merged) it) x;
    v_new_xp := 0;
    for v_it in select * from jsonb_array_elements(v_merged) loop
      v_tag_xp := null;
      select xp_value into v_tag_xp from public.behavior_tags where id::text=(v_it->>'id');
      if v_tag_xp is null then v_tag_xp := case when (v_it->>'category')='negative' then 0 else 2 end; end if;
      v_new_xp := v_new_xp + coalesce(v_tag_xp,0);
      v_dim := null;
      select coalesce(nullif(dim,''),'zhi') into v_dim from public.behavior_tags where id::text=(v_it->>'id');
      if v_dim is null then v_dim := 'zhi'; end if;
      case v_dim
        when 'de'  then v_new_de  := v_new_de  + coalesce(v_tag_xp,0);
        when 'ti'  then v_new_ti  := v_new_ti  + coalesce(v_tag_xp,0);
        when 'mei' then v_new_mei := v_new_mei + coalesce(v_tag_xp,0);
        when 'lao' then v_new_lao := v_new_lao + coalesce(v_tag_xp,0);
        else            v_new_zhi := v_new_zhi + coalesce(v_tag_xp,0);
      end case;
    end loop;
    v_delta := v_new_xp - v_old_xp;
    update public.daily_record
       set behavior=jsonb_build_object('mood',p_mood,'items',v_merged),
           semester=coalesce(v_old.semester,v_sem), create_at=now()
     where id=v_old.id returning id into v_rec_id;
    if v_delta<>0 then
      update public.student_info
         set xp     = greatest(0,coalesce(xp,0)+v_delta),
             xp_de  = greatest(0,coalesce(xp_de,0) + (v_new_de  - v_old_de)),
             xp_zhi = greatest(0,coalesce(xp_zhi,0)+ (v_new_zhi - v_old_zhi)),
             xp_ti  = greatest(0,coalesce(xp_ti,0) + (v_new_ti  - v_old_ti)),
             xp_mei = greatest(0,coalesce(xp_mei,0)+ (v_new_mei - v_old_mei)),
             xp_lao = greatest(0,coalesce(xp_lao,0)+ (v_new_lao - v_old_lao)),
             level  = public.level_from_xp(greatest(0,coalesce(xp,0)+v_delta))
       where id=v_sid returning xp into v_xp;
    end if;
    -- 实时流水：按合并后逐项写入（幂等 upsert，改分/改评后自动同步）
    for v_it in select * from jsonb_array_elements(v_merged) loop
      select t.xp_value, coalesce(nullif(t.dim,''),'zhi'), t.label
        into v_tag_xp, v_dim2, v_lbl from public.behavior_tags t where t.id::text=(v_it->>'id');
      if v_tag_xp is null then v_tag_xp := case when (v_it->>'category')='negative' then 0 else 2 end; v_dim2 := 'zhi'; v_lbl := (v_it->>'id'); end if;
      if coalesce(v_tag_xp,0) > 0 then
        insert into public.xp_log (class,student_name,source,ref_id,label,dim,xp,record_date)
        values (btrim(p_class),btrim(p_student),'daily',v_rec_id,
                v_lbl || case when coalesce(v_it->>'value','') <> '' then '：'||(v_it->>'value') else '' end,
                v_dim2, v_tag_xp, v_today)
        on conflict (source, ref_id, label) do update set xp = excluded.xp, dim = excluded.dim;
      end if;
    end loop;
    return jsonb_build_object('ok',true,'merged',true,'xp_delta',v_delta,'xp',v_xp,'level',public.level_from_xp(v_xp));
  end if;
  -- 新插入路径：先检测提交项异常（标签已删/经验值误配）
  perform public.log_item_anomalies(btrim(p_class), btrim(p_student), v_today, 'daily', p_items);
  select xp into v_xp_before from public.student_info where id = v_sid;
  insert into public.daily_record(class,student_name,record_date,semester,self_evaluation,behavior)
  values (btrim(p_class),btrim(p_student),v_today,v_sem,null,jsonb_build_object('mood',p_mood,'items',p_items))
  returning id into v_rec_id;
  v_new_xp := 0;
  for v_it in select * from jsonb_array_elements(p_items) loop
    v_tag_xp := null;
    select xp_value into v_tag_xp from public.behavior_tags where id::text=(v_it->>'id');
    if v_tag_xp is null then v_tag_xp := case when (v_it->>'category')='negative' then 0 else 2 end; end if;
    v_new_xp := v_new_xp + coalesce(v_tag_xp,0);
  end loop;
  select xp into v_xp from public.student_info where id = v_sid;
  -- 增量校验：实际增量应等于标签应得（防双计/漏计回归）
  if (v_xp - v_xp_before) <> v_new_xp then
    perform public.log_xp_anomaly(btrim(p_class), btrim(p_student), v_today, 'daily', 'xp_mismatch',
      '提交后经验增量与标签应得不符（疑似加分链路异常：双计或漏计）',
      jsonb_build_object('expected', v_new_xp, 'actual', v_xp - v_xp_before, 'record_id', v_rec_id));
  end if;
  -- 实时流水：逐项写入（幂等）
  for v_it in select * from jsonb_array_elements(p_items) loop
    select t.xp_value, coalesce(nullif(t.dim,''),'zhi'), t.label
      into v_tag_xp, v_dim2, v_lbl from public.behavior_tags t where t.id::text=(v_it->>'id');
    if v_tag_xp is null then v_tag_xp := case when (v_it->>'category')='negative' then 0 else 2 end; v_dim2 := 'zhi'; v_lbl := (v_it->>'id'); end if;
    if coalesce(v_tag_xp,0) > 0 then
      insert into public.xp_log (class,student_name,source,ref_id,label,dim,xp,record_date)
      values (btrim(p_class),btrim(p_student),'daily',v_rec_id,
              v_lbl || case when coalesce(v_it->>'value','') <> '' then '：'||(v_it->>'value') else '' end,
              v_dim2, v_tag_xp, v_today)
      on conflict (source, ref_id, label) do update set xp = excluded.xp, dim = excluded.dim;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'merged',false,'xp_delta',v_new_xp,'xp',v_xp,'level',public.level_from_xp(v_xp));
end; $function$;

-- ============================================================
-- ② confirm_challenge_levels：加行锁（防并发重复提交双计）+ 实时流水
-- ============================================================
drop function if exists public.confirm_challenge_task(uuid, int);
create or replace function public.confirm_challenge_levels(p_task_id uuid, p_levels jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_t        public.challenge_task%rowtype;
  v_done     int[] := '{}';
  v_new      int[] := '{}';
  v_item     jsonb;
  v_lv_num   int;
  v_found    boolean;
  v_xp_one   int;
  v_xp_earn  int := 0;
  v_xp_cur   int;
  v_lv       int;
  v_col      text;
  v_done_cnt int;
  v_total    int;
  v_row_ex   boolean;
  v_sub_id   uuid;
begin
  -- 加行锁：同一挑战任务并发提交串行化（第二个请求将看到最新 done_levels → 不重复加分）
  select * into v_t from public.challenge_task where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '挑战不存在或已取消');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '该挑战已全部达成');
  end if;
  if jsonb_typeof(p_levels) <> 'array' or jsonb_array_length(p_levels) = 0 then
    return jsonb_build_object('ok', false, 'reason', '请先勾选本次达成的档位');
  end if;

  select coalesce(array_agg((e#>>'{}')::int), '{}')
    into v_done
    from jsonb_array_elements(coalesce(v_t.done_levels, '[]'::jsonb)) e
   where (e#>>'{}') ~ '^-?[0-9]+$';

  for v_item in select * from jsonb_array_elements(p_levels)
  loop
    if (v_item#>>'{}') ~ '^-?[0-9]+$' then
      v_lv_num := (v_item#>>'{}')::int;
    else
      continue;
    end if;
    if v_lv_num = any(v_done) then continue; end if;
    select exists(
      select 1 from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)) a
       where (a->>0)::int = v_lv_num
    ) into v_found;
    if not v_found then continue; end if;
    v_new := array_append(v_new, v_lv_num);
    select coalesce((a->>1)::int, 0)
      into v_xp_one
      from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)) a
     where (a->>0)::int = v_lv_num
     limit 1;
    v_xp_earn := v_xp_earn + coalesce(v_xp_one, 0);
  end loop;

  if array_length(v_new, 1) is null then
    return jsonb_build_object('ok', false, 'reason', '没有可新增的达成档位（请勿重复提交）');
  end if;

  select exists(
    select 1 from public.student_info
     where class = v_t.class and student_name = v_t.student_name
  ) into v_row_ex;
  if not v_row_ex then
    return jsonb_build_object('ok', false, 'reason', '名单中未找到该学生，请联系老师');
  end if;

  v_col := case v_t.dim
             when 'de'  then 'xp_de'
             when 'zhi' then 'xp_zhi'
             when 'ti'  then 'xp_ti'
             when 'mei' then 'xp_mei'
             when 'lao' then 'xp_lao'
             else 'xp_zhi'
           end;
  execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) + $1) where class = $2 and student_name = $3',
                 v_col, v_col) using v_xp_earn, v_t.class, v_t.student_name;
  update public.student_info
     set xp = greatest(0, coalesce(xp, 0) + v_xp_earn)
   where class = v_t.class and student_name = v_t.student_name
   returning xp into v_xp_cur;
  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp_cur)
     where class = v_t.class and student_name = v_t.student_name;
    select level into v_lv from public.student_info
     where class = v_t.class and student_name = v_t.student_name;
  end if;

  v_done := array(select distinct x from unnest(v_done || v_new) x order by 1);
  v_done_cnt := cardinality(v_done);
  v_total := (select count(*)::int from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)));

  update public.challenge_task
     set status = case when v_done_cnt >= v_total then 'done' else 'pending' end,
         max_level = (select max(x) from unnest(v_done) x),
         done_levels = to_jsonb(v_done),
         confirm_at = now(),
         filled_by = 'student'
   where id = p_task_id;

  -- 填报记录（单次可取消）
  insert into public.challenge_submission (challenge_id, class, student_name, dim, levels, xp, status)
  values (v_t.id, v_t.class, v_t.student_name, v_t.dim, to_jsonb(v_new), v_xp_earn, 'active')
  returning id into v_sub_id;

  -- 实时流水（幂等；取消回退由 cancel_challenge_submission 同步维护）
  if v_xp_earn > 0 then
    insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
    values (v_t.class, v_t.student_name, 'challenge', v_sub_id,
            v_t.title || '（' || array_to_string(v_new, '/') || '档）', v_t.dim, v_xp_earn, current_date)
    on conflict (source, ref_id, label) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'xp_delta', v_xp_earn,
    'level', v_lv,
    'new_levels', to_jsonb(v_new),
    'done_count', v_done_cnt,
    'total_count', v_total,
    'status', case when v_done_cnt >= v_total then 'done' else 'pending' end
  );
end;
$$;

-- ============================================================
-- ③ confirm_personal_task：加行锁（防并发重复确认双计）+ 实时流水
-- ============================================================
create or replace function public.confirm_personal_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t   public.personal_task%rowtype;
  v_xp  int;
  v_lv  int;
  v_col text;
begin
  select * into v_t from public.personal_task where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '任务不存在或已删除');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '该任务已完成');
  end if;
  if v_t.deadline is not null
     and v_t.deadline < (now() at time zone 'Asia/Shanghai')::date then
    return jsonb_build_object('ok', false, 'reason', '任务已截止，请联系老师');
  end if;

  v_col := case v_t.dim
             when 'de'  then 'xp_de'
             when 'zhi' then 'xp_zhi'
             when 'ti'  then 'xp_ti'
             when 'mei' then 'xp_mei'
             when 'lao' then 'xp_lao'
             else 'xp_zhi'
           end;
  execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) + $1) where class = $2 and student_name = $3',
                 v_col, v_col) using v_t.xp_value, v_t.class, v_t.student_name;
  update public.student_info
     set xp = greatest(0, coalesce(xp, 0) + v_t.xp_value)
   where class = v_t.class and student_name = v_t.student_name
   returning xp into v_xp;
  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp)
     where class = v_t.class and student_name = v_t.student_name;
    select level into v_lv from public.student_info
     where class = v_t.class and student_name = v_t.student_name;
  end if;

  update public.personal_task
     set status = 'done', confirm_at = now(), filled_by = 'student'
   where id = p_task_id;

  -- 实时流水（幂等）
  if v_t.xp_value > 0 then
    insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
    values (v_t.class, v_t.student_name, 'personal', p_task_id, v_t.content, v_t.dim, v_t.xp_value, current_date)
    on conflict (source, ref_id, label) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'xp_delta', v_t.xp_value, 'level', v_lv);
end;
$function$;

-- ============================================================
-- ④ teacher_fill_personal_task：加行锁 + 实时流水（教师代填）
-- ============================================================
create or replace function public.teacher_fill_personal_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t   public.personal_task%rowtype;
  v_xp  int;
  v_lv  int;
  v_col text;
begin
  select * into v_t from public.personal_task where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '任务不存在或已删除');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '该任务已完成');
  end if;

  v_col := case v_t.dim
             when 'de'  then 'xp_de'
             when 'zhi' then 'xp_zhi'
             when 'ti'  then 'xp_ti'
             when 'mei' then 'xp_mei'
             when 'lao' then 'xp_lao'
             else 'xp_zhi'
           end;
  execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) + $1) where class = $2 and student_name = $3',
                 v_col, v_col) using v_t.xp_value, v_t.class, v_t.student_name;
  update public.student_info
     set xp = greatest(0, coalesce(xp, 0) + v_t.xp_value)
   where class = v_t.class and student_name = v_t.student_name
   returning xp into v_xp;
  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp)
     where class = v_t.class and student_name = v_t.student_name;
    select level into v_lv from public.student_info
     where class = v_t.class and student_name = v_t.student_name;
  end if;

  update public.personal_task
     set status = 'done', confirm_at = now(), filled_by = 'teacher'
   where id = p_task_id;

  -- 实时流水（幂等）
  if v_t.xp_value > 0 then
    insert into public.xp_log (class, student_name, source, ref_id, label, dim, xp, record_date)
    values (v_t.class, v_t.student_name, 'personal', p_task_id, v_t.content, v_t.dim, v_t.xp_value, current_date)
    on conflict (source, ref_id, label) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'xp_delta', v_t.xp_value, 'level', v_lv);
end;
$function$;

-- ---------- 授权（与 90 号一致） ----------
revoke execute on function public.submit_today(text,text,text,jsonb) from anon;
grant  execute on function public.submit_today(text,text,text,jsonb) to authenticated;
revoke execute on function public.confirm_challenge_levels(uuid,jsonb) from anon;
grant  execute on function public.confirm_challenge_levels(uuid,jsonb) to authenticated;
revoke execute on function public.confirm_personal_task(uuid) from anon;
grant  execute on function public.confirm_personal_task(uuid) to authenticated;
revoke execute on function public.teacher_fill_personal_task(uuid) from anon;
grant  execute on function public.teacher_fill_personal_task(uuid) to authenticated;

-- ============================================================
-- ⑤ 对账闭环：回退/删除路径同步维护经验流水（防「经验已回退但流水残留」）
-- ============================================================

-- ⑤-1 apply_record_xp：DELETE 时同步删除该记录的 daily 流水
--      （保持 90 号全部加分/负截断检测逻辑不变，仅追加流水清理）
create or replace function public.apply_record_xp()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rec    record;
  v_item   record;
  v_tag_xp int;
  v_dim    text;
  v_delta  int := 0;
  v_delta_de  int := 0;
  v_delta_zhi int := 0;
  v_delta_ti  int := 0;
  v_delta_mei int := 0;
  v_delta_lao int := 0;
  v_xp     int;
begin
  v_rec := case when tg_op = 'DELETE' then old else new end;
  for v_item in
    select e ->> 'id' as tag_id, e ->> 'category' as category
    from jsonb_array_elements(coalesce(v_rec.behavior -> 'items', '[]'::jsonb)) as e
  loop
    select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi')
      into v_tag_xp, v_dim
      from public.behavior_tags t
     where t.id::text = v_item.tag_id;
    if not found then
      v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
      v_dim := 'zhi';
    end if;
    v_delta := v_delta + coalesce(v_tag_xp, 0);
    case v_dim
      when 'de'  then v_delta_de  := v_delta_de  + coalesce(v_tag_xp, 0);
      when 'ti'  then v_delta_ti  := v_delta_ti  + coalesce(v_tag_xp, 0);
      when 'mei' then v_delta_mei := v_delta_mei + coalesce(v_tag_xp, 0);
      when 'lao' then v_delta_lao := v_delta_lao + coalesce(v_tag_xp, 0);
      else            v_delta_zhi := v_delta_zhi + coalesce(v_tag_xp, 0);
    end case;
  end loop;

  -- 对账闭环：删除记录时同步删除该记录的 daily 流水
  if tg_op = 'DELETE' then
    delete from public.xp_log where ref_id = v_rec.id and source = 'daily';
  end if;

  if coalesce(v_delta, 0) = 0 then
    return v_rec;
  end if;

  if tg_op = 'DELETE' then
    v_delta := -v_delta;
    v_delta_de  := -v_delta_de;
    v_delta_zhi := -v_delta_zhi;
    v_delta_ti  := -v_delta_ti;
    v_delta_mei := -v_delta_mei;
    v_delta_lao := -v_delta_lao;
  end if;

  -- 负截断检测（扣减致负 → 上报，避免静默截断）
  if v_delta < 0 then
    select coalesce(xp, 0) into v_xp from public.student_info
     where class = v_rec.class and student_name = v_rec.student_name;
    if coalesce(v_xp, 0) + v_delta < 0 then
      perform public.log_xp_anomaly(v_rec.class, v_rec.student_name,
        (v_rec.record_date)::date, 'daily', 'negative_clip',
        '扣减将导致经验为负（已自动截断为 0，请核对扣减来源）',
        jsonb_build_object('before', v_xp, 'delta', v_delta));
    end if;
  end if;

  update public.student_info
     set xp     = greatest(0, coalesce(xp, 0)     + v_delta),
         xp_de  = greatest(0, coalesce(xp_de, 0)  + v_delta_de),
         xp_zhi = greatest(0, coalesce(xp_zhi, 0) + v_delta_zhi),
         xp_ti  = greatest(0, coalesce(xp_ti, 0)  + v_delta_ti),
         xp_mei = greatest(0, coalesce(xp_mei, 0) + v_delta_mei),
         xp_lao = greatest(0, coalesce(xp_lao, 0) + v_delta_lao)
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
$function$;

drop trigger if exists trg_apply_record_xp     on public.daily_record;
drop trigger if exists trg_apply_record_xp_ins on public.daily_record;
drop trigger if exists trg_apply_record_xp_del on public.daily_record;
create trigger trg_apply_record_xp_ins after insert on public.daily_record
  for each row execute function public.apply_record_xp();
create trigger trg_apply_record_xp_del after delete on public.daily_record
  for each row execute function public.apply_record_xp();

-- ⑤-2 cancel_challenge_submission：取消单次填报时同步删除对应挑战流水
create or replace function public.cancel_challenge_submission(p_submission_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_s       public.challenge_submission%rowtype;
  v_t       public.challenge_task%rowtype;
  v_done    int[] := '{}';
  v_removed int[] := '{}';
  v_newdone int[] := '{}';
  v_gain    int := 0;
  v_xp_cur  int;
  v_lv      int;
  v_col     text;
  v_total   int;
  v_done_cnt int;
begin
  select * into v_s from public.challenge_submission
   where id = p_submission_id and status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'reason', '填报记录不存在或已取消');
  end if;

  select * into v_t from public.challenge_task where id = v_s.challenge_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '对应挑战不存在');
  end if;

  -- 该次档位
  select coalesce(array_agg((e#>>'{}')::int), '{}')
    into v_removed
    from jsonb_array_elements(coalesce(v_s.levels, '[]'::jsonb)) e
   where (e#>>'{}') ~ '^-?[0-9]+$';

  -- 当前已达成档位，移除本次档位
  select coalesce(array_agg((e#>>'{}')::int), '{}')
    into v_done
    from jsonb_array_elements(coalesce(v_t.done_levels, '[]'::jsonb)) e
   where (e#>>'{}') ~ '^-?[0-9]+$';
  v_newdone := array(
    select distinct x from unnest(v_done) x
     where not (x = any(v_removed))
     order by 1
  );
  v_done_cnt := cardinality(v_newdone);
  v_total := (select count(*)::int from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)));

  -- 回退该次经验
  v_gain := coalesce(v_s.xp, 0);
  if v_gain > 0 then
    v_col := case v_s.dim
               when 'de'  then 'xp_de'
               when 'zhi' then 'xp_zhi'
               when 'ti'  then 'xp_ti'
               when 'mei' then 'xp_mei'
               when 'lao' then 'xp_lao'
               else 'xp_zhi'
             end;
    execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) - $1) where class = $2 and student_name = $3',
                   v_col, v_col) using v_gain, v_s.class, v_s.student_name;
    update public.student_info
       set xp = greatest(0, coalesce(xp, 0) - v_gain)
     where class = v_s.class and student_name = v_s.student_name
     returning xp into v_xp_cur;
    if found then
      update public.student_info
         set level = public.level_from_xp(v_xp_cur)
       where class = v_s.class and student_name = v_s.student_name;
      select level into v_lv from public.student_info
       where class = v_s.class and student_name = v_s.student_name;
    end if;
  end if;

  -- 更新挑战任务（档位/最高档/状态）
  update public.challenge_task
     set done_levels = to_jsonb(v_newdone),
         max_level = coalesce((select max(x) from unnest(v_newdone) x), 0),
         status = case when v_done_cnt >= v_total and v_total > 0 then 'done'
                       else 'pending' end
   where id = v_t.id;

  -- 标记记录为已取消
  update public.challenge_submission
     set status = 'cancelled'
   where id = p_submission_id;

  -- 对账闭环：删除本次填报对应的挑战流水
  delete from public.xp_log where ref_id = p_submission_id and source = 'challenge';

  return jsonb_build_object(
    'ok', true,
    'refund_xp', v_gain,
    'level', v_lv,
    'removed_levels', to_jsonb(v_removed),
    'done_count', v_done_cnt,
    'total_count', v_total,
    'status', case when v_done_cnt >= v_total and v_total > 0 then 'done' else 'pending' end
  );
end;
$$;

-- ⑤-3 delete_personal_task：删除（含回退）时同步删除个人任务流水
create or replace function public.delete_personal_task(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_t       public.personal_task%rowtype;
  v_refund  int := 0;
  v_xp_cur  int;
  v_lv      int;
  v_col     text;
begin
  select * into v_t from public.personal_task where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '任务不存在或已删除');
  end if;

  -- 已完成任务：回退已加经验（维度列 + 总经验 + 等级重算）
  if v_t.status = 'done' then
    v_refund := coalesce(v_t.xp_value, 0);
    v_col := case v_t.dim
               when 'de'  then 'xp_de'
               when 'zhi' then 'xp_zhi'
               when 'ti'  then 'xp_ti'
               when 'mei' then 'xp_mei'
               when 'lao' then 'xp_lao'
               else 'xp_zhi'
             end;
    execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) - $1) where class = $2 and student_name = $3',
                   v_col, v_col) using v_refund, v_t.class, v_t.student_name;
    update public.student_info
       set xp = greatest(0, coalesce(xp, 0) - v_refund)
     where class = v_t.class and student_name = v_t.student_name
     returning xp into v_xp_cur;
    if found then
      update public.student_info
         set level = public.level_from_xp(v_xp_cur)
       where class = v_t.class and student_name = v_t.student_name;
      select level into v_lv from public.student_info
       where class = v_t.class and student_name = v_t.student_name;
    end if;
  end if;

  delete from public.personal_task where id = p_task_id;
  -- 对账闭环：删除该任务的个人流水
  delete from public.xp_log where ref_id = p_task_id and source = 'personal';
  return jsonb_build_object('ok', true, 'refund_xp', v_refund, 'level', v_lv);
end;
$$;

-- ⑤-4 delete_challenge_task：删除（含回退）时同步删除该挑战全部流水
create or replace function public.delete_challenge_task(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_t      public.challenge_task%rowtype;
  v_done   int[] := '{}';
  v_gain   int := 0;
  v_xp_cur int;
  v_lv     int;
  v_col    text;
begin
  select * into v_t from public.challenge_task where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '挑战不存在或已删除');
  end if;

  -- 已达成档位 → 按方案累加已加经验
  select coalesce(array_agg((e#>>'{}')::int), '{}')
    into v_done
    from jsonb_array_elements(coalesce(v_t.done_levels, '[]'::jsonb)) e
   where (e#>>'{}') ~ '^-?[0-9]+$';

  if cardinality(v_done) > 0 then
    select coalesce(sum((a->>1)::int), 0)
      into v_gain
      from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)) a
     where (a->>0)::int = any(v_done);

    if v_gain > 0 then
      v_col := case v_t.dim
                 when 'de'  then 'xp_de'
                 when 'zhi' then 'xp_zhi'
                 when 'ti'  then 'xp_ti'
                 when 'mei' then 'xp_mei'
                 when 'lao' then 'xp_lao'
                 else 'xp_zhi'
               end;
      execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) - $1) where class = $2 and student_name = $3',
                     v_col, v_col) using v_gain, v_t.class, v_t.student_name;
      update public.student_info
         set xp = greatest(0, coalesce(xp, 0) - v_gain)
       where class = v_t.class and student_name = v_t.student_name
       returning xp into v_xp_cur;
      if found then
        update public.student_info
           set level = public.level_from_xp(v_xp_cur)
         where class = v_t.class and student_name = v_t.student_name;
        select level into v_lv from public.student_info
         where class = v_t.class and student_name = v_t.student_name;
      end if;
    end if;
  end if;

  -- 对账闭环：删除该挑战关联的全部挑战流水（submission 级联删除）
  delete from public.xp_log
   where source = 'challenge'
     and ref_id in (select id from public.challenge_submission where challenge_id = p_task_id);
  delete from public.challenge_task where id = p_task_id;
  return jsonb_build_object('ok', true, 'refund_xp', v_gain, 'level', v_lv);
end;
$$;

revoke execute on function public.cancel_challenge_submission(uuid) from public;
grant  execute on function public.cancel_challenge_submission(uuid) to anon, authenticated;
revoke execute on function public.delete_personal_task(uuid) from public;
grant  execute on function public.delete_personal_task(uuid) to authenticated;
revoke execute on function public.delete_challenge_task(uuid) from public;
grant  execute on function public.delete_challenge_task(uuid) to authenticated;

-- ---------- 自检 ----------
-- ① 日常提交一次 → 经验 +2 且 xp_log 出现对应流水：
--    select * from public.xp_log where source='daily' order by created_at desc limit 3;
-- ② 全班对账：select student_name, xp, coalesce((select sum(xp) from xp_log l where l.student_name=s.student_name and l.class=s.class),0) as log_sum
--      from public.student_info s;   -- 期望 xp = log_sum（历史未注入部分除外）
-- ③ 挑战/个人提交后流水：select * from public.xp_log where source in ('challenge','personal') order by created_at desc limit 5;
-- ④ 并发防重：同一挑战连点两次「提交达成」→ 第二次返回「没有可新增的达成档位」，经验只加一次
-- ⑤ 回退对账：取消挑战/删除个人任务/删除日常记录后，对应流水同步消失，xp 与流水合计仍相等
