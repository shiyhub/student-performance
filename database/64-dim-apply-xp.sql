-- ============================================================
-- 64-dim-apply-xp.sql  五维经验改造【第五步：加分链路按维度写入】
--   重写 3 个函数（create or replace，参数/返回值不变，前端零改动）：
--   1) apply_record_xp()   触发器加分函数：按标签 dim 写对应维度列
--                          （覆盖 batch_award_tag 批量评价 + 学生提交 + 删除扣回）
--   2) submit_today()      学生提交：显式加分处同步写维度列（保持原加分总量不变）
--   3) recalc_all_xp()     一键重算：按历史记录 items 全量重算五维 + 总 xp + 等级
--   执行前请先执行 61（加列）、62-part1（视图+标签归智）、63（结算引擎）。
--   可重复执行。
-- ============================================================

-- 1) 触发器加分函数：INSERT/DELETE 触发器共用，按标签维度写列
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

  -- 遍历本单 behavior.items，累加每个标签配置的经验值（按维度分别累计）
  for v_item in
    select e ->> 'id' as tag_id, e ->> 'category' as category
    from jsonb_array_elements(coalesce(v_rec.behavior -> 'items', '[]'::jsonb)) as e
  loop
    select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi')
      into v_tag_xp, v_dim
      from public.behavior_tags t
     where t.id::text = v_item.tag_id;

    if v_tag_xp is null then
      v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
    end if;
    if v_dim is null then v_dim := 'zhi'; end if;

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

  -- 删除记录时反向扣回（各维度同步反向）
  if tg_op = 'DELETE' then
    v_delta := -v_delta;
    v_delta_de  := -v_delta_de;
    v_delta_zhi := -v_delta_zhi;
    v_delta_ti  := -v_delta_ti;
    v_delta_mei := -v_delta_mei;
    v_delta_lao := -v_delta_lao;
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

-- 2) 学生提交：显式加分同步写维度列（保留原合并/去重/总分逻辑，总量不变）
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
  v_sid uuid; v_xp int; v_old public.daily_record%rowtype;
  v_old_xp int := 0; v_new_xp int; v_delta int; v_merged jsonb; v_it jsonb; v_tag_xp int; v_dim text; v_rec_id uuid;
  v_items jsonb := '[]'::jsonb; v_unique boolean;
  -- 维度分量（旧记录 / 新合并后）
  v_old_de int := 0; v_old_zhi int := 0; v_old_ti int := 0; v_old_mei int := 0; v_old_lao int := 0;
  v_new_de int := 0; v_new_zhi int := 0; v_new_ti int := 0; v_new_mei int := 0; v_new_lao int := 0;
