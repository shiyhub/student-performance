-- ============================================================
-- 58-get-wall-data.sql  学生端班级墙聚合 RPC（三端加速方案 C）
-- 把学生端"进墙"的多次往返（名单 / 近30天记录 / 今日任务 / 座位 / 今日提交）
-- 合并为 1 次 RPC（海外数据库弱网下 RTT 高，合并次数收益最大）。
-- 需在 Supabase SQL Editor 手动执行（与 56/57 号 SQL 同流程）。可重复执行。
-- ============================================================

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
  --    v152：补充 id / class / frame —— class 供身份卡 currentRosterRow 按班匹配；
  --          frame 供班级墙直接渲染头像框（此前缺失导致墙上不显示头像框、身份卡头像回退小动物）
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'class', i.class, 'student_name', i.student_name,
           'avatar', i.avatar, 'frame', i.frame, 'xp', i.xp, 'level', i.level)
           order by i.student_name), '[]'::jsonb)
    into v_roster
    from public.student_directory i
   where btrim(i.class) = btrim(p_class);

  -- 2) 近 30 天在校表现（v146(RSK-16)：瘦身——墙只需 星级/日期/表情/时间；
  --    behavior 明细 items 与 teacher_comment 体积大，改为点开详情时按需单查，墙首屏 payload 降 90%+）
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
