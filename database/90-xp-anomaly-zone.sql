-- ============================================================
-- 90-xp-anomaly-zone.sql
-- v153：学生经验日志 + 经验异常区（自动上报教师端「经验记录」菜单）
-- 内容：
--   1) xp_anomaly 表：经验异常清单（open/resolved）
--   2) log_xp_anomaly()：上报异常（同学生+同日+同类型已有未处理 → 去重）
--   3) log_item_anomalies()：对一组提交项批量检测「标签已删 / 经验值误配」
--   4) apply_record_xp()：在原有加分逻辑上增加「扣减致负截断」兜底检测
--   5) submit_today()：包含 89 号双计修复 + 插入/合并两路径异常检测 + 增量校验
--   6) get_xp_anomaly_zone()：教师端「经验异常区」清单 + 未处理计数
--   7) resolve_xp_anomaly()：教师标记已处理
--   8) get_student_xp_logs()：学生经验日志（全班摘要，结合 xp_log 流水）
-- 用法：
--   ① 需先执行 01/09/64/57 号基础脚本（若已执行 89 号修复，本脚本会再次覆盖
--      submit_today，功能等价并增加异常检测，可重复执行）
--   ② 可选：执行 87 号并注入经验流水（select inject_xp_log()），供日志/差额比对
--   ③ 执行本文件
--   ④ 教师后台 →「📜 经验记录」→「🚨 经验异常区」查看自动上报；「👥 全班日志」看学生经验日志
-- ============================================================

-- ---------- 1) 经验异常表 ----------
create table if not exists public.xp_anomaly (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,
  student_name text not null,
  record_date  date,
  source       text,                 -- daily/task/personal/challenge/manual/auto
  anomaly_type text not null,        -- missing_tag / bad_xp_value / negative_clip / xp_mismatch
  reason       text not null,
  detail       jsonb default '{}'::jsonb,
  status       text not null default 'open',   -- open / resolved
  create_at    timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists idx_xp_anomaly_open on public.xp_anomaly (class, status, create_at);

alter table public.xp_anomaly enable row level security;
drop policy if exists "xpanom teacher all" on public.xp_anomaly;
create policy "xpanom teacher all" on public.xp_anomaly for all to authenticated using (true) with check (true);

-- ---------- 2) 上报函数（去重） ----------
create or replace function public.log_xp_anomaly(
  p_class text, p_student text, p_date date, p_source text,
  p_type text, p_reason text, p_detail jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.xp_anomaly
     where class = btrim(p_class) and student_name = btrim(p_student)
       and coalesce(record_date, '1970-01-01'::date) = coalesce(p_date, '1970-01-01'::date)
       and anomaly_type = p_type and status = 'open'
  ) then
    return;  -- 已存在同型未处理异常，去重
  end if;
  insert into public.xp_anomaly (class, student_name, record_date, source, anomaly_type, reason, detail)
  values (btrim(p_class), btrim(p_student), p_date, p_source, p_type, p_reason, coalesce(p_detail, '{}'::jsonb));
end;
$$;

-- ---------- 2b) 批量检测：标签已删 / 经验值误配 ----------
create or replace function public.log_item_anomalies(
  p_class text, p_student text, p_date date, p_source text, p_items jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_it jsonb; v_tag_xp int; v_label text;
begin
  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select t.xp_value, t.label into v_tag_xp, v_label
      from public.behavior_tags t where t.id::text = (v_it ->> 'id');
    if not found then
      perform public.log_xp_anomaly(p_class, p_student, p_date, p_source, 'missing_tag',
        '提交的记录引用了已不存在的表现标签（标签可能已被删除）',
        jsonb_build_object('tag_id', v_it ->> 'id', 'category', v_it ->> 'category'));
    elsif v_tag_xp < 0 or v_tag_xp > 30 then
      perform public.log_xp_anomaly(p_class, p_student, p_date, p_source, 'bad_xp_value',
        '标签经验值配置异常（应为 0~30 的整数，当前值可能为误配）',
        jsonb_build_object('tag_id', v_it ->> 'id', 'label', v_label, 'xp_value', v_tag_xp));
    end if;
  end loop;
end;
$$;

-- ---------- 3) 带检测的 apply_record_xp（64 号加分逻辑 + 负截断兜底检测） ----------
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

