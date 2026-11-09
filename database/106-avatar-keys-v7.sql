-- ============================================================================
-- 106-avatar-keys-v7.sql  新增「萌趣Q版」chibi1~4 头像白名单（v7）
--   在 96 号（set_student_avatar）与 103 号（enforce_student_unlocks）基础上扩展：
--     chibi1  绿恐龙套娃 ：Lv.5 解锁（与 nature 同档）
--     chibi2  白发蝴蝶结 ：Lv.6 解锁
--     chibi3  粉发美乐蒂 ：Lv.6 解锁
--     chibi4  棕发红衣    ：Lv.6 解锁
--   口径与前端 js/student.js 的 CHIBI_AVATARS / IMG_KEY_RE 一致。
--   本文件可重复执行（create or replace）；不改动头像框（frame）白名单。
--   执行位置：Supabase Dashboard → SQL Editor → 粘贴运行
-- ============================================================================

create or replace function public.set_student_avatar(
  p_class   text,
  p_student text,
  p_avatar  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid        uuid;
  v_cur        text;
  v_xp         int;
  v_level      int;
  v_changed_at timestamptz;
  v_changes    smallint;
  v_key        text;
  v_is_image   boolean;
  v_is_animal  boolean;   -- 基础小动物头像 animal1~24：每天限换 2 次
  v_is_campus  boolean;   -- Lv3 解锁的校园头像
  v_is_legend  boolean;   -- Lv6 解锁的典藏头像
  v_is_master  boolean;   -- Lv7 解锁的大师典藏头像
  v_is_sweet   boolean;   -- Lv4 甜美少女
  v_is_game    boolean;   -- Lv4 游戏风
  v_is_nature  boolean;   -- Lv5 森系田园
  v_is_mecha   boolean;   -- Lv6 机甲战士（mecha1-4）
  v_is_warrior boolean;   -- v6：次元武士 warrior1-4（Lv6）/ warrior5-6（Lv9）
  v_is_fantasy boolean;   -- Lv7 奇幻神域（fantasy1-11）
  v_is_xian    boolean;   -- v6：国风仙韵 xian1-5（Lv8）
  v_is_chibi   boolean;   -- v165：萌趣Q版 chibi1(Lv5)/chibi2-4(Lv6)
  v_is_new     boolean;
  v_need       int;
  v_left       int;
begin
  v_key := nullif(btrim(coalesce(p_avatar, '')), '');
  if v_key is null or length(v_key) > 24 then
    return jsonb_build_object('ok', false, 'reason', 'bad_key', 'changed', false);
  end if;

  select id, avatar, xp, level, avatar_changed_at, avatar_changes_today
    into v_sid, v_cur, v_xp, v_level, v_changed_at, v_changes
  from public.student_info
  where class = btrim(coalesce(p_class, ''))
    and student_name = btrim(coalesce(p_student, ''));

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student', 'changed', false);
  end if;

  -- 白名单：与前端 js/student.js 的 IMG_KEY_RE / 分组一致（v6 补 warrior/xian/mecha5/fantasy8-11）
  v_is_animal  := v_key ~ '^animal([1-9]|1[0-9]|2[0-4])$';
  v_is_campus  := v_key ~ '^(girl|boy|neutral)[1-8]$';
  v_is_legend  := v_key ~ '^(magic|star)[1-8]$' or v_key ~ '^(mg|arm|wp)[1-3]$';
  v_is_master  := v_key ~ '^(guofeng|dou|cat)[1-9]$';
  v_is_sweet   := v_key ~ '^sweet([1-9]|1[0-9]|2[0-2])$';
  v_is_game    := v_key ~ '^game([1-9]|1[0-7])$';
  v_is_nature  := v_key ~ '^nature[1-8]$';
  v_is_mecha   := v_key ~ '^mecha[1-5]$';
  v_is_warrior := v_key ~ '^warrior[1-6]$';
  v_is_fantasy := v_key ~ '^fantasy([1-9]|1[0-1])$';
  v_is_xian    := v_key ~ '^xian[1-5]$';
  v_is_chibi   := v_key ~ '^chibi[1-4]$';
  v_is_new     := v_is_sweet or v_is_game or v_is_nature or v_is_mecha or v_is_warrior or v_is_fantasy or v_is_xian or v_is_chibi;
  v_is_image   := v_is_campus or v_is_legend or v_is_master or v_is_new;

  -- 选的就是当前头像：幂等成功，不计数
  if v_key is not distinct from v_cur then
    v_left := case when v_changed_at::date = current_date then greatest(0, 2 - coalesce(v_changes,0)) else 2 end;
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'same',
                              'level', v_level, 'xp', v_xp, 'changes_left', v_left);
  end if;

  -- Lv7 大师典藏头像
  if v_is_master then
    if coalesce(v_level, 1) < 7 then
      return jsonb_build_object('ok', false, 'reason', 'locked_master', 'changed', false,
                                'level', v_level, 'xp', v_xp, 'changes_left', 0);
    end if;
    update public.student_info set avatar = v_key where id = v_sid;
    return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                              'level', v_level, 'xp', v_xp, 'changes_left', -1);
  end if;

  -- Lv6 典藏头像
  if v_is_legend then
    if coalesce(v_level, 1) < 6 then
      return jsonb_build_object('ok', false, 'reason', 'locked_legend', 'changed', false,
                                'level', v_level, 'xp', v_xp, 'changes_left', 0);
    end if;
    update public.student_info set avatar = v_key where id = v_sid;
    return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                              'level', v_level, 'xp', v_xp, 'changes_left', -1);
  end if;

  -- 品质头像：按档位等级校验（v6：mecha5/warrior5-6 需 Lv.9，warrior1-4 Lv.6，xian Lv.8）
  if v_is_new then
    v_need := case
      when v_is_sweet or v_is_game then 4
      when v_is_nature then 5
      when v_key in ('mecha5','warrior5','warrior6') then 9
      when v_is_mecha or v_is_warrior then 6
      when v_is_fantasy then 7
      when v_is_xian then 8
      when v_key = 'chibi1' then 5
      when v_is_chibi then 6
      else 7
    end;
    if coalesce(v_level, 1) < v_need then
      return jsonb_build_object('ok', false, 'reason', 'locked_tier', 'changed', false,
                                'level', v_level, 'xp', v_xp, 'changes_left', 0);
    end if;
    update public.student_info set avatar = v_key where id = v_sid;
    return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                              'level', v_level, 'xp', v_xp, 'changes_left', -1);
  end if;

  -- Lv3 校园头像
  if v_is_campus then
    if coalesce(v_level, 1) < 3 then
      return jsonb_build_object('ok', false, 'reason', 'locked', 'changed', false,
                                'level', v_level, 'xp', v_xp, 'changes_left', 0);
    end if;
    update public.student_info set avatar = v_key where id = v_sid;
    return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                              'level', v_level, 'xp', v_xp, 'changes_left', -1);
  end if;

  -- 基础小动物头像：每天限换 2 次
  if v_is_animal then
    if v_changed_at::date is distinct from current_date then
      v_changes := 0;
    end if;
    if coalesce(v_changes, 0) >= 2 then
      return jsonb_build_object('ok', false, 'reason', 'limit', 'changed', false,
                                'level', v_level, 'xp', v_xp, 'changes_left', 0);
    end if;
    v_changes := coalesce(v_changes, 0) + 1;
    update public.student_info
       set avatar = v_key,
           avatar_changed_at = now(),
           avatar_changes_today = v_changes
     where id = v_sid;
    return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                              'level', v_level, 'xp', v_xp,
                              'changes_left', greatest(0, 2 - v_changes));
  end if;

  -- 其他表情头像（emoji）：每天限换 2 次（保留）
  if v_changed_at::date is distinct from current_date then
    v_changes := 0;
  end if;

  if coalesce(v_changes, 0) >= 2 then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'changed', false,
                              'level', v_level, 'xp', v_xp, 'changes_left', 0);
  end if;

  v_changes := coalesce(v_changes, 0) + 1;
  update public.student_info
     set avatar = v_key,
         avatar_changed_at = now(),
         avatar_changes_today = v_changes
   where id = v_sid;

  return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                            'level', v_level, 'xp', v_xp,
                            'changes_left', greatest(0, 2 - v_changes));
