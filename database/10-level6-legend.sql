-- ============================================================================
-- 增量升级 10：Lv6 + 48 枚典藏头像（赛博/机甲/假面/光之英雄/魔法少女/科幻）
--   1. 等级上限扩到 6 级：Lv6 = 400 经验
--   2. set_student_avatar 白名单扩展：
--      - 原 girl/boy/neutral1~8：Lv3 解锁
--      - 新 cyber/mecha/rider/ultra/magic/star1~8：Lv6 解锁
-- 可重复执行。
-- ============================================================================

-- 1) 等级上限放宽到 6
alter table public.student_info drop constraint if exists chk_student_level;
alter table public.student_info add  constraint chk_student_level check (level between 1 and 6);

-- 2) 等级阈值：L1=0 / L2=20 / L3=60 / L4=120 / L5=200 / L6=400
create or replace function public.level_from_xp(p_xp int)
returns int
language sql
immutable
as $$
  select case
           when coalesce(p_xp, 0) >= 400 then 6
           when coalesce(p_xp, 0) >= 200 then 5
           when coalesce(p_xp, 0) >= 120 then 4
           when coalesce(p_xp, 0) >= 60  then 3
           when coalesce(p_xp, 0) >= 20  then 2
           else 1
         end;
$$;

-- 3) 头像保存：白名单扩展 + Lv6 解锁
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

  -- 三类头像：表情（无 key 限制）/ 校园 Lv3 / 典藏 Lv6
  v_is_campus := v_key ~ '^(girl|boy|neutral)[1-8]$';
  v_is_legend := v_key ~ '^(cyber|mecha|rider|ultra|magic|star)[1-8]$';
  v_is_image  := v_is_campus or v_is_legend;

  -- 选的就是当前头像：幂等成功，不计数
  if v_key is not distinct from v_cur then
    v_left := case when v_changed_at::date = current_date then greatest(0, 2 - coalesce(v_changes,0)) else 2 end;
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'same',
                              'level', v_level, 'xp', v_xp, 'changes_left', v_left);
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

-- 自检：
--   select public.level_from_xp(400);   -- 应返回 6
