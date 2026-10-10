-- ============================================================================
-- 47-unlock-guard.sql  头像/头像框/成就 后端解锁校验（经验变动·等级重算后自动兜底）
--   需求：在用户经验变动、等级重算后，自动检查当前头像/头像框的最低解锁等级，
--         若当前等级低于要求，自动回退到"当前等级可解锁的最高等级默认项"。
--   设计：
--     1) enforce_student_unlocks(sid) —— 单学生校验函数（头像 + 头像框），
--        不满足解锁条件的自动回退；成就为实时计算（get_student_profile），天然后端校验。
--     2) 触发器 trg_student_unlock_guard —— student_info 的 xp 或 level 变化时自动调用，
--        覆盖所有经验变动入口（加经验/发奖/任务评分/等级重算等），无需逐个 RPC 改动。
--     3) 全量修复语句（末尾，可选执行）：对现存学生跑一遍，修复历史遗留数据。
--   可重复执行（create or replace / drop trigger if exists）。
--   执行位置：Supabase Dashboard → SQL Editor → 粘贴运行
-- ============================================================================

-- 1) 单学生校验函数 ---------------------------------------------------------
create or replace function public.enforce_student_unlocks(p_sid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class   text;
  v_name    text;
  v_xp      int;
  v_level   int;
  v_avatar  text;
  v_frame   text;
  m         jsonb;
  v_avatar_ok boolean := true;
  v_frame_ok  boolean := true;
  v_new_avatar text := null;
  v_new_frame  text := null;
begin
  select class, student_name, xp, level, avatar, frame
    into v_class, v_name, v_xp, v_level, v_avatar, v_frame
    from public.student_info
   where id = p_sid;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  v_level := coalesce(v_level, 1);

  -- ── 头像解锁等级校验（与前端 IMG_KEY_RE / 分组同口径）──
  v_avatar := nullif(btrim(coalesce(v_avatar, '')), '');
  if v_avatar is not null then
    if v_avatar ~ '^animal([1-9]|1[0-9]|2[0-4])$' then
      v_avatar_ok := true;                                   -- 基础小动物：无等级要求
    elsif v_avatar ~ '^(girl|boy|neutral)[1-8]$' then
      v_avatar_ok := v_level >= 3;                           -- 校园 Lv3
    elsif v_avatar ~ '^(magic|star)[1-8]$' or v_avatar ~ '^(mg|arm|wp)[1-3]$' then
      v_avatar_ok := v_level >= 6;                           -- 典藏 Lv6
    elsif v_avatar ~ '^(guofeng|dou|cat)[1-9]$' then
      v_avatar_ok := v_level >= 7;                           -- 大师典藏 Lv7
    else
      v_avatar_ok := true;                                   -- emoji/旧key：展示层已迁移，不强改
    end if;

    if not v_avatar_ok then
      v_new_avatar := case
        when v_level >= 7 then 'guofeng1'                    -- 最高可解锁档默认：大师
        when v_level >= 6 then 'mg1'                         -- 典藏档默认：机甲
        when v_level >= 3 then 'girl1'                       -- 校园档默认
        else 'animal1'                                       -- 基础档默认
      end;
    end if;
  end if;

  -- ── 头像框解锁校验（等级类 + 计数类，与 set_student_frame 同口径）──
  m := public.student_metrics(v_class, v_name);
  v_frame := coalesce(nullif(btrim(coalesce(v_frame, '')), ''), 'none');
  if v_frame <> 'none' then
    v_frame_ok := case v_frame
      when 'bronze'   then (m->>'total_days')::int >= 10
      when 'silver'   then (m->>'total_days')::int >= 30
      when 'gold'     then v_level >= 5
      when 'rainbow'  then v_level >= 7
      when 'star'     then (m->>'active_records')::int >= 20
      when 'heart'    then (m->>'perfect_tasks')::int >= 5
      when 'crown'    then (m->>'rank_in_class')::int <= 3
      when 'tac'      then v_level >= 2
      when 'sakura'   then v_level >= 2
      when 'gun'      then v_level >= 3
      when 'pixie'    then v_level >= 3
      when 'mecha'    then v_level >= 4
      when 'magic'    then v_level >= 4
      when 'wolf'     then v_level >= 5
      when 'rose'     then v_level >= 5
      when 'fairy'    then v_level >= 5
      when 'dragon'   then v_level >= 6
      when 'queen'    then v_level >= 6
      when 'princess' then v_level >= 6
      else false                                              -- 未知框：回退
    end;

    if not v_frame_ok then
      v_new_frame := case
        when v_level >= 7 then 'rainbow'                      -- 满级默认框
        when v_level >= 6 then 'dragon'
        when v_level >= 5 then 'wolf'
        when v_level >= 4 then 'mecha'
        when v_level >= 3 then 'gun'
        when v_level >= 2 then 'tac'
        else 'none'
      end;
    end if;
  end if;

  if v_new_avatar is not null or v_new_frame is not null then
    update public.student_info
       set avatar = coalesce(v_new_avatar, v_avatar),
           frame  = case when coalesce(v_new_frame, coalesce(v_frame,'none')) = 'none'
                         then null else coalesce(v_new_frame, coalesce(v_frame,'none')) end
     where id = p_sid;
  end if;

  return jsonb_build_object(
    'ok', true,
    'level', v_level,
    'xp', v_xp,
    'avatar', coalesce(v_new_avatar, v_avatar),
    'frame',  coalesce(v_new_frame, v_frame),
    'avatar_fixed', v_new_avatar is not null,
    'frame_fixed',  v_new_frame  is not null
  );
end;
$$;

revoke execute on function public.enforce_student_unlocks(uuid) from public;
grant  execute on function public.enforce_student_unlocks(uuid) to anon, authenticated;

-- 2) 触发器：经验(xp)或等级(level)变化时自动校验 ----------------------------
create or replace function public.trg_student_unlock_guard()
returns trigger
language plpgsql
as $$
begin
  perform public.enforce_student_unlocks(new.id);
  return new;
end;
$$;

drop trigger if exists trg_student_unlock_guard on public.student_info;
create trigger trg_student_unlock_guard
after update of xp, level on public.student_info
for each row
when (new.xp is distinct from old.xp or new.level is distinct from old.level)
execute function public.trg_student_unlock_guard();

-- 3) 全量修复（可选）：对所有现存学生跑一遍，修复历史遗留的不合规头像/头像框 ----
--    select public.enforce_student_unlocks(id) as fixed from public.student_info;

notify pgrst, 'reload schema';

-- 自检（可选，SQL Editor 依次执行）：
--   select public.enforce_student_unlocks(id) from public.student_info where student_name='某学生';
--   触发器生效验证：update public.student_info set xp = xp where id = (select id from public.student_info limit 1); -- xp 不变不触发