end;
$$;

revoke execute on function public.set_student_avatar(text, text, text) from public;
grant  execute on function public.set_student_avatar(text, text, text) to anon, authenticated;

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

  -- ── 头像解锁等级校验（与 95 号同口径，不变）──
  v_avatar := nullif(btrim(coalesce(v_avatar, '')), '');
  if v_avatar is not null then
    if v_avatar ~ '^animal([1-9]|1[0-9]|2[0-4])$' then
      v_avatar_ok := true;
    elsif v_avatar ~ '^(girl|boy|neutral)[1-8]$' then
      v_avatar_ok := v_level >= 3;
    elsif v_avatar ~ '^sweet([1-9]|1[0-9]|2[0-2])$' then
      v_avatar_ok := v_level >= 4;
    elsif v_avatar ~ '^game([1-9]|1[0-7])$' then
      v_avatar_ok := v_level >= 4;
    elsif v_avatar ~ '^nature[1-8]$' then
      v_avatar_ok := v_level >= 5;
    elsif v_avatar in ('mecha5','warrior5','warrior6') then
      v_avatar_ok := v_level >= 9;
    elsif v_avatar ~ '^mecha[1-4]$' then
      v_avatar_ok := v_level >= 6;
    elsif v_avatar ~ '^warrior[1-4]$' then
      v_avatar_ok := v_level >= 6;
    elsif v_avatar ~ '^fantasy([1-9]|1[0-1])$' then
      v_avatar_ok := v_level >= 7;
    elsif v_avatar ~ '^xian[1-5]$' then
      v_avatar_ok := v_level >= 8;
    elsif v_avatar = 'chibi1' then
      v_avatar_ok := v_level >= 5;
    elsif v_avatar ~ '^chibi[2-4]$' then
      v_avatar_ok := v_level >= 6;
    else
      v_avatar_ok := true;
    end if;

    if not v_avatar_ok then
      v_new_avatar := case
        when v_level >= 9 then 'mecha5'
        when v_level >= 8 then 'xian1'
        when v_level >= 7 then 'fantasy1'
        when v_level >= 6 then 'mecha1'
        when v_level >= 5 then 'nature1'
        when v_level >= 4 then 'sweet1'
        when v_level >= 3 then 'girl1'
        else 'animal1'
      end;
    end if;
  end if;

  -- ── 头像框解锁校验（加 cyber/pulse/unicorn/onyx，均 Lv.8）──
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
      when 'huadian'  then v_level >= 7
      when 'blossom'  then v_level >= 7
      when 'ink'      then v_level >= 8
      when 'spring'   then v_level >= 8
      when 'redlily'  then v_level >= 9
      when 'mask'     then v_level >= 9
      when 'neonwolf' then v_level >= 10
      when 'ice'      then v_level >= 7
      when 'moon'     then v_level >= 7
      when 'crystal'  then v_level >= 7
      when 'silk'     then v_level >= 7
      when 'goldwing' then v_level >= 7
      when 'kitty'    then v_level >= 7
      when 'devilcat' then v_level >= 8
      when 'angelcat' then v_level >= 8
      when 'clover'   then v_level >= 8
      when 'neko'     then v_level >= 8
      when 'sweets'   then v_level >= 8
      when 'goth'     then v_level >= 8
      when 'broken'   then v_level >= 8
      when 'mono'     then v_level >= 8
      when 'tech'     then v_level >= 8
      when 'ribbon'   then v_level >= 8
      when 'cyber'    then v_level >= 8
      when 'pulse'    then v_level >= 8
      when 'unicorn'  then v_level >= 8
      when 'onyx'     then v_level >= 8
      else false
    end;

    if not v_frame_ok then
      v_new_frame := case
        when v_level >= 9 then 'redlily'
        when v_level >= 8 then 'ink'
        when v_level >= 7 then 'rainbow'
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

notify pgrst, 'reload schema';

-- ============================================================================
-- 自检（按需在 SQL Editor 运行）
-- ① Lv.4 学生换 chibi1：  select public.set_student_avatar('一班','Lv4学生','chibi1');
--    -- 期望 ok=false, reason=locked_tier（chibi1 需 Lv.5）
-- ② Lv.5 学生换 chibi1：  select public.set_student_avatar('一班','Lv5学生','chibi1');
--    -- 期望 ok=true, changed=true
-- ③ Lv.5 学生换 chibi2：  select public.set_student_avatar('一班','Lv5学生','chibi2');
--    -- 期望 ok=false, reason=locked_tier（chibi2-4 需 Lv.6）
-- ④ Lv.6 学生换 chibi3：  select public.set_student_avatar('一班','Lv6学生','chibi3');
--    -- 期望 ok=true, changed=true
-- ⑤ 守卫回退：Lv.4 学生已戴 chibi1，select public.enforce_student_unlocks('<该生id>');
--    -- 期望 avatar_fixed=true，回退到低档位头像
-- ============================================================================
