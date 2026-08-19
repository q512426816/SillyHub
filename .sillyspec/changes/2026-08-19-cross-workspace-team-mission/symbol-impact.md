---
author: qinyi
created_at: 2026-08-19 11:15:00
---

# 符号影响面扫描（execute step2）

结论先行：本变更全部签名级改动均为**带默认值的增量参数 / 新增可选字段**（additive），既有调用点不传新参数即保持原行为（零回归），且所有需要感知新参数的调用点都落在对应 task 的 allowed_paths 内。无阻断项。

| task | 变更类型 | 受影响调用点 | 是否在范围内 |
|---|---|---|---|
| task-01 | ORM 列新增（AgentMission.project_id / scope_workspace_ids；AgentRun.target_workspace_id） | 构造调用点 orchestrator.py(team_mission_entry) / execution.py(dispatch_worker) 不传即默认 NULL，无需改 | task-04/06 覆盖写入方 ✓ |
| task-02 | 新函数 resolve_representative_binding | 全新符号，无既有调用点；消费者 placement.py（task-03） | ✓ |
| task-03 | _resolve_dispatch_runtime 增带默认值参数 representative_fallback=False | placement.py:365 / placement.py:811（同文件内部调用，默认值零回归） | task-03 allowed_paths 含 placement.py ✓ |
| task-04 | MissionExecutionService.dispatch_worker 增带默认值参数 target_workspace_id=None | mcp_tools.py:427（task-08 ✓）、router.py:1040（task-07 ✓）、mcp_gateway/tools.py（task-09 ✓）、既有测试 test_dispatch_worker_*.py ×5（默认值零回归，无需改） | ✓ |
| task-05 | Pydantic DTO 新增可选字段（Create/Response/WorkerRun） | 序列化消费方自动兼容；前端 api-types 由 task-13 regen | ✓ |
| task-06 | team_mission_entry 增带默认值形参 scope_workspace_ids=None | router.py:987（task-07 ✓）、既有测试 test_orchestrator.py / test_mission_external_mode.py（默认值零回归） | ✓ |
| task-07 | 新增 POST/GET /api/projects/{pid}/missions 端点 | 新路由，无既有调用点；前端消费由 task-14 新增 | ✓ |
| task-08 | mcp_tools.py 内部校验逻辑（_get_mission / _resolve_dispatch_agent_profile）+ dispatch_worker 传 target | exec_svc.dispatch_worker 调用点在本文件（task-04 契约） | ✓ |
| task-09 | mcp_gateway/tools.py 同款对齐 + converge 兜底路由 | 复用 MissionExecutionService.dispatch_worker（task-04 契约） | ✓ |
| task-10 | mcp-server.ts dispatch_worker inputSchema 加 optional 字段 | zod schema additive；透传链 client.dispatchWorker（hub-client 守卫不写 undefined） | ✓ |
| task-11 | finalizer.py finalize_execute_mission 内部分组逻辑 | 无对外签名变更；converge_mission_for_completed_run 入口不变 | ✓ |
| task-12 | finalizer.py cleanup_mission 内部分组逻辑 | 无对外签名变更 | ✓ |
| task-13 | openapi.json / api-types.ts regen | 生成产物，无手写签名 | ✓ |
| task-14 | lib/agent.ts 新增 createProjectMission / listProjectMissions | 全新符号；消费方 task-15 新页 | ✓ |
| task-15 | mission-console.tsx props 扩展（新增可选 project 维度 props） | 既有调用点 workspaces/[id]/missions/page.tsx（可选 props 不破坏既有渲染，零回归）；新页为新增 | ✓ |
| task-16 | 集成测试 + 模块卡文档 | 无签名级变更 | ✓ |

扫描方法：rg 检索 `_resolve_dispatch_runtime(`、`dispatch_worker(`、`team_mission_entry(`、`MissionConsole`、mcp_gateway dispatch/converge 引用，逐点对照 tasks/task-NN.md 的 allowed_paths。
