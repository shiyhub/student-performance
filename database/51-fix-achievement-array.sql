-- ============================================================================
-- 51-fix-achievement-array.sql  修复"教师端每日任务评价保存失败"（22P02）
--   现象：教师端给学生的任务点等级 → 提示"保存失败，请重试"。
--   根因：49 号迁移中 sync_student_achievements 的数组拼接写法
--         `v_should := v_should || 'first_record'` 在 PostgreSQL 中会把右侧
--         unknown 字符串当作数组字面量解析（'first_record' 缺花括号）→ 22P02
--         （malformed array literal）。触发器链：
--         submit_task 更新 xp → trg_student_unlock_guard → sync_student_achievements
--         报错 → 整个事务回滚 → 保存失败。学生端进主页同样受影响。
--   修复：① 防御性修复 student_achievements.a_key 列类型（若被误建成数组则转回 text）
--         ② 重新部署修正版成就函数（数组拼接改用 array_append，杜绝 22P02）
--         ③ 全量纠错：为所有学生重新结算成就（幂等）
--         ④ 自检：查一个学生档案确认恢复正常
--   可重复执行。执行位置：Supabase Dashboard → SQL Editor → 粘贴运行（整段执行）。
-- ============================================================================

-- ① 防御性修复：student_achievements.a_key 若被建成数组类型则转回 text ----------
do $$
declare
  v_data_type text;
  v_rows      int;
begin
  select data_type into v_data_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'student_achievements'
     and column_name  = 'a_key';

  if v_data_type = 'ARRAY' then
    -- 数组列 → 展开成多行 text 列
    create table if not exists public.student_achievements_tmp as
      select student_id, unnest(a_key) as a_key, unlocked_at
        from public.student_achievements;
    get diagnostics v_rows = row_count;

    drop table public.student_achievements;

    create table public.student_achievements (
      student_id  uuid        not null references public.student_info(id) on delete cascade,
      a_key       text        not null,
      unlocked_at timestamptz not null default now(),
      primary key (student_id, a_key)
    );
    alter table public.student_achievements enable row level security;

    insert into public.student_achievements (student_id, a_key, unlocked_at)
      select student_id, a_key, unlocked_at from public.student_achievements_tmp;
    drop table public.student_achievements_tmp;

    raise notice 'student_achievements.a_key 已从数组修复为 text（迁移 % 行）', v_rows;
  else
    raise notice 'student_achievements.a_key 类型正常（%），无需修复', v_data_type;
  end if;
end $$;

-- ② 重新部署修正版成就函数（数组拼接用 array_append，杜绝 22P02）----------------
-- 1) 成就持久化表（若已存在则保持，① 已确保结构正确）
create table if not exists public.student_achievements (
  student_id  uuid        not null references public.student_info(id) on delete cascade,
  a_key       text        not null,
  unlocked_at timestamptz not null default now(),
  primary key (student_id, a_key)
);

alter table public.student_achievements enable row level security;
-- 不建任何直接读写的 policy：仅 security definer 函数可访问，前端经 get_student_profile 读取。

-- 2) 徽章构造（结构兼容前端）
create or replace function public.ach_badge_ex(
  p_keys text[], p_key text, p_icon text, p_name text, p_desc text,
  p_cur int, p_target int
)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'key', p_key, 'icon', p_icon, 'name', p_name, 'desc', p_desc,
    'cur', least(p_cur, p_target), 'target', p_target,
    'unlocked', p_key = any(p_keys)
  );
$$;

-- 3) 自动结算函数（动态双向同步：达标解锁 / 不达标撤销）
--    ★ 修正：v_should 数组追加一律用 array_append(v_should, 'xxx')，
--      不用 `|| 'xxx'`（unknown 字符串会被当作数组字面量解析 → 22P02）
create or replace function public.sync_student_achievements(p_sid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_class   text;
  v_name    text;
  v_level   int;
  m         jsonb;
  v_should  text[] := '{}';   -- 当前条件下应解锁的成就集合
  v_new     int := 0;
  v_revoked int := 0;
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

  -- ── 计算应解锁集合（14 项，条件与 get_student_profile 完全一致）──
  if (m->>'total_records')::int >= 1  then v_should := array_append(v_should, 'first_record'); end if;
  if (m->>'total_days')::int    >= 10 then v_should := array_append(v_should, 'days10'); end if;
  if (m->>'total_days')::int    >= 30 then v_should := array_append(v_should, 'days30'); end if;
  if v_level >= 2 then v_should := array_append(v_should, 'level2'); end if;
  if v_level >= 3 then v_should := array_append(v_should, 'level3'); end if;
  if v_level >= 5 then v_should := array_append(v_should, 'level5'); end if;
  if v_level >= 7 then v_should := array_append(v_should, 'level7'); end if;
  if (m->>'good_tasks')::int    >= 10 then v_should := array_append(v_should, 'good10'); end if;
  if (m->>'good_tasks')::int    >= 30 then v_should := array_append(v_should, 'good30'); end if;
  if (m->>'perfect_tasks')::int >= 5  then v_should := array_append(v_should, 'perfect5'); end if;
  if (m->>'perfect_tasks')::int >= 15 then v_should := array_append(v_should, 'perfect15'); end if;
  if (m->>'tasks_done')::int    >= 10 then v_should := array_append(v_should, 'tasks10'); end if;
  if (m->>'active_records')::int >= 20 then v_should := array_append(v_should, 'active20'); end if;
  -- 班级前三：实时排名 <= 3（动态：被挤出前三自动撤销）
  if (m->>'rank_in_class')::int <= 3 then v_should := array_append(v_should, 'top3'); end if;

  -- ── 纠错：删除已不再达标的成就（自动撤销）──
  delete from public.student_achievements
   where student_id = p_sid
     and not (a_key = any(v_should));
  get diagnostics v_revoked = row_count;

  -- ── 补齐：写入新达标的成就（新解锁，unlocked_at 保留首次解锁时间）──
  insert into public.student_achievements(student_id, a_key)
  select p_sid, k from unnest(v_should) as k
  on conflict (student_id, a_key) do nothing;
  get diagnostics v_new = row_count;

  return jsonb_build_object(
    'ok', true,
    'new_unlocked', v_new,
    'revoked', v_revoked,
    'total_unlocked', (select count(*) from public.student_achievements where student_id = p_sid)
  );
end;
$$;

revoke execute on function public.sync_student_achievements(uuid) from public;
grant  execute on function public.sync_student_achievements(uuid) to anon, authenticated;

-- 4) 触发器：经验/等级变化 = 头像框兜底 + 成就动态同步
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

-- 5) 学生档案读持久化成就（动态状态，结构兼容前端）
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

  -- 进主页也顺手同步一次（补结算 + 纠错，保证即时展示）
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

-- ③ 全量纠错：为所有学生重新结算成就（幂等，可重复执行；返回每名学生的新解锁/撤销数）--
select count(*) as synced_students
  from (select public.sync_student_achievements(id) from public.student_info) t;

-- ④ 自检：查一个学生档案，应返回 ok=true 且无报错（原 22P02 应消失）---------------
select public.get_student_profile('六年级一班','杨鑫') -> 'ok' as profile_ok,
       public.get_student_profile('六年级一班','杨鑫') -> 'achievements' as achievements_sample;
