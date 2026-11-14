-- ============================================================
-- 117-card-theme-shop.sql
-- 1) student_info 新增 card_theme（个人卡片主题，三套水彩羽毛角饰）
-- 2) student_directory 视图补 card_theme（班级墙需要）
-- 3) shop_item 放开 item_type='theme'，上架 3 件卡片主题，单价均 ≤ 40
-- 4) set_student_card_theme：佩戴 / 取下（取下传 null 或空串）
-- 5) get_shop_catalog：主题一并返回 owned / equipped / card_theme
-- 6) get_wall_data：roster 补 card_theme（班级墙每张卡片各自的主题）
-- 7) get_student_card_theme：个人主页单独取（轻量）
-- 可重复执行（幂等）。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 字段
-- ------------------------------------------------------------
alter table public.student_info add column if not exists card_theme text;

comment on column public.student_info.card_theme is '个人卡片主题 key（对应 shop_item.item_type=theme），null 表示未佩戴';

-- ------------------------------------------------------------
-- 1. 班级墙视图补 card_theme
--    （原定义见 58b：id, class, student_name, avatar, frame, xp, level）
-- ------------------------------------------------------------
drop view if exists public.student_directory;
create view public.student_directory as
  select id, class, student_name, avatar, frame, xp, level, card_theme
  from public.student_info;
comment on view public.student_directory is '学生端班级墙只读视图：班级、学生姓名、头像、头像框、星光值、等级、卡片主题';
revoke all on public.student_directory from anon, authenticated;
grant select on public.student_directory to anon, authenticated;