begin
  select id, xp into v_sid, v_xp from public.student_info
   where btrim(class)=btrim(p_class) and btrim(student_name)=btrim(p_student) limit 1;
  if v_sid is null then return jsonb_build_object('ok',false,'reason','no_student'); end if;
  p_items := coalesce(p_items,'[]'::jsonb);
  -- ① 跨天去重：历史唯一标签，历史任意日期已打过同 id+value → 跳过
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
  -- ② 当天已有记录：合并新增项（old 维度分量 / new 维度分量分别累计）
  if v_old.id is not null then
    for v_it in select * from jsonb_array_elements(coalesce(v_old.behavior->'items','[]'::jsonb)) loop
      select coalesce(xp_value, case when (v_it->>'category')='negative' then 0 else 2 end) into v_tag_xp
        from public.behavior_tags where id::text=(v_it->>'id');
      v_old_xp := v_old_xp + coalesce(v_tag_xp,0);
      select coalesce(nullif(dim,''),'zhi') into v_dim
        from public.behavior_tags where id::text=(v_it->>'id');
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
      select coalesce(xp_value, case when (v_it->>'category')='negative' then 0 else 2 end) into v_tag_xp
        from public.behavior_tags where id::text=(v_it->>'id');
      v_new_xp := v_new_xp + coalesce(v_tag_xp,0);
      select coalesce(nullif(dim,''),'zhi') into v_dim
        from public.behavior_tags where id::text=(v_it->>'id');
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
  -- ③ 当天无记录：新插入（带 semester），正确计算经验（维度分量同步）
  insert into public.daily_record(class,student_name,record_date,semester,self_evaluation,behavior)
  values (btrim(p_class),btrim(p_student),v_today,v_sem,null,jsonb_build_object('mood',p_mood,'items',p_items))
  returning id into v_rec_id;
  v_new_xp := 0;
  for v_it in select * from jsonb_array_elements(p_items) loop
    select coalesce(xp_value, case when (v_it->>'category')='negative' then 0 else 2 end) into v_tag_xp
      from public.behavior_tags where id::text=(v_it->>'id');
    v_new_xp := v_new_xp + coalesce(v_tag_xp,0);
    select coalesce(nullif(dim,''),'zhi') into v_dim
      from public.behavior_tags where id::text=(v_it->>'id');
    if v_dim is null then v_dim := 'zhi'; end if;
    case v_dim
      when 'de'  then v_new_de  := v_new_de  + coalesce(v_tag_xp,0);
      when 'ti'  then v_new_ti  := v_new_ti  + coalesce(v_tag_xp,0);
      when 'mei' then v_new_mei := v_new_mei + coalesce(v_tag_xp,0);
      when 'lao' then v_new_lao := v_new_lao + coalesce(v_tag_xp,0);
      else            v_new_zhi := v_new_zhi + coalesce(v_tag_xp,0);
    end case;
  end loop;
  update public.student_info
     set xp     = greatest(0,coalesce(xp,0)+v_new_xp),
         xp_de  = greatest(0,coalesce(xp_de,0) + v_new_de),
         xp_zhi = greatest(0,coalesce(xp_zhi,0)+ v_new_zhi),
         xp_ti  = greatest(0,coalesce(xp_ti,0) + v_new_ti),
         xp_mei = greatest(0,coalesce(xp_mei,0)+ v_new_mei),
         xp_lao = greatest(0,coalesce(xp_lao,0)+ v_new_lao),
         level  = public.level_from_xp(greatest(0,coalesce(xp,0)+v_new_xp))
   where id=v_sid returning xp into v_xp;
  return jsonb_build_object('ok',true,'merged',false,'xp_delta',v_new_xp,'xp',v_xp,'level',public.level_from_xp(v_xp));
end; $function$;

-- 3) 一键重算：按历史记录 items 全量重算五维 + 总 xp + 等级（前端"重算经验"按钮同款返回）
create or replace function public.recalc_all_xp()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stu  record;
  v_rec  record;
  v_item record;
  v_tag_xp int;
  v_dim  text;
  v_xp int := 0;
  v_de int := 0; v_zhi int := 0; v_ti int := 0; v_mei int := 0; v_lao int := 0;
  v_cnt int := 0;
begin
  for v_stu in select id, class, student_name from public.student_info loop
    v_xp := 0; v_de := 0; v_zhi := 0; v_ti := 0; v_mei := 0; v_lao := 0;
    for v_rec in
      select behavior from public.daily_record
       where class = v_stu.class and student_name = v_stu.student_name
    loop
      for v_item in
        select e ->> 'id' as tag_id, e ->> 'category' as category
        from jsonb_array_elements(coalesce(v_rec.behavior -> 'items', '[]'::jsonb)) as e
      loop
        select t.xp_value, coalesce(nullif(t.dim,''),'zhi') into v_tag_xp, v_dim
          from public.behavior_tags t where t.id::text = v_item.tag_id;
        if v_tag_xp is null then
          v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
        end if;
        if v_dim is null then v_dim := 'zhi'; end if;
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
    update public.student_info
       set xp = v_xp, level = public.level_from_xp(v_xp),
           xp_de = v_de, xp_zhi = v_zhi, xp_ti = v_ti, xp_mei = v_mei, xp_lao = v_lao
     where id = v_stu.id;
  end loop;
  return jsonb_build_object('records_replayed', v_cnt);
end;
$function$;

-- 自检：确认三个函数已更新（版本行）
select p.proname as 函数名, p.prosrc like '%xp_de%' as 含五维逻辑
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('apply_record_xp','submit_today','recalc_all_xp')
order by p.proname;
