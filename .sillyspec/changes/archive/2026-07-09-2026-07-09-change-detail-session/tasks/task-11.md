---
id: task-11
title: lib/daemon.ts createSession 加字段 + listChangeSessions
title_zh: 前端 API 层支持变更会话
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-03, task-06, task-09]
blocks: [task-12, task-13]
requirement_ids: [FR-02, FR-04]
decision_ids: []
allowed_paths:
  - frontend/src/lib/daemon.ts
provides:
  - contract: createSession(payload)
    fields: [change_id, workspace_id]
  - contract: listChangeSessions(workspaceId, changeId)
    fields: [returns_AgentSessionListItem_array]
expects_from:
  task-03:
    - contract: SessionCreateRequest
      needs: [change_id, workspace_id]
  task-09:
    - contract: AgentSessionListItem
      needs: [id, provider, status, turn_count, author, last_active_at, title]
goal: >
  SessionCreateRequest（daemon.ts:799）+ createSession（:831）加 change_id?/workspace_id?；新增 listChangeSessions(wid,cid) 调 task-09 端点。
implementation:
  - SessionCreateRequest 类型加 change_id?: string、workspace_id?: string
  - createSession 把可选字段传入 POST /api/daemon/sessions body
  - 新增 listChangeSessions(workspaceId, changeId)：GET /api/workspaces/{wid}/changes/{cid}/sessions，返回 AgentSessionListItem[]
  - 定义/复用 AgentSessionListItem 类型（与后端 DTO 对齐）
acceptance:
  - createSession 可带 change_id/workspace_id；不带时 body 不含（零回归）
  - listChangeSessions 返回类型与后端一致
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test -- src/lib/daemon
constraints:
  - 字段可选，不破坏 runtimes 页既有 createSession 调用
---

## 验收标准
- createSession 可带 change_id/workspace_id；不带时 body 不含（零回归）
- listChangeSessions 返回类型与后端 DTO 一致
- typecheck 通过

## 验证步骤
- cd frontend && pnpm typecheck
- cd frontend && pnpm test -- src/lib/daemon
