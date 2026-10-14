-- ============================================================================
-- 49-achievements-dynamic-sync.sql  成就动态纠错（达标解锁 / 不达标自动撤销）
--   需求：成就要有纠错机制动态变化——条件满足自动解锁，条件不再满足自动撤销，
--         避免"错误成就"长期挂着（否则只能手动删除引发问题的成就）。
--   设计（对 48 的升级，可直接覆盖执行，可重复执行）：
--     1) 每次经验(xp)/等级(level)变动（触发器）或进主页时，
--        sync_student_achievements 会做**双向同步**：
--          达标项  → 写入（新解锁）
--          不达标项 → 删除（自动撤销/纠错）
--        成就在 student_achievements 表里的集合 = 当前条件下应解锁的集合。
--     2) 班级前三等动态成就：进前三自动解锁，被挤出前三自动撤销，
--        与 crown 头像框的实时佩戴资格一致。
--     3) 计数类成就（累计天数/优秀/完美/等级等）计数只增不减，正常不会撤销；
--        一旦数据回滚或解锁条件调整，也会自动纠正，无需手动删除。
--   执行位置：Supabase Dashboard → SQL Editor → 粘贴运行
-- ============================================================================

-- 1) 成就持久化表（若已由 48 创建则保持）--------------------------------------
create table if not exists public.student_achievements (
  student_id  uuid        not null references public.student_info(id) on delete cascade,
  a_key       text        not null,
  unlocked_at timestamptz not null default now(),
  primary key (student_id, a_key)
);

alter table public.student_achievements enable row level security;
-- 不建任何直接读写的 policy：仅 security definer 函数可访问，前端经 get_student_profile 读取。

-- 2) 徽章构造（结构兼容前端）---------------------------------------------------
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

-- 3) 自动结算函数（动态双向同步：达标解锁 / 不达标撤销）------------------------
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

-- 4) 触发器：经验/等级变化 = 头像框兜底 + 成就动态同步 ---------------------------
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

-- 5) 学生档案读持久化成就（动态状态，结构兼容前端）-----------------------------
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

-- 6) 全量纠错（可选，建议部署后执行一次：清除历史错误成就、补齐应解锁成就）------
--    select public.sync_student_achievements(id) as synced from public.student_info;

-- 自检（可选）：
--   select public.sync_student_achievements(id) from public.student_info where student_name='某学生';
--   -- 返回 new_unlocked（新解锁数）/ revoked（撤销数）/ total_unlocked（当前解锁总数）
