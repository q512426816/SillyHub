---
id: task-03
title: service getter 改 target + 待办分页（覆盖：FR-01, FR-02, D-001@v1, D-003@v1, D-005@v1）
title_zh: service — getter 按 target 取数 + _derive_todos 分页 + get_todos/list_switchable_users
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-01, task-02]
blocks: [task-04, task-07]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-003@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/ppm/workbench/service.py
expects_from:
  task-01:
    - contract: WorkbenchProfile
      needs: [can_view_others]
    - contract: WorkbenchSummary
      needs: [metrics]
    - contract: WorkbenchSwitchableUser
      needs: [user_id, display_name, employee_no, department_name]
  task-02:
    - contract: _resolve_target_user
      needs: [resolved_user]
provides:
  - contract: WorkbenchTodosPage
    fields: [items, total, page, page_size]
goal: >
  getter（profile/summary/calendar）按 target_user 取数；_derive_todos 去除 top20 改分页；新增 get_todos、list_switchable_users。
implementation:
  - get_profile/get_summary/get_calendar 增加 target_user 参数，内部 user.id→target.id；profile 带 can_view_others（反映登录人）
  - _derive_todos(target, page, page_size)：三源全量取（单源≤200 保护上限）→合并稳定排序→total=len→切片
  - get_todos(target, page, page_size) 返回 WorkbenchTodosPage(PageResp)
  - list_switchable_users(user)：_visible_user_ids → 批量 JOIN User+Organization 装配 WorkbenchSwitchableUser（防 N+1）
acceptance:
  - 传 target 时 profile/summary/calendar 返回 target 数据
  - get_todos 默认 page_size=10，total 准确，切片正确
  - summary 不再含 todos
  - list_switchable_users 批量取数无 N+1
verify:
  - cd backend && uv run pytest app/modules/ppm/workbench -q --no-cov
constraints:
  - can_view_others 始终反映登录人，与 target 无关
  - 不传 target 行为与旧版一致（兼容）
---
