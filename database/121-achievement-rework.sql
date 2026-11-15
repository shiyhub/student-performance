-- ============================================================
-- 121-achievement-rework.sql
-- 成就系统重写（面向小学生场景）+ 头像/头像框奖励位预留 + 永久保留
--
--   1) achievement_def：成就定义表（分组 / 图标 / 名称 / 描述 / 目标 / 排序 /
--      reward_avatar / reward_frame 绑定位）——后续加成就、挂奖励只改数据
--   2) ach_progress：按 key 算当前进度（展示用，与判定口径同源）
--   3) sync_student_achievements：重写为「只增不减」——成就一旦获得永不消失
--      班级前三（top3）改为「名次 ≤ 3 且星光值余额 > 20」才判定达成
--   4) get_student_profile：成就列表改为读定义表，返回分组与奖励绑定字段
--   5) 头像框学生端命名优化（7 款旧款）：铜/银/金→更有画面感的名字
--
-- 可重复执行（create table if not exists / create or replace / on conflict）。
-- 执行位置：Supabase Dashboard → SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 1. 成就定义表
--    reward_avatar / reward_frame 为预留绑定位：
--    留空 = 未绑定奖励（学生端显示占位槽）；填值 = 绑定对应头像 / 头像框 key
-- ------------------------------------------------------------
create table if not exists public.achievement_def (
  key           text primary key,
  group_key     text not null default 'misc',
  group_name    text not null default '其他',
  icon          text not null default '⭐',
  name          text not null,
  desc_text     text not null default '',
  target        integer not null default 1 check (target >= 1),
  sort_order    integer not null default 100,
  show_progress boolean not null default true,
  reward_avatar text,
  reward_frame  text,
  enabled       boolean not null default true,
  updated_at    timestamptz not null default now()
);
create index if not exists idx_ach_def_sort on public.achievement_def(enabled, sort_order);

alter table public.achievement_def enable row level security;
drop policy if exists p_ach_def_read on public.achievement_def;
create policy p_ach_def_read on public.achievement_def
  for select to anon, authenticated using (true);
grant select on public.achievement_def to anon, authenticated;

-- ------------------------------------------------------------
-- 2. 24 枚成就（5 组）
--    原有 20 个 key 全部保留（历史解锁不失效），只改名称/描述/分组；
--    新增 4 枚：days50 / tasks30 / star100 / star500
-- ------------------------------------------------------------
insert into public.achievement_def
  (key, group_key, group_name, icon, name, desc_text, target, sort_order, show_progress, reward_avatar, reward_frame) values
  -- 启程
  ('first_record','start','启程','🌱','第一颗星',      '提交第一条在校表现',           1, 110, true, null, null),
  ('days10',      'start','启程','📔','记录满十天',    '累计记录 10 天',              10, 120, true, null, null),
  ('days30',      'start','启程','🗓️','记录满一月',    '累计记录 30 天',              30, 130, true, null, null),
  ('days50',      'start','启程','📅','记录满五十天',  '累计记录 50 天',              50, 140, true, null, null),
  -- 学习
  ('tasks10',     'study','学习','✅','作业小能手',    '认真完成 10 次任务',          10, 210, true, null, null),
  ('tasks30',     'study','学习','📝','任务小达人',    '认真完成 30 次任务',          30, 220, true, null, null),
  ('good10',      'study','学习','👍','十次优秀',      '累计 10 次优秀（A）',         10, 230, true, null, null),
  ('good30',      'study','学习','💯','三十次优秀',    '累计 30 次优秀（A）',         30, 240, true, null, null),
  ('perfect5',    'study','学习','🏆','五次满分',      '获得 5 次满分（A+）',          5, 250, true, null, null),
  ('perfect15',   'study','学习','🥇','满分小超人',    '获得 15 次满分（A+）',        15, 260, true, null, null),
  -- 五育
  ('dim_de',      'five','五育','🤝','热心小帮手',    '德育累计 100 星',            100, 310, true, null, null),
  ('dim_zhi',     'five','五育','📚','智慧小书虫',    '智育累计 200 星',            200, 320, true, null, null),
  ('dim_ti',      'five','五育','🏃','运动小健将',    '体育累计 100 星',            100, 330, true, null, null),
  ('dim_mei',     'five','五育','🎨','小小艺术家',    '美育累计 100 星',            100, 340, true, null, null),
  ('dim_lao',     'five','五育','🧹','劳动小能手',    '劳动累计 100 星',            100, 350, true, null, null),
  ('dim_all',     'five','五育','💎','五边形战士',  '五项都达到 50 星',            50, 360, true, null, null),
  -- 成长
  ('level2',      'growth','成长','⭐','成长新星',     '升到 2 级',                    2, 410, true, null, null),
  ('level3',      'growth','成长','🌟','成长之星',     '升到 3 级',                    3, 420, true, null, null),
  ('level5',      'growth','成长','🎖️','班级榜样',     '升到 5 级',                    5, 430, true, null, null),
  ('level7',      'growth','成长','👑','满级小达人',   '升到 7 级',                    7, 440, true, null, null),
  -- 荣誉
  ('active20',    'honor','荣誉','🌻','积极小星星',   '累计 20 次积极表现',          20, 510, true, null, null),
  ('top3',        'honor','荣誉','🥇','班级前三',     '星光值超过 20，且经验进入班级前三', 3, 520, false, null, null),
  ('star100',     'honor','荣誉','⭐','星光小富',     '累计获得 100 星光值',        100, 530, true, null, null),
  ('star500',     'honor','荣誉','💫','星光满满',     '累计获得 500 星光值',        500, 540, true, null, null)
