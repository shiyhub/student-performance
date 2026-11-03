-- ============================================================
-- 67-manual-task-rpc.sql
-- 手动分配任务三个 RPC：
--   create_manual_tasks  教师批量分配（按标签）
--   confirm_manual_task  学生确认完成（按标签真实分值/维度加分）
--   delete_manual_task   教师取消/删除（已完成回退经验）
-- 说明：缺失迁移还原版，参数名与 teacher.js/student.js 调用一致，
--   可重复执行；加分口径与 97 号一致（按 behavior_tags 真实分值）。
-- ============================================================

-- ---------- 1) 批量分配 ----------
create or replace function public.create_manual_tasks(
  p_class    text,
  p_tag_id   uuid,
  p_date     date,
  p_students jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare
  v_stu jsonb;
  v_name text;
  v_ex boolean;
  v_created int := 0;
  v_skipped int := 0;
begin
  if p_class is null or p_tag_id is null or p_date is null then
    return jsonb_build_object('ok', false, 'reason', '参数不完整');
  end if;
  if not exists (select 1 from public.behavior_tags where id = p_tag_id) then
    return jsonb_build_object('ok', false, 'reason', '任务标签不存在');
  end if;
  for v_stu in select * from jsonb_array_elements(coalesce(p_students, '[]'::jsonb))
  loop
    v_name := v_stu ->> 'value';
    if v_name is null or btrim(v_name) = '' then continue; end if;
    select exists(
      select 1 from public.manual_task
       where class = p_class and student_name = btrim(v_name)
         and tag_id = p_tag_id and task_date = p_date
         and status = 'pending'
    ) into v_ex;
    if v_ex then
      v_skipped := v_skipped + 1;
    else
      insert into public.manual_task (class, student_name, tag_id, task_date, status)
      values (p_class, btrim(v_name), p_tag_id, p_date, 'pending');
      v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
end;
$function$;

-- ---------- 2) 学生确认完成 ----------
create or replace function public.confirm_manual_task(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare
  v_t   public.manual_task%rowtype;
  v_xp  int;
  v_lv  int;
  v_col text;
  v_tag_xp int;
  v_dim text;
begin
  select * into v_t from public.manual_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '任务不存在或已删除');
  end if;
  if v_t.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', '该任务已完成');
  end if;

  -- 按标签真实分值/维度（标签缺失兜底：积极 2 / 消极 0，维度 zhi）
  select xp_value, coalesce(nullif(dim, ''), 'zhi')
    into v_tag_xp, v_dim from public.behavior_tags where id = v_t.tag_id;
  if v_tag_xp is null then
    v_tag_xp := 2; v_dim := 'zhi';
  end if;

  v_col := case v_dim
             when 'de'  then 'xp_de'
             when 'ti'  then 'xp_ti'
             when 'mei' then 'xp_mei'
             when 'lao' then 'xp_lao'
             else 'xp_zhi'
           end;
  execute format('update public.student_info set %I = greatest(0, coalesce(%I,0) + $1) where class=$2 and student_name=$3',
                 v_col, v_col) using v_tag_xp, v_t.class, v_t.student_name;
  update public.student_info
     set xp = greatest(0, coalesce(xp,0) + v_tag_xp)
   where class = v_t.class and student_name = v_t.student_name
   returning xp into v_xp;
  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp)
     where class = v_t.class and student_name = v_t.student_name;
    select level into v_lv from public.student_info
     where class = v_t.class and student_name = v_t.student_name;
  end if;

  update public.manual_task set status = 'done' where id = p_task_id;
  return jsonb_build_object('ok', true, 'xp_delta', v_tag_xp, 'level', v_lv);
end;
$function$;

-- ---------- 3) 取消/删除（已完成回退经验） ----------
drop function if exists public.delete_manual_task(uuid);
create or replace function public.delete_manual_task(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare
  v_t   public.manual_task%rowtype;
  v_refund int := 0;
  v_xp_cur int;
  v_lv  int;
  v_col text;
  v_dim text;
begin
  select * into v_t from public.manual_task where id = p_task_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', '任务不存在或已删除');
  end if;

  if v_t.status = 'done' then
    select coalesce(xp_value, 0), coalesce(nullif(dim,''),'zhi')
      into v_refund, v_dim from public.behavior_tags where id = v_t.tag_id;
    v_refund := coalesce(v_refund, 0);
    v_col := case v_dim
               when 'de'  then 'xp_de'
               when 'ti'  then 'xp_ti'
               when 'mei' then 'xp_mei'
               when 'lao' then 'xp_lao'
               else 'xp_zhi'
             end;
    execute format('update public.student_info set %I = greatest(0, coalesce(%I,0) - $1) where class=$2 and student_name=$3',
                   v_col, v_col) using v_refund, v_t.class, v_t.student_name;
    update public.student_info
       set xp = greatest(0, coalesce(xp,0) - v_refund)
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

  delete from public.manual_task where id = p_task_id;
  return jsonb_build_object('ok', true, 'refund_xp', v_refund, 'level', v_lv);
end;
$function$;

revoke execute on function public.create_manual_tasks(text, uuid, date, jsonb) from public;
grant  execute on function public.create_manual_tasks(text, uuid, date, jsonb) to anon, authenticated;
revoke execute on function public.confirm_manual_task(uuid) from public;
grant  execute on function public.confirm_manual_task(uuid) to anon, authenticated;
revoke execute on function public.delete_manual_task(uuid) from public;
grant  execute on function public.delete_manual_task(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
