-- ============================================================================
-- 增量升级 09：经验值可调 + 删记录经验回扣 + 测试工具
--   1. behavior_tags 增加 xp_value：每个标签给多少经验，老师可在后台自定
--   2. 重写经验触发器：INSERT 时按"标签配置的 xp_value"累加；DELETE 时回扣
--   3. 新增 RPC：
--      - recalc_all_xp()：按历史记录重新累加全班经验（改了标签经验值后一键重算）
--      - set_student_xp(班级, 姓名, 经验值)：老师手动调整某学生经验并自动重算等级
-- 可重复执行。跑完到老师后台"🏷️ 表现标签"里就能看到每个标签的"经验值"列。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 标签经验值：默认积极 +2，消极 0；老师可在后台改
-- ---------------------------------------------------------------------------
alter table public.behavior_tags add column if not exists xp_value int not null default 2;

-- 已有数据兜底：消极标签给 0 经验
update public.behavior_tags set xp_value = 0 where category = 'negative' and xp_value = 2;

-- ---------------------------------------------------------------------------
-- 2) 经验触发器：INSERT 加 / DELETE 减（按标签上的 xp_value 累加）
--    历史记录里标签已被删的，按类别兜底（积极=2，消极=0）
-- ---------------------------------------------------------------------------
create or replace function public.apply_record_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec    record;
  v_item   record;
  v_tag_xp int;
  v_delta  int := 0;
  v_xp     int;
begin
  v_rec := case when tg_op = 'DELETE' then old else new end;

  -- 遍历本单 behavior.items，累加每个标签配置的经验值
  for v_item in
    select e ->> 'id' as tag_id, e ->> 'category' as category
    from jsonb_array_elements(coalesce(v_rec.behavior -> 'items', '[]'::jsonb)) as e
  loop
    select t.xp_value into v_tag_xp
      from public.behavior_tags t
     where t.id::text = v_item.tag_id;

    if v_tag_xp is null then
      v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
    end if;
    v_delta := v_delta + coalesce(v_tag_xp, 0);
  end loop;

  if coalesce(v_delta, 0) = 0 then
    return v_rec;
  end if;

  -- 删除记录时反向扣回
  if tg_op = 'DELETE' then
    v_delta := -v_delta;
  end if;

  update public.student_info
     set xp = greatest(0, coalesce(xp, 0) + v_delta)
   where class = v_rec.class
     and student_name = v_rec.student_name
  returning xp into v_xp;

  if found then
    update public.student_info
       set level = public.level_from_xp(v_xp)
     where class = v_rec.class
       and student_name = v_rec.student_name;
  end if;

  return v_rec;
end;
$$;

drop trigger if exists trg_apply_record_xp     on public.daily_record;
drop trigger if exists trg_apply_record_xp_ins on public.daily_record;
drop trigger if exists trg_apply_record_xp_del on public.daily_record;
create trigger trg_apply_record_xp_ins after insert on public.daily_record
  for each row execute function public.apply_record_xp();
create trigger trg_apply_record_xp_del after delete on public.daily_record
  for each row execute function public.apply_record_xp();

-- ---------------------------------------------------------------------------
-- 3) 测试工具 RPC：一键重算全班经验（按历史记录顺序重放）
-- ---------------------------------------------------------------------------
create or replace function public.recalc_all_xp()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec    record;
  v_item   record;
  v_tag_xp int;
  v_delta  int;
  v_touched int := 0;
begin
  -- 先全班清零
  update public.student_info set xp = 0, level = 1;

  for v_rec in
    select class, student_name, behavior, record_date, create_at
      from public.daily_record
     order by record_date, create_at
  loop
    v_delta := 0;
    for v_item in
      select e ->> 'id' as tag_id, e ->> 'category' as category
      from jsonb_array_elements(coalesce(v_rec.behavior -> 'items', '[]'::jsonb)) as e
    loop
      select t.xp_value into v_tag_xp
        from public.behavior_tags t where t.id::text = v_item.tag_id;
      if v_tag_xp is null then
        v_tag_xp := case when v_item.category = 'negative' then 0 else 2 end;
      end if;
      v_delta := v_delta + coalesce(v_tag_xp, 0);
    end loop;

    if v_delta <> 0 then
      update public.student_info
         set xp = coalesce(xp, 0) + v_delta,
             level = public.level_from_xp(coalesce(xp, 0) + v_delta)
       where class = v_rec.class
         and student_name = v_rec.student_name;
      v_touched := v_touched + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'records_replayed', v_touched);
end;
$$;

revoke execute on function public.recalc_all_xp() from public;
grant  execute on function public.recalc_all_xp() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) 测试工具 RPC：老师手动设置某学生经验（自动重算等级）
-- ---------------------------------------------------------------------------
create or replace function public.set_student_xp(
  p_class   text,
  p_student  text,
  p_xp      int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_xp    int;
  v_level int;
begin
  v_xp := greatest(0, least(99999, coalesce(p_xp, 0)));

  update public.student_info
     set xp = v_xp,
         level = public.level_from_xp(v_xp)
   where class = btrim(coalesce(p_class, ''))
     and student_name = btrim(coalesce(p_student, ''))
  returning xp, level into v_xp, v_level;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_student');
  end if;
  return jsonb_build_object('ok', true, 'xp', v_xp, 'level', v_level);
end;
$$;

revoke execute on function public.set_student_xp(text, text, int) from public;
grant  execute on function public.set_student_xp(text, text, int) to authenticated;

notify pgrst, 'reload schema';

-- 自检（可选）：
--   select student_name, xp, level from student_info order by xp desc limit 5;
--   select public.recalc_all_xp();
--   select public.set_student_xp('六年级一班', '某学生', 60);
