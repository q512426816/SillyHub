---
id: task-06
title: mcp_gateway 5 existing tool handlers wire service layer + scope check
title_zh: 对外 MCP 5 现有 tool handler 接 service 层 + scope 校验
author: qinyi
created_at: 2026-08-06 13:52:28
priority: P0
depends_on: [task-05]
blocks: [task-07, task-10, task-14, task-15]
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - backend/app/modules/mcp_gateway/tools.py
goal: >
  在 mcp_gateway/tools.py 用 FastMCP 注册 5 个现有 tool（dispatch_worker / get_worker_result /
  list_workers / converge_mission / report_progress），handler 直接调现有 service 层，按 scope 校验越界，行为与 agent/mcp_tools.py 5 endpoint 一致，业务逻辑零重复。
provides:
  - contract: McpToolHandlers
    fields: [dispatch_worker, get_worker_result, list_workers, converge_mission, report_progress]
expects_from:
  task-03: [workspace_id, scope]
  task-05: [server]
implementation:
  - 5 tool 注册到 task-05 server；workspace_id 从 task-03 McpAuthContext 注入（非 inputSchema 参数），mission_id 等业务参数进 inputSchema
  - scope 校验在 handler 入口，dispatch_worker 与 report_progress 要 dispatch scope，converge_mission 要 converge scope，get_worker_result 与 list_workers 要 read scope，不足返 MCP error 不触达 service
  - 直接复用 agent/mcp_tools.py 背后 service 层业务逻辑零重复，dispatch_worker 调 MissionExecutionService.dispatch_worker + MissionControlService 治理门 + mark_worker_run_failed，get_worker_result/list_workers 查 AgentRun 与 AgentArtifact，converge_mission 调 converge_mission_for_completed_run + FinalizerService + R-07 conflict 计数，report_progress 写 AgentRunLog channel=tool_call
  - inputSchema 字段对齐 sillyhub-daemon/src/mcp-server.ts 现有 5 tool（mcp-server.ts:154-312）保第三方兼容
acceptance:
  - 5 tool 在 /mcp tools/list 可见且 inputSchema 字段与 mcp-server.ts 对齐
  - dispatch / converge / read 三类 scope 越界被拒返 MCP error 不触达 service
  - handler 行为与 agent/mcp_tools.py endpoint 一致（治理门拒绝标 killed / converge 可重入 conflict 状态机 / read 返 artifacts）业务逻辑零重复
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway -q --no-cov
constraints:
  - tool handler 直接调现有 service 层（MissionExecutionService / FinalizerService / converge_mission_for_completed_run / AgentRunLog 写入），业务零重复行为同 agent/mcp_tools.py 5 endpoint
  - 按 scope 校验，dispatch 类（dispatch_worker / report_progress）要 dispatch scope，converge_mission 要 converge scope，read 类（get_worker_result / list_workers）要 read scope，不足返 MCP error 不执行
  - inputSchema 对齐 sillyhub-daemon/src/mcp-server.ts 现有 5 tool 字段保第三方兼容，workspace_id 由 middleware 注入不进 inputSchema
  - 本 task 仅 5 现有 tool，3 新 tool（list_agent_profiles / create_mission / get_run_logs）归 task-14
---
