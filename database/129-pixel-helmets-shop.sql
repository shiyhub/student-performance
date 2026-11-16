-- ============================================================================
-- 129-pixel-helmets-shop.sql
--   上架像素头像 game18 + 两套像素头盔头像框，并放开佩戴校验。
--   在 108 号（set_student_frame / enforce_student_unlocks）基础上扩展：
--     goldhelm    黄金头盔   Lv.7 起可佩戴，62 星光值
--     diamondhelm 钻石头盔   Lv.9 起可佩戴，72 星光值
--     game18      像素·勇者  头像，48 星光值（无等级门槛，购买即用）
--   价格口径沿用 115 号：装扮类上限 80，取偶数保证首次半价为整数。
--   本文件可重复执行（create or replace + on conflict）；执行位置：Supabase SQL Editor。
--   前端配合：js/student.js 的 FRAMES 已加两框、AVATAR_SM_KEYS 已加 game18；
--             css/student.css 已加 .frame-diamondhelm/.frame-goldhelm 叠加规则；
--             sw.js 已登记素材并升到 sp-cache-v93。
-- ============================================================================

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
                     'devilcat','angelcat','clover','neko','sweets','goth','broken','mono','tech',
                     'ribbon',
                     'cyber','pulse','unicorn','onyx','rosefeather',
                     'goldhelm','diamondhelm') then
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
      when 'ice'     then coalesce(v_level, 1) >= 7
      when 'moon'    then coalesce(v_level, 1) >= 7
      when 'crystal' then coalesce(v_level, 1) >= 7
      when 'silk'    then coalesce(v_level, 1) >= 7
      when 'goldwing'then coalesce(v_level, 1) >= 7
      when 'kitty'   then coalesce(v_level, 1) >= 7
      when 'devilcat'then coalesce(v_level, 1) >= 8
      when 'angelcat'then coalesce(v_level, 1) >= 8
      when 'clover'  then coalesce(v_level, 1) >= 8
      when 'neko'    then coalesce(v_level, 1) >= 8
      when 'sweets'  then coalesce(v_level, 1) >= 8
      when 'goth'    then coalesce(v_level, 1) >= 8
      when 'broken'  then coalesce(v_level, 1) >= 8
      when 'mono'    then coalesce(v_level, 1) >= 8
      when 'tech'    then coalesce(v_level, 1) >= 8
      when 'ribbon'  then coalesce(v_level, 1) >= 8
      when 'cyber'   then coalesce(v_level, 1) >= 8
      when 'pulse'   then coalesce(v_level, 1) >= 8
      when 'unicorn' then coalesce(v_level, 1) >= 8
      when 'onyx'    then coalesce(v_level, 1) >= 8
      when 'rosefeather' then coalesce(v_level, 1) >= 7
      when 'goldhelm'    then coalesce(v_level, 1) >= 7
      when 'diamondhelm' then coalesce(v_level, 1) >= 9
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
    elsif v_avatar in ('moe1','moe2') then
      v_avatar_ok := v_level >= 5;
    elsif v_avatar ~ '^moe([3-9]|10)$' then
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
      when 'rosefeather' then v_level >= 7
      when 'goldhelm'    then v_level >= 7
      when 'diamondhelm' then v_level >= 9
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


-- ------------------------------------------------------------
-- 3. 商品上架（价格可按 115 号口径随时在教师端「商店价格管理」里改）
-- ------------------------------------------------------------
insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled) values
  ('game18',      'avatar', '像素·勇者', 48, '游戏风',   1218, true),
  ('goldhelm',    'frame',  '黄金头盔',  62, '像素装备', 3301, true),
  ('diamondhelm', 'frame',  '钻石头盔',  72, '像素装备', 3302, true)
on conflict (item_key) do update
  set item_type  = excluded.item_type,
      name       = excluded.name,
      price      = excluded.price,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      enabled    = true,
      updated_at = now();

-- 兜底：装扮类不得高于 80（与 115 号同口径）
update public.shop_item set price = 80, updated_at = now()
 where item_type in ('avatar', 'frame') and price > 80;

-- ------------------------------------------------------------
-- 4. 校验：应返回 3 行，价格 48 / 62 / 72
-- ------------------------------------------------------------
select item_key, item_type, name, price, group_name, sort_order
  from public.shop_item
 where item_key in ('game18', 'goldhelm', 'diamondhelm')
 order by item_type, sort_order;

notify pgrst, 'reload schema';
