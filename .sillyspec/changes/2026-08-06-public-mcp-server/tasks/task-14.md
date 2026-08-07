---
id: task-14
title: mcp_gateway 3 new tools (list_agent_profiles / create_mission / get_run_logs)
title_zh: 对外 MCP 3 个新 tool（列 profile / 建 mission / 看日志）
author: qinyi
created_at: 2026-08-06 14:36:00
priority: P1
depends_on: [task-06]
requirement_ids: [FR-09]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/tools.py
provides: []
expects_from: []
related_tests:
  - path: backend/app/modules/mcp_gateway/tests/
    reason: 3 新 tool handler 各自单测
goal: >
  在 mcp_gateway/tools.py 用 FastMCP 注册 3 个新 tool（list_agent_profiles / create_mission /
  get_run_logs），handler 直接调现有 service 层并按 scope 校验，补齐第三方「列 agent / 建
  mission / 看完整日志」纯 MCP 闭环（design §5.2 P6 / §7.1 后 3 行 / D-006）。
implementation: |
  - list_agent_profiles（read）：复用 AgentProfileService.list（profile/router.py list_workspace_profiles 清单逻辑，actor=token.created_by 对应 user、workspace=token 绑定 workspace），返回 id/name/description/provider/model/tools_summary。
  - create_mission（dispatch）：复用 OrchestratorService.team_mission_entry（mode=team，D-004 忍一个闲置主 agent run），透传 objective/worker_preset/main_agent_config/budget_usd/change_id。
  - CC-05 / G-4 决议（重点）：McpToken 无独立 user，create_mission 的 created_by 用 token.created_by（签发该 token 的 user，最小改动、可审计），不传 None。
  - get_run_logs（read）：查 AgentRunLog by run_id（model.py:336），按 limit/channel 过滤，返回 timestamp/channel/tool_kind/content_redacted（CC-09 对齐 model.py:391，返 content_redacted 不返 content）。
  - 3 tool 注册到 task-05 server；workspace_id 从 task-03 McpAuthContext 取（非 inputSchema）。
acceptance: |
  - 3 tool 在 /mcp tools/list 可见，inputSchema 字段对齐 design §7.1。
  - create_mission 落 mission + 闲置主 agent run，created_by=token.created_by；get_run_logs 返 content_redacted 不返 content；list_agent_profiles 返 tools_summary。
  - read（list_agent_profiles / get_run_logs）与 dispatch（create_mission）scope 越界返 MCP error 不触达 service。
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway -q --no-cov
constraints: |
  - list_agent_profiles 复用 profile/router.py 清单逻辑（AgentProfileService.list），返回 id/name/description/provider/model/tools_summary。
  - create_mission 复用 OrchestratorService.team_mission_entry（mode=team，D-004 忍闲置主 agent），created_by=token.created_by（CC-05 决议，McpToken 无独立 user，最小改动可审计）。
  - get_run_logs 查 AgentRunLog by run_id，返回字段含 content_redacted（CC-09 对齐 model.py:391，不要写 content）。
  - 3 tool 按 scope 校验（list_agent_profiles / get_run_logs=read，create_mission=dispatch）。
---
