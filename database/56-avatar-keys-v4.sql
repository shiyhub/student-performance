-- ============================================================================
-- 56-avatar-keys-v4.sql  set_student_avatar 白名单 v3（Lv4 档新增游戏风头像）
--   在 50 基础上补充：sweet1~18（甜美少女扩到 18 款）、game1~15（游戏风扩到 15 款）。本文件为 50 的完整替代，可重复执行；若已执行过 50，直接执行本文件覆盖即可。
--   本文件为 48 的完整替代，可重复执行；若已执行过 48，直接执行本文件覆盖即可。
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
  v_is_game    boolean;   -- v2.1 Lv4 游戏风
  v_is_nature  boolean;   -- Lv5 森系田园
  v_is_mecha   boolean;   -- Lv6 机甲战士
  v_is_fantasy boolean;   -- Lv7 奇幻神域
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

  -- 白名单：与前端 js/student.js 的 IMG_KEY_RE / 分组完全一致
  v_is_animal  := v_key ~ '^animal([1-9]|1[0-9]|2[0-4])$';
  v_is_campus  := v_key ~ '^(girl|boy|neutral)[1-8]$';
  v_is_legend  := v_key ~ '^(magic|star)[1-8]$' or v_key ~ '^(mg|arm|wp)[1-3]$';
  v_is_master  := v_key ~ '^(guofeng|dou|cat)[1-9]$';
  v_is_sweet   := v_key ~ '^sweet([1-9]|1[0-8])$';
  v_is_game    := v_key ~ '^game([1-9]|1[0-5])$';
  v_is_nature  := v_key ~ '^nature[1-4]$';
  v_is_mecha   := v_key ~ '^mecha[1-4]$';
  v_is_fantasy := v_key ~ '^fantasy[1-7]$';
  v_is_new     := v_is_sweet or v_is_game or v_is_nature or v_is_mecha or v_is_fantasy;
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

  -- 四档品质头像：按档位等级校验，保存不消耗表情限额
  if v_is_new then
    v_need := case
      when v_is_sweet or v_is_game then 4
      when v_is_nature then 5
      when v_is_mecha then 6
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

  -- 基础小动物头像：每天限换 2 次（与前端"每天可换 2 次"提示一致）
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

notify pgrst, 'reload schema';

-- 自检（在 SQL Editor 里依次执行查看返回）：
--   select public.set_student_avatar('六年级一班','某学生','game1');      -- 4级学生应 ok=true（不消耗动物次数）
--   select public.set_student_avatar('六年级一班','某学生','sweet1');     -- 4级学生应 ok=true
--   select public.set_student_avatar('六年级一班','某学生','game8');      -- 3级学生应 reason=locked_tier
--   select public.set_student_avatar('六年级一班','某学生','nature1');    -- 4级学生应 reason=locked_tier