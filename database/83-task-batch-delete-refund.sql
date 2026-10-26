-- ============================================================
-- 83-task-batch-delete-refund.sql
-- v152.1：教师端个人任务/挑战任务 多选删除 + 删除经验回退
-- 内容：
--   1) 改造 delete_personal_task：任意状态可删；已完成任务按 xp_value 回退经验并重算等级
--   2) 新增 delete_personal_tasks(p_task_ids jsonb)：批量删除（逐条走回退，同一事务语义）
--   3) 改造 delete_challenge_task：任意状态可删；已达成档位按 levels 方案累计回退经验并重算等级
--   4) 新增 delete_challenge_tasks(p_task_ids jsonb)：批量删除
-- 可重复执行。注意：本文件必须在 70 号（personal_task 表）与 82 号（challenge_task 表）之后执行。
-- ============================================================

-- ---------- 1) 个人任务：单条删除（含经验回退） ----------
-- 旧版 delete_personal_task（若存在）行为为仅能取消未完成任务；本次覆盖为：
--   · pending → 直接删除（未加分）
--   · done    → 先按任务 xp_value 回退该生对应维度与总经验、重算等级，再删除
drop function if exists public.delete_personal_task(uuid);
create or replace function public.delete_personal_task(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_t       public.personal_task%rowtype;
  v_refund  int := 0;
  v_xp_cur  int;
  v_lv      int;
  v_col     text;
begin
  select * into v_t from public.personal_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '任务不存在或已删除');
  end if;

  -- 已完成任务：回退已加经验（维度列 + 总经验 + 等级重算）
  if v_t.status = 'done' then
    v_refund := coalesce(v_t.xp_value, 0);
    v_col := case v_t.dim
               when 'de'  then 'xp_de'
               when 'zhi' then 'xp_zhi'
               when 'ti'  then 'xp_ti'
               when 'mei' then 'xp_mei'
               when 'lao' then 'xp_lao'
               else 'xp_zhi'
             end;
    execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) - $1) where class = $2 and student_name = $3',
                   v_col, v_col) using v_refund, v_t.class, v_t.student_name;
    update public.student_info
       set xp = greatest(0, coalesce(xp, 0) - v_refund)
     where class = v_t.class and student_name = v_t.student_name
     returning xp into v_xp_cur;
    if found then
      update public.student_info
         set level = public.level_from_xp(v_xp_cur)
       where class = v_t.class and student_name = v_t.student_name;
      select level into v_lv from public.student_info
       where class = v_t.class and student_name = v_t.student_name;
    end if;
  end if;

  delete from public.personal_task where id = p_task_id;
  return jsonb_build_object('ok', true, 'refund_xp', v_refund, 'level', v_lv);
end;
$$;

-- ---------- 2) 个人任务：批量删除（多选，经验回退） ----------
create or replace function public.delete_personal_tasks(p_task_ids jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id     uuid;
  v_res    jsonb;
  v_sum    int := 0;
  v_done   int := 0;
  v_failed int := 0;
begin
  if jsonb_typeof(p_task_ids) <> 'array' or jsonb_array_length(p_task_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', '请先勾选要删除的任务');
  end if;
  for v_id in
    select (e#>>'{}')::uuid from jsonb_array_elements(p_task_ids) e
  loop
    v_res := public.delete_personal_task(v_id);
    if (v_res->>'ok')::boolean then
      v_done := v_done + 1;
      v_sum  := v_sum + coalesce((v_res->>'refund_xp')::int, 0);
    else
      v_failed := v_failed + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'deleted', v_done, 'refund_xp', v_sum, 'failed', v_failed);
end;
$$;

-- ---------- 3) 挑战任务：单条删除（含已达成经验回退） ----------
-- 旧版不允许取消已加经验的挑战；本次覆盖为：任意状态可删，
-- 已达成档位按 levels 方案 [[档位,经验],...] 累计回退。
drop function if exists public.delete_challenge_task(uuid);
create or replace function public.delete_challenge_task(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_t      public.challenge_task%rowtype;
  v_done   int[] := '{}';
  v_gain   int := 0;
  v_xp_cur int;
  v_lv     int;
  v_col    text;
begin
  select * into v_t from public.challenge_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '挑战不存在或已删除');
  end if;

  -- 已达成档位 → 按方案累加已加经验
  select coalesce(array_agg((e#>>'{}')::int), '{}')
    into v_done
    from jsonb_array_elements(coalesce(v_t.done_levels, '[]'::jsonb)) e
   where (e#>>'{}') ~ '^-?[0-9]+$';

  if cardinality(v_done) > 0 then
    select coalesce(sum((a->>1)::int), 0)
      into v_gain
      from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)) a
     where (a->>0)::int = any(v_done);

    if v_gain > 0 then
      v_col := case v_t.dim
                 when 'de'  then 'xp_de'
                 when 'zhi' then 'xp_zhi'
                 when 'ti'  then 'xp_ti'
                 when 'mei' then 'xp_mei'
                 when 'lao' then 'xp_lao'
                 else 'xp_zhi'
               end;
      execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) - $1) where class = $2 and student_name = $3',
                     v_col, v_col) using v_gain, v_t.class, v_t.student_name;
      update public.student_info
         set xp = greatest(0, coalesce(xp, 0) - v_gain)
       where class = v_t.class and student_name = v_t.student_name
       returning xp into v_xp_cur;
      if found then
        update public.student_info
           set level = public.level_from_xp(v_xp_cur)
         where class = v_t.class and student_name = v_t.student_name;
        select level into v_lv from public.student_info
         where class = v_t.class and student_name = v_t.student_name;
      end if;
    end if;
  end if;

  delete from public.challenge_task where id = p_task_id;
  return jsonb_build_object('ok', true, 'refund_xp', v_gain, 'level', v_lv);
end;
$$;

-- ---------- 4) 挑战任务：批量删除（多选，经验回退） ----------
create or replace function public.delete_challenge_tasks(p_task_ids jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id     uuid;
  v_res    jsonb;
  v_sum    int := 0;
  v_done   int := 0;
  v_failed int := 0;
begin
  if jsonb_typeof(p_task_ids) <> 'array' or jsonb_array_length(p_task_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', '请先勾选要删除的挑战');
  end if;
  for v_id in
    select (e#>>'{}')::uuid from jsonb_array_elements(p_task_ids) e
  loop
    v_res := public.delete_challenge_task(v_id);
    if (v_res->>'ok')::boolean then
      v_done := v_done + 1;
      v_sum  := v_sum + coalesce((v_res->>'refund_xp')::int, 0);
    else
      v_failed := v_failed + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'deleted', v_done, 'refund_xp', v_sum, 'failed', v_failed);
end;
$$;

revoke execute on function public.delete_personal_task(uuid) from public;
grant  execute on function public.delete_personal_task(uuid) to anon, authenticated;
revoke execute on function public.delete_personal_tasks(jsonb) from public;
grant  execute on function public.delete_personal_tasks(jsonb) to anon, authenticated;
revoke execute on function public.delete_challenge_task(uuid) from public;
grant  execute on function public.delete_challenge_task(uuid) to anon, authenticated;
revoke execute on function public.delete_challenge_tasks(jsonb) from public;
grant  execute on function public.delete_challenge_tasks(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

-- 自检（可选）：
--   select public.delete_personal_tasks('["<uuid1>","<uuid2>"]'::jsonb);
--   select public.delete_challenge_tasks('["<uuid1>"]'::jsonb);
