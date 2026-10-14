-- ============================================================
-- 52-tag-system-v2.sql  标签系统 v2：只保留勾选型（兜底迁移）
-- ------------------------------------------------------------
-- 需求（2026-10-12）：
--   1. 按提交方式分「可重复提交 / 不可重复提交」
--      —— 由 history_unique 反向表达（false=可重复，true=不可重复），前端已适配
--   2. 按心情分「积极 / 消极」—— category 列（已有）
--   3. 支持二级标签 —— options 列（已有）
--   4. 只保留勾选型 —— tag_type 固定 'check'；历史"填写型"标签在此兜底停用
--   5. 教师自定义经验值 —— xp_value 列（已有；前端已放开消极标签的自定义）
--   6. 标签字段容量 600 —— label 为 text 类型（容量无限制）、options 为 jsonb，
--      前端输入/显示限制已提升至 600 字符，本迁移无需 ALTER
-- 适配现有标签：线上 14 个标签已全部为 check 型、history_unique 分布正确
--              （10 消极=可重复、4 积极=不可重复），无需迁移数据；
--              本迁移仅做兜底，幂等可重复执行。
-- ============================================================

-- 只保留勾选型：停用历史"填写型"标签（不影响历史记录中的文字快照）
update public.behavior_tags
   set is_active = false
 where tag_type = 'text'
   and is_active = true;

-- 自检：应返回 0 行（没有启用中的填写型标签）
select id, label, tag_type, is_active
  from public.behavior_tags
 where tag_type = 'text' and is_active = true;

notify pgrst, 'reload schema';
