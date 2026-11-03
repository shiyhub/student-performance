-- ============================================================================
-- 96-avatar-keys-v6.sql  set_student_avatar 白名单 v6
--   在 56c 基础上扩展：mecha5 / warrior1-6 / fantasy8-11 / xian1-5 纳入四档品质头像校验
--   （修复：56c 只认 mecha[1-4]/fantasy[1-7]，warrior/xian/mecha5 会漏到
--      emoji 兜底分支——绕过等级限制且与 enforce_student_unlocks 回退冲突）
--   与 95 号同口径：mecha5/warrior5/warrior6 需 Lv.9（传说神将），
--      warrior1-4 需 Lv.6，fantasy 需 Lv.7，xian 需 Lv.8，mecha1-4 需 Lv.6。
--   本文件为 56c 的完整替代，可重复执行；若已执行过 56c，直接执行本文件覆盖即可。
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
  v_is_new     := v_is_sweet or v_is_game or v_is_nature or v_is_mecha or v_is_warrior or v_is_fantasy or v_is_xian;
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

notify pgrst, 'reload schema';

-- ============================================================================
-- 自检
-- ============================================================================
-- ① Lv.6 学生换 mecha5：   select public.set_student_avatar('一班','Lv6学生','mecha5');
--    -- 期望 ok=false, reason=locked_tier（mecha5 需 Lv.9）
-- ② Lv.9 学生换 warrior6：  select public.set_student_avatar('一班','Lv9学生','warrior6');
--    -- 期望 ok=true, changed=true
-- ③ Lv.6 学生换 warrior1：  select public.set_student_avatar('一班','Lv6学生','warrior1');
--    -- 期望 ok=true（warrior1-4 为 Lv.6）
-- ④ Lv.5 学生换 warrior1：  select public.set_student_avatar('一班','Lv5学生','warrior1');
--    -- 期望 ok=false, reason=locked_tier
-- ⑤ Lv.7 学生换 fantasy8：  select public.set_student_avatar('一班','Lv7学生','fantasy8');
--    -- 期望 ok=true（fantasy 整组 Lv.7）
-- ⑥ Lv.8 学生换 xian3：     select public.set_student_avatar('一班','Lv8学生','xian3');
--    -- 期望 ok=true（xian 整组 Lv.8）
-- ⑦ Lv.7 学生换 xian1：     select public.set_student_avatar('一班','Lv7学生','xian1');
--    -- 期望 ok=false, reason=locked_tier
