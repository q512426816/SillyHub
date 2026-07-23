---
id: task-03
title: OrchestratorService（新）+ mcp_tools endpoint（新）+ create_mission 旁路 CoordinatorPlanner
title_zh: 主 agent 编排引擎与 MCP 端点，旁路 GLM planner
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: [task-02]
blocks: [task-05, task-06, task-09, task-11]
requirement_ids: [FR-1, FR-4]
decision_ids: [D-001@v2, D-006@v2, D-007@v2]
allowed_paths:
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/mission.py
  - backend/app/modules/agent/mission_schema.py
provides:
  - contract: MCPToolsEndpoint
    fields: [dispatch_worker, get_worker_result, list_workers, converge_mission, report_progress]
  - contract: OrchestratorService
    fields: [schedule_loop, converge_skeleton, team_mission_entry, main_agent_run]
expects_from:
  task-02:
    - contract: AgentMission
      needs: [worker_preset, main_agent_config]
    - contract: AgentRun
      needs: [role, worktree_branch]
goal: >
  新建主 agent OrchestratorService 调度循环 + MCP endpoint，create_mission 在 mode=team 时
  旁路 GLM CoordinatorPlanner 走主 agent 路径，复用现有 converge 链路。
implementation:
  - 新建 orchestrator.py：OrchestratorService（主 agent 调度循环 + 三重收敛骨架，完整收敛留 task-11）
  - 新建 mcp_tools.py：5 endpoint（dispatch_worker / get_worker_result / list_workers / converge_mission / report_progress）
  - router.py create_mission：mode=team 时不调 CoordinatorPlanner.plan，改走 OrchestratorService 建主 agent run
  - 调用点搜索（grep CoordinatorPlanner）记录所有调用方，确认旁路不影响 mode=single
  - 复用 finalizer + collect_artifacts converge 链路（不重写）
acceptance:
  - mode=team 的 create_mission 不调 planner.plan，建主 agent AgentRun(role='orchestrator')
  - 5 endpoint 各返回正确结构（dispatch 建 worker run / get_result 读 artifact / list 查状态 / converge 触发 finalizer / progress 落决策日志）
  - mode=single 仍走 planner（零回归）
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_orchestrator app/modules/agent/tests/test_mcp_tools -q --no-cov
  - grep -rn "CoordinatorPlanner" backend/app/modules/agent/
constraints:
  - mode=single 零回归（planner 链路不动）
  - 调用点搜索结果（CoordinatorPlanner 所有调用方）记录在本 TaskCard 或实现注释
  - 三重收敛仅骨架（完整逻辑 task-11）
  - 不实现 GLM fallback（task-10）
---
