-- ============================================================================
-- 133-wall-roster-star.sql
--   修复：班级星光墙的学生卡片不显示星光值（只有点进过个人主页的学生才有数字）
--
--   根因（已定位到代码）：
--     1) get_wall_data 返回的 roster 只有 id/class/student_name/avatar/frame/
--        xp/level/is_test/test_enabled/test_show_on_wall，没有 star 字段；
--     2) 前端 renderWall() 用 Number(s.star) || 0 渲染卡片角标，拿不到就恒为 0；
--     3) 只有当学生点进个人主页、loadWallet() 调 get_student_wallet 之后，
--        才会把余额写回 roster 的那一行 —— 于是"进过主页的才有值，没进过的都是 0"。
--
--   做法：
--     ① student_directory 视图末尾追加 star（= student_wallet.balance）；
--     ② get_wall_data 的 roster 输出 star，一次请求全班都带余额；
--     ③ 前端无需改动（原本就在读 s.star；RPC 不可用时的回退路径也跟着好了）。
--
--   执行位置：Supabase → SQL Editor → 整段粘贴 → Run（幂等，可重复执行）。
--   跑完后：页面按 Ctrl+F5 强刷一次（本地有 60 秒名单缓存，强刷可立即生效）。
-- ============================================================================

-- ---------------------------------------------------------------- 1. 名单视图加 star
drop view if exists public.student_directory;

create view public.student_directory as
  select i.id, i.class, i.student_name, i.avatar, i.frame, i.xp, i.level,
         i.is_test, i.test_enabled, i.test_show_on_wall,
         coalesce(w.balance, 0) as star
    from public.student_info i
    left join public.student_wallet w
      on w.class = i.class
     and w.student_name = i.student_name;

comment on view public.student_directory is
  '学生端班级墙只读视图：班级、姓名、头像、头像框、经验、等级、测试标记、可消费星光值';
grant select on public.student_directory to anon, authenticated;

-- ---------------------------------------------------------------- 2. 班级墙聚合带上 star
drop function if exists public.get_wall_data(text, text);

create or replace function public.get_wall_data(
  p_class        text,
  p_semester     text default null,
  p_include_test boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_roster  jsonb;
  v_records jsonb;
  v_tasks   jsonb;
  v_seat    jsonb;
  v_subs    jsonb;
  v_today   date := (now() at time zone 'Asia/Shanghai')::date;
  v_since   date := v_today - 30;
  v_task_ids uuid[];
begin
  -- 1) 名单：测试学生仅在 include_test 或显式允许上墙时出现
  --    v133：追加 star（可消费星光值余额），供星光墙卡片直接显示
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'class', i.class, 'student_name', i.student_name,
           'avatar', i.avatar, 'frame', i.frame, 'xp', i.xp, 'level', i.level,
           'star', coalesce(i.star, 0),
           'is_test', i.is_test, 'test_enabled', i.test_enabled,
           'test_show_on_wall', i.test_show_on_wall)
           order by i.student_name), '[]'::jsonb)
    into v_roster
    from public.student_directory i
   where btrim(i.class) = btrim(p_class)
     and (i.is_test = false
          or (i.test_enabled = true
              and (p_include_test = true or i.test_show_on_wall = true)));

  -- 2) 近 30 天记录：与名单同口径过滤，避免测试记录混进平均星级/今日人数
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
         and not exists (
               select 1 from public.student_info ti
                where btrim(ti.class) = btrim(r.class)
                  and btrim(ti.student_name) = btrim(r.student_name)
                  and ti.is_test = true
                  and p_include_test = false)
       order by r.record_date desc, r.create_at desc
       limit 500
    ) x;

  -- 3) 今日任务
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'task_type', t.task_type)
           order by t.id), '[]'::jsonb)
    into v_tasks
    from public.daily_task t
   where btrim(t.class) = btrim(p_class)
     and t.task_date = v_today;

  -- 4) 座位表
  select coalesce(jsonb_agg(jsonb_build_object(
           'student_name', s.student_name, 'seat_row', s.seat_row, 'seat_col', s.seat_col)), '[]'::jsonb)
    into v_seat
    from public.seat_grid s
   where btrim(s.class) = btrim(p_class);

  -- 5) 今日任务提交
  v_task_ids := (select coalesce(array_agg(t.id), '{}'::uuid[])
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
    'ok', true, 'roster', v_roster, 'records', v_records,
    'tasks', v_tasks, 'seat', v_seat, 'subs', v_subs);
end;
$$;

revoke execute on function public.get_wall_data(text, text, boolean) from public;
grant  execute on function public.get_wall_data(text, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------- 自检
-- ① 视图应已有 star 列（返回 star 一行）
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'student_directory'
--  order by ordinal_position;
--
-- ② 接口应返回每人的 star（挑一个班上真实学生名，看 star 是否为非 0）
-- select jsonb_pretty(public.get_wall_data('六年级一班') -> 'roster' -> 0);
--
-- ③ 全班星光值分布（应有不同数值，不再全是 0）
-- select student_name, star from public.student_directory
--  where class = '六年级一班' order by star desc limit 10;