on conflict (key) do update
  set group_key     = excluded.group_key,
      group_name    = excluded.group_name,
      icon          = excluded.icon,
      name          = excluded.name,
      desc_text     = excluded.desc_text,
      target        = excluded.target,
      sort_order    = excluded.sort_order,
      show_progress = excluded.show_progress,
      -- 绑定位只在显式给值时覆盖，避免重跑把已挂好的奖励清空
      reward_avatar = coalesce(excluded.reward_avatar, public.achievement_def.reward_avatar),
      reward_frame  = coalesce(excluded.reward_frame,  public.achievement_def.reward_frame),
      enabled       = true,
      updated_at    = now();

-- ------------------------------------------------------------
-- 3. 进度计算（展示用；判定与 sync 里的条件同口径）
--    p_dims 传 student_dims(...) -> 'total'
-- ------------------------------------------------------------
create or replace function public.ach_progress(
  p_key     text,
  m         jsonb,
  p_level   int,
  p_dims    jsonb,
  p_balance int,
  p_earned  int
) returns int language sql immutable as $func$
  select greatest(0, case p_key
    when 'first_record' then coalesce((m->>'total_records')::int, 0)
    when 'days10'       then coalesce((m->>'total_days')::int, 0)
    when 'days30'       then coalesce((m->>'total_days')::int, 0)
    when 'days50'       then coalesce((m->>'total_days')::int, 0)
    when 'tasks10'      then coalesce((m->>'tasks_done')::int, 0)
    when 'tasks30'      then coalesce((m->>'tasks_done')::int, 0)
    when 'good10'       then coalesce((m->>'good_tasks')::int, 0)
    when 'good30'       then coalesce((m->>'good_tasks')::int, 0)
    when 'perfect5'     then coalesce((m->>'perfect_tasks')::int, 0)
    when 'perfect15'    then coalesce((m->>'perfect_tasks')::int, 0)
    when 'level2'       then coalesce(p_level, 1)
    when 'level3'       then coalesce(p_level, 1)
    when 'level5'       then coalesce(p_level, 1)
    when 'level7'       then coalesce(p_level, 1)
    when 'active20'     then coalesce((m->>'active_records')::int, 0)
    when 'top3'         then least(coalesce((m->>'rank_in_class')::int, 99), 3)
    when 'dim_de'       then coalesce((p_dims->>'de')::int, 0)
    when 'dim_zhi'      then coalesce((p_dims->>'zhi')::int, 0)
    when 'dim_ti'       then coalesce((p_dims->>'ti')::int, 0)
    when 'dim_mei'      then coalesce((p_dims->>'mei')::int, 0)
    when 'dim_lao'      then coalesce((p_dims->>'lao')::int, 0)
    when 'dim_all'      then least(coalesce((p_dims->>'de')::int, 0),
                                   coalesce((p_dims->>'zhi')::int, 0),
                                   coalesce((p_dims->>'ti')::int, 0),
                                   coalesce((p_dims->>'mei')::int, 0),
                                   coalesce((p_dims->>'lao')::int, 0))
    when 'star100'      then coalesce(p_earned, 0)
    when 'star500'      then coalesce(p_earned, 0)
    else 0 end);
