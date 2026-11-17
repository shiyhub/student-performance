-- ============================================================================
-- 132-drop-student-level-gates.sql
--   学生等级（student_info.level）不再作为任何佩戴 / 兑换 / 解锁门槛。
--   口径：只要商品已成功兑换（student_inventory 有记录）即可正常佩戴。
--
--   背景：
--     130 号把 set_student_frame 换回了按等级校验的旧版，导致已购买的
--     「钻石头盔」（Lv.9）在 Lv.8 学生身上无法佩戴；
--     同时 enforce_student_unlocks + trg_student_unlock_guard 会在 xp/level
--     变化时自动把不合规的头像、头像框降级。
--
--   本补丁：
--     1) 解绑 trg_student_unlock_guard（不再自动降级）
--     2) enforce_student_unlocks 改为 no-op（保留签名，旧调用不报错）
--     3) set_student_frame 回到「合法 + 已拥有即可」口径，去掉全部等级判断
--     4) set_student_avatar 同样去掉等级判断（109 版已无，此处再加一道保险）
--     5) student_inventory 放开 item_type='theme'（修卡片主题兑换 400）
--
--   不改动：
--     student_info.level / xp 字段保留（历史数据、归档表、排行口径不变），
--     只是不再参与任何使用限制与前端展示。
--
--   执行位置：Supabase → SQL Editor → 整段粘贴 → Run（幂等，可重复执行）。
-- ============================================================================

-- ---------------------------------------------------------------- 1. 解绑自动降级触发器
drop trigger if exists trg_student_unlock_guard on public.student_info;

-- ---------------------------------------------------------------- 2. 兜底函数改 no-op
-- 旧调用方（历史 SQL / 教师端脚本）仍可执行，但不再修改任何学生装扮。
create or replace function public.enforce_student_unlocks(p_sid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avatar text;
  v_frame  text;
begin
  select avatar, frame into v_avatar, v_frame
    from public.student_info
   where id = p_sid;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  return jsonb_build_object(
    'ok', true,
    'avatar', v_avatar,
    'frame',  v_frame,
    'avatar_fixed', false,
    'frame_fixed',  false,
    'skipped', 'level_gate_removed'
  );
end;
$$;

revoke execute on function public.enforce_student_unlocks(uuid) from public;
grant  execute on function public.enforce_student_unlocks(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- 3. 头像框：拥有即可佩戴
create or replace function public.set_student_frame(p_class text, p_student text, p_frame text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_key   text := coalesce(nullif(btrim(coalesce(p_frame, '')), ''), 'none');
  v_sid   uuid;
  v_bal   int;
begin
  select id into v_sid
    from public.student_info
   where class = v_class and student_name = v_name
   limit 1;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  select coalesce(balance, 0) into v_bal from public.student_wallet
   where class = v_class and student_name = v_name;

  if v_key <> 'none' then
    if not exists (select 1 from public.shop_item
                    where item_key = v_key and item_type = 'frame' and enabled) then
      return jsonb_build_object('ok', false, 'reason', 'bad_frame');
    end if;
    if not exists (select 1 from public.student_inventory
                    where class = v_class and student_name = v_name
                      and item_type = 'frame' and item_key = v_key) then
      return jsonb_build_object('ok', false, 'reason', 'not_owned', 'balance', coalesce(v_bal, 0));
    end if;
  end if;

  update public.student_info set frame = v_key where id = v_sid;

  return jsonb_build_object('ok', true, 'frame', v_key, 'balance', coalesce(v_bal, 0));
end;
$$;

revoke execute on function public.set_student_frame(text, text, text) from public;
grant  execute on function public.set_student_frame(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- 4. 头像：已拥有即可佩戴（去掉任何等级分支）
create or replace function public.set_student_avatar(p_class text, p_student text, p_avatar text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_key   text := nullif(btrim(coalesce(p_avatar, '')), '');
  v_sid   uuid;
  v_cur   text;
  v_free  boolean;
  v_owned boolean;
  v_xp    int;
  v_level int;
  v_bal   int;
begin
  if v_key is null or length(v_key) > 24 then
    return jsonb_build_object('ok', false, 'reason', 'bad_key', 'changed', false);
  end if;

  select id, avatar, coalesce(xp, 0), coalesce(level, 1)
    into v_sid, v_cur, v_xp, v_level
    from public.student_info where class = v_class and student_name = v_name;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student', 'changed', false);
  end if;

  select coalesce(balance, 0) into v_bal from public.student_wallet
   where class = v_class and student_name = v_name;

  if v_key is not distinct from v_cur then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'same',
                              'level', v_level, 'xp', v_xp, 'balance', coalesce(v_bal, 0));
  end if;

  -- 免费头像：小动物 24 款（默认拥有，无需购买）
  v_free := v_key ~ '^animal([1-9]|1[0-9]|2[0-4])$';

  -- 其他头像必须在商店目录内，且已兑换
  if not v_free then
    if not exists (select 1 from public.shop_item where item_key = v_key and item_type = 'avatar' and enabled) then
      return jsonb_build_object('ok', false, 'reason', 'bad_key', 'changed', false);
    end if;
    select exists (select 1 from public.student_inventory
                    where class = v_class and student_name = v_name
                      and item_type = 'avatar' and item_key = v_key) into v_owned;
    if not v_owned then
      return jsonb_build_object('ok', false, 'reason', 'not_owned', 'changed', false,
                                'level', v_level, 'xp', v_xp, 'balance', coalesce(v_bal, 0));
    end if;
  end if;

  update public.student_info set avatar = v_key where id = v_sid;

  return jsonb_build_object('ok', true, 'changed', true, 'reason', 'ok',
                            'level', v_level, 'xp', v_xp, 'balance', coalesce(v_bal, 0));
end;
$$;

revoke execute on function public.set_student_avatar(text, text, text) from public;
grant  execute on function public.set_student_avatar(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- 5. 库存表放开 theme
-- 117 号只放开了 shop_item 的类型约束，student_inventory 仍停在 109 号的
-- ('avatar','frame')，导致兑换卡片主题时写库存被拒（400 / 23514）。
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.student_inventory'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%item_type%'
  loop
    execute format('alter table public.student_inventory drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.student_inventory
  add constraint student_inventory_item_type_check
  check (item_type in ('avatar', 'frame', 'theme'));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------- 自检
-- ① 触发器应已不存在（返回 0 行）
-- select tgname from pg_trigger
--  where tgrelid = 'public.student_info'::regclass and tgname = 'trg_student_unlock_guard';
--
-- ② 已拥有钻石头盔的低等级学生应可佩戴（应返回 ok=true）
-- select public.set_student_frame('六年级一班','测试学生','diamondhelm');
--
-- ③ 未拥有的框仍应被拒（应返回 reason=not_owned）
-- select public.set_student_frame('六年级一班','测试学生','neonwolf');
