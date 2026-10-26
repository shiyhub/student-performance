-- ============================================================
-- 85-challenge-submission.sql
-- v152.2：挑战任务填报记录（单次可取消）
-- 内容：
--   1) 建表 challenge_submission：记录学生每次挑战提交的档位与经验
--   2) 重写 confirm_challenge_levels：加分的同时写入一条填报记录
--   3) 新增 cancel_challenge_submission(p_submission_id)：取消单次填报，
--      回退该次经验（维度+总经验+等级重算），并从 done_levels 移除该次档位
-- 可重复执行。注意：须在 82 号（挑战任务 v2）之后执行。
-- ============================================================

-- ---------- 1) 填报记录表 ----------
create table if not exists public.challenge_submission (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenge_task(id) on delete cascade,
  class         text not null,
  student_name  text not null,
  dim           text,
  levels        jsonb not null,          -- 本次提交的档位数组，如 [10,15]
  xp            int  not null default 0, -- 本次提交所得经验
  submitted_at  timestamptz not null default now(),
  status        text not null default 'active'   -- active / cancelled
);
create index if not exists idx_chsub_challenge on public.challenge_submission (challenge_id);

alter table public.challenge_submission enable row level security;
drop policy if exists "chsub teacher all" on public.challenge_submission;
create policy "chsub teacher all" on public.challenge_submission
  for all to authenticated using (true) with check (true);
drop policy if exists "chsub anon select" on public.challenge_submission;
create policy "chsub anon select" on public.challenge_submission
  for select to anon using (true);

-- ---------- 2) 重写 confirm_challenge_levels（82 号基础上增加填报记录写入） ----------
drop function if exists public.confirm_challenge_task(uuid, int);
create or replace function public.confirm_challenge_levels(p_task_id uuid, p_levels jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_t        public.challenge_task%rowtype;
  v_done     int[] := '{}';
  v_new      int[] := '{}';
  v_item     jsonb;
  v_lv_num   int;
  v_found    boolean;
  v_xp_one   int;
  v_xp_earn  int := 0;
  v_xp_cur   int;
  v_lv       int;
  v_col      text;
  v_done_cnt int;
  v_total    int;
  v_row_ex   boolean;
begin
  select * into v_t from public.challenge_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '挑战不存在或已取消');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '该挑战已全部达成');
  end if;
  if jsonb_typeof(p_levels) <> 'array' or jsonb_array_length(p_levels) = 0 then
    return jsonb_build_object('ok', false, 'reason', '请先勾选本次达成的档位');
  end if;

  select coalesce(array_agg((e#>>'{}')::int), '{}')
    into v_done
    from jsonb_array_elements(coalesce(v_t.done_levels, '[]'::jsonb)) e
   where (e#>>'{}') ~ '^-?[0-9]+$';

  for v_item in select * from jsonb_array_elements(p_levels)
  loop
    if (v_item#>>'{}') ~ '^-?[0-9]+$' then
      v_lv_num := (v_item#>>'{}')::int;
    else
      continue;
    end if;
    if v_lv_num = any(v_done) then continue; end if;
    select exists(
      select 1 from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)) a
       where (a->>0)::int = v_lv_num
    ) into v_found;
    if not v_found then continue; end if;
    v_new := array_append(v_new, v_lv_num);
    select coalesce((a->>1)::int, 0)
      into v_xp_one
      from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)) a
     where (a->>0)::int = v_lv_num
     limit 1;
    v_xp_earn := v_xp_earn + coalesce(v_xp_one, 0);
  end loop;

  if array_length(v_new, 1) is null then
    return jsonb_build_object('ok', false, 'reason', '没有可新增的达成档位（请勿重复提交）');
  end if;

  select exists(
    select 1 from public.student_info
     where class = v_t.class and student_name = v_t.student_name
  ) into v_row_ex;
  if not v_row_ex then
    return jsonb_build_object('ok', false, 'reason', '名单中未找到该学生，请联系老师');
  end if;

  v_col := case v_t.dim
             when 'de'  then 'xp_de'
             when 'zhi' then 'xp_zhi'
             when 'ti'  then 'xp_ti'
             when 'mei' then 'xp_mei'
             when 'lao' then 'xp_lao'
             else 'xp_zhi'
           end;
  execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) + $1) where class = $2 and student_name = $3',
                 v_col, v_col) using v_xp_earn, v_t.class, v_t.student_name;
  update public.student_info
     set xp = greatest(0, coalesce(xp, 0) + v_xp_earn)
   where class = v_t.class and student_name = v_t.student_name
   returning xp into v_xp_cur;
  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp_cur)
     where class = v_t.class and student_name = v_t.student_name;
    select level into v_lv from public.student_info
     where class = v_t.class and student_name = v_t.student_name;
  end if;

  v_done := array(select distinct x from unnest(v_done || v_new) x order by 1);
  v_done_cnt := cardinality(v_done);
  v_total := (select count(*)::int from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)));

  update public.challenge_task
     set status = case when v_done_cnt >= v_total then 'done' else 'pending' end,
         max_level = (select max(x) from unnest(v_done) x),
         done_levels = to_jsonb(v_done),
         confirm_at = now(),
         filled_by = 'student'
   where id = p_task_id;

  -- v152.2：写入填报记录（单次可取消）
  insert into public.challenge_submission (challenge_id, class, student_name, dim, levels, xp, status)
  values (v_t.id, v_t.class, v_t.student_name, v_t.dim, to_jsonb(v_new), v_xp_earn, 'active');

  return jsonb_build_object(
    'ok', true,
    'xp_delta', v_xp_earn,
    'level', v_lv,
    'new_levels', to_jsonb(v_new),
    'done_count', v_done_cnt,
    'total_count', v_total,
    'status', case when v_done_cnt >= v_total then 'done' else 'pending' end
  );
