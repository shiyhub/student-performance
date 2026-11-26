-- ============================================================
-- 140-checkin-and-dim-norm.sql
--   两件事：
--   A. 班级打卡（劳动 / 作业 / 牛奶搬运 / 佳肴运输）
--      新增 checkin_item（打卡项）、checkin_log（打卡记录）两张表，
--      以及学生端提交、教师端管理/撤销所需的 6 个 RPC。
--   B. 五维失衡修复
--      student_dims 增加 norm 字段：按「班级同维度均值」归一，
--      不再让任务发得多的那一维把其他维压到圆心。
--
--   为什么打卡不写 daily_record：
--      daily_record 的分值由 apply_record_xp 触发器按 behavior_tags.xp_value 算，
--      打卡项的分值是打卡项自己配的，塞进去会被标签分值覆盖。
--      所以打卡单独记 checkin_log，并在同一事务里显式加 xp 与维度列。
--
--   幂等：全部 create ... if not exists / create or replace，可重复执行。
--   执行位置：Supabase Dashboard → SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 0. 打卡项
-- ------------------------------------------------------------
create table if not exists public.checkin_item (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  dim         text not null default 'lao',
  xp          int  not null default 2,
  icon        text not null default '',
  note        text not null default '',
  enabled     boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint checkin_item_dim_chk check (dim in ('de','zhi','ti','mei','lao')),
  constraint checkin_item_xp_chk  check (xp >= 0 and xp <= 50)
);

-- 同名只允许一条，避免教师手滑建出两个「劳动打卡」
create unique index if not exists checkin_item_name_uniq
  on public.checkin_item (lower(btrim(name)));

-- ------------------------------------------------------------
-- 1. 打卡记录
--    xp / dim / item_name 都是「当时的快照」：
--    以后教师改打卡项分值时，历史记录不会被追改。
-- ------------------------------------------------------------
create table if not exists public.checkin_log (
  id           uuid primary key default gen_random_uuid(),
  class        text not null,
  record_date  date not null default ((now() at time zone 'Asia/Shanghai')::date),
  item_id      uuid not null references public.checkin_item(id) on delete restrict,
  item_name    text not null default '',
  dim          text not null default 'lao',
  xp           int  not null default 2,
  student_name text not null,
  operator     text not null default '',
  created_at   timestamptz not null default now()
);

-- 一天一项一人只能有一条：重复提交不会重复加分
create unique index if not exists checkin_log_uniq
  on public.checkin_log (class, record_date, item_id, student_name);

create index if not exists checkin_log_day_idx
  on public.checkin_log (class, record_date);

create index if not exists checkin_log_stu_idx
  on public.checkin_log (class, student_name, record_date);

-- ------------------------------------------------------------
-- 2. 五维权重（教师可调，默认 1）
-- ------------------------------------------------------------
create table if not exists public.dim_weight (
  dim        text primary key,
  weight     numeric(4,2) not null default 1.00,
  updated_at timestamptz not null default now(),
  constraint dim_weight_dim_chk check (dim in ('de','zhi','ti','mei','lao')),
  constraint dim_weight_w_chk   check (weight >= 0.20 and weight <= 3.00)
);

insert into public.dim_weight(dim, weight) values
  ('de',1.00),('zhi',1.00),('ti',1.00),('mei',1.00),('lao',1.00)
on conflict (dim) do nothing;

-- ------------------------------------------------------------
-- 3. 权限：读开放，写只走 RPC（RPC 内部 security definer + 教师校验）
-- ------------------------------------------------------------
alter table public.checkin_item enable row level security;
alter table public.checkin_log  enable row level security;
alter table public.dim_weight   enable row level security;

drop policy if exists "打卡项可读" on public.checkin_item;
create policy "打卡项可读" on public.checkin_item for select using (true);

drop policy if exists "打卡记录可读" on public.checkin_log;
create policy "打卡记录可读" on public.checkin_log for select using (true);

drop policy if exists "五维权重可读" on public.dim_weight;
create policy "五维权重可读" on public.dim_weight for select using (true);

-- ------------------------------------------------------------
-- 4. 读接口：打卡项列表（学生端 + 教师端共用）
--    p_all = true 时连停用的也返回（教师管理页用）
-- ------------------------------------------------------------
create or replace function public.get_checkin_items(p_all boolean default false)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'ok', true,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.name, 'dim', i.dim, 'xp', i.xp,
      'icon', coalesce(i.icon,''), 'note', coalesce(i.note,''),
      'enabled', i.enabled, 'sort_order', i.sort_order
    ) order by i.sort_order, i.created_at), '[]'::jsonb)
  )
  from public.checkin_item i
  where p_all or i.enabled;
