-- ============================================================
-- 58b-fix-wall-avatar-frame.sql  （v152 头像修复补丁，可重复执行）
-- 问题：58-get-wall-data.sql 的 roster 缺 class / frame 两个字段，导致
--   ① 学生墙卡片不渲染头像框（s.frame 恒为 undefined）
--   ② 身份卡 currentRosterRow() 按班级匹配失败 → 头像回退成按姓名哈希的小动物（"小狗头像"）
-- 修复：roster 补 id / class / frame（视图 student_directory 本身已含 frame）。
-- 已在旧库执行过 58 号的，只需跑本文件；全新部署直接跑 58 + 本文件（或 58 新版）。
-- ============================================================

-- ---------- 0) 视图防御：确保 student_directory 带 frame 列 ----------
-- 若旧库的视图还是早期版本（无 frame），get_wall_data 取 i.frame 会报错，先重建视图
alter table public.student_info add column if not exists frame text;
drop view if exists public.student_directory;
create view public.student_directory as
  select id, class, student_name, avatar, frame, xp, level
  from public.student_info;
comment on view public.student_directory is '学生端班级墙只读视图：班级、学生姓名、头像、头像框、经验、等级';
grant select on public.student_directory to anon, authenticated;

-- ---------- 1) 重写 get_wall_data（roster 带 id/class/frame） ----------

create or replace function public.get_wall_data(
  p_class    text,
  p_semester text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_roster  jsonb;
  v_records jsonb;
  v_tasks   jsonb;
  v_seat    jsonb;
  v_subs    jsonb;
  v_today   date := (now() at time zone 'Asia/Shanghai')::date;  -- 与 22 号 SQL 同一"今天"口径
  v_since   date := v_today - 30;                                 -- 墙只需近 30 天状态；累计天数由 get_student_profile 单独算
  v_task_ids bigint[];
begin
  -- 1) 名单（student_directory 视图字段：id/class/student_name/avatar/frame/xp/level）
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'class', i.class, 'student_name', i.student_name,
           'avatar', i.avatar, 'frame', i.frame, 'xp', i.xp, 'level', i.level)
           order by i.student_name), '[]'::jsonb)
    into v_roster
    from public.student_directory i
   where btrim(i.class) = btrim(p_class);

  -- 2) 近 30 天在校表现（墙只需 星级/日期/表情/时间；明细点开详情时按需单查）
  select coalesce(jsonb_agg(x), '[]'::jsonb)
    into v_records
    from (
      select jsonb_build_object(
               'id', r.id, 'student_name', r.student_name, 'class', r.class,
               'record_date', r.record_date, 'self_evaluation', r.self_evaluation,
               'mood', coalesce(r.behavior->>'mood', ''), 'create_at', r.create_at)
        from public.daily_record r
       where btrim(r.class) = btrim(p_class)
         and r.record_date >= v_since
         and (p_semester is null or r.semester = p_semester)
       order by r.record_date desc, r.create_at desc
       limit 500
    ) x;

  -- 3) 今日任务（墙上"今日任务"区）
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'task_type', t.task_type)
           order by t.id), '[]'::jsonb)
    into v_tasks
    from public.daily_task t
   where btrim(t.class) = btrim(p_class)
     and t.task_date = v_today;

  -- 4) 座位表（前端 seat_row*6+seat_col 规则不变，这里原样返回行数据）
  select coalesce(jsonb_agg(jsonb_build_object(
           'student_name', s.student_name, 'seat_row', s.seat_row, 'seat_col', s.seat_col)), '[]'::jsonb)
    into v_seat
    from public.seat_grid s
   where btrim(s.class) = btrim(p_class);

  -- 5) 今日任务提交（task_submission 无 class/date 列，按当天任务 id 查）
  v_task_ids := (select coalesce(array_agg(t.id), '{}'::bigint[])
                   from public.daily_task t
                  where btrim(t.class) = btrim(p_class) and t.task_date = v_today);
  if cardinality(v_task_ids) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'student_name', su.student_name, 'task_id', su.task_id, 'grade', su.grade)), '[]'::jsonb)
      into v_subs
      from public.task_submission su
     where su.task_id = any(v_task_ids);
  else
    v_subs := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'ok', true,
    'roster', v_roster,
    'records', v_records,
    'tasks',   v_tasks,
    'seat',    v_seat,
    'subs',    v_subs
  );
end;
$$;

-- 学生端为匿名访问，须授权 anon（authenticated 一并授予无妨）
revoke execute on function public.get_wall_data(text, text) from public;
grant execute on function public.get_wall_data(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
