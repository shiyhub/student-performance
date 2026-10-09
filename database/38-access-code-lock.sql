-- ============================================================
-- 38-access-code-lock.sql  学生个人码试错锁定（RSK-02）
-- ------------------------------------------------------------
-- 背景：家长凭据 = 出生日期 或 6 位学生密码(access_code)。6 位数字
--       仅 100 万组合，无试错限制时可被枚举批量查询。
-- 修复：
--   1) student_info 增加 code_fails（连续失败次数）、code_locked_at（锁定时间）
--   2) verify_parent 改为 plpgsql：连续失败 5 次 → 锁定 15 分钟（返回 locked）
--      锁定期间一律拒绝；凭据正确自动清零失败计数
--   3) set_student_code（教师重置密码）同时清零失败计数与锁定
-- 可重复执行（幂等：add column if not exists + create or replace）
-- ============================================================

alter table public.student_info add column if not exists code_fails int not null default 0;
alter table public.student_info add column if not exists code_locked_at timestamptz;
comment on column public.student_info.code_fails is '家长凭据连续验证失败次数（>=5 触发锁定）';
comment on column public.student_info.code_locked_at is '家长凭据锁定时间（锁 15 分钟，教师重置密码时清除）';

-- ---------------------------------------------------------------------------
-- 家长端校验：失败计数 + 锁定（5 次失败锁 15 分钟）
-- ---------------------------------------------------------------------------
create or replace function public.verify_parent(
  p_class text, p_student text, p_birth text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid;
  v_fails int;
  v_locked_at timestamptz;
begin
  select id, code_fails, code_locked_at into v_sid, v_fails, v_locked_at
    from public.student_info s
   where btrim(lower(s.class)) = btrim(lower(p_class))
     and btrim(lower(s.student_name)) = btrim(lower(p_student))
   limit 1;
  if v_sid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;

  -- 锁定期内：一律拒绝（即使凭据正确，也等锁定过期，防枚举绕锁）
  if v_locked_at is not null and v_locked_at > now() - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  -- 锁定已过期：自动清除
  if v_locked_at is not null then
    update public.student_info set code_locked_at = null, code_fails = 0 where id = v_sid;
    v_fails := 0;
  end if;

  -- 凭据正确（出生日期 或 学生密码）：清零计数并放行
  if exists (
    select 1 from public.student_info s
     where s.id = v_sid
       and (btrim(s.birth_date) = btrim(p_birth) or btrim(s.access_code) = btrim(p_birth))
  ) then
    update public.student_info set code_fails = 0, code_locked_at = null where id = v_sid;
    return jsonb_build_object('ok', true);
  end if;

  -- 凭据错误：计数 +1，达到 5 次锁定 15 分钟
  v_fails := coalesce(v_fails, 0) + 1;
  if v_fails >= 5 then
    update public.student_info set code_fails = v_fails, code_locked_at = now() where id = v_sid;
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  update public.student_info set code_fails = v_fails where id = v_sid;
  return jsonb_build_object('ok', false, 'reason', 'no_birth');
end; $$;
revoke execute on function public.verify_parent(text, text, text) from public;
grant  execute on function public.verify_parent(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 教师重置密码：同时清零失败计数与锁定
-- ---------------------------------------------------------------------------
create or replace function public.set_student_code(
  p_class  text,
  p_student text,
  p_code   text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
begin
  if auth.role() <> 'authenticated' then
    return false;   -- 仅登录教师可设置/重置密码
  end if;
  -- 清洗：只接受 6 位数字
  v := nullif(btrim(coalesce(p_code, '')), '');
  if v is null or v !~ '^\d{6}$' then
    return false;
  end if;
  update public.student_info
     set access_code = v, code_fails = 0, code_locked_at = null
   where btrim(class) = btrim(coalesce(p_class, ''))
     and btrim(student_name) = btrim(coalesce(p_student, ''));
  return found;
end;
$$;
revoke execute on function public.set_student_code(text, text, text) from public;
grant  execute on function public.set_student_code(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
