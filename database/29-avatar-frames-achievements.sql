-- ============================================================================
-- 增量升级 29：头像框 + 成就系统
--   1. student_info 增加 frame 列（头像框 key；NULL = 无框）
--   2. student_directory 视图带上 frame，班级墙直接渲染每个人的头像框
--   3. student_metrics(班级, 姓名)：从已有数据实时计算成就指标
--      （累计记录天数 / 连续打卡 / 积极次数 / 任务完成 / 完美A+ / 班级排名）
--   4. get_student_profile(班级, 姓名)：一次返回 头像/等级/头像框/指标/成就列表
--   5. set_student_frame(班级, 姓名, 头像框)：学生经 RPC 佩戴头像框，
--      服务端校验该框是否已解锁（按成就/等级），防作弊
-- 安全可重复执行。跑完后到学生端点自己头像 → 底部出现「✨ 头像框」，
-- 左栏出现「🏅 我的成就」。
-- ============================================================================

-- 1) 名单表加头像框列 -------------------------------------------------------
alter table public.student_info add column if not exists frame text;

-- 2) 重建班级通讯录视图（多带一列 frame）------------------------------------
create or replace view public.student_directory as
  select id, class, student_name, avatar, frame, xp, level
  from public.student_info;

comment on view public.student_directory is '学生端班级墙只读视图：班级、学生姓名、头像、头像框、经验、等级';
grant select on public.student_directory to anon, authenticated;

-- 3) 成就小工具：把指标包成一个徽章对象 -------------------------------------
create or replace function public.ach_badge(
  p_key text, p_icon text, p_name text, p_desc text,
  p_cur int, p_target int
)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'key', p_key,
    'icon', p_icon,
    'name', p_name,
    'desc', p_desc,
    'cur', least(p_cur, p_target),
    'target', p_target,
    'unlocked', p_cur >= p_target
  );
$$;

