-- ============================================================
-- 97-xp-log-fix.sql  经验流水双倍修复（挑战任务渠道）
-- 2026-10-29  v152.10
--
-- 问题：挑战任务流水被两条通道各写一次
--   93号实时流水   label = 任务标题+档位（ref_id = 填报记录 id）
--   87号历史注入   label = 固定'挑战任务'（ref_id = 同一填报记录 id）
--   唯一键 (source, ref_id, label) 含 label → 互不冲突 → 双倍流水
--   注入只回填日志不加经验 → 当前经验不变，流水合计虚高（差额=重复流水合计）
--
-- 修复（两步）：
--   ① 重定义 inject_xp_log()：挑战段 label 改为与 93 号一致的
--      「任务标题+档位」→ 再次注入时幂等冲突自动跳过，不再双写
--   ② 存量清理：删除已存在「带档位实时流水」的同 ref_id 泛化'挑战任务'流水
--
-- 用法：
--   ① 执行本文件（可重复执行）
--   ② 教师后台 → 📜 经验记录 → 查询 → 流水合计应等于当前经验（或正常差额）
-- ============================================================

-- ---------- ① 重定义 inject_xp_log（挑战段口径统一） ----------
-- ---------- 2) 注入函数：把现有历史加分按真实经验值写入流水 ----------
create or replace function public.inject_xp_log()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt int := 0;
  v_rec record;
  v_tag_xp int;
  v_dim  text;
  v_label text;
