---
id: task-04
title: list/get 过滤 deleted_at IS NULL
title_zh: list/get 会话接口过滤软删项
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-01]
blocks: [task-06]
requirement_ids: [FR-07]
decision_ids: [D-003]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/change/router.py
provides:
  - behavior: list_get_filter_deleted_at
goal: >
  让 list_agent_sessions / list_change_sessions 仅返回 deleted_at IS NULL 的会话；get_agent_session 对软删会话抛 DaemonSessionNotFound 404。
implementation:
  - backend/app/modules/daemon/session/service.py:1301 list_agent_sessions 的 base_filters 追加 AgentSession.deleted_at.is_(None)
  - backend/app/modules/daemon/session/service.py:1319 get_agent_session：软删（deleted_at 非空）视为不存在，抛 DaemonSessionNotFound（404）
  - backend/app/modules/change/router.py:213 list_change_sessions 的 where 追加 AgentSession.deleted_at.is_(None)
acceptance:
  - list_agent_sessions 不返回软删会话
  - list_change_sessions 不返回软删会话
  - get_agent_session 对软删会话抛 DaemonSessionNotFound 404
verify:
  - cd backend && uv run mypy app/modules/daemon/session/service.py app/modules/change/router.py
  - cd backend && uv run ruff check app/modules/daemon/session/service.py app/modules/change/router.py
constraints:
  - 软删会话 agent_runs 表该会话的 run 仍可查（agent_session_id 未断，design §7.5 不变量），本任务不动 run 侧查询
  - 不强制改 status，过滤只看 deleted_at
---

## 验收标准
- list_agent_sessions 不返回软删会话
- list_change_sessions 不返回软删会话
- get_agent_session 对软删会话抛 DaemonSessionNotFound 404

## 验证步骤
- cd backend && uv run mypy app/modules/daemon/session/service.py app/modules/change/router.py
- cd backend && uv run ruff check app/modules/daemon/session/service.py app/modules/change/router.py
