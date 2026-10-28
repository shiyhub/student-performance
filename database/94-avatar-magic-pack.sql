-- ============================================================================
-- 94-avatar-magic-pack.sql  魔法星空头像框 6 款 + 兽耳小铺 9 款 + 新头像（新增款式）
--   1) set_student_frame：白名单新增 15 个框（ice/moon/crystal/silk/goldwing/kitty
--      + devilcat/angelcat/clover/neko/sweets/goth/broken/mono/tech），佩戴时校验等级。
--   2) enforce_student_unlocks：头像白名单加宽（mecha1-5 / warrior1-6，承接
--      新增头像 mecha5、warrior6），头像框校验新增 15 框，等级不足自动回退。
--   3) 触发器 trg_student_unlock_guard 保持不变重建。
--   与 71 号同款增量升级写法，可重复执行；须在 43/71 号之后执行。
--   执行位置：Supabase Dashboard → SQL Editor → 粘贴运行
-- ============================================================================

-- 1) 佩戴校验：set_student_frame（升级自 71 号）-----------------------------
create or replace function public.set_student_frame(
  p_class  text,
  p_student text,
  p_frame  text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_frame text := nullif(btrim(coalesce(p_frame, '')), '');
  v_sid   uuid;
  v_level int;
  m jsonb;
  v_ok boolean := false;
begin
  if v_frame is null then v_frame := 'none'; end if;

  if v_frame not in ('none','bronze','silver','gold','rainbow','star','heart','crown',
                     'tac','gun','dragon','mecha','wolf','sakura','magic','princess','queen','rose','fairy','pixie',
                     'huadian','blossom','ink','spring','redlily','mask','neonwolf',
                     'ice','moon','crystal','silk','goldwing','kitty',
                     'devilcat','angelcat','clover','neko','sweets','goth','broken','mono','tech') then
    return jsonb_build_object('ok', false, 'reason', 'bad_frame');
  end if;

  select id, level into v_sid, v_level
    from public.student_info
   where class = btrim(coalesce(p_class, ''))
     and student_name = btrim(coalesce(p_student, ''))
   limit 1;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  if v_frame = 'none' then
    v_ok := true;
  else
    m := public.student_metrics(p_class, p_student);
    v_ok := case v_frame
      when 'bronze'  then (m->>'streak_days')::int >= 3
      when 'silver'  then (m->>'streak_days')::int >= 7
      when 'gold'    then coalesce(v_level, 1) >= 5
      when 'rainbow' then coalesce(v_level, 1) >= 7
      when 'star'    then (m->>'active_records')::int >= 20
      when 'heart'   then (m->>'perfect_tasks')::int >= 5
      when 'crown'   then (m->>'rank_in_class')::int <= 3
      when 'tac'     then coalesce(v_level, 1) >= 2
      when 'sakura'  then coalesce(v_level, 1) >= 2
      when 'gun'     then coalesce(v_level, 1) >= 3
      when 'pixie'   then coalesce(v_level, 1) >= 3
      when 'mecha'   then coalesce(v_level, 1) >= 4
      when 'magic'   then coalesce(v_level, 1) >= 4
      when 'wolf'    then coalesce(v_level, 1) >= 5
      when 'rose'    then coalesce(v_level, 1) >= 5
      when 'fairy'   then coalesce(v_level, 1) >= 5
      when 'dragon'  then coalesce(v_level, 1) >= 6
      when 'queen'   then coalesce(v_level, 1) >= 6
      when 'princess'then coalesce(v_level, 1) >= 6
      when 'huadian' then coalesce(v_level, 1) >= 7
      when 'blossom' then coalesce(v_level, 1) >= 7
      when 'ink'     then coalesce(v_level, 1) >= 8
      when 'spring'  then coalesce(v_level, 1) >= 8
      when 'redlily' then coalesce(v_level, 1) >= 9
      when 'mask'    then coalesce(v_level, 1) >= 9
      when 'neonwolf'then coalesce(v_level, 1) >= 10
      when 'ice'     then coalesce(v_level, 1) >= 5
      when 'moon'    then coalesce(v_level, 1) >= 5
      when 'crystal' then coalesce(v_level, 1) >= 6
      when 'silk'    then coalesce(v_level, 1) >= 6
      when 'goldwing'then coalesce(v_level, 1) >= 7
      when 'kitty'   then coalesce(v_level, 1) >= 7
      when 'devilcat'then coalesce(v_level, 1) >= 4
      when 'angelcat'then coalesce(v_level, 1) >= 4
      when 'clover'  then coalesce(v_level, 1) >= 4
      when 'neko'    then coalesce(v_level, 1) >= 4
      when 'sweets'  then coalesce(v_level, 1) >= 5
      when 'goth'    then coalesce(v_level, 1) >= 5
      when 'broken'  then coalesce(v_level, 1) >= 5
      when 'mono'    then coalesce(v_level, 1) >= 5
      when 'tech'    then coalesce(v_level, 1) >= 6
      else false
    end;
  end if;

  if not v_ok then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'frame', v_frame);
  end if;

  update public.student_info
     set frame = case when v_frame = 'none' then null else v_frame end
   where id = v_sid;

  return jsonb_build_object('ok', true, 'frame', v_frame);
