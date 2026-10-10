-- ============================================================================
-- 48-achievements-auto-sync.sql  成就自动结算（后端持久化，不再依赖进主页）
--   背景：成就原本由 get_student_profile 在学生"进入主页"时实时计算，
--         学生不进入主页成就就永不结算（尤其"班级前三"这类动态成就）。
--   方案：
--     1) 新建 student_achievements 表：记录"已解锁成就"，解锁后永久保留
--     2) sync_student_achievements(sid)：按 14 项条件自动结算并写入（幂等）
--     3) 触发器 trg_student_unlock_guard 追加调用：经验(xp)/等级(level)变化即自动结算，
--        覆盖加经验/发奖/任务评分/等级重算等所有入口，无需学生进主页
--     4) get_student_profile 改读持久化表：解锁状态由后端结算决定，结构完全兼容前端
--   可重复执行（create or replace / drop trigger / create table if not exists）。
--   执行位置：Supabase Dashboard → SQL Editor → 粘贴运行
-- ============================================================================

-- 1) 成就持久化表 ------------------------------------------------------------
create table if not exists public.student_achievements (
  student_id  uuid        not null references public.student_info(id) on delete cascade,
  a_key       text        not null,
  unlocked_at timestamptz not null default now(),
  primary key (student_id, a_key)
);

alter table public.student_achievements enable row level security;
-- 不建任何直接读写的 policy：仅 security definer 函数（sync/get_student_profile）可访问，
-- 前端一律经 get_student_profile RPC 读取，防止绕过校验。

-- 2) 徽章构造（结构兼容前端 ach_badge，解锁状态由持久化表决定）------------------
create or replace function public.ach_badge_ex(
  p_keys text[], p_key text, p_icon text, p_name text, p_desc text,
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
    'unlocked', p_key = any(p_keys)
  );
$$;

-- 3) 自动结算函数（单学生）---------------------------------------------------
create or replace function public.sync_student_achievements(p_sid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_class  text;
  v_name   text;
  v_level  int;
  m        jsonb;
  v_new    int := 0;
  v_total  int := 0;
  v_found  boolean;
begin
  select class, student_name, level
    into v_class, v_name, v_level
    from public.student_info
   where id = p_sid;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  v_level := coalesce(v_level, 1);
  m := public.student_metrics(v_class, v_name);

  -- 逐项判定：满足即写入（on conflict do nothing，解锁后永久保留）
  if (m->>'total_records')::int >= 1 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'first_record')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if (m->>'total_days')::int >= 10 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'days10')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if (m->>'total_days')::int >= 30 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'days30')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if v_level >= 2 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'level2')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if v_level >= 3 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'level3')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if v_level >= 5 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'level5')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if v_level >= 7 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'level7')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if (m->>'good_tasks')::int >= 10 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'good10')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if (m->>'good_tasks')::int >= 30 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'good30')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if (m->>'perfect_tasks')::int >= 5 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'perfect5')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if (m->>'perfect_tasks')::int >= 15 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'perfect15')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if (m->>'tasks_done')::int >= 10 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'tasks10')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  if (m->>'active_records')::int >= 20 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'active20')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;
  -- 班级前三：实时排名 <= 3 即解锁（每次经验变动自动结算，无需进主页）
  if (m->>'rank_in_class')::int <= 3 then
    insert into public.student_achievements(student_id, a_key) values (p_sid, 'top3')
    on conflict do nothing returning 1 into v_found; if v_found then v_new := v_new + 1; v_found := false; end if;
  end if;

  select count(*) into v_total from public.student_achievements where student_id = p_sid;

  return jsonb_build_object('ok', true, 'new_unlocked', v_new, 'total_unlocked', v_total);
end;
$$;

revoke execute on function public.sync_student_achievements(uuid) from public;
grant  execute on function public.sync_student_achievements(uuid) to anon, authenticated;