$func$;

revoke execute on function public.ach_progress(text, jsonb, int, jsonb, int, int) from public;
grant  execute on function public.ach_progress(text, jsonb, int, jsonb, int, int) to anon, authenticated;

-- ------------------------------------------------------------
-- 4. 成就结算：只增不减（永久保留）
--    v178 之前的版本会把「已不达标」的成就删掉（自动撤销），
--    导致班级前三掉出前三后成就消失。本次移除该逻辑。
-- ------------------------------------------------------------
create or replace function public.sync_student_achievements(p_sid uuid)
returns jsonb language plpgsql security definer set search_path = public as $func$
declare
  v_class  text;
  v_name   text;
  v_level  int;
  v_de     int := 0;
  v_zhi    int := 0;
  v_ti     int := 0;
  v_mei    int := 0;
  v_lao    int := 0;
  v_min    int := 0;
  v_bal    int := 0;
  v_earned int := 0;
  m        jsonb;
  v_should text[] := '{}';
  v_new    int := 0;
begin
  select class, student_name, level,
         coalesce(xp_de, 0), coalesce(xp_zhi, 0), coalesce(xp_ti, 0),
         coalesce(xp_mei, 0), coalesce(xp_lao, 0)
    into v_class, v_name, v_level, v_de, v_zhi, v_ti, v_mei, v_lao
    from public.student_info
   where id = p_sid;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  v_level := coalesce(v_level, 1);
  m := public.student_metrics(v_class, v_name);

  select coalesce(balance, 0), coalesce(total_earned, 0)
    into v_bal, v_earned
    from public.student_wallet
   where class = v_class and student_name = v_name;

  -- ── 启程 ──
  if coalesce((m->>'total_records')::int, 0) >= 1  then v_should := array_append(v_should, 'first_record'); end if;
  if coalesce((m->>'total_days')::int, 0)    >= 10 then v_should := array_append(v_should, 'days10'); end if;
  if coalesce((m->>'total_days')::int, 0)    >= 30 then v_should := array_append(v_should, 'days30'); end if;
  if coalesce((m->>'total_days')::int, 0)    >= 50 then v_should := array_append(v_should, 'days50'); end if;

  -- ── 学习 ──
  if coalesce((m->>'tasks_done')::int, 0)    >= 10 then v_should := array_append(v_should, 'tasks10'); end if;
  if coalesce((m->>'tasks_done')::int, 0)    >= 30 then v_should := array_append(v_should, 'tasks30'); end if;
  if coalesce((m->>'good_tasks')::int, 0)    >= 10 then v_should := array_append(v_should, 'good10'); end if;
  if coalesce((m->>'good_tasks')::int, 0)    >= 30 then v_should := array_append(v_should, 'good30'); end if;
  if coalesce((m->>'perfect_tasks')::int, 0) >= 5  then v_should := array_append(v_should, 'perfect5'); end if;
  if coalesce((m->>'perfect_tasks')::int, 0) >= 15 then v_should := array_append(v_should, 'perfect15'); end if;

  -- ── 五育 ──
  v_min := least(v_de, v_zhi, v_ti, v_mei, v_lao);
  if v_de  >= 100 then v_should := array_append(v_should, 'dim_de');  end if;
  if v_zhi >= 200 then v_should := array_append(v_should, 'dim_zhi'); end if;
  if v_ti  >= 100 then v_should := array_append(v_should, 'dim_ti');  end if;
  if v_mei >= 100 then v_should := array_append(v_should, 'dim_mei'); end if;
  if v_lao >= 100 then v_should := array_append(v_should, 'dim_lao'); end if;
  if v_min >= 50  then v_should := array_append(v_should, 'dim_all'); end if;

  -- ── 成长 ──
  if v_level >= 2 then v_should := array_append(v_should, 'level2'); end if;
  if v_level >= 3 then v_should := array_append(v_should, 'level3'); end if;
  if v_level >= 5 then v_should := array_append(v_should, 'level5'); end if;
  if v_level >= 7 then v_should := array_append(v_should, 'level7'); end if;

  -- ── 荣誉 ──
  if coalesce((m->>'active_records')::int, 0) >= 20 then v_should := array_append(v_should, 'active20'); end if;
  -- 班级前三：名次 ≤ 3 且 星光值余额 > 20（避免 0 星也占前三拿成就）
  if coalesce((m->>'rank_in_class')::int, 999) <= 3 and coalesce(v_bal, 0) > 20 then
    v_should := array_append(v_should, 'top3');
  end if;
  if coalesce(v_earned, 0) >= 100 then v_should := array_append(v_should, 'star100'); end if;
  if coalesce(v_earned, 0) >= 500 then v_should := array_append(v_should, 'star500'); end if;

  -- ── 只增不减：写过的不删（成就一旦获得永久保留）──
  insert into public.student_achievements(student_id, a_key)
  select p_sid, k
    from unnest(v_should) as k
   where exists (select 1 from public.achievement_def d where d.key = k)
  on conflict (student_id, a_key) do nothing;
  get diagnostics v_new = row_count;

  return jsonb_build_object(
    'ok', true,
    'new_unlocked', v_new,
    'revoked', 0,
    'total_unlocked', (select count(*) from public.student_achievements where student_id = p_sid)
  );
