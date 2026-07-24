---
id: task-01
title: workbench schema 调整（覆盖：FR-02, FR-04, D-003@v1, D-005@v1）
title_zh: workbench schema — Profile 加 can_view_others、Summary 去 todos、新增 SwitchableUser
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: []
blocks: [task-03, task-07]
requirement_ids: [FR-02, FR-04]
decision_ids: [D-003@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/ppm/workbench/schema.py
provides:
  - contract: WorkbenchProfile
    fields: [display_name, employee_no, department_name, role_name, avatar_text, can_view_others]
  - contract: WorkbenchSummary
    fields: [metrics]
  - contract: WorkbenchSwitchableUser
    fields: [user_id, display_name, employee_no, department_name]
goal: >
  调整 workbench schema DTO：Profile 加 can_view_others、Summary 移除 todos、新增 WorkbenchSwitchableUser，为切换用户与分页待办铺契约。
implementation:
  - WorkbenchProfile 增加 can_view_others: bool 字段
  - WorkbenchSummary 移除 todos 字段（仅留 metrics）
  - 新增 WorkbenchSwitchableUser(user_id/display_name/employee_no/department_name)
acceptance:
  - WorkbenchProfile 含 can_view_others 布尔字段
  - WorkbenchSummary 不再含 todos
  - WorkbenchSwitchableUser 四字段齐全
verify:
  - cd backend && uv run python -c "from app.modules.ppm.workbench.schema import WorkbenchProfile, WorkbenchSummary, WorkbenchSwitchableUser"
constraints:
  - 纯 DTO 调整，无 DB migration
  - can_view_others 反映登录人能力（与 target 无关）
---
