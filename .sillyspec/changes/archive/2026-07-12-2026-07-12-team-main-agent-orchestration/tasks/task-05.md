---
id: task-05
title: daemon 内置 stdio MCP server + hub-client 加方法 + platform_default 配置注入
title_zh: daemon 侧 MCP 工具与反向通道
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: [task-03]
blocks: [task-06]
requirement_ids: [FR-4]
decision_ids: [D-007@v2]
allowed_paths:
  - sillyhub-daemon/src/mcp-server.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/mcp-config.ts
provides:
  - contract: DaemonMcpServer
    fields: [dispatch_worker, get_worker_result, list_workers, converge_mission, report_progress]
  - contract: HubClientMethods
    fields: [dispatchWorker, getWorkerResult, listWorkers, convergeMission, reportProgress]
expects_from:
  task-03:
    - contract: MCPToolsEndpoint
      needs: [dispatch_worker, get_worker_result, list_workers, converge_mission, report_progress]
goal: >
  新建 daemon 内置 stdio MCP server 暴露 5 tool，hub-client 加反向方法调 backend endpoint，
  platform_default MCP 配置注入让主 agent discover tool。
implementation:
  - 新建 mcp-server.ts：stdio MCP server，5 tool handler（转发到 hub-client 方法）
  - hub-client.ts 加 5 方法（仿 change-write 三段式 hub-client.ts:842 + X-Claim-Token 二级鉴权 :543）
  - mcp-config.ts platform_default 配置加本 server 项（injectMcpConfig :214 复用，主 agent spawn 时 --mcp-config 注入）
  - spike-01 先行验证主 agent 能调 dispatch_worker tool 并收状态回执
acceptance:
  - MCP server 暴露 5 tool（主 agent discover 可见）
  - hub-client 方法调通 backend 5 endpoint（auth + 权限校验通过）
  - 配置注入后主 agent tool_call 能路由到 hub-client → backend
verify:
  - cd sillyhub-daemon && pnpm test src/mcp-server src/hub-client
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - spike-01 先行（不通过退方案 A：backend 主动 GLM 决策循环）
  - auth 用 daemon token + WORKSPACE_WRITE 权限校验 + 限流（NFR-1）
  - tool_kind mcp__ 前缀归类已有（tool-kind.ts:62）零改动
  - hub-client 鉴权头复用（X-API-Key/Bearer + X-Claim-Token）
---
