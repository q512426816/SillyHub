---
id: task-06
title: agent-sessions endpoint include_ended param + lib/daemon.ts call
title_zh: agent-sessions 端点扩展 include_ended
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P1
depends_on: []
blocks: [task-08]
requirement_ids: [FR-03c]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/agent/tests/test_agent_sessions_include_ended.py
  - frontend/src/lib/daemon.ts
provides:
  AgentSessionListItem:
    fields: [id, provider, status, turn_count, author, last_active_at, title]
goal: >
  扩展既有 GET /workspaces/{wid}/agent-sessions 支持 include_ended 参数，返回完整会话列表
  （含已结束），供工作区会话页展示。不新增双端点（design C-5 修正）。
implementation:
  - backend/app/modules/agent/router.py：现有 GET /workspaces/{wid}/agent-sessions（:544，现 active-only
    最小字段 dict）加 `include_ended: bool = False` 查询参数。include_ended=false 时保持现状（仅 active）；
    true 时返回完整 AgentSessionListItem（id/provider/status/turn_count/author/last_active_at/title，
    对齐 daemon/schema.py:71-84 字段）。排序按 last_active_at desc（coalesce 到 created_at）。
  - 权限与过滤保持现状（workspace 成员可见，跨成员），不因 include_ended 改变。
  - frontend/src/lib/daemon.ts：现有 listAgentSessions（或对应客户端方法）加 include_ended 参数透传。
acceptance:
  - include_ended=false 行为与现状一致（active-only，最小字段或完整字段不破坏既有调用方）
  - include_ended=true 返回含已结束会话的完整列表，字段含 last_active_at/title
  - 权限/过滤不变；前端方法支持 include_ended 透传
  - pytest 新用例 + 既有 agent 会话测试不回归；frontend typecheck 通过
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov
  - cd backend && uv run ruff format --check app/modules/agent app/modules/daemon/schema.py && uv run ruff check app/modules/agent app/modules/daemon/schema.py
  - cd frontend && pnpm typecheck
constraints:
  - 扩展现有端点，不新增 /sessions 双端点（design C-5 / D-002@v1）
  - AgentSessionListItem 字段以 daemon/schema.py 实际为准，不臆造字段
  - 既有调用方（change 上下文会话列表等）不受 include_ended 缺省行为影响
---