drop trigger if exists trg_apply_record_xp_ins on public.daily_record;
drop trigger if exists trg_apply_record_xp_del on public.daily_record;
create trigger trg_apply_record_xp_ins after insert on public.daily_record
  for each row execute function public.apply_record_xp();
create trigger trg_apply_record_xp_del after delete on public.daily_record
  for each row execute function public.apply_record_xp();

-- ---------- 4) submit_today（= 89 号修复 + 两路径异常检测 + 插入路径增量校验） ----------
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
begin
  select id, xp into v_sid, v_xp from public.student_info
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) limit 1;
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
  return jsonb_build_object('ok',true,'merged',false,'xp_delta',v_new_xp,'xp',v_xp,'level',public.level_from_xp(v_xp));
end; $function$;

-- ---------- 5) 查询：经验异常区清单 + 未处理计数 ----------
create or replace function public.get_xp_anomaly_zone(p_class text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rows jsonb; v_open int;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'student', student_name, 'date', record_date,
           'source', source, 'type', anomaly_type, 'reason', reason,
           'detail', detail, 'create_at', create_at
         ) order by create_at desc), '[]'::jsonb)
    into v_rows
    from public.xp_anomaly
   where btrim(class) = btrim(p_class) and status = 'open';
  select count(*) into v_open
    from public.xp_anomaly
   where btrim(class) = btrim(p_class) and status = 'open';
  return jsonb_build_object('rows', v_rows, 'open_count', coalesce(v_open, 0));
end;
$$;

-- ---------- 6) 标记已处理 ----------
create or replace function public.resolve_xp_anomaly(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_ok boolean;
begin
  update public.xp_anomaly set status='resolved', resolved_at=now() where id=p_id and status='open';
  v_ok := found;
  return jsonb_build_object('ok', v_ok);
end;
$$;

-- ---------- 7) 学生经验日志：全班摘要（结合 xp_log 流水） ----------
create or replace function public.get_student_xp_logs(p_class text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'student', s.student_name, 'level', s.level, 'cur_xp', s.xp,
           'log_total', coalesce(l.total, 0), 'log_cnt', coalesce(l.cnt, 0),
           'last_date', l.last_date, 'diff', s.xp - coalesce(l.total, 0)
         ) order by s.student_name), '[]'::jsonb)
    into v_rows
    from public.student_info s
    left join (
      select student_name, sum(xp) as total, count(*) as cnt, max(record_date) as last_date
        from public.xp_log where btrim(class) = btrim(p_class)
       group by student_name
    ) l on l.student_name = s.student_name
   where btrim(s.class) = btrim(p_class);
  return jsonb_build_object('rows', v_rows);
end;
$$;

-- ---------- 授权 ----------
revoke execute on function public.log_xp_anomaly(text,text,date,text,text,text,jsonb) from anon;
grant  execute on function public.log_xp_anomaly(text,text,date,text,text,text,jsonb) to authenticated;
revoke execute on function public.log_item_anomalies(text,text,date,text,jsonb) from anon;
grant  execute on function public.log_item_anomalies(text,text,date,text,jsonb) to authenticated;
revoke execute on function public.get_xp_anomaly_zone(text) from anon;
grant  execute on function public.get_xp_anomaly_zone(text) to authenticated;
revoke execute on function public.resolve_xp_anomaly(uuid) from anon;
grant  execute on function public.resolve_xp_anomaly(uuid) to authenticated;
revoke execute on function public.get_student_xp_logs(text) from anon;
grant  execute on function public.get_student_xp_logs(text) to authenticated;
-- （注：内容由AI生成）