$$;

-- ------------------------------------------------------------
-- 5. 读接口：某天某班的打卡记录（按项分组）
-- ------------------------------------------------------------
create or replace function public.get_checkin_day(p_class text, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class,''));
  v_date  date := coalesce(p_date, (now() at time zone 'Asia/Shanghai')::date);
  v_items jsonb;
begin
  if v_class = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_class');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.item_id, 'name', g.item_name, 'dim', g.dim, 'xp', g.xp,
           'names', g.names, 'students', g.students, 'cnt', g.cnt
         ) order by g.name), '[]'::jsonb)
    into v_items
    from (
      select l.item_id,
             max(l.item_name) as name,
             max(l.dim) as dim,
             max(l.xp) as xp,
             jsonb_agg(l.student_name order by l.student_name) as names,
             jsonb_agg(jsonb_build_object('id', l.id, 'name', l.student_name) order by l.student_name) as students,
             count(*)::int as cnt
        from public.checkin_log l
       where l.class = v_class and l.record_date = v_date
       group by l.item_id
    ) g;

  return jsonb_build_object(
    'ok', true, 'class', v_class, 'date', v_date,
    'total', (select count(*)::int from public.checkin_log where class = v_class and record_date = v_date),
    'items', v_items
  );
end;
$$;

-- ------------------------------------------------------------
-- 6. 提交打卡（学生端 / 教师端共用）
--    一天一项一人只加一次；已记过的直接跳过并回报。
-- ------------------------------------------------------------
create or replace function public.submit_checkin(
  p_class text,
  p_item_id uuid,
  p_students text[],
  p_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class,''));
  v_date  date := coalesce(p_date, (now() at time zone 'Asia/Shanghai')::date);
  v_item  public.checkin_item%rowtype;
  v_name  text;
  v_added int := 0;
  v_skip  int := 0;
  v_miss  int := 0;
  v_miss_names text[] := '{}';
  v_old_xp int;
  v_claims text := current_setting('request.jwt.claims', true);
  v_operator text := '';
  v_ins uuid;
begin
  if v_class = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_class');
  end if;
  if p_students is null or array_length(p_students, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'no_students');
  end if;

  select * into v_item from public.checkin_item where id = p_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_item');
  end if;
  if not v_item.enabled then
    return jsonb_build_object('ok', false, 'reason', 'item_disabled');
  end if;

  -- 操作者：SQL 编辑器里为空；匿名前端记为 anon；教师记 uid
  if coalesce(v_claims,'') <> '' then
    begin
      v_operator := case when (v_claims::jsonb ->> 'role') = 'anon'
                         then 'anon'
                         else coalesce(v_claims::jsonb ->> 'sub','') end;
    exception when others then v_operator := 'anon';
    end;
  else
    v_operator := 'sql';
  end if;

  -- 去重 + 跳过空名
  for v_name in
    select distinct btrim(x) from unnest(p_students) x where btrim(coalesce(x,'')) <> ''
  loop
    -- 该生必须在本班名单里
    select coalesce(xp,0) into v_old_xp
      from public.student_info
     where class = v_class and student_name = v_name
     limit 1;

    if v_old_xp is null then
      v_miss := v_miss + 1;
      v_miss_names := v_miss_names || v_name;
      continue;
    end if;

    v_ins := null;   -- RETURNING INTO 无行时不会自动置空，必须先清

    insert into public.checkin_log(class, record_date, item_id, item_name, dim, xp, student_name, operator)
    values (v_class, v_date, v_item.id, v_item.name, v_item.dim, v_item.xp, v_name, v_operator)
    on conflict (class, record_date, item_id, student_name) do nothing
    returning id into v_ins;

    if v_ins is null then
      v_skip := v_skip + 1;       -- 今天已经记过
      continue;
    end if;

    -- 直接在库内做加法，避免两个人同时打卡时用读出的旧值互相覆盖
    update public.student_info
       set xp     = greatest(0, coalesce(xp,0) + v_item.xp),
           xp_de  = greatest(0, coalesce(xp_de,0)  + case when v_item.dim = 'de'  then v_item.xp else 0 end),
           xp_zhi = greatest(0, coalesce(xp_zhi,0) + case when v_item.dim = 'zhi' then v_item.xp else 0 end),
           xp_ti  = greatest(0, coalesce(xp_ti,0)  + case when v_item.dim = 'ti'  then v_item.xp else 0 end),
           xp_mei = greatest(0, coalesce(xp_mei,0) + case when v_item.dim = 'mei' then v_item.xp else 0 end),
           xp_lao = greatest(0, coalesce(xp_lao,0) + case when v_item.dim = 'lao' then v_item.xp else 0 end),
           level  = public.level_from_xp(greatest(0, coalesce(xp,0) + v_item.xp))
     where class = v_class and student_name = v_name;

    v_added := v_added + 1;
    v_ins := null;
  end loop;

  return jsonb_build_object(
    'ok', true, 'date', v_date,
    'item', v_item.name, 'dim', v_item.dim, 'xp', v_item.xp,
    'added', v_added, 'skipped', v_skip,
    'missing', v_miss, 'missing_names', to_jsonb(v_miss_names)
  );