-- ------------------------------------------------------------
-- 2. shop_item 放开 theme
-- ------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.shop_item'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%item_type%'
  loop
    execute format('alter table public.shop_item drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.shop_item
  add constraint shop_item_item_type_check
  check (item_type in ('avatar', 'frame', 'daily', 'theme'));

-- ------------------------------------------------------------
-- 3. 三件卡片主题商品
--    定价：28 / 32 / 36（一律 ≤ 40，且首次半价后仍为整数）
-- ------------------------------------------------------------
insert into public.shop_item(item_key, item_type, name, price, group_name, sort_order, enabled)
values
  ('feather-moon',   'theme', '月羽星穹', 28, '卡片主题', 4010, true),
  ('feather-violet', 'theme', '紫羽流风', 32, '卡片主题', 4020, true),
  ('feather-night',  'theme', '夜羽星尘', 36, '卡片主题', 4030, true)
on conflict (item_key) do update
  set item_type  = excluded.item_type,
      name       = excluded.name,
      price      = excluded.price,
      group_name = excluded.group_name,
      sort_order = excluded.sort_order,
      enabled    = true,
      updated_at = now();

-- 兜底：任何主题商品价格不得超过 40
update public.shop_item set price = 40, updated_at = now()
 where item_type = 'theme' and price > 40;

-- ------------------------------------------------------------
-- 4. 佩戴 / 取下卡片主题
-- ------------------------------------------------------------
create or replace function public.set_student_card_theme(p_class text, p_student text, p_card_theme text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_key   text := nullif(btrim(coalesce(p_card_theme, '')), '');
  v_sid   uuid;
begin
  select id into v_sid
    from public.student_info where class = v_class and student_name = v_name;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  if v_key is not null then
    if not exists (select 1 from public.shop_item
                    where item_key = v_key and item_type = 'theme' and enabled) then
      return jsonb_build_object('ok', false, 'reason', 'bad_theme');
    end if;
    if not exists (select 1 from public.student_inventory
                    where class = v_class and student_name = v_name
                      and item_type = 'theme' and item_key = v_key) then
      return jsonb_build_object('ok', false, 'reason', 'not_owned');
    end if;
  end if;

  update public.student_info set card_theme = v_key where id = v_sid;

  return jsonb_build_object('ok', true, 'card_theme', coalesce(v_key, ''));
end;
$$;

-- ------------------------------------------------------------
-- 5. 商店目录（在原 115 版基础上补 theme）
-- ------------------------------------------------------------
create or replace function public.get_shop_catalog(p_class text, p_student text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_av    text;
  v_fr    text;
  v_ct    text;
  v_bal   int;
  v_first boolean;
  v_items jsonb;
begin
  select avatar, coalesce(frame, 'none'), coalesce(card_theme, '')
    into v_av, v_fr, v_ct
    from public.student_info
   where class = v_class and student_name = v_name
   limit 1;

  select coalesce(balance, 0) into v_bal from public.student_wallet
   where class = v_class and student_name = v_name;

  v_first := not exists (
               select 1 from public.student_inventory
                where class = v_class and student_name = v_name
                  and source = 'purchase' and price_paid > 0)
             and not exists (
               select 1 from public.student_coupon
                where class = v_class and student_name = v_name);

  select coalesce(jsonb_agg(jsonb_build_object(
           'item_key', s.item_key,
           'item_type', s.item_type,
           'name', s.name,
           'price', s.price,
           'pay_price', case when v_first and s.price > 0 then ceil(s.price / 2.0)::int else s.price end,
           'group_name', s.group_name,
           'sort_order', s.sort_order,
           'held', case when s.item_type = 'daily' then (
                     select count(*) from public.student_coupon c
                      where c.class = v_class and c.student_name = v_name
                        and c.item_key = s.item_key and c.status = 'unused')::int
                   else 0 end,
           'owned', case when s.item_type = 'daily' then false else
                      (s.item_key = v_av and s.item_type = 'avatar')
                      or (s.item_key = v_fr and s.item_type = 'frame')
                      or exists (select 1 from public.student_inventory iv
                                  where iv.class = v_class and iv.student_name = v_name
                                    and iv.item_type = s.item_type and iv.item_key = s.item_key)
                    end,
           'equipped', (s.item_type = 'avatar' and s.item_key = v_av)
                       or (s.item_type = 'frame' and s.item_key = v_fr)
                       or (s.item_type = 'theme' and s.item_key = v_ct)
         ) order by s.sort_order, s.item_key), '[]'::jsonb)
    into v_items
    from public.shop_item s
   where s.enabled;

  return jsonb_build_object(
    'ok', true,
    'balance', coalesce(v_bal, 0),
    'avatar', v_av,
    'frame', coalesce(v_fr, 'none'),
    'card_theme', coalesce(v_ct, ''),
    'first_discount', v_first,
    'items', v_items
  );
end;
$$;

-- ------------------------------------------------------------
-- 6. 班级墙数据（roster 补 card_theme）
-- ------------------------------------------------------------
create or replace function public.get_wall_data(p_class text, p_semester text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_roster  jsonb;
  v_records jsonb;
  v_tasks   jsonb;
  v_seat    jsonb;
  v_subs    jsonb;
  v_prog    jsonb;
  v_today   date := (now() at time zone 'Asia/Shanghai')::date;
  v_since   date := v_today - 30;
  v_task_ids uuid[];
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'class', i.class, 'student_name', i.student_name,
           'avatar', i.avatar, 'frame', i.frame, 'xp', i.xp, 'level', i.level,
           'card_theme', to_jsonb(i)->>'card_theme',
           'star', coalesce(w.balance, 0))
           order by i.student_name), '[]'::jsonb)
    into v_roster
    from public.student_directory i
    left join public.student_wallet w
      on w.class = i.class and w.student_name = i.student_name
   where btrim(i.class) = btrim(p_class);

  select coalesce(jsonb_agg(x), '[]'::jsonb)
    into v_records
    from (
      select jsonb_build_object(
               'id', r.id, 'student_name', r.student_name, 'class', r.class,
               'record_date', r.record_date, 'self_evaluation', r.self_evaluation,
               'mood', coalesce(r.behavior->>'mood', ''), 'create_at', r.create_at) x
        from public.daily_record r
       where btrim(r.class) = btrim(p_class)
         and r.record_date >= v_since
         and (p_semester is null or r.semester = p_semester)
       order by r.record_date desc, r.create_at desc
       limit 500
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'task_type', t.task_type)
           order by t.id), '[]'::jsonb)
    into v_tasks
    from public.daily_task t
   where btrim(t.class) = btrim(p_class) and t.task_date = v_today;

  select coalesce(jsonb_agg(jsonb_build_object(
           'student_name', s.student_name, 'seat_row', s.seat_row, 'seat_col', s.seat_col)), '[]'::jsonb)
    into v_seat
    from public.seat_grid s
   where btrim(s.class) = btrim(p_class);

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

  v_prog := public.get_class_progress(p_class);

  return jsonb_build_object(
    'ok', true, 'roster', v_roster, 'records', v_records,
    'tasks', v_tasks, 'seat', v_seat, 'subs', v_subs, 'progress', v_prog
  );
end;
$$;

-- ------------------------------------------------------------
-- 7. 个人主页取卡片主题（轻量，避免拉整份档案）
-- ------------------------------------------------------------
create or replace function public.get_student_card_theme(p_class text, p_student text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ct text;
begin
  select coalesce(card_theme, '') into v_ct
    from public.student_info
   where class = btrim(coalesce(p_class, '')) and student_name = btrim(coalesce(p_student, ''))
   limit 1;

  return jsonb_build_object('ok', true, 'card_theme', coalesce(v_ct, ''));
end;
$$;

grant execute on function public.set_student_card_theme(text, text, text) to anon, authenticated;
grant execute on function public.get_student_card_theme(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 8. 校验
-- ------------------------------------------------------------
select item_key, item_type, name, price, group_name, sort_order
  from public.shop_item
 where item_type = 'theme'
 order by sort_order;

select count(*) filter (where price > 40) as 超过40的主题数
  from public.shop_item where item_type = 'theme';

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'student_info' and column_name = 'card_theme';
