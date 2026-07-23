---
id: task-06
title: 主 agent lease 长生命周期（复用 interactive 永不过期）+ MCP tool 转发进 driver
title_zh: 主 agent 会话生命周期与工具转发
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: [task-03, task-05]
blocks: [task-09]
requirement_ids: [FR-1]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/interactive/driver.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
expects_from:
  task-03:
    - contract: OrchestratorService
      needs: [main_agent_run]
  task-05:
    - contract: DaemonMcpServer
      needs: [dispatch_worker, get_worker_result, list_workers, converge_mission, report_progress]
goal: >
  主 agent 走 interactive lease（永不过期，复用现有）+ session 恢复，MCP tool 注入 driver
  consume 循环（循环不改，仅 tool 注入）。
implementation:
  - 主 agent = kind=interactive lease（lease/service.py:186 永不过期，零新续期机制）
  - session 恢复复用 restoreAndReconnect（session-manager.ts:1750，daemon 重启主 agent 可恢复）
  - driver.ts consume 循环不改，仅 MCP tool 注入（主 agent tool_call 路由到 task-05 MCP server）
  - 主 agent lease metadata 透传 per-worker provider/model（task-04）
acceptance:
  - 主 agent lease 永不过期（lease_expires_at=NULL）
  - daemon 重启后主 agent session 恢复（restoreAndReconnect 调通）
  - 主 agent tool_call 经 MCP server → hub-client → backend 路径正确
verify:
  - cd sillyhub-daemon && pnpm test src/interactive
constraints:
  - 零新 lease 机制（复用 interactive 永不过期 + session 恢复）
  - driver consume 循环不改（仅 tool 注入）
  - 主 agent 绑 session_id（会话入口，task-08 UI）
  - R-01 长生命周期靠现有机制，不引入心跳续期
---
