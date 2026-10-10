-- ============================================================
-- 增量升级 44（RSK-12）：成就系统按「经验等级 + 优秀/完美次数」重构
--   背景：原「连续打卡 3/7 天」成就对小学生不现实（周末、节假日必然中断），
--   且缺少「优秀 A」维度。本次：
--     1. student_metrics 增加 good_tasks（优秀 A 次数）指标
--     2. get_student_profile 成就列表重构为 14 项：
--        经验等级：Lv.2 / Lv.3 / Lv.5 / Lv.7
--        优秀次数：10 次 / 30 次优秀 A
--        完美次数：5 次 / 15 次完美 A+
--        保留合理项：首条记录 / 累计10天 / 累计30天 / 任务10次 / 积极20次 / 班级前三
--        （删除不现实的「连续打卡 3/7 天」）
--     3. set_student_frame 旧款头像框解锁条件同步：
--        bronze 铜环 = 累计记录 10 天（原连续3天）
--        silver 银环 = 累计记录 30 天（原连续7天）
--        其余旧款与 12 款新框解锁条件不变
-- 安全可重复执行（create or replace function）。
-- ============================================================

-- 1) 成就指标：增加 good_tasks（优秀 A 次数）--------------------------------
create or replace function public.student_metrics(p_class text, p_student text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_total_records int := 0;
  v_total_days    int := 0;
  v_active        int := 0;
  v_tasks_done    int := 0;
  v_good          int := 0;
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

  -- 任务完成数 / 优秀 A 数 / 完美 A+ 数
  select count(*) filter (where grade in ('done','good','perfect')),
         count(*) filter (where grade = 'good'),
         count(*) filter (where grade = 'perfect')
    into v_tasks_done, v_good, v_perfect
    from public.task_submission
   where class = v_class and student_name = v_name;

  -- 连续打卡（保留计算，仅作展示不再用于解锁；周末/节假日中断属正常）
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
    'good_tasks',     v_good,
    'perfect_tasks',  v_perfect,
    'streak_days',    v_streak,
    'rank_in_class',  v_rank
  );
end;
$$;

revoke execute on function public.student_metrics(text, text) from public;
grant  execute on function public.student_metrics(text, text) to anon, authenticated;

-- 2) 学生档案：成就列表重构 ------------------------------------------------
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
      public.ach_badge('days10','📔','记录小达人','累计记录 10 天',
                       (m->>'total_days')::int, 10),
      public.ach_badge('days30','🗓️','月度坚持','累计记录 30 天',
                       (m->>'total_days')::int, 30),
      public.ach_badge('level2','⭐','校园新星','升到 Lv.2',
                       v_level, 2),
      public.ach_badge('level3','🌟','学习能手','升到 Lv.3',
                       v_level, 3),
      public.ach_badge('level5','🎖️','班级榜样','升到 Lv.5',
                       v_level, 5),
      public.ach_badge('level7','👑','传奇之星','升到 Lv.7 满级',
                       v_level, 7),
      public.ach_badge('good10','👍','优秀少年','累计 10 次优秀 A',
                       (m->>'good_tasks')::int, 10),
      public.ach_badge('good30','💯','优秀达人','累计 30 次优秀 A',
                       (m->>'good_tasks')::int, 30),
      public.ach_badge('perfect5','🏆','完美主义','获得 5 次完美 A+',
                       (m->>'perfect_tasks')::int, 5),
      public.ach_badge('perfect15','🥇','完美学霸','获得 15 次完美 A+',
                       (m->>'perfect_tasks')::int, 15),
      public.ach_badge('tasks10','✅','作业小能手','累计完成 10 次任务',
                       (m->>'tasks_done')::int, 10),
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

-- 3) 头像框解锁条件同步（旧款 bronze/silver 不再依赖连续打卡）---------------
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

  if v_frame not in ('none','bronze','silver','gold','rainbow','star','heart','crown',
                     'tac','gun','dragon','mecha','wolf','sakura','magic','princess','queen','rose','fairy','pixie') then
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
      when 'bronze'  then (m->>'total_days')::int >= 10
      when 'silver'  then (m->>'total_days')::int >= 30
      when 'gold'    then coalesce(v_level, 1) >= 5
      when 'rainbow' then coalesce(v_level, 1) >= 7
      when 'star'    then (m->>'active_records')::int >= 20
      when 'heart'   then (m->>'perfect_tasks')::int >= 5
      when 'crown'   then (m->>'rank_in_class')::int <= 3
      when 'tac'     then coalesce(v_level, 1) >= 2
      when 'sakura'  then coalesce(v_level, 1) >= 2
      when 'gun'     then coalesce(v_level, 1) >= 3
      when 'pixie'   then coalesce(v_level, 1) >= 3
      when 'mecha'   then coalesce(v_level, 1) >= 4
      when 'magic'   then coalesce(v_level, 1) >= 4
      when 'wolf'    then coalesce(v_level, 1) >= 5
      when 'rose'    then coalesce(v_level, 1) >= 5
      when 'fairy'   then coalesce(v_level, 1) >= 5
      when 'dragon'  then coalesce(v_level, 1) >= 6
      when 'queen'   then coalesce(v_level, 1) >= 6
      when 'princess'then coalesce(v_level, 1) >= 6
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
--   select public.get_student_profile('六年级一班','杨素菲');
--   select public.set_student_frame('六年级一班','某学生','bronze');
