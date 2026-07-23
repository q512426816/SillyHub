---
id: task-03
title: SessionCreateRequest + POST /sessions 端点加 change_id?/workspace_id?
title_zh: 会话创建请求与端点接收 change_id/workspace_id
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-01]
blocks: [task-04, task-11]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
provides:
  - contract: SessionCreateRequest
    fields: [change_id, workspace_id]
expects_from:
  task-01:
    - contract: AgentSession
      needs: [change_id, workspace_id]
goal: >
  SessionCreateRequest（router.py:1502）加可选 change_id?/workspace_id?，create_session 端点（:1675）透传给 service。
implementation:
  - SessionCreateRequest 加 change_id: Optional[UUID]=None 与 workspace_id: Optional[UUID]=None
  - create_session 端点把 data.change_id/data.workspace_id 透传给 DaemonService.create_session
acceptance:
  - 请求体可携带可选 change_id/workspace_id，未携带时默认 None（零回归）
  - OpenAPI schema 反映新字段
verify:
  - cd backend && uv run mypy app/modules/daemon/router.py
  - cd backend && uv run ruff check app/modules/daemon/router.py
constraints:
  - 两字段可选，不破坏既有调用
---

## 验收标准
- 请求体可携带可选 change_id/workspace_id，未携带默认 None（零回归）
- OpenAPI schema 反映新字段
- create_session 端点透传两字段给 service

## 验证步骤
- cd backend && uv run mypy app/modules/daemon/router.py
- cd backend && uv run ruff check app/modules/daemon/router.py