end;
$$;

-- ------------------------------------------------------------
-- 7. 撤销单条打卡（教师端）
-- ------------------------------------------------------------
create or replace function public.cancel_checkin(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_g    jsonb := public.shop_admin_guard();
  v_row  public.checkin_log%rowtype;
  v_new  int;
begin
  if not (v_g ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select * into v_row from public.checkin_log where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_record');
  end if;

  delete from public.checkin_log where id = p_id;

  update public.student_info
     set xp     = greatest(0, coalesce(xp,0) - v_row.xp),
         xp_de  = greatest(0, coalesce(xp_de,0)  - case when v_row.dim = 'de'  then v_row.xp else 0 end),
         xp_zhi = greatest(0, coalesce(xp_zhi,0) - case when v_row.dim = 'zhi' then v_row.xp else 0 end),
         xp_ti  = greatest(0, coalesce(xp_ti,0)  - case when v_row.dim = 'ti'  then v_row.xp else 0 end),
         xp_mei = greatest(0, coalesce(xp_mei,0) - case when v_row.dim = 'mei' then v_row.xp else 0 end),
         xp_lao = greatest(0, coalesce(xp_lao,0) - case when v_row.dim = 'lao' then v_row.xp else 0 end)
   where class = v_row.class and student_name = v_row.student_name
  returning xp into v_new;

  update public.student_info
     set level = public.level_from_xp(coalesce(v_new,0))
   where class = v_row.class and student_name = v_row.student_name;

  return jsonb_build_object('ok', true, 'student', v_row.student_name,
                            'item', v_row.item_name, 'xp', v_row.xp, 'xp_now', coalesce(v_new,0));
end;
$$;

-- ------------------------------------------------------------
-- 8. 打卡项管理（教师端）：新增 / 编辑
--    p_item 可带 id（编辑）或不带（新增）
-- ------------------------------------------------------------
create or replace function public.save_checkin_item(p_item jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_g     jsonb := public.shop_admin_guard();
  v_id    uuid;
  v_name  text := btrim(coalesce(p_item ->> 'name',''));
  v_dim   text := coalesce(nullif(p_item ->> 'dim',''), 'lao');
  v_xp    int  := coalesce((p_item ->> 'xp')::int, 2);
  v_icon  text := coalesce(p_item ->> 'icon','');
  v_note  text := coalesce(p_item ->> 'note','');
  v_en    boolean := coalesce((p_item ->> 'enabled')::boolean, true);
  v_sort  int  := coalesce((p_item ->> 'sort_order')::int, 0);
begin
  if not (v_g ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_name');
  end if;
  if v_dim not in ('de','zhi','ti','mei','lao') then
    return jsonb_build_object('ok', false, 'reason', 'bad_dim');
  end if;
  if v_xp < 0 or v_xp > 50 then
    return jsonb_build_object('ok', false, 'reason', 'bad_xp');
  end if;

  if p_item ? 'id' and (p_item ->> 'id') <> '' then
    v_id := (p_item ->> 'id')::uuid;
    update public.checkin_item
       set name = v_name, dim = v_dim, xp = v_xp, icon = v_icon,
           note = v_note, enabled = v_en, sort_order = v_sort, updated_at = now()
     where id = v_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'no_item');
    end if;
  else
    insert into public.checkin_item(name, dim, xp, icon, note, enabled, sort_order)
    values (v_name, v_dim, v_xp, v_icon, v_note, v_en, v_sort)
    returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'dup_name');
end;
$$;

-- ------------------------------------------------------------
-- 9. 删除打卡项：有历史记录则只停用，保历史可追溯
-- ------------------------------------------------------------
create or replace function public.delete_checkin_item(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_g   jsonb := public.shop_admin_guard();
  v_cnt int;
begin
  if not (v_g ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select count(*)::int into v_cnt from public.checkin_log where item_id = p_id;

  if v_cnt > 0 then
    update public.checkin_item set enabled = false, updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'disabled', true, 'used', v_cnt);
  end if;

  delete from public.checkin_item where id = p_id;
  return jsonb_build_object('ok', true, 'disabled', false, 'used', 0);
end;
$$;

-- ------------------------------------------------------------
-- 10. 五维权重设置
-- ------------------------------------------------------------
create or replace function public.set_dim_weight(p_dim text, p_weight numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_g jsonb := public.shop_admin_guard();
begin
  if not (v_g ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_dim not in ('de','zhi','ti','mei','lao') then
    return jsonb_build_object('ok', false, 'reason', 'bad_dim');
  end if;

  insert into public.dim_weight(dim, weight, updated_at)
  values (p_dim, round(greatest(0.20, least(3.00, coalesce(p_weight,1)))::numeric, 2), now())
  on conflict (dim) do update
    set weight = excluded.weight, updated_at = now();

  return jsonb_build_object('ok', true, 'dim', p_dim,
                            'weight', (select weight from public.dim_weight where dim = p_dim));
end;
$$;

-- ------------------------------------------------------------
-- 11. 五维读数（124 版重写）：新增 norm 归一 + 打卡计入周统计
--
--     norm 口径：
--       raw  = 该维度累计分（student_info.xp_*）
--       avg  = 全班该维度累计分平均值（不含测试学生）
--       norm = round(60 * raw / max(avg, 20) * weight)，封顶 100
--
--     60 的含义：正好达到班级平均线的孩子落在 60 分位；
--     任务发得多把全班均值抬高时，基准一起抬高，个人高出的部分才体现在半径上，
--     所以「智力任务发得多」不再会让其余四维贴圆心。
--     max(avg,20) 是极小分母保护（开学第一周全班都只有个位数时）。
-- ------------------------------------------------------------
create or replace function public.student_dims(p_class text, p_student text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class text := btrim(coalesce(p_class, ''));
  v_name  text := btrim(coalesce(p_student, ''));
  v_sid   uuid;
  v_de int := 0; v_zhi int := 0; v_ti int := 0; v_mei int := 0; v_lao int := 0;
  w_de int := 0; w_zhi int := 0; w_ti int := 0; w_mei int := 0; w_lao int := 0;
  p_de int := 0; p_zhi int := 0; p_ti int := 0; p_mei int := 0; p_lao int := 0;
  a_de numeric := 0; a_zhi numeric := 0; a_ti numeric := 0; a_mei numeric := 0; a_lao numeric := 0;
  g_de numeric := 1; g_zhi numeric := 1; g_ti numeric := 1; g_mei numeric := 1; g_lao numeric := 1;
  n_de int := 0; n_zhi int := 0; n_ti int := 0; n_mei int := 0; n_lao int := 0;
  v_ws   date;
  v_prev date;
  v_top text; v_top_xp int;
  v_ptop text; v_ptop_xp int;
begin
  select id,
         coalesce(xp_de, 0), coalesce(xp_zhi, 0), coalesce(xp_ti, 0),
         coalesce(xp_mei, 0), coalesce(xp_lao, 0)
    into v_sid, v_de, v_zhi, v_ti, v_mei, v_lao
    from public.student_info
   where class = v_class and student_name = v_name
   limit 1;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  v_ws   := date_trunc('week', (now() at time zone 'Asia/Shanghai'))::date;  -- 本周一
  v_prev := v_ws - 7;                                                        -- 上周一

  -- 本周 / 上周：逐项取维度与真实分值（负向 0 分不计）
  -- 打卡记录一并计入（打卡不落 daily_record，这里补上）
  select coalesce(sum(xp) filter (where rd >= v_ws   and dim = 'de'),  0),
         coalesce(sum(xp) filter (where rd >= v_ws   and dim = 'zhi'), 0),
         coalesce(sum(xp) filter (where rd >= v_ws   and dim = 'ti'),  0),
         coalesce(sum(xp) filter (where rd >= v_ws   and dim = 'mei'), 0),
         coalesce(sum(xp) filter (where rd >= v_ws   and dim = 'lao'), 0),
         coalesce(sum(xp) filter (where rd <  v_ws   and dim = 'de'),  0),
         coalesce(sum(xp) filter (where rd <  v_ws   and dim = 'zhi'), 0),
         coalesce(sum(xp) filter (where rd <  v_ws   and dim = 'ti'),  0),
         coalesce(sum(xp) filter (where rd <  v_ws   and dim = 'mei'), 0),
         coalesce(sum(xp) filter (where rd <  v_ws   and dim = 'lao'), 0)
    into w_de, w_zhi, w_ti, w_mei, w_lao,
         p_de, p_zhi, p_ti, p_mei, p_lao
    from (
      select dr.record_date as rd,
             coalesce(nullif(t.dim, ''), 'zhi') as dim,
             case when t.xp_value is null
                  then (case when (e ->> 'category') = 'negative' then 0 else 2 end)
                  else t.xp_value end as xp
        from public.daily_record dr
        cross join lateral jsonb_array_elements(
               case when jsonb_typeof(dr.behavior -> 'items') = 'array'
                    then dr.behavior -> 'items' else '[]'::jsonb end) e
        left join public.behavior_tags t on t.id::text = (e ->> 'id')
       where dr.class = v_class
         and dr.student_name = v_name
         and dr.record_date >= v_prev
         and e is distinct from 'null'::jsonb
      union all
      select l.bonus_date as rd,
             coalesce(nullif(l.dim, ''), 'zhi') as dim,
             l.xp_value as xp
        from public.auto_bonus_log l
       where l.class = v_class
         and l.student_name = v_name
         and l.bonus_date >= v_prev
      union all
      select c.record_date as rd,
             coalesce(nullif(c.dim, ''), 'lao') as dim,
             c.xp as xp
        from public.checkin_log c
       where c.class = v_class
         and c.student_name = v_name
         and c.record_date >= v_prev
    ) s
   where s.xp > 0;

  -- 全班同维度均值（不含测试学生）
  select coalesce(avg(coalesce(xp_de, 0)), 0),
         coalesce(avg(coalesce(xp_zhi,0)), 0),
         coalesce(avg(coalesce(xp_ti, 0)), 0),
         coalesce(avg(coalesce(xp_mei,0)), 0),
         coalesce(avg(coalesce(xp_lao,0)), 0)
    into a_de, a_zhi, a_ti, a_mei, a_lao
    from public.student_info
   where class = v_class
     and coalesce(is_test, false) = false;

  select coalesce(weight,1) into g_de  from public.dim_weight where dim = 'de';
  select coalesce(weight,1) into g_zhi from public.dim_weight where dim = 'zhi';
  select coalesce(weight,1) into g_ti  from public.dim_weight where dim = 'ti';
  select coalesce(weight,1) into g_mei from public.dim_weight where dim = 'mei';
  select coalesce(weight,1) into g_lao from public.dim_weight where dim = 'lao';
  g_de  := coalesce(g_de,1);  g_zhi := coalesce(g_zhi,1);
  g_ti  := coalesce(g_ti,1);  g_mei := coalesce(g_mei,1); g_lao := coalesce(g_lao,1);

  n_de  := least(100, greatest(0, round(60.0 * v_de  / greatest(a_de,  20) * g_de )::int));
  n_zhi := least(100, greatest(0, round(60.0 * v_zhi / greatest(a_zhi, 20) * g_zhi)::int));
  n_ti  := least(100, greatest(0, round(60.0 * v_ti  / greatest(a_ti,  20) * g_ti )::int));
  n_mei := least(100, greatest(0, round(60.0 * v_mei / greatest(a_mei, 20) * g_mei)::int));
  n_lao := least(100, greatest(0, round(60.0 * v_lao / greatest(a_lao, 20) * g_lao)::int));

  -- 本周 / 上周最强维度（同分按 德→智→体→美→劳 的顺序稳定取第一个）
  select d.dim, d.xp into v_top, v_top_xp
    from (values ('de', w_de), ('zhi', w_zhi), ('ti', w_ti), ('mei', w_mei), ('lao', w_lao)) d(dim, xp)
   order by d.xp desc, array_position(array['de','zhi','ti','mei','lao'], d.dim)
   limit 1;

  select d.dim, d.xp into v_ptop, v_ptop_xp
    from (values ('de', p_de), ('zhi', p_zhi), ('ti', p_ti), ('mei', p_mei), ('lao', p_lao)) d(dim, xp)
   order by d.xp desc, array_position(array['de','zhi','ti','mei','lao'], d.dim)
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'total', jsonb_build_object('de', v_de, 'zhi', v_zhi, 'ti', v_ti, 'mei', v_mei, 'lao', v_lao),
    'week',  jsonb_build_object('de', w_de, 'zhi', w_zhi, 'ti', w_ti, 'mei', w_mei, 'lao', w_lao),
    'prev',  jsonb_build_object('de', p_de, 'zhi', p_zhi, 'ti', p_ti, 'mei', p_mei, 'lao', p_lao),
    'norm',  jsonb_build_object('de', n_de, 'zhi', n_zhi, 'ti', n_ti, 'mei', n_mei, 'lao', n_lao),
    'dim_avg', jsonb_build_object('de', round(a_de)::int, 'zhi', round(a_zhi)::int,
                                  'ti', round(a_ti)::int, 'mei', round(a_mei)::int,
                                  'lao', round(a_lao)::int),
    'dim_weight', jsonb_build_object('de', g_de, 'zhi', g_zhi, 'ti', g_ti, 'mei', g_mei, 'lao', g_lao),
    'total_sum', v_de + v_zhi + v_ti + v_mei + v_lao,
    'week_sum',  w_de + w_zhi + w_ti + w_mei + w_lao,
    'prev_sum',  p_de + p_zhi + p_ti + p_mei + p_lao,
    'week_start', v_ws,
    'norm_base', 60,
    'norm_floor', 20,
    'top', coalesce(v_top, ''), 'top_xp', coalesce(v_top_xp, 0),
    'prev_top', coalesce(v_ptop, ''), 'prev_xp', coalesce(v_ptop_xp, 0),
    'medal_min', 5
  );
end;
$$;

-- ------------------------------------------------------------
-- 12. 授权
-- ------------------------------------------------------------
revoke execute on function public.get_checkin_items(boolean)        from public;
revoke execute on function public.get_checkin_day(text, date)       from public;
revoke execute on function public.submit_checkin(text, uuid, text[], date) from public;
revoke execute on function public.cancel_checkin(uuid)              from public, anon;
revoke execute on function public.save_checkin_item(jsonb)          from public, anon;
revoke execute on function public.delete_checkin_item(uuid)         from public, anon;
revoke execute on function public.set_dim_weight(text, numeric)     from public, anon;
revoke execute on function public.student_dims(text, text)          from public;

grant execute on function public.get_checkin_items(boolean)          to anon, authenticated;
grant execute on function public.get_checkin_day(text, date)         to anon, authenticated;
grant execute on function public.submit_checkin(text, uuid, text[], date) to anon, authenticated;
grant execute on function public.cancel_checkin(uuid)                to authenticated;
grant execute on function public.save_checkin_item(jsonb)            to authenticated;
grant execute on function public.delete_checkin_item(uuid)           to authenticated;
grant execute on function public.set_dim_weight(text, numeric)       to authenticated;
grant execute on function public.student_dims(text, text)            to anon, authenticated;

-- ------------------------------------------------------------
-- 13. 种子：四个打卡项（已存在则不动）
-- ------------------------------------------------------------
insert into public.checkin_item(name, dim, xp, icon, note, enabled, sort_order) values
  ('劳动打卡',       'lao', 2, 'broom', '扫地、擦桌、整理卫生角', true, 10),
  ('完成作业打卡',   'zhi', 2, 'book',  '当天作业按时完成并已订正',   true, 20),
  ('牛奶搬运打卡',   'lao', 2, 'milk',  '课间奶箱搬运与分发',         true, 30),
  ('美味佳肴运输打卡','lao', 2, 'bowl', '午餐餐桶搬运与回收',         true, 40)
on conflict do nothing;

-- ------------------------------------------------------------
-- 14. 自检
-- ------------------------------------------------------------
select '打卡项' as 项目, count(*)::text as 数量 from public.checkin_item
union all
select '打卡记录', count(*)::text from public.checkin_log
union all
select '五维权重', count(*)::text from public.dim_weight;

-- 期望：打卡项 ≥ 4，打卡记录 0（首次），五维权重 5
-- 真实学生五维自检（换成你的班级/学生）：
-- select public.student_dims('六年级一班','王玥') -> 'norm';