end;
$$;

-- ---------- 3) 取消单次填报（回退该次经验 + 移除该次档位） ----------
create or replace function public.cancel_challenge_submission(p_submission_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_s       public.challenge_submission%rowtype;
  v_t       public.challenge_task%rowtype;
  v_done    int[] := '{}';
  v_removed int[] := '{}';
  v_newdone int[] := '{}';
  v_gain    int := 0;
  v_xp_cur  int;
  v_lv      int;
  v_col     text;
  v_total   int;
  v_done_cnt int;
begin
  select * into v_s from public.challenge_submission
   where id = p_submission_id and status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'reason', '填报记录不存在或已取消');
  end if;

  select * into v_t from public.challenge_task where id = v_s.challenge_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '对应挑战不存在');
  end if;

  -- 该次档位
  select coalesce(array_agg((e#>>'{}')::int), '{}')
    into v_removed
    from jsonb_array_elements(coalesce(v_s.levels, '[]'::jsonb)) e
   where (e#>>'{}') ~ '^-?[0-9]+$';

  -- 当前已达成档位，移除本次档位
  select coalesce(array_agg((e#>>'{}')::int), '{}')
    into v_done
    from jsonb_array_elements(coalesce(v_t.done_levels, '[]'::jsonb)) e
   where (e#>>'{}') ~ '^-?[0-9]+$';
  v_newdone := array(
    select distinct x from unnest(v_done) x
     where not (x = any(v_removed))
     order by 1
  );
  v_done_cnt := cardinality(v_newdone);
  v_total := (select count(*)::int from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)));

  -- 回退该次经验
  v_gain := coalesce(v_s.xp, 0);
  if v_gain > 0 then
    v_col := case v_s.dim
               when 'de'  then 'xp_de'
               when 'zhi' then 'xp_zhi'
               when 'ti'  then 'xp_ti'
               when 'mei' then 'xp_mei'
               when 'lao' then 'xp_lao'
               else 'xp_zhi'
             end;
    execute format('update public.student_info set %I = greatest(0, coalesce(%I, 0) - $1) where class = $2 and student_name = $3',
                   v_col, v_col) using v_gain, v_s.class, v_s.student_name;
    update public.student_info
       set xp = greatest(0, coalesce(xp, 0) - v_gain)
     where class = v_s.class and student_name = v_s.student_name
     returning xp into v_xp_cur;
    if found then
      update public.student_info
         set level = public.level_from_xp(v_xp_cur)
       where class = v_s.class and student_name = v_s.student_name;
      select level into v_lv from public.student_info
       where class = v_s.class and student_name = v_s.student_name;
    end if;
  end if;

  -- 更新挑战任务（档位/最高档/状态）
  update public.challenge_task
     set done_levels = to_jsonb(v_newdone),
         max_level = coalesce((select max(x) from unnest(v_newdone) x), 0),
         status = case when v_done_cnt >= v_total and v_total > 0 then 'done'
                       else 'pending' end
   where id = v_t.id;

  -- 标记记录为已取消
  update public.challenge_submission
     set status = 'cancelled'
   where id = p_submission_id;

  return jsonb_build_object(
    'ok', true,
    'refund_xp', v_gain,
    'level', v_lv,
    'removed_levels', to_jsonb(v_removed),
    'done_count', v_done_cnt,
    'total_count', v_total,
    'status', case when v_done_cnt >= v_total and v_total > 0 then 'done' else 'pending' end
  );
end;
$$;

revoke execute on function public.confirm_challenge_levels(uuid, jsonb) from public;
grant  execute on function public.confirm_challenge_levels(uuid, jsonb) to anon, authenticated;
revoke execute on function public.cancel_challenge_submission(uuid) from public;
grant  execute on function public.cancel_challenge_submission(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

-- 自检（可选）：
--   select id, student_name, levels, xp, status from public.challenge_submission order by submitted_at desc;
--   select public.cancel_challenge_submission('<submission_id>'::uuid);
