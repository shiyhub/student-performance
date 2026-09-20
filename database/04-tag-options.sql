-- ============================================================================
-- 增量升级：表现标签支持"二级选项"（如 优秀作业 → 数学课堂作业）
-- 在已有库上运行一次即可，安全可重复执行。
-- 同时配合：学生点头像直接进入自评填写（纯前端改动，无需 SQL）。
-- ============================================================================

-- 1) 标签表新增二级选项列（字符串数组，默认空数组=无二级）
alter table public.behavior_tags
  add column if not exists options jsonb not null default '[]'::jsonb;

-- 防止历史脏数据不是数组
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_tag_options_array'
  ) then
    alter table public.behavior_tags
      add constraint chk_tag_options_array check (jsonb_typeof(options) = 'array');
  end if;
end $$;

-- 2) 预置一个"二级选项"示例标签（老师可在后台随意改名/删除/增减选项）
insert into public.behavior_tags (label, tag_type, options, sort_order)
values (
  '优秀作业', 'check',
  '["语文课堂作业","语文家庭作业","数学课堂作业","数学家庭作业","英语课堂作业","英语家庭作业"]'::jsonb,
  55
)
on conflict (label) do update
  set options = excluded.options
  where public.behavior_tags.options = '[]'::jsonb;   -- 只在老师未自行配置时补上示例

-- 3) RLS 无需改动：新增列自动被既有 behavior_tags 策略覆盖（学生读启用标签、老师全权）
notify pgrst, 'reload schema';

-- 完成后可选自检：
--   select label, tag_type, options from behavior_tags order by sort_order;