-- 4) 触发器升级：经验/等级变化时 = 头像框兜底校验 + 成就自动结算 ------------------
create or replace function public.trg_student_unlock_guard()
returns trigger language plpgsql as $$
begin
  perform public.enforce_student_unlocks(new.id);
  perform public.sync_student_achievements(new.id);
  return new;
end;
$$;

drop trigger if exists trg_student_unlock_guard on public.student_info;
create trigger trg_student_unlock_guard
after update of xp, level on public.student_info
for each row
when (new.xp is distinct from old.xp or new.level is distinct from old.level)
execute function public.trg_student_unlock_guard();

-- 5) 学生档案改读持久化成就（结构兼容前端，前端零改动）--------------------------
create or replace function public.get_student_profile(p_class text, p_student text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sid    uuid;
  v_xp     int;
  v_level  int;
  v_avatar text;
  v_frame  text;
  m        jsonb;
  v_keys   text[] := '{}';
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

  -- 进主页也顺手同步一次（补结算最新状态，保证即时展示）
  perform public.sync_student_achievements(v_sid);

  select coalesce(array_agg(a_key), '{}') into v_keys
    from public.student_achievements
   where student_id = v_sid;

  m := public.student_metrics(p_class, p_student);

  return jsonb_build_object(
    'ok', true,
    'xp', v_xp,
    'level', v_level,
    'avatar', v_avatar,
    'frame', coalesce(v_frame, 'none'),
    'metrics', m,
    'achievements', jsonb_build_array(
      public.ach_badge_ex(v_keys,'first_record','🌱','初来乍到','提交第 1 条在校表现',(m->>'total_records')::int, 1),
      public.ach_badge_ex(v_keys,'days10','📔','记录小达人','累计记录 10 天',(m->>'total_days')::int, 10),
      public.ach_badge_ex(v_keys,'days30','🗓️','月度坚持','累计记录 30 天',(m->>'total_days')::int, 30),
      public.ach_badge_ex(v_keys,'level2','⭐','校园新星','升到 Lv.2',v_level, 2),
      public.ach_badge_ex(v_keys,'level3','🌟','学习能手','升到 Lv.3',v_level, 3),
      public.ach_badge_ex(v_keys,'level5','🎖️','班级榜样','升到 Lv.5',v_level, 5),
      public.ach_badge_ex(v_keys,'level7','👑','传奇之星','升到 Lv.7 满级',v_level, 7),
      public.ach_badge_ex(v_keys,'good10','👍','优秀少年','累计 10 次优秀 A',(m->>'good_tasks')::int, 10),
      public.ach_badge_ex(v_keys,'good30','💯','优秀达人','累计 30 次优秀 A',(m->>'good_tasks')::int, 30),
      public.ach_badge_ex(v_keys,'perfect5','🏆','完美主义','获得 5 次完美 A+',(m->>'perfect_tasks')::int, 5),
      public.ach_badge_ex(v_keys,'perfect15','🥇','完美学霸','获得 15 次完美 A+',(m->>'perfect_tasks')::int, 15),
      public.ach_badge_ex(v_keys,'tasks10','✅','作业小能手','累计完成 10 次任务',(m->>'tasks_done')::int, 10),
      public.ach_badge_ex(v_keys,'active20','🌻','积极分子','累计 20 次积极表现',(m->>'active_records')::int, 20),
      public.ach_badge_ex(v_keys,'top3','🥇','班级前三','经验冲进班级前三名',least((m->>'rank_in_class')::int, 3), 3)
    )
  );
end;
$$;

revoke execute on function public.get_student_profile(text, text) from public;
grant  execute on function public.get_student_profile(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- 6) 全量自动结算（可选，建议部署后执行一次，补齐历史成就）---------------------
--    select public.sync_student_achievements(id) as synced from public.student_info;

-- 自检（可选）：
--   select public.sync_student_achievements(id) from public.student_info where student_name='某学生';
--   select public.get_student_profile('六年级一班','某学生') -> 'achievements';