-- 4) 实时计算某学生的成就指标（SECURITY DEFINER，学生端可经 RPC 读自己的） ----
create or replace function public.student_metrics(p_class text, p_student text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_total_records int := 0;
  v_total_days    int := 0;
  v_active        int := 0;
  v_tasks_done    int := 0;
  v_perfect       int := 0;
  v_streak        int := 0;
  v_rank          int := 999;
  v_d date;
begin
  -- 累计记录条数 / 累计记录天数
  select count(*), count(distinct record_date)
    into v_total_records, v_total_days
    from public.daily_record
   where class = v_class and student_name = v_name;

  -- 累计积极表现次数（遍历每条记录的 items）
  select count(*) into v_active
    from public.daily_record,
         jsonb_array_elements(coalesce(behavior -> 'items', '[]'::jsonb)) e
   where class = v_class and student_name = v_name
     and e ->> 'category' = 'positive';

  -- 任务完成数 / 完美 A+ 数
  select count(*) filter (where grade in ('done','good','perfect')),
         count(*) filter (where grade = 'perfect')
    into v_tasks_done, v_perfect
    from public.task_submission
   where class = v_class and student_name = v_name;

  -- 连续打卡：今天没记就从昨天往前数
  v_d := (now() at time zone 'Asia/Shanghai')::date;
  if not exists (
    select 1 from public.daily_record
     where class = v_class and student_name = v_name and record_date = v_d
  ) then
    v_d := v_d - 1;
  end if;
  while exists (
    select 1 from public.daily_record
     where class = v_class and student_name = v_name and record_date = v_d
  ) loop
    v_streak := v_streak + 1;
    v_d := v_d - 1;
  end loop;

  -- 班级经验排名（1 = 全班第一）
  select count(*) + 1 into v_rank
    from public.student_info
   where class = v_class
     and xp > coalesce((select xp from public.student_info
                         where class = v_class and student_name = v_name limit 1), 0);

  return jsonb_build_object(
    'total_records',  v_total_records,
    'total_days',     v_total_days,
    'active_records', v_active,
    'tasks_done',     v_tasks_done,
    'perfect_tasks',  v_perfect,
    'streak_days',    v_streak,
    'rank_in_class',  v_rank
  );
end;
$$;

revoke execute on function public.student_metrics(text, text) from public;
grant  execute on function public.student_metrics(text, text) to anon, authenticated;

-- 5) 学生档案：头像框 + 成就列表（学生端进入填写页时调用一次）----------------
create or replace function public.get_student_profile(p_class text, p_student text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sid   uuid;
  v_xp    int;
  v_level int;
  v_avatar text;
  v_frame  text;
  m jsonb;
begin
  select id, xp, level, avatar, frame
    into v_sid, v_xp, v_level, v_avatar, v_frame
    from public.student_info
   where class = btrim(coalesce(p_class, ''))
     and student_name = btrim(coalesce(p_student, ''))
   limit 1;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  m := public.student_metrics(p_class, p_student);

  return jsonb_build_object(
    'ok', true,
    'xp', v_xp,
    'level', v_level,
    'avatar', v_avatar,
    'frame', coalesce(v_frame, 'none'),
    'metrics', m,
    'achievements', jsonb_build_array(
      public.ach_badge('first_record','🌱','初来乍到','提交第 1 条在校表现',
                       (m->>'total_records')::int, 1),
      public.ach_badge('streak3','🔥','小坚持','连续打卡 3 天',
                       (m->>'streak_days')::int, 3),
      public.ach_badge('streak7','💪','坚持不懈','连续打卡 7 天',
                       (m->>'streak_days')::int, 7),
      public.ach_badge('days10','📔','记录小达人','累计记录 10 天',
                       (m->>'total_days')::int, 10),
      public.ach_badge('days30','🗓️','月度坚持','累计记录 30 天',
                       (m->>'total_days')::int, 30),
      public.ach_badge('level3','🌟','校园新星','升到 Lv.3',
                       v_level, 3),
      public.ach_badge('level5','🎖️','班级榜样','升到 Lv.5',
                       v_level, 5),
      public.ach_badge('level7','👑','传奇之星','升到 Lv.7 满级',
                       v_level, 7),
      public.ach_badge('tasks10','✅','作业小能手','累计完成 10 次任务',
                       (m->>'tasks_done')::int, 10),
      public.ach_badge('perfect5','🏆','完美主义','获得 5 次完美 A+',
                       (m->>'perfect_tasks')::int, 5),
      public.ach_badge('active20','🌻','积极分子','累计 20 次积极表现',
                       (m->>'active_records')::int, 20),
      public.ach_badge('top3','🥇','班级前三','经验冲进班级前三名',
                       least((m->>'rank_in_class')::int, 3), 3)
    )
  );
end;
$$;

revoke execute on function public.get_student_profile(text, text) from public;
grant  execute on function public.get_student_profile(text, text) to anon, authenticated;

-- 6) 学生佩戴头像框：白名单 + 服务端校验解锁条件 -----------------------------
--    解锁条件与前端展示一致：
--      bronze  铜环  = 连续打卡 3 天（成就 streak3）
--      silver  银环  = 连续打卡 7 天（成就 streak7）
--      gold    金环  = 升到 Lv.5
--      rainbow 彩虹环 = 升到 Lv.7
--      star    星光环 = 累计 20 次积极表现（成就 active20）
--      heart   爱心环 = 5 次完美 A+（成就 perfect5）
--      crown   皇冠环 = 班级经验前三（成就 top3）
create or replace function public.set_student_frame(
  p_class  text,
  p_student text,
  p_frame  text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_frame text := nullif(btrim(coalesce(p_frame, '')), '');
  v_sid   uuid;
  v_level int;
  m jsonb;
  v_ok boolean := false;
begin
  if v_frame is null then v_frame := 'none'; end if;

  if v_frame not in ('none','bronze','silver','gold','rainbow','star','heart','crown') then
    return jsonb_build_object('ok', false, 'reason', 'bad_frame');
  end if;

  select id, level into v_sid, v_level
    from public.student_info
   where class = btrim(coalesce(p_class, ''))
     and student_name = btrim(coalesce(p_student, ''))
   limit 1;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  if v_frame = 'none' then
    v_ok := true;
  else
    m := public.student_metrics(p_class, p_student);
    v_ok := case v_frame
      when 'bronze'  then (m->>'streak_days')::int >= 3
      when 'silver'  then (m->>'streak_days')::int >= 7
      when 'gold'    then coalesce(v_level, 1) >= 5
      when 'rainbow' then coalesce(v_level, 1) >= 7
      when 'star'    then (m->>'active_records')::int >= 20
      when 'heart'   then (m->>'perfect_tasks')::int >= 5
      when 'crown'   then (m->>'rank_in_class')::int <= 3
      else false
    end;
  end if;

  if not v_ok then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'frame', v_frame);
  end if;

  update public.student_info
     set frame = case when v_frame = 'none' then null else v_frame end
   where id = v_sid;

  return jsonb_build_object('ok', true, 'frame', v_frame);
end;
$$;

revoke execute on function public.set_student_frame(text, text, text) from public;
grant  execute on function public.set_student_frame(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- 自检（可选）：
--   select student_name, frame, xp, level from student_info order by xp desc limit 5;
--   select public.get_student_profile('六年级一班','某学生');
--   select public.set_student_frame('六年级一班','某学生','gold');
