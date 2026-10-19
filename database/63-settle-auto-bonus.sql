-- ============================================================
-- 63-settle-auto-bonus.sql  五维经验改造【第四步：自动化结算引擎】
--   新增 RPC：run_auto_bonus —— 按日幂等结算所有启用规则
--   规则条件：当天没有/有某标签（behavior->items 中是否存在该标签 id）
--   过滤：生效日期范围 + 执行星期（默认周一~周五）
--   加分：写对应维度列 + 同步总 xp 与 level（level_from_xp 重算）
--   幂等：auto_bonus_log (rule_id, student_name, bonus_date) 唯一
--   调用：教师端打开表现记录页时后台静默触发（前端 fire-and-forget）
--   可重复执行。执行后无副作用（不结算历史，只等触发）。
-- ============================================================

create or replace function public.run_auto_bonus(p_date date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Shanghai')::date);
  v_rule record;
  v_stu record;
  v_hit boolean;
  v_ok   int := 0;
  v_skip int := 0;
  v_rule_cnt int := 0;
  v_stu_cnt int := 0;
begin
  -- 遍历启用且今日生效的规则（日期范围 + 星期过滤）
  for v_rule in
    select r.*
    from public.auto_rules r
    where r.is_active
      and (r.start_date is null or r.start_date <= v_date)
      and (r.end_date   is null or r.end_date   >= v_date)
      and extract(isodow from v_date) = any(r.weekdays)
  loop
    v_rule_cnt := v_rule_cnt + 1;
    -- 遍历所有学生（规则不绑班级，全校生效）
    for v_stu in
      select id, class, student_name from public.student_info
    loop
      v_stu_cnt := v_stu_cnt + 1;
      -- 幂等：同一规则+学生+日期已结算过则跳过
      if exists (
        select 1 from public.auto_bonus_log
        where rule_id = v_rule.id and student_name = v_stu.student_name and bonus_date = v_date
      ) then
        v_skip := v_skip + 1;
        continue;
      end if;

      -- 当天该学生是否有目标标签记录
      select exists (
        select 1 from public.daily_record r
        where r.class = v_stu.class
          and r.student_name = v_stu.student_name
          and r.record_date = v_date
          and exists (
            select 1 from jsonb_array_elements(coalesce(r.behavior -> 'items', '[]'::jsonb)) it
            where it ->> 'id' = v_rule.tag_id::text
          )
      ) into v_hit;

      -- no_tag：当天没有该标签 → 加分；has_tag：当天有该标签 → 加分
      if (v_rule.trigger_type = 'no_tag' and not v_hit)
         or (v_rule.trigger_type = 'has_tag' and v_hit) then
        update public.student_info s
           set xp    = s.xp + v_rule.xp_value,
               level = public.level_from_xp(s.xp + v_rule.xp_value),
               xp_de  = case when v_rule.dim = 'de'  then s.xp_de  + v_rule.xp_value else s.xp_de  end,
               xp_zhi = case when v_rule.dim = 'zhi' then s.xp_zhi + v_rule.xp_value else s.xp_zhi end,
               xp_ti  = case when v_rule.dim = 'ti'  then s.xp_ti  + v_rule.xp_value else s.xp_ti  end,
               xp_mei = case when v_rule.dim = 'mei' then s.xp_mei + v_rule.xp_value else s.xp_mei end,
               xp_lao = case when v_rule.dim = 'lao' then s.xp_lao + v_rule.xp_value else s.xp_lao end
         where s.id = v_stu.id;

        insert into public.auto_bonus_log(rule_id, class, student_name, dim, xp_value, bonus_date)
        values (v_rule.id, v_stu.class, v_stu.student_name, v_rule.dim, v_rule.xp_value, v_date);

        v_ok := v_ok + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'date', v_date::text,
    'rules_active', v_rule_cnt,
    'students_scanned', v_stu_cnt,
    'awarded', v_ok,
    'skipped_duplicate', v_skip
  );
end;
$$;

-- 授权：教师端调用（匿名 anon 也可调，RPC 本身幂等且只写加分记录）
grant execute on function public.run_auto_bonus(date) to anon, authenticated, service_role;

-- 自检（可选，手动模拟今日结算；无规则时返回 awarded=0）
-- select public.run_auto_bonus();
