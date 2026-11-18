-- ============================================================================
-- 133-wall-roster-star-theme.sql
--   修复之一：班级星光墙的学生卡片不显示星光值（只有点进过个人主页的学生才有数字）
--   修复之二：卡片主题（三套羽毛）不在星光墙上显示，只在个人主页显示
--   修复之三：头像白名单没跟上 129/130 的 game18（像素·勇者）与 poster1-10，
--            导致佩戴后头像回退成小动物（海豚/小狗）
--
--   根因（已定位到代码）：
--     1) get_wall_data 返回的 roster 只有 id/class/student_name/avatar/frame/
--        xp/level/is_test/test_enabled/test_show_on_wall，既没有 star 也没有 card_theme；
--     2) 前端 renderWall() 用 Number(s.star) || 0 渲染星光值角标，拿不到就恒为 0；
--        只有当学生点进个人主页、loadWallet() 调过 get_student_wallet 之后，
--        余额才会被写回 roster 那一行 —— 于是"进过主页的才有值"；
--     3) 前端 renderWall() 用 s.card_theme 决定卡片是否套主题，
--        roster 里没有这个字段，所以主题永远只在个人主页出现。
--
--   做法：
--     ① student_directory 视图末尾追加 star（= student_wallet.balance）与 card_theme；
--     ② get_wall_data 的 roster 一次带出 star + card_theme，全班同屏生效；
--     ③ set_student_avatar 换成「在商店目录内 + 已兑换即可佩戴」口径（与 132 号一致），
--        让 game18 / poster1-10 能正常保存，不再被旧白名单判 bad_key；
--     ④ 前端无需再改（js/student.js 原本就在读 s.star / s.card_theme）。
--
--   执行位置：Supabase → SQL Editor → 整段粘贴 → Run（幂等，可重复执行）。
--   跑完后：页面按 Ctrl+F5 强刷一次（本地有 60 秒名单缓存，强刷可立即生效）。
-- ============================================================================

-- ---------------------------------------------------------------- 1. 名单视图加 star / card_theme
drop view if exists public.student_directory;

create view public.student_directory as
  select i.id, i.class, i.student_name, i.avatar, i.frame, i.xp, i.level,
         i.is_test, i.test_enabled, i.test_show_on_wall,
         coalesce(w.balance, 0) as star,
         i.card_theme
    from public.student_info i
    left join public.student_wallet w
      on w.class = i.class
     and w.student_name = i.student_name;

comment on view public.student_directory is
  '学生端班级墙只读视图：班级、姓名、头像、头像框、经验、等级、测试标记、可消费星光值、卡片主题';
grant select on public.student_directory to anon, authenticated;

-- ---------------------------------------------------------------- 2. 班级墙聚合带上 star + card_theme
drop function if exists public.get_wall_data(text, text);

create or replace function public.get_wall_data(
  p_class        text,
  p_semester     text default null,
  p_include_test boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_roster  jsonb;
  v_records jsonb;
  v_tasks   jsonb;
  v_seat    jsonb;
  v_subs    jsonb;
  v_today   date := (now() at time zone 'Asia/Shanghai')::date;
  v_since   date := v_today - 30;
  v_task_ids uuid[];
begin
  -- 1) 名单：测试学生仅在 include_test 或显式允许上墙时出现
  --    v133：追加 star（可消费星光值余额）与 card_theme（星光墙卡片主题）
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'class', i.class, 'student_name', i.student_name,
           'avatar', i.avatar, 'frame', i.frame, 'xp', i.xp, 'level', i.level,
           'star', coalesce(i.star, 0),
           'card_theme', i.card_theme,
           'is_test', i.is_test, 'test_enabled', i.test_enabled,
           'test_show_on_wall', i.test_show_on_wall)
           order by i.student_name), '[]'::jsonb)
    into v_roster
    from public.student_directory i
   where btrim(i.class) = btrim(p_class)
     and (i.is_test = false
          or (i.test_enabled = true
              and (p_include_test = true or i.test_show_on_wall = true)));

  -- 2) 近 30 天记录：与名单同口径过滤，避免测试记录混进平均星级/今日人数
  select coalesce(jsonb_agg(x), '[]'::jsonb)
    into v_records
    from (
      select jsonb_build_object(
               'id', r.id, 'student_name', r.student_name, 'class', r.class,
               'record_date', r.record_date, 'self_evaluation', r.self_evaluation,
               'mood', coalesce(r.behavior->>'mood', ''), 'create_at', r.create_at)
        from public.daily_record r
       where btrim(r.class) = btrim(p_class)
         and r.record_date >= v_since
         and (p_semester is null or r.semester = p_semester)
         and not exists (
               select 1 from public.student_info ti
                where btrim(ti.class) = btrim(r.class)
                  and btrim(ti.student_name) = btrim(r.student_name)
                  and ti.is_test = true
                  and p_include_test = false)
       order by r.record_date desc, r.create_at desc
       limit 500
    ) x;

  -- 3) 今日任务
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'task_type', t.task_type)
           order by t.id), '[]'::jsonb)
    into v_tasks
    from public.daily_task t
   where btrim(t.class) = btrim(p_class)
     and t.task_date = v_today;

  -- 4) 座位表
  select coalesce(jsonb_agg(jsonb_build_object(
           'student_name', s.student_name, 'seat_row', s.seat_row, 'seat_col', s.seat_col)), '[]'::jsonb)
    into v_seat
    from public.seat_grid s
   where btrim(s.class) = btrim(p_class);

  -- 5) 今日任务提交
  v_task_ids := (select coalesce(array_agg(t.id), '{}'::uuid[])
                   from public.daily_task t
                  where btrim(t.class) = btrim(p_class) and t.task_date = v_today);
  if cardinality(v_task_ids) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'student_name', su.student_name, 'task_id', su.task_id, 'grade', su.grade)), '[]'::jsonb)
      into v_subs
      from public.task_submission su
     where su.task_id = any(v_task_ids);
  else
    v_subs := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'ok', true, 'roster', v_roster, 'records', v_records,
    'tasks', v_tasks, 'seat', v_seat, 'subs', v_subs);
end;
$$;

revoke execute on function public.get_wall_data(text, text, boolean) from public;
grant  execute on function public.get_wall_data(text, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------- 3. 头像白名单口径（与 132 号一致，可重复执行）
--   为什么放进来：129/130 上架了 game18「像素·勇者」与 poster1-10 海报头像，
--   但更早的白名单函数（106 版）只认 game1-17。若线上仍是旧函数，学生点「像素·勇者」
--   会被判 bad_key，前端只能回退成按姓名分配的小动物头像（海豚/小狗），
--   表现就是"戴了像素勇者却显示成动物"。这里统一下成「在商店目录内 + 已兑换即可佩戴」。
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

-- ---------------------------------------------------------------- 自检
-- ① 视图应已有 star、card_theme 两列
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'student_directory'
--  order by ordinal_position;
--
-- ② 接口应返回每人的 star 与 card_theme（挑一个班上真实学生名看）
-- select jsonb_pretty(public.get_wall_data('六年级一班') -> 'roster' -> 0);
--
-- ③ 全班星光值分布（应有不同数值，不再全是 0）
-- select student_name, star, card_theme from public.student_directory
--  where class = '六年级一班' order by star desc limit 10;
