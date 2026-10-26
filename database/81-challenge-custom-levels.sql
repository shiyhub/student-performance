-- ============================================================
-- 81-challenge-custom-levels.sql
-- 挑战任务升级：教师可自定义档位与经验值
--   1) challenge_task 加列 levels jsonb —— 该挑战的档位方案 [[档位,经验],...]
--      默认沿用 80 号模板：10/15/.../110 → 2/3/.../22（共 21 档）
--   2) create_challenge_tasks 加参数 p_levels jsonb（不传则用默认模板）
--   3) confirm_challenge_task 改为按方案取经验（不再 level/5 硬算）
-- 可重复执行。
-- ============================================================

alter table public.challenge_task
  add column if not exists levels jsonb;

-- 默认档位模板（与原 80 号一致）：10,15,...,110 → 2,3,...,22
alter table public.challenge_task
  alter column levels set default '[[10,2],[15,3],[20,4],[25,5],[30,6],[35,7],[40,8],[45,9],[50,10],[55,11],[60,12],[65,13],[70,14],[75,15],[80,16],[85,17],[90,18],[95,19],[100,20],[105,21],[110,22]]'::jsonb;

-- 存量挑战任务补默认方案
update public.challenge_task set levels = '[[10,2],[15,3],[20,4],[25,5],[30,6],[35,7],[40,8],[45,9],[50,10],[55,11],[60,12],[65,13],[70,14],[75,15],[80,16],[85,17],[90,18],[95,19],[100,20],[105,21],[110,22]]'::jsonb
 where levels is null;

-- ------------------------------------------------------------
-- 1) 教师批量布置（支持自定义档位方案）
-- ------------------------------------------------------------
create or replace function public.create_challenge_tasks(
  p_class    text,
  p_title    text,
  p_dim      text default 'zhi',
  p_date     date default null,
  p_students jsonb default '[]'::jsonb,
  p_levels   jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_stu jsonb;
  v_name text;
  v_ex boolean;
  v_created int := 0;
  v_skipped int := 0;
  v_d date := coalesce(p_date, (now() at time zone 'Asia/Shanghai')::date);
  v_lv jsonb := coalesce(p_levels,
    '[[10,2],[15,3],[20,4],[25,5],[30,6],[35,7],[40,8],[45,9],[50,10],[55,11],[60,12],[65,13],[70,14],[75,15],[80,16],[85,17],[90,18],[95,19],[100,20],[105,21],[110,22]]'::jsonb);
begin
  if p_class is null or p_title is null or btrim(p_title) = '' then
    return jsonb_build_object('ok', false, 'reason', '参数不完整');
  end if;
  if jsonb_typeof(v_lv) <> 'array' or jsonb_array_length(v_lv) = 0 then
    return jsonb_build_object('ok', false, 'reason', '档位方案不能为空');
  end if;
  for v_stu in select * from jsonb_array_elements(coalesce(p_students, '[]'::jsonb))
  loop
    v_name := v_stu ->> 'value';
    if v_name is null or v_name = '' then continue; end if;
    select exists(
      select 1 from public.challenge_task
       where class = p_class and student_name = v_name
         and title = p_title and status = 'pending'
    ) into v_ex;
    if v_ex then
      v_skipped := v_skipped + 1;
    else
      insert into public.challenge_task (class, student_name, title, dim, task_date, status, levels)
      values (p_class, v_name, btrim(p_title), coalesce(p_dim, 'zhi'), v_d, 'pending', v_lv);
      v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.create_challenge_tasks(text, text, text, date, jsonb, jsonb) from public;
grant  execute on function public.create_challenge_tasks(text, text, text, date, jsonb, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- 2) 学生自选档位确认（按该挑战方案取经验）
-- ------------------------------------------------------------
create or replace function public.confirm_challenge_task(p_task_id uuid, p_level int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_t   public.challenge_task%rowtype;
  v_xp  int;
  v_lv  int;
  v_col text;
  v_gain int;
begin
  select * into v_t from public.challenge_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '挑战不存在或已取消');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '该挑战已完成');
  end if;
  -- 在该挑战档位方案里找到对应经验
  select (a.v ->> 1)::int into v_gain
    from jsonb_array_elements(coalesce(v_t.levels, '[]'::jsonb)) as a(v)
   where (a.v ->> 0)::int = p_level;
  if v_gain is null then
    return jsonb_build_object('ok', false, 'reason', '档位不在该挑战方案内');
  end if;

  v_col := case v_t.dim
             when 'de'  then 'xp_de'
             when 'zhi' then 'xp_zhi'
             when 'ti'  then 'xp_ti'
             when 'mei' then 'xp_mei'
             when 'lao' then 'xp_lao'
             else 'xp_zhi'
           end;
  execute format('update public.student_info set %I = greatest(0, coalesce(%I,0) + $1) where class=$2 and student_name=$3',
                 v_col, v_col) using v_gain, v_t.class, v_t.student_name;
  update public.student_info
     set xp = greatest(0, coalesce(xp,0) + v_gain)
   where class = v_t.class and student_name = v_t.student_name
   returning xp into v_xp;
  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp)
     where class = v_t.class and student_name = v_t.student_name;
    select level into v_lv from public.student_info
     where class = v_t.class and student_name = v_t.student_name;
  end if;

  update public.challenge_task
     set status='done', max_level=p_level, confirm_at=now(), filled_by='student'
   where id = p_task_id;
  return jsonb_build_object('ok', true, 'xp_delta', v_gain, 'level', v_lv, 'level_done', p_level);
end;
$$;

revoke execute on function public.confirm_challenge_task(uuid, int) from public;
grant  execute on function public.confirm_challenge_task(uuid, int) to anon, authenticated;

notify pgrst, 'reload schema';