end;
$func$;

revoke execute on function public.sync_student_achievements(uuid) from public;
grant  execute on function public.sync_student_achievements(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 5. 学生档案：成就列表改读定义表（分组 + 奖励绑定位）
--    返回结构在原字段基础上追加：group_key / group_name / show_progress /
--    reward_avatar / reward_frame；原有 key/icon/name/desc/cur/target/unlocked 不变
-- ------------------------------------------------------------
create or replace function public.get_student_profile(p_class text, p_student text)
returns jsonb language plpgsql security definer set search_path = public as $func$
declare
  v_sid    uuid;
  v_xp     int;
  v_level  int;
  v_avatar text;
  v_frame  text;
  v_ct     text;
  v_de     int := 0;
  v_zhi    int := 0;
  v_ti     int := 0;
  v_mei    int := 0;
  v_lao    int := 0;
  v_bal    int := 0;
  v_earned int := 0;
  m        jsonb;
  v_dims   jsonb;
  v_keys   text[] := '{}';
  v_achs   jsonb;
begin
  select id, xp, level, avatar, frame, coalesce(card_theme, ''),
         coalesce(xp_de, 0), coalesce(xp_zhi, 0), coalesce(xp_ti, 0),
         coalesce(xp_mei, 0), coalesce(xp_lao, 0)
    into v_sid, v_xp, v_level, v_avatar, v_frame, v_ct,
         v_de, v_zhi, v_ti, v_mei, v_lao
    from public.student_info
   where class = btrim(coalesce(p_class, ''))
     and student_name = btrim(coalesce(p_student, ''))
   limit 1;

  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  -- 进主页顺手结算一次（只增不减，可重复调用）
  perform public.sync_student_achievements(v_sid);

  select coalesce(array_agg(a_key), '{}') into v_keys
    from public.student_achievements
   where student_id = v_sid;

  select coalesce(balance, 0), coalesce(total_earned, 0)
    into v_bal, v_earned
    from public.student_wallet
   where class = btrim(coalesce(p_class, ''))
     and student_name = btrim(coalesce(p_student, ''));

  m := public.student_metrics(p_class, p_student);
  v_dims := public.student_dims(p_class, p_student);

  select coalesce(jsonb_agg(jsonb_build_object(
           'key',           d.key,
           'group_key',     d.group_key,
           'group_name',    d.group_name,
           'icon',          d.icon,
           'name',          d.name,
           'desc',          d.desc_text,
           'cur',           least(public.ach_progress(d.key, m, v_level, v_dims -> 'total', v_bal, v_earned), d.target),
           'target',        d.target,
           'show_progress', d.show_progress,
           'reward_avatar', d.reward_avatar,
           'reward_frame',  d.reward_frame,
           'unlocked',      d.key = any(v_keys)
         ) order by d.sort_order, d.key), '[]'::jsonb)
    into v_achs
    from public.achievement_def d
   where d.enabled;

  return jsonb_build_object(
    'ok', true,
    'xp', v_xp,
    'level', v_level,
    'avatar', v_avatar,
    'frame', coalesce(v_frame, 'none'),
    'card_theme', coalesce(v_ct, ''),
    'star_balance', coalesce(v_bal, 0),
    'metrics', m,
    'dims', v_dims,
    'achievements', coalesce(v_achs, '[]'::jsonb)
  );
end;
$func$;

revoke execute on function public.get_student_profile(text, text) from public;
grant  execute on function public.get_student_profile(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 6. 头像框命名优化（学生端显示）
--    铜/银/金 + 皇冠 是材质/成人化说法，小学生缺少画面感：
--      铜环 → 暖阳环（橙红火焰，像太阳）
--      银环 → 月光环（淡蓝水彩，像月光）
--      金环 → 阳光环（金色）
--      皇冠环 → 冠军环（"皇冠"偏等级感，"冠军"是运动会里的词）
--    彩虹环 / 星光环 / 爱心环 本身已是学生熟悉的词，保留不动
-- ------------------------------------------------------------
update public.shop_item
   set name = case item_key
                when 'bronze' then '暖阳环'
                when 'silver' then '月光环'
                when 'gold'   then '阳光环'
                when 'crown'  then '冠军环'
                else name
              end,
       updated_at = now()
 where item_type = 'frame'
   and item_key in ('bronze','silver','gold','crown');

-- 抽奖奖池里的同名商品文案同步
update public.lottery_prize
   set name = case prize_item
                when 'bronze' then '暖阳环头像框'
                when 'gold'   then '阳光环头像框'
                when 'crown'  then '冠军环头像框'
                else name
              end
 where prize_type = 'frame'
   and prize_item in ('bronze','gold','crown');

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 7. 全量补结算（幂等）：让新增 4 枚成就对历史数据立即生效
-- ------------------------------------------------------------
select count(*) as synced_students
  from (select public.sync_student_achievements(id) from public.student_info) t;

-- ------------------------------------------------------------
-- 8. 自检
-- ------------------------------------------------------------
-- 成就定义总数（应为 24）
-- select count(*) from public.achievement_def where enabled;
-- 分组成败
-- select group_name, count(*) from public.achievement_def where enabled group by group_name order by min(sort_order);
-- 单个学生：成就项数 / 解锁数 / 班级前三是否达标
-- select jsonb_array_length(p -> 'achievements') as total,
--        (select count(*) from jsonb_array_elements(p -> 'achievements') e
--          where (e ->> 'unlocked')::boolean) as unlocked,
--        (select e ->> 'unlocked' from jsonb_array_elements(p -> 'achievements') e
--          where e ->> 'key' = 'top3') as top3_unlocked,
--        p -> 'star_balance' as star_balance
--   from (select public.get_student_profile('六年级一班','某学生') as p) s;
-- 头像框新名
-- select item_key, name from public.shop_item where item_type='frame'
--   and item_key in ('bronze','silver','gold','rainbow','star','heart','crown') order by sort_order;
