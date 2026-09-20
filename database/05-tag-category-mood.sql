-- ============================================================================
-- 增量升级：表现标签分"积极 / 消极"两类，用于自动计算学生每日心情（5 档）
-- 在已有库上运行一次，安全可重复执行。
--
-- 心情规则（前端计算，无需数据库函数）：
--   从第 3 档「一般😐」起步；每勾 1 个积极标签 +1 档，每勾 1 个消极标签 -1 档；
--   结果限制在 1~5 档：😄很棒 / 🙂不错 / 😐一般 / 😟有点低落 / 😢需要加油。
-- ============================================================================

-- 1) 标签分类：positive=积极表现（+1），negative=消极表现（-1）
alter table public.behavior_tags
  add column if not exists category text not null default 'positive';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_tag_category') then
    alter table public.behavior_tags
      add constraint chk_tag_category check (category in ('positive', 'negative'));
  end if;
end $$;

-- 2) 每个标签的心情分值（积极 +1，消极 -1；保留为整数列，以后可扩展权重）
alter table public.behavior_tags
  add column if not exists score int not null default 1;

-- 3) 预置几个"消极表现"示例标签（老师可在后台改名/删除/增减）
insert into public.behavior_tags (label, tag_type, options, category, score, sort_order) values
  ('上课走神',     'check', '[]'::jsonb, 'negative', -1, 110),
  ('未完成作业',   'check', '[]'::jsonb, 'negative', -1, 120),
  ('扰乱课堂',     'check', '[]'::jsonb, 'negative', -1, 130),
  ('忘记带学具',   'check', '[]'::jsonb, 'negative', -1, 140)
on conflict (label) do update
  set category = 'negative', score = -1;

-- 4) RLS 无需改动：新增列自动被既有 behavior_tags 策略覆盖
notify pgrst, 'reload schema';

-- 完成后自检：
--   select label, category, score, options from behavior_tags order by sort_order;
