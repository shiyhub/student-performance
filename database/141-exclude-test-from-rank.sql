-- 141-exclude-test-from-rank.sql
-- 测试学生不参与星光榜排名（含「班级星光榜前三」成就口径）
--
-- 背景：
--   131-test-student.sql 给 student_info 加了 is_test 标记，测试学生默认不上墙、
--   不计入班级星光值；但 123 建的 star_rank_in_class() 没有排除它，
--   测试学生一旦累计领先（线上「测试学生」xp=1000），就会占据第 1 名，
--   把全班真实学生整体后推一位，导致「班级星光榜前三」成就口径失真。
--
-- 本次改动：
--   只重写 star_rank_in_class()，在 ranked CTE 里加 is_test 排除。
--   其余逻辑（>20 门槛、rank() 并列、查无此人返回 999）完全保持原样。
--
-- 影响面：
--   该函数只被 sync_student_achievements() 的 top3 判定调用（123:154），
--   学生端榜单走前端 + student_directory 视图，不依赖此函数。
--   已解锁的 top3 成就按原口径「永久保留」，不会因本次改动被撤销。
--
-- 执行后自查（把班级名换成实际值）：
--   select public.star_rank_in_class('六年级一班', '测试学生');  -- 应返回 999
--   select public.star_rank_in_class('六年级一班', '杨叶珊');    -- 应比改动前小 1

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
       and coalesce(si.is_test, false) = false          -- 测试学生不参与排名
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

comment on function public.star_rank_in_class(text, text) is
  '班级星光榜名次（累计获得 > 20、排除测试学生）：1..n = 名次；999 = 不参与或查无此人';

revoke execute on function public.star_rank_in_class(text, text) from public;
grant  execute on function public.star_rank_in_class(text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 可选：清理测试学生此前已解锁的 top3 成就（默认注释掉，按需手动执行）
-- 说明：仅影响测试学生本人，不影响真实学生的成就记录。
-- ------------------------------------------------------------
-- delete from public.student_achievements a
--  using public.student_info si
--  where a.student_id = si.id
--    and si.is_test = true
--    and a.a_key = 'top3';
