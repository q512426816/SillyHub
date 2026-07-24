---
id: task-04
title: workbench router 端点（覆盖：FR-01, FR-02）
title_zh: router — 3 端点加 target_user_id + 新建 /todos + /switchable-users
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-02, task-03]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/ppm/workbench/router.py
goal: >
  workbench router：profile/summary/calendar 三端点加可选 target_user_id Query（经 _resolve_target_user 解析）；新建 GET /workbench/todos（带 target，分页）+ GET /workbench/switchable-users。
implementation:
  - profile/summary/calendar 增 target_user_id: str|None Query，调 svc._resolve_target_user 后传 target
  - 新增 GET /workbench/todos?target_user_id=&page=1&page_size=10 → WorkbenchTodosPage
  - 新增 GET /workbench/switchable-users → list[WorkbenchSwitchableUser]
  - todos/switchable-users response_model 对齐 schema
acceptance:
  - 三端点支持可选 target_user_id（不传=旧行为）
  - /workbench/todos 返回 PageResp，默认 page_size=10
  - /workbench/switchable-users 返回可切换用户列表
verify:
  - cd backend && uv run pytest app/modules/ppm/workbench -q --no-cov
  - cd backend && uv run python -c "from app.modules.ppm.workbench.router import router"
constraints:
  - 仅认证（get_current_principal）+ _resolve_target_user 收口，不在 router 重复权限逻辑
  - target_user_id 全部可选
---
