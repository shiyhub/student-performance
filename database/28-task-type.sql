-- 28-task-type.sql  允许任务类型为 背诵/默写
alter table public.daily_task drop constraint if exists daily_task_task_type_check;
alter table public.daily_task add constraint daily_task_task_type_check
  check (task_type in ('classwork','homework','recite','dictation'));
