-- ============================================================================
-- 45-avatar-keys-v141.sql  set_student_avatar 白名单同步到 v141 前端
--   背景：v139 起前端已删除旧 Q 版四组（cyber/mecha/rider/ultra），
--         典藏头像换成 机甲(mg)/铠甲(arm)/武器(wp) 各 3 款 + 魔法少女(magic)/科幻(star)；
--         大师典藏(guofeng/dou/cat) Lv.7 解锁。
--         但服务端白名单一直停留在旧版，导致 mg/arm/wp、guofeng/dou/cat
--         保存时被当成"表情头像"处理：每日 2 次额度耗尽即报错/异常计数。
--   修复：白名单对齐前端 —— 校园 Lv3 / 典藏 Lv6 / 大师 Lv7，三类图片头像不走表情限次。
--   可重复执行。
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
  v_is_campus  boolean;   -- Lv3 解锁的校园头像
  v_is_legend  boolean;   -- Lv6 解锁的典藏头像
  v_is_master  boolean;   -- Lv7 解锁的大师典藏头像
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

  -- v141 白名单：与前端 js/student.js 的 IMG_KEY_RE / 分组完全一致
  v_is_campus := v_key ~ '^(girl|boy|neutral)[1-8]$';
  v_is_legend := v_key ~ '^(magic|star)[1-8]$' or v_key ~ '^(mg|arm|wp)[1-3]$';
  v_is_master := v_key ~ '^(guofeng|dou|cat)[1-9]$';
  v_is_image  := v_is_campus or v_is_legend or v_is_master;

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

  -- 表情头像：每日限 2 次
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
--   select public.set_student_avatar('六年级一班','某学生','wp3');      -- 6级学生应 ok=true
--   select public.set_student_avatar('六年级一班','某学生','guofeng1'); -- 7级学生应 ok=true
--   select public.set_student_avatar('六年级一班','某学生','cyber1');   -- 旧 key 不再在白名单，会按表情头像处理（建议不再使用）
