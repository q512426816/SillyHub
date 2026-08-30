---
id: task-05
title: list_agent_sessions 补 title + AgentSessionRead 加 title/deleted_at + 前端类型同步
title_zh: list 补 title 字段并抽共享 title helper，前后端类型同步
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: []
blocks: [task-06, task-07, task-10, task-11]
requirement_ids: [FR-08]
decision_ids: [D-006]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/router.py
  - frontend/src/lib/daemon.ts
provides:
  - field: AgentSessionRead.title
  - field: AgentSessionRead.deleted_at
  - helper: shared_session_title
goal: >
  list_agent_sessions 返回值补 title（首条 user_input AgentRunLog 摘要前 30 字，复用 list_change_sessions 同一逻辑），AgentSessionRead schema 加 title/deleted_at，前端 lib/daemon.ts 类型同步。
implementation:
  - 在 backend/app/modules/daemon/session/service.py 抽共享 helper 计算首条 channel=user_input 的 AgentRunLog 摘要前 30 字（design §4.5 D-006 / §9 C-6）
  - list_agent_sessions（service.py:1301）与 list_change_sessions（change/router.py:213 内 title 计算）共用该 helper，避免两套实现
  - list_agent_sessions 返回每条含 title（无 user_input log 时 null）
  - backend/app/modules/daemon/router.py 的 list_sessions 响应模型（AgentSessionRead）加 title: str | None 与 deleted_at: datetime | None
  - frontend/src/lib/daemon.ts:1124 AgentSessionRead 类型加 title: string | null 与 deleted_at: string | null
acceptance:
  - list_agent_sessions 每条返回 title（首条 user_input 摘要前 30 字），无 user_input 时 title=null
  - AgentSessionRead schema 含 title: str | None 与 deleted_at: datetime | None
  - 前端 lib/daemon.ts AgentSessionRead 类型同步 title 与 deleted_at
  - list_agent_sessions 与 list_change_sessions 复用同一 title helper
verify:
  - cd backend && uv run mypy app/modules/daemon/session/service.py app/modules/daemon/router.py
  - cd backend && uv run ruff check app/modules/daemon/session/service.py app/modules/daemon/router.py
  - cd frontend && pnpm tsc --noEmit
constraints:
  - R-7（title 逻辑分叉）：必须抽共享 helper 两端点共用（design §4.5 D-006 / §9 C-6），不允许 list_agent_sessions 与 list_change_sessions 各写一套
  - title 摘要规则：首条 channel=user_input 的 AgentRunLog 前 30 字，无则 null（FR-08）
  - 注意 list_change_sessions 已有 title 逻辑，本任务是抽出来复用而非重写变更侧
---

## 验收标准
- list_agent_sessions 每条返回 title（首条 user_input 摘要前 30 字），无 user_input 时 title=null
- AgentSessionRead schema 含 title: str | None 与 deleted_at: datetime | None
- 前端 lib/daemon.ts AgentSessionRead 类型同步 title 与 deleted_at
- list_agent_sessions 与 list_change_sessions 复用同一 title helper

## 验证步骤
- cd backend && uv run mypy app/modules/daemon/session/service.py app/modules/daemon/router.py
- cd backend && uv run ruff check app/modules/daemon/session/service.py app/modules/daemon/router.py
- cd frontend && pnpm tsc --noEmit
