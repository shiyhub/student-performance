-- ============================================================
-- 123-reset-achievements-star-top3.sql
-- 成就记录清空 + 班级前三口径变更
--
-- 背景：成就功能尚未投入使用，student_achievements 里的记录全部来自
--       联调与试运行，直接清空后按新规则重新结算。
--
-- 新口径（班级前三 top3）：
--   1) 只有「累计获得星光值 > 20」的学生参与排名
--   2) 参与者在本班内按「累计获得总额」降序排名（并列同名次）
--   3) 排名 ≤ 3 即解锁
--   4) 解锁后永久保留：后续掉出前三也不撤销
--
-- 为什么用累计获得总额（student_wallet.total_earned）而不是当前余额：
--   余额会被兑换消费扣减，拿它排名等于「越攒越不敢花」，奖励了囤积；
--   总额只在获得时累加、消费不减（109 的触发器维护），反映真实获得量，
--   与「荣誉」语义一致，也让「永久保留」在逻辑上自洽。
--
-- 与旧口径的差别：
--   旧 = 按经验（xp）排名，没有星光值门槛
--   新 = 按累计获得星光值排名，且必须先过 20 星门槛
--
-- 排名口径统一由 public.star_rank_in_class() 提供，
-- 结算与人工验证查的是同一个函数，避免两边算法漂移。
--
-- 可重复执行。执行位置：Supabase Dashboard → SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 1. 清空全部成就记录
--    pg_safeupdate 要求带 WHERE，用 where true
-- ------------------------------------------------------------
delete from public.student_achievements where true;

-- ------------------------------------------------------------
-- 2. 星光排名（唯一口径来源）
--    口径：累计获得总额 > 20 的学生参与排名，按总额降序取名次
--    返回：1..n = 本班星光榜名次；999 = 累计获得不足 20 或查无此人
--    注意用的是 total_earned（累计获得），不是 balance（当前余额）
-- ------------------------------------------------------------
create or replace function public.star_rank_in_class(p_class text, p_student text)
returns int
language sql
stable
security definer
set search_path = public
as $func$
  with ranked as (
    select si.id,
           rank() over (order by coalesce(sw.total_earned, 0) desc) as rk
      from public.student_info si
      left join public.student_wallet sw
             on sw.class = si.class and sw.student_name = si.student_name
     where si.class = btrim(coalesce(p_class, ''))
       and coalesce(sw.total_earned, 0) > 20
  ), me as (
    select id
      from public.student_info
     where class = btrim(coalesce(p_class, ''))
       and student_name = btrim(coalesce(p_student, ''))
     limit 1
  )
  select coalesce((select rk from ranked where id = (select id from me)), 999);
$func$;

revoke execute on function public.star_rank_in_class(text, text) from public;
grant  execute on function public.star_rank_in_class(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 3. 成就文案同步（学生端可见）
-- ------------------------------------------------------------
update public.achievement_def
   set desc_text  = '累计获得星光值超过 20，且位列班级星光榜前三',
       target     = 3,
       updated_at = now()
 where key = 'top3';

-- ------------------------------------------------------------
-- 4. 重建结算函数
--    top3 走新排名口径；其余 23 枚逻辑不变
--    全部 insert ... on conflict do nothing = 只增不减
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

  select coalesce(total_earned, 0)
    into v_earned
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
  if coalesce(v_earned, 0) >= 100 then v_should := array_append(v_should, 'star100'); end if;
  if coalesce(v_earned, 0) >= 500 then v_should := array_append(v_should, 'star500'); end if;

  -- 班级前三：累计获得 > 20 且班级星光榜前三（与 star_rank_in_class 同源）
  if public.star_rank_in_class(v_class, v_name) <= 3 then
    v_should := array_append(v_should, 'top3');
  end if;

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
-- 4b. 全班重算（人工校验 / 补结算用）
--     逐个调用结算函数，排名每次都按当前星光值实时计算
-- ------------------------------------------------------------
create or replace function public.recalc_class_achievements(p_class text)
returns jsonb language plpgsql security definer set search_path = public as $func$
declare
  v_id uuid;
  n    int := 0;
begin
  for v_id in
    select id from public.student_info
     where class = btrim(coalesce(p_class, ''))
  loop
    perform public.sync_student_achievements(v_id);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'class', p_class, 'students', n);
end;
$func$;

revoke execute on function public.recalc_class_achievements(text) from public;
grant  execute on function public.recalc_class_achievements(text) to anon, authenticated;

-- ============================================================
-- 5. 验证（三段，按需单独执行）
-- ============================================================

-- ① 确认已清空：应返回 0
-- select count(*) as remaining from public.student_achievements;

-- ② 班级星光榜：谁有资格、排第几、是否已解锁
--    只列累计获得 > 20 的参与排名者，按名次排序
--    total_earned = 累计获得（排名依据）；balance = 当前余额（仅供参考）
-- select si.class,
--        si.student_name,
--        coalesce(sw.total_earned, 0) as total_earned,
--        coalesce(sw.balance, 0) as balance,
--        public.star_rank_in_class(si.class, si.student_name) as star_rank,
--        (public.star_rank_in_class(si.class, si.student_name) <= 3) as in_top3,
--        exists (select 1 from public.student_achievements a
--                 where a.student_id = si.id and a.a_key = 'top3') as top3_unlocked
--   from public.student_info si
--   left join public.student_wallet sw
--          on sw.class = si.class and sw.student_name = si.student_name
--  where coalesce(sw.total_earned, 0) > 20
--  order by si.class, star_rank;

-- ③ 对一名学生手动结算（换成真实班级/姓名）
-- select public.sync_student_achievements(si.id) as result
--   from public.student_info si
--  where si.class = '六年级1班' and si.student_name = '张三';