begin
  -- ① 日常表现：每项按「标签当前真实分值」注入（负面 0 分不记）
  for v_rec in
    select dr.id as ref_id, dr.class, dr.student_name, dr.record_date,
           e ->> 'id' as tag_id, e ->> 'category' as category,
           e ->> 'value' as value
      from public.daily_record dr,
           lateral jsonb_array_elements(
             case when jsonb_typeof(dr.behavior) = 'object'
                   and jsonb_typeof(dr.behavior -> 'items') = 'array'
                  then dr.behavior -> 'items'
                  else '[]'::jsonb end
           ) as e
  loop
    select t.xp_value, coalesce(nullif(t.dim, ''), 'zhi'), t.label
      into v_tag_xp, v_dim, v_label
      from public.behavior_tags t
     where t.id::text = v_rec.tag_id;
    if v_tag_xp is null then
      v_tag_xp := case when v_rec.category = 'negative' then 0 else 2 end;
      v_dim := 'zhi';
    end if;
    if coalesce(v_tag_xp, 0) > 0 then
      insert into public.xp_log
        (class, student_name, source, ref_id, label, dim, xp, record_date)
      values
        (v_rec.class, v_rec.student_name, 'daily', v_rec.ref_id,
         case when v_rec.value is not null and v_rec.value <> '' then v_label || '：' || v_rec.value else v_label end,
         v_dim, v_tag_xp, v_rec.record_date)
      on conflict (source, ref_id, label) do nothing;
      v_cnt := v_cnt + 1;
    end if;
  end loop;

  -- ② 每日任务：按 xp_awarded 净值（只加总经验，不进五维）
  for v_rec in
    select ts.id as ref_id, ts.class, ts.student_name, dt.task_date,
           coalesce(dt.title, '每日任务') as title, ts.xp_awarded
      from public.task_submission ts
      left join public.daily_task dt on dt.id = ts.task_id
     where ts.xp_awarded > 0
  loop
    insert into public.xp_log
      (class, student_name, source, ref_id, label, dim, xp, record_date)
    values
      (v_rec.class, v_rec.student_name, 'task', v_rec.ref_id, v_rec.title, null, v_rec.xp_awarded, v_rec.task_date)
    on conflict (source, ref_id, label) do nothing;
    v_cnt := v_cnt + 1;
  end loop;

  -- ③ 个人任务：已完成（含教师代填）按任务分值 + 维度
  for v_rec in
    select id as ref_id, class, student_name, content, xp_value, dim, task_date
      from public.personal_task
     where status = 'done' and coalesce(xp_value, 0) > 0
  loop
    insert into public.xp_log
      (class, student_name, source, ref_id, label, dim, xp, record_date)
    values
      (v_rec.class, v_rec.student_name, 'personal', v_rec.ref_id, v_rec.content,
       coalesce(nullif(v_rec.dim, ''), 'zhi'), v_rec.xp_value, v_rec.task_date)
    on conflict (source, ref_id, label) do nothing;
    v_cnt := v_cnt + 1;
  end loop;

  -- ④ 挑战任务：按填报记录（已取消的不算）
  -- v152.10 修复：label 与 93 号实时流水口径一致（任务标题+档位），
  -- 唯一键 (source, ref_id, label) 幂等冲突自动跳过，杜绝注入/实时双写
  for v_rec in
    select cs.id as ref_id, cs.class, cs.student_name, cs.levels, cs.xp,
           cs.dim, cs.submitted_at, coalesce(ct.title, '挑战任务') as title
      from public.challenge_submission cs
      left join public.challenge_task ct on ct.id = cs.challenge_id
     where cs.status = 'active' and coalesce(cs.xp, 0) > 0
  loop
    insert into public.xp_log
      (class, student_name, source, ref_id, label, dim, xp, record_date)
    values
      (v_rec.class, v_rec.student_name, 'challenge', v_rec.ref_id,
       v_rec.title || '（' ||
         coalesce((select string_agg(x, '/') from jsonb_array_elements_text(v_rec.levels) x), '') ||
         '档）',
       coalesce(nullif(v_rec.dim, ''), 'zhi'), v_rec.xp,
       (v_rec.submitted_at)::date)
    on conflict (source, ref_id, label) do nothing;
    v_cnt := v_cnt + 1;
  end loop;

  -- ⑤ 手动分配任务：确认完成按标签真实分值（当前表无记录不受影响；
  --    若确认函数同时写入 daily_record，注意会与①重复——当前数据为 0）
  for v_rec in
    select mt.id as ref_id, mt.class, mt.student_name, mt.task_date,
           mt.tag_id, bt.label, bt.xp_value, bt.dim
      from public.manual_task mt
      left join public.behavior_tags bt on bt.id = mt.tag_id
     where mt.status = 'done' and coalesce(bt.xp_value, 0) > 0
  loop
    insert into public.xp_log
      (class, student_name, source, ref_id, label, dim, xp, record_date)
    values
      (v_rec.class, v_rec.student_name, 'manual', v_rec.ref_id, v_rec.label,
       coalesce(nullif(v_rec.dim, ''), 'zhi'), v_rec.xp_value, v_rec.task_date)
    on conflict (source, ref_id, label) do nothing;
    v_cnt := v_cnt + 1;
  end loop;

  return jsonb_build_object('ok', true, 'injected', v_cnt);
end;
$$;



-- ---------- ② 存量清理：删除挑战任务双倍流水 ----------
-- 只删「同 ref_id 已存在带档位实时流水」的泛化'挑战任务'记录；
-- 若某填报只有注入流水（无实时流水对应），保留不动。
delete from public.xp_log x
 where x.source = 'challenge'
   and x.label = '挑战任务'
   and exists (
     select 1 from public.xp_log y
      where y.source = 'challenge'
        and y.ref_id = x.ref_id
        and y.label <> '挑战任务'
        and y.id <> x.id
   );

-- ---------- ③ 验证 ----------
-- ① 查剩余流水（应无'挑战任务'泛化重复；每个填报一条带档位记录）
-- select source, ref_id, label, xp from public.xp_log where source='challenge' order by created_at;
-- ② 再执行一次注入（应全部幂等跳过，injected 计数仅统计尝试）
-- select public.inject_xp_log();
-- ③ 复查流水合计与当前经验对照
-- select coalesce(sum(xp),0) as 流水合计 from public.xp_log where class='六年级一班' and student_name='杨悦';
