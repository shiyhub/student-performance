-- ============================================================================
-- 增量升级 12：每日任务支持多任务 + 课堂/家庭作业分类
--   daily_task 增加：
--     task_type  text  'classwork' 课堂作业 / 'homework' 家庭作业
--     sort_order int   排序（越小越靠前）
--   同日可发布多条任务。RPC 改为返回数组。
--   为大数据量：索引 (class, task_date, task_type)，学生/老师/家长查询都走限定日期。
-- 可重复执行。
-- ============================================================================

alter table public.daily_task
  add column if not exists task_type text not null default 'classwork'
    check (task_type in ('classwork','homework'));

alter table public.daily_task
  add column if not exists sort_order int not null default 0;

create index if not exists idx_daily_task_class_date_type
  on public.daily_task (class, task_date, task_type, sort_order);

-- 1) 学生端：取今天本班全部任务 + 自己每条已选等级
create or replace function public.get_today_task(
  p_class   text,
  p_student text,
  p_date    date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_date, current_date);
begin
  return jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select d.id, d.title, d.detail, d.task_date, d.task_type,
               coalesce(s.grade, 'none')        as my_grade,
               coalesce(s.mood_awarded, false)  as mood_awarded
          from public.daily_task d
          left join public.task_submission s
            on s.task_id = d.id and s.student_name = btrim(p_student)
         where d.class = btrim(p_class)
           and d.task_date = v_date
         order by d.task_type, d.sort_order, d.create_at
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_today_task(text,text,date) from public;
grant  execute on function public.get_today_task(text,text,date) to anon, authenticated;

-- 2) 老师端：某班某日全部任务 + 每条全班提交情况
create or replace function public.get_class_task_report(
  p_class text,
  p_date  date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_date, current_date);
begin
  return jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select d.id, d.title, d.detail, d.task_date, d.task_type,
          coalesce((
            select jsonb_object_agg(sub.student_name,
                       jsonb_build_object('grade', coalesce(sub.grade,'none'),
                                          'mood',   coalesce(sub.mood_awarded,false)))
              from public.task_submission sub
             where sub.task_id = d.id
          ), '{}'::jsonb) as submissions
          from public.daily_task d
         where d.class = btrim(p_class)
           and d.task_date = v_date
         order by d.task_type, d.sort_order, d.create_at
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_class_task_report(text,date) from public;
grant  execute on function public.get_class_task_report(text,date) to authenticated;

-- 3) 老师删除一条任务（提交记录级联删除，经验不再回滚——按发布前约定：
--    删任务时该任务已发的经验保留，避免误删后学生经验异常波动）
create or replace function public.delete_daily_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.daily_task where id = p_task_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.delete_daily_task(uuid) from public;
grant  execute on function public.delete_daily_task(uuid) to authenticated;

notify pgrst, 'reload schema';
