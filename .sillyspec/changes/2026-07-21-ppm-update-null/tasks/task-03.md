---
id: task-03
title: plan update_detail 去 if v is not None + 复查 _sync_task_fields
wave: 1
status: draft
owner: WhaleFall
allowed_paths:
  - backend/app/modules/ppm/plan/service.py
depends_on: []
blocks:
  - task-06
---

# task-03: plan `update_detail` 去 `if v is not None`

## 目标
修复 `PlanService.update_detail` 清空字段不生效；复查下游任务联动安全。

## 完成标准
- `update_detail`（plan/service.py 约 657 行）改直接 setattr，去掉守卫。
- 复查 `_sync_task_fields`（plan/service.py:1645 `uid is not None` 守卫）：清空 `duty_user_id`/`execute_user_id` 时 `PlanTask.user_id` 非空约束仍受保护，不触发 IntegrityError。

## 依赖
无（Wave 1）。与 task-01 同文件，execute 时串行（task-01 → task-03 或反之）。
