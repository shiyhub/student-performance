-- ============================================================
-- 112-fix-archive-safeupdate.sql
-- 修复：执行「封存并重置」报 400 / DELETE requires a WHERE clause
-- 原因：Supabase 默认启用 pg_safeupdate 扩展，禁止无 WHERE 的 DELETE/UPDATE，
--       原 archive_all_and_reset 里 18 条全表清理语句与 1 条全表 UPDATE 均被拦截。
-- 本脚本仅重建该函数（已加 `where true`），不动任何数据，可安全重复执行。
-- 附带修正：封存不再清空 student_inventory（学生已兑换的头像/头像框保留），
--           钱包与流水改到学生档案归零之后清理，避免残留"降到 0"的调整流水。
-- 适用：已经跑过 109、但封存失败的环境。新环境直接用修好的 109 即可，无需本脚本。
-- ============================================================

create or replace function public.archive_all_and_reset(
  p_label text default null,
  p_note  text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_batch uuid;
  v_label text := coalesce(nullif(btrim(coalesce(p_label, '')), ''), '历史封存 ' || to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI'));
  s jsonb := '{}'::jsonb;
  n int;
begin
  insert into public.archive_batch(label, note) values (v_label, p_note) returning id into v_batch;

  -- 学生档案快照
  insert into public.archive_student(archive_batch_id, id, class, student_name, created_at, avatar, xp, level,
                                     avatar_changed_at, avatar_changes_today, frame, birth_date, access_code,
                                     code_fails, code_locked_at, xp_de, xp_zhi, xp_ti, xp_mei, xp_lao)
  select v_batch, id, class, student_name, created_at, avatar, xp, level,
         avatar_changed_at, avatar_changes_today, frame, birth_date, access_code,
         code_fails, code_locked_at, xp_de, xp_zhi, xp_ti, xp_mei, xp_lao
    from public.student_info;
  get diagnostics n = row_count; s := s || jsonb_build_object('student', n);

  insert into public.archive_daily_record(archive_batch_id, id, student_name, class, record_date, self_evaluation,
                                          behavior, teacher_comment, create_at, semester)
  select v_batch, id, student_name, class, record_date, self_evaluation, behavior, teacher_comment, create_at, semester
    from public.daily_record;
  get diagnostics n = row_count; s := s || jsonb_build_object('daily_record', n);

  insert into public.archive_task_submission(archive_batch_id, id, task_id, class, student_name, grade, xp_awarded,
                                             mood_awarded, create_at, update_at, semester, task_date)
  select v_batch, id, task_id, class, student_name, grade, xp_awarded, mood_awarded, create_at, update_at, semester, task_date
    from public.task_submission;
  get diagnostics n = row_count; s := s || jsonb_build_object('task_submission', n);

  insert into public.archive_challenge_submission(archive_batch_id, id, challenge_id, class, student_name, dim, levels,
                                                  xp, submitted_at, status)
  select v_batch, id, challenge_id, class, student_name, dim, levels, xp, submitted_at, status
    from public.challenge_submission;
  get diagnostics n = row_count; s := s || jsonb_build_object('challenge_submission', n);

  insert into public.archive_exam_paper(archive_batch_id, id, student_id, class, student_name, record_date, subject,
                                        score, score_text, image_url, note, create_at)
  select v_batch, id, student_id, class, student_name, record_date, subject, score, score_text, image_url, note, create_at
    from public.exam_paper;
  get diagnostics n = row_count; s := s || jsonb_build_object('exam_paper', n);

  insert into public.archive_exam_score(archive_batch_id, id, batch_id, student_id, class, student_name, score, create_at)
  select v_batch, id, batch_id, student_id, class, student_name, score, create_at
    from public.exam_score;
  get diagnostics n = row_count; s := s || jsonb_build_object('exam_score', n);

  insert into public.archive_home_note(archive_batch_id, id, student_id, parent_name, content, record_date, create_at, class)
  select v_batch, id, student_id, parent_name, content, record_date, create_at, class
    from public.home_note;
  get diagnostics n = row_count; s := s || jsonb_build_object('home_note', n);

  insert into public.archive_xp_log(archive_batch_id, id, class, student_name, source, ref_id, label, dim, xp,
                                    record_date, note, created_at)
  select v_batch, id, class, student_name, source, ref_id, label, dim, xp, record_date, note, created_at
    from public.xp_log;
  get diagnostics n = row_count; s := s || jsonb_build_object('xp_log', n);

  insert into public.archive_star_ledger(archive_batch_id, id, class, student_name, amount, balance_after, reason,
                                         source, ref_table, ref_id, note, created_at)
  select v_batch, id, class, student_name, amount, balance_after, reason, source, ref_table, ref_id, note, created_at
    from public.star_ledger;
  get diagnostics n = row_count; s := s || jsonb_build_object('star_ledger', n);

  insert into public.archive_inventory(archive_batch_id, class, student_name, item_type, item_key, price_paid, source, acquired_at)
  select v_batch, class, student_name, item_type, item_key, price_paid, source, acquired_at
    from public.student_inventory;
  get diagnostics n = row_count; s := s || jsonb_build_object('inventory', n);

  insert into public.archive_personal_task(archive_batch_id, id, class, student_name, content, dim, xp_value,
                                           task_date, status, confirm_at, create_at, deadline, filled_by)
  select v_batch, id, class, student_name, content, dim, xp_value, task_date, status, confirm_at, create_at, deadline, filled_by
    from public.personal_task;
  get diagnostics n = row_count; s := s || jsonb_build_object('personal_task', n);

  insert into public.archive_manual_task(archive_batch_id, id, class, student_name, tag_id, task_date, status, confirm_at, create_at)
  select v_batch, id, class, student_name, tag_id, task_date, status, confirm_at, create_at
    from public.manual_task;
  get diagnostics n = row_count; s := s || jsonb_build_object('manual_task', n);

  insert into public.archive_challenge_task(archive_batch_id, id, class, student_name, title, dim, max_level, status,
                                            task_date, create_at, confirm_at, filled_by, levels, done_levels)
  select v_batch, id, class, student_name, title, dim, max_level, status, task_date, create_at, confirm_at, filled_by, levels, done_levels
    from public.challenge_task;
  get diagnostics n = row_count; s := s || jsonb_build_object('challenge_task', n);

  insert into public.archive_home_note_reply(archive_batch_id, id, note_id, sender, content, create_at)
  select v_batch, id, note_id, sender, content, create_at from public.home_note_reply;
  get diagnostics n = row_count; s := s || jsonb_build_object('home_note_reply', n);

  insert into public.archive_xp_anomaly(archive_batch_id, id, class, student_name, record_date, source, anomaly_type,
                                        reason, detail, status, create_at, resolved_at)
  select v_batch, id, class, student_name, record_date, source, anomaly_type, reason, detail, status, create_at, resolved_at
    from public.xp_anomaly;
  get diagnostics n = row_count; s := s || jsonb_build_object('xp_anomaly', n);

  -- 清理业务数据（保留名单、标签、任务定义、座位）
  -- 注意：Supabase 默认安装 pg_safeupdate，禁止无 WHERE 的 DELETE/UPDATE，
  --       因此下面每条都显式写 `where true`（语义等价于全表，但能通过安全校验）。
  delete from public.home_note_reply   where true;
  delete from public.home_note         where true;
  delete from public.exam_score        where true;
  delete from public.exam_paper        where true;
  delete from public.challenge_submission where true;
  delete from public.challenge_task    where true;
  delete from public.task_submission   where true;
  delete from public.manual_task       where true;
  delete from public.personal_task     where true;
  delete from public.auto_bonus_log    where true;
  delete from public.daily_record      where true;  -- 触发 apply_record_xp，同步把 xp 归零
  delete from public.student_achievements where true;
  delete from public.xp_log            where true;
  delete from public.xp_anomaly        where true;
  delete from public.class_draw_log    where true;
  delete from public.class_draw_chance where true;
  -- 注意：student_inventory 故意不清空。
  --       已兑换的头像/头像框属于学生永久财产，封存只重置统计与货币，
  --       否则学生花星光买过的装扮会凭空消失（与「封存不动头像、头像框」的承诺冲突）。

  -- 学生档案重置为全新状态（保留姓名/头像/头像框/家长凭据）
  update public.student_info
     set xp = 0, level = 1,
         xp_de = 0, xp_zhi = 0, xp_ti = 0, xp_mei = 0, xp_lao = 0,
         avatar_changes_today = 0, avatar_changed_at = null, code_fails = 0, code_locked_at = null
   where true;

  -- 钱包与流水必须放在上面 update 之后清理：
  -- update student_info.xp 会触发 star_sync_wallet，自动写一条 adjust 流水并重建钱包行；
  -- 若先清后 update，重置后流水里会残留一批「降到 0」的调整记录。
  delete from public.star_ledger       where true;
  delete from public.student_wallet    where true;

  -- 新钱包（0 起步）
  insert into public.student_wallet(class, student_name, balance, total_earned, total_spent)
  select class, student_name, 0, 0, 0 from public.student_info
  on conflict (class, student_name) do nothing;

  -- 兜底补登：正在佩戴、但库存里没有登记的头像/头像框，补记为已拥有，
  -- 避免「佩戴中的装扮却显示未拥有」的异常状态（已登记的不会重复插入）。
  insert into public.student_inventory(class, student_name, item_type, item_key, price_paid, source)
  select class, student_name, 'avatar', avatar, 0, 'migrate'
    from public.student_info
   where coalesce(avatar, '') <> '' and avatar !~ '^animal([1-9]|1[0-9]|2[0-4])$'
  on conflict do nothing;
  insert into public.student_inventory(class, student_name, item_type, item_key, price_paid, source)
  select class, student_name, 'frame', frame, 0, 'migrate'
    from public.student_info
   where coalesce(frame, 'none') not in ('', 'none')
  on conflict do nothing;

  -- 班级经验归零
  delete from public.class_progress where true;
  insert into public.class_progress(class, xp, level)
  select distinct class, 0, 1 from public.student_info
  on conflict (class) do nothing;

  update public.archive_batch set stats = s where id = v_batch;

  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'label', v_label, 'stats', s);
end;
$$;

revoke all on function public.archive_all_and_reset(text, text) from public;
revoke all on function public.archive_all_and_reset(text, text) from anon;
grant execute on function public.archive_all_and_reset(text, text) to authenticated;


-- 自查：确认函数已重建（应返回「OK 已修复」）
select case when position('where true' in prosrc) > 0
            then 'OK 已修复（含 where true）'
            else '仍未修复，请检查' end as 修复状态,
       length(prosrc) as 函数长度
  from pg_proc
 where proname = 'archive_all_and_reset'
   and pronamespace = 'public'::regnamespace;
