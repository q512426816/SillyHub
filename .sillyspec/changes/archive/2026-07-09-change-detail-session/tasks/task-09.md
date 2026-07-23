---
id: task-09
title: GET /workspaces/{wid}/changes/{cid}/sessions 列表端点（跨成员，CHANGE_READ）
title_zh: 变更级会话列表端点
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-01, task-06]
blocks: [task-10, task-11]
requirement_ids: [FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/change/router.py
  - backend/app/modules/daemon/schema.py
provides:
  - contract: AgentSessionListItem
    fields: [id, provider, status, turn_count, author, last_active_at, title]
expects_from:
  task-01:
    - contract: AgentSession
      needs: [change_id, workspace_id]
goal: >
  新增 GET /api/workspaces/{workspace_id}/changes/{change_id}/sessions，返回该变更全部会话（跨成员，D-005），按 last_active_at desc，鉴权 require_permission(CHANGE_READ)（X-03）。
implementation:
  - 在 change/router.py（prefix /workspaces/{workspace_id}）加 @router.get("/changes/{change_id}/sessions")
  - 依赖 require_permission(Permission.CHANGE_READ)
  - 查 AgentSession where change_id=cid（不过滤 user_id），JOIN User 取作者 display_name
  - 标题取该会话首条 channel=user_input 的 AgentRunLog 摘要（前 30 字）
  - 定义 AgentSessionListItem DTO（schema.py）
acceptance:
  - 返回该变更全部会话（跨成员），含作者/状态/turn_count/last_active_at/标题
  - 非工作空间成员/无 CHANGE_READ 权限被拒
  - 无会话时返回空列表
verify:
  - cd backend && uv run mypy app/modules/change/router.py app/modules/daemon/schema.py
  - cd backend && uv run ruff check app/modules/change/router.py
constraints:
  - 鉴权沿用 change router 既有 require_permission 模式
  - 标题来源干净 user_input（与 task-08 一致，X-04）
---

## 验收标准
- 返回该变更全部会话（跨成员），含作者/状态/turn_count/last_active_at/标题
- 非工作空间成员或无 CHANGE_READ 权限被拒
- 无会话时返回空列表

## 验证步骤
- cd backend && uv run mypy app/modules/change/router.py app/modules/daemon/schema.py
- cd backend && uv run ruff check app/modules/change/router.py
