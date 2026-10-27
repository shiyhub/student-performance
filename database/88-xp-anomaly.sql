-- ============================================================
-- 88-xp-anomaly.sql
-- v152.8：经验异常排查（配合经验流水功能）
-- 内容：
--   1) get_xp_anomalies(班级)：比对全班「当前经验」与「经验流水应得」，
--      列出差额非零的学生（经验偏多/偏少），辅助排查异常经验来源
-- 用法：
--   ① 先执行 87 号并注入经验流水（select inject_xp_log()）
--   ② 执行本文件
--   ③ 教师后台 →「📜 经验记录」→「⚠️ 异常经验排查」→ 扫描异常
-- ============================================================

create or replace function public.get_xp_anomalies(p_class text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'student', s.student_name,
           'cur_xp',  s.xp,
           'level',   s.level,
           'log_total', coalesce(l.total, 0),
           'diff',    s.xp - coalesce(l.total, 0)
         ) order by (s.xp - coalesce(l.total, 0)) desc, s.student_name), '[]'::jsonb)
    into v_rows
    from public.student_info s
    left join (
      select student_name, sum(xp) as total
        from public.xp_log
       where class = p_class
       group by student_name
    ) l on l.student_name = s.student_name
   where btrim(s.class) = btrim(p_class)
     and s.xp <> coalesce(l.total, 0);
  return jsonb_build_object('rows', v_rows);
end;
$$;

revoke execute on function public.get_xp_anomalies(text) from anon;
grant  execute on function public.get_xp_anomalies(text) to anon, authenticated;
