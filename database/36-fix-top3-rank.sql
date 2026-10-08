-- ============================================================
-- 36-fix-top3-rank.sql —— 修复"班级前三"成就判定反转（Bug-9）
-- 29 版：ach_badge('top3', least(rank,3), 3) → unlocked = p_cur >= p_target
--   rank=1 → least=1 → 1>=3 false → 第一名反而未解锁 ❌
--   rank>=3 → least=3 → 3>=3 true  → 第三名及以后全员解锁 ❌（判定完全反转）
-- 修复：top3 改用排名判定，unlocked = rank ∈ [1,3]
-- 应用：在 Supabase SQL Editor 执行本文件即可（无需动前端）
-- ============================================================

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
      jsonb_build_object(
        'key','top3','icon','🥇','name','班级前三','desc','经验冲进班级前三名',
        'cur', least(greatest((m->>'rank_in_class')::int, 0), 3),
        'target', 3,
        'unlocked', ((m->>'rank_in_class')::int) between 1 and 3)
    )
  );
end;
$$;

revoke execute on function public.get_student_profile(text, text) from public;
grant  execute on function public.get_student_profile(text, text) to anon, authenticated;