end;
$$;

revoke execute on function public.set_student_frame(text, text, text) from public;
grant  execute on function public.set_student_frame(text, text, text) to anon, authenticated;

-- 2) 兜底解锁校验：enforce_student_unlocks（升级自 71 号）----------------------
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

  -- ── 头像解锁等级校验（与前端 IMG_KEY_RE / 分组、94 号白名单同口径）──
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
    elsif v_avatar ~ '^mecha([1-9]|1[0-9])$' then
      v_avatar_ok := v_level >= 6;
    elsif v_avatar ~ '^warrior([1-9]|1[0-9])$' then
      v_avatar_ok := v_level >= 6;
    elsif v_avatar ~ '^fantasy([1-9]|1[0-1])$' then
      v_avatar_ok := v_level >= 7;
    elsif v_avatar ~ '^xian[1-5]$' then
      v_avatar_ok := v_level >= 8;
    else
      v_avatar_ok := true;
    end if;

    if not v_avatar_ok then
      v_new_avatar := case
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
      when 'huadian'  then v_level >= 7
      when 'blossom'  then v_level >= 7
      when 'ink'      then v_level >= 8
      when 'spring'   then v_level >= 8
      when 'redlily'  then v_level >= 9
      when 'mask'     then v_level >= 9
      when 'neonwolf' then v_level >= 10
      when 'ice'      then v_level >= 5
      when 'moon'     then v_level >= 5
      when 'crystal'  then v_level >= 6
      when 'silk'     then v_level >= 6
      when 'goldwing' then v_level >= 7
      when 'kitty'    then v_level >= 7
      when 'devilcat' then v_level >= 4
      when 'angelcat' then v_level >= 4
      when 'clover'   then v_level >= 4
      when 'neko'     then v_level >= 4
      when 'sweets'   then v_level >= 5
      when 'goth'     then v_level >= 5
      when 'broken'   then v_level >= 5
      when 'mono'     then v_level >= 5
      when 'tech'     then v_level >= 6
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

-- 3) 触发器保持不变（若已存在则重建，行为一致）-------------------------------
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
  after insert or update of xp, level, avatar, frame on public.student_info
  for each row execute function public.trg_student_unlock_guard();

notify pgrst, 'reload schema';

-- ============================================================================
-- 自检
-- ============================================================================
-- ① 佩戴新框（Lv.6 学生佩戴 crystal）：
--    select public.set_student_frame('一班','张三','crystal');
--    -- 期望 ok=true（若该生 Lv>=6）
-- ② 等级不足佩戴（Lv.1 学生戴 tech）：
--    select public.set_student_frame('一班','低年级学生','tech');
--    -- 期望 ok=false, reason=locked
-- ③ 新头像解锁校验（mecha5 需 Lv.6）：
--    update public.student_info set avatar='mecha5' where student_name='Lv5学生';
--    -- 期望 enforce 触发器自动回退到 nature1
-- ④ 校验函数直接调用：
--    select public.enforce_student_unlocks('学生id');
--    -- 返回 avatar_fixed / frame_fixed 反映是否需要回退
