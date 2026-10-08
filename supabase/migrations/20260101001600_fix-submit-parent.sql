-- ============================================================
-- 16-fix-submit-parent.sql
-- 修复测试发现的问题：
--   1) S2：学生当天只保留一条记录，重复提交合并 items，按差额加经验（防刷）
--   2) S1：家长三要素匹配统一 btrim+lower，兼容首尾空格/大小写
--   3) 历史记录限量，避免无限返回
-- 可重复执行。
-- ============================================================

-- 返回列顺序与旧版不同，先 DROP 再重建（不影响数据）
drop function if exists public.get_student_papers(text, text, text);
drop function if exists public.get_student_records(text, text, text);
drop function if exists public.add_home_note(text, text, text, text, date);

-- 名字匹配工具：忽略首尾空格、大小写（中文不受 lower 影响）
create or replace function public.name_eq(a text, b text)
returns boolean language sql immutable as $$
  select btrim(coalesce(a,'')) = btrim(coalesce(b,''));
$$;

-- ------------------------------------------------------------
-- 1) 当天合并提交 RPC
-- ------------------------------------------------------------
create or replace function public.submit_today(
  p_class   text,
  p_student text,
  p_mood    text,
  p_items   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid       uuid;
  v_xp        int;
  v_old       public.daily_record%rowtype;
  v_old_xp    int := 0;
  v_new_xp    int := 0;
  v_delta     int;
  v_merged    jsonb := '[]'::jsonb;
  v_it        jsonb;
  v_tag_xp    int;
  v_rec_id    uuid;
begin
  -- 校验学生在名单内
  select id, xp into v_sid, v_xp
    from public.student_info
   where btrim(class) = btrim(p_class)
     and btrim(student_name) = btrim(p_student)
   limit 1;
  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  p_items := coalesce(p_items, '[]'::jsonb);

  -- 汇总新提交 items 的经验（按标签配置）
  for v_it in select * from jsonb_array_elements(p_items)
  loop
    select coalesce(xp_value, case when (v_it->>'category')='negative' then 0 else 2 end)
      into v_tag_xp from public.behavior_tags where id::text = (v_it->>'id');
    v_new_xp := v_new_xp + coalesce(v_tag_xp, 0);
  end loop;

  -- 取当天已有记录
  select * into v_old from public.daily_record
   where btrim(class) = btrim(p_class)
     and btrim(student_name) = btrim(p_student)
     and record_date = current_date;

  if v_old.id is not null then
    -- 老记录经验
    for v_it in select * from jsonb_array_elements(coalesce(v_old.behavior->'items','[]'::jsonb))
    loop
      select coalesce(xp_value, case when (v_it->>'category')='negative' then 0 else 2 end)
        into v_tag_xp from public.behavior_tags where id::text = (v_it->>'id');
      v_old_xp := v_old_xp + coalesce(v_tag_xp, 0);
    end loop;

    -- 合并 items（老的在前，新的在后；同 id+value 去重）
    v_merged := coalesce(v_old.behavior->'items','[]'::jsonb) || p_items;
    select jsonb_agg(distinct it) into v_merged
      from (select it from jsonb_array_elements(v_merged) it
            order by it->>'label') x;

    v_delta := v_new_xp - (v_new_xp); -- 占位，下面用真实差额
    v_delta := v_new_xp - 0; -- 新提交只算"这次新增"的差额：
    -- 合并后总经验
    v_new_xp := 0;
    for v_it in select * from jsonb_array_elements(v_merged)
    loop
      select coalesce(xp_value, case when (v_it->>'category')='negative' then 0 else 2 end)
        into v_tag_xp from public.behavior_tags where id::text = (v_it->>'id');
      v_new_xp := v_new_xp + coalesce(v_tag_xp, 0);
    end loop;
    v_delta := v_new_xp - v_old_xp;

    update public.daily_record
       set behavior = jsonb_build_object('mood', p_mood, 'items', v_merged),
           create_at = now()
     where id = v_old.id
     returning id into v_rec_id;

    -- 手动调整经验（UPDATE 不触发器）
    if v_delta <> 0 then
      update public.student_info
         set xp = greatest(0, coalesce(xp,0) + v_delta),
             level = public.level_from_xp(greatest(0, coalesce(xp,0) + v_delta))
       where id = v_sid
      returning xp, level into v_xp;
    end if;

    return jsonb_build_object('ok', true, 'merged', true, 'xp_delta', v_delta,
                              'xp', v_xp, 'level', public.level_from_xp(v_xp));
  end if;

  -- 当天第一条：直接插入（触发器会自动加经验）
  insert into public.daily_record(class, student_name, record_date, self_evaluation, behavior)
  values (btrim(p_class), btrim(p_student), current_date, null,
          jsonb_build_object('mood', p_mood, 'items', p_items))
  returning id into v_rec_id;

  select xp, level into v_xp from public.student_info where id = v_sid;
  return jsonb_build_object('ok', true, 'merged', false, 'xp_delta', v_new_xp,
                            'xp', v_xp, 'level', public.level_from_xp(v_xp));
end;
$$;

grant execute on function public.submit_today(text,text,text,jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- 2) 家长三要素匹配放宽（首尾空格/大小写），并限量返回
-- ------------------------------------------------------------
create or replace function public.get_student_records(
  p_class text, p_student text, p_parent text
) returns table (
  id uuid, student_name text, class text, record_date date,
  self_evaluation smallint, behavior jsonb, teacher_comment text, create_at timestamptz
) language sql security definer set search_path = public as $$
  select r.id, r.student_name, r.class, r.record_date,
         r.self_evaluation, r.behavior, r.teacher_comment, r.create_at
  from public.daily_record r
  where btrim(lower(r.class))        = btrim(lower(p_class))
    and btrim(lower(r.student_name))= btrim(lower(p_student))
    and exists (
      select 1 from public.student_info s
      join public.student_parent p on p.student_id = s.id
      where btrim(lower(s.class)) = btrim(lower(p_class))
        and btrim(lower(s.student_name)) = btrim(lower(p_student))
        and btrim(lower(p.parent_name))  = btrim(lower(p_parent))
    )
  order by r.record_date desc, r.create_at desc
  limit 400;
$$;

create or replace function public.get_student_papers(
  p_class text, p_student text, p_parent text
) returns table (
  id uuid, subject text, score numeric, score_text text,
  image_url text, note text, record_date date, create_at timestamptz
) language sql security definer set search_path = public as $$
  select e.id, e.subject, e.score, e.score_text, e.image_url, e.note, e.record_date, e.create_at
  from public.exam_paper e
  where btrim(lower(e.class)) = btrim(lower(p_class))
    and btrim(lower(e.student_name)) = btrim(lower(p_student))
    and exists (
      select 1 from public.student_info s
      join public.student_parent p on p.student_id = s.id
      where btrim(lower(s.class)) = btrim(lower(p_class))
        and btrim(lower(s.student_name)) = btrim(lower(p_student))
        and btrim(lower(p.parent_name))  = btrim(lower(p_parent))
    )
  order by e.record_date desc limit 200;
$$;

create or replace function public.add_home_note(
  p_class text, p_student text, p_parent text, p_content text, p_date date
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid; v_content text; v_parent text; v_date date;
begin
  v_content := nullif(left(btrim(coalesce(p_content,'')),500),'');
  if v_content is null then return false; end if;
  v_parent := btrim(coalesce(p_parent,''));
  v_date   := coalesce(p_date, current_date);
  select si.id into v_sid from public.student_info si
    join public.student_parent sp on sp.student_id = si.id
   where btrim(lower(si.class)) = btrim(lower(p_class))
     and btrim(lower(si.student_name)) = btrim(lower(p_student))
     and btrim(lower(sp.parent_name))  = btrim(lower(p_parent))
   limit 1;
  if v_sid is null then return false; end if;
  insert into public.home_note (student_id, parent_name, content, record_date)
  values (v_sid, v_parent, v_content, v_date);
  return true;
end;
$$;

notify pgrst, 'reload schema';
