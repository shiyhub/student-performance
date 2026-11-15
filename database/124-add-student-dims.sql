-- ============================================================
-- 124-add-student-dims.sql
-- 补齐缺失的 public.student_dims(text, text)
--
-- 现象：
--   学生端 get_student_profile 全部 404，控制台一片红；
--   成就墙停在 1/14（读的是很久以前的本机离线缓存）。
--
-- 根因：
--   121 的 get_student_profile 内部要调 public.student_dims()，
--   但这个函数只在 119 里创建过。119 被跳过没执行，
--   于是任何真实学生走到那行就抛 42883：
--     function public.student_dims(text, text) does not exist
--   PostgREST 把函数体内的这类错误映射成 HTTP 404，
--   前端 loadProfile() 捕获后回退到 Offline 本机缓存，
--   所以页面看似正常、成就却一直是旧的 14 枚结构。
--
--   （用不存在的假学生名探测时，get_student_profile 会在
--    「查无此人」处提前 return，走不到 student_dims，会误判成正常。）
--
-- 为什么单独成补丁、不直接重跑 119：
--   119 还会覆盖 sync_student_achievements 和 get_student_profile，
--   把已经建好的 24 枚成就结构和后续口径退回旧版。
--   这里只补缺失的函数，不动任何已有定义。
--
-- 执行顺序：先执行本文件，再执行 123-reset-achievements-star-top3.sql
-- 可重复执行。执行位置：Supabase Dashboard → SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 0. 前置：card_theme 列（117 已加，这里幂等兜底）
-- ------------------------------------------------------------
alter table public.student_info add column if not exists card_theme text;

-- ------------------------------------------------------------
-- 1. 五维读数（与 119 完全一致，未做任何修改）
--    累计：student_info.xp_de/xp_zhi/xp_ti/xp_mei/xp_lao
--    本周：daily_record.behavior.items → behavior_tags.dim
--           UNION auto_bonus_log（自动加分直接写维度列，不落行为记录）
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
    ) s
   where s.xp > 0;

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
    'total_sum', v_de + v_zhi + v_ti + v_mei + v_lao,
    'week_sum',  w_de + w_zhi + w_ti + w_mei + w_lao,
    'prev_sum',  p_de + p_zhi + p_ti + p_mei + p_lao,
    'week_start', v_ws,
    'top', coalesce(v_top, ''), 'top_xp', coalesce(v_top_xp, 0),
    'prev_top', coalesce(v_ptop, ''), 'prev_xp', coalesce(v_ptop_xp, 0),
    'medal_min', 5
  );
end;
$$;

revoke execute on function public.student_dims(text, text) from public;
grant  execute on function public.student_dims(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 2. 验证：换成真实班级/学生，期望返回 ok=true 和 total/week 两组数字
-- select public.student_dims('六年级一班', '王玥');
-- ------------------------------------------------------------
