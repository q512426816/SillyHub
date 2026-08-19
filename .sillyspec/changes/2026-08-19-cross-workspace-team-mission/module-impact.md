---
author: qinyi
created_at: 2026-08-19 10:35:00
---

# 模块影响分析（Module Impact）— 跨工作区团队执行 + 项目维度会话

## 影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend | 修改 + 新增 + 依赖变更 | `agent` 子域是本次核心改造区：model/schema/router/orchestrator/placement/execution/finalizer/mcp_tools 均修改；新增 migration `20260819100000_mission_cross_workspace.py`；新增/修改 `agent/tests/*` 覆盖跨 ws 场景。`workspace/member_runtimes` 新增代表 binding 查询，被 `agent/placement` 依赖。`mcp_gateway` 工具链路对齐。`openapi.json` 重新生成。 |
| sillyhub-daemon | 修改 + 依赖变更 | `src/mcp-server.ts` 的 `dispatch_worker` schema 新增 `target_workspace_id` 可选参并透传 backend；`src/api-types.ts` 随 backend OpenAPI 重新生成。 |
| frontend | 新增 + 修改 + 依赖变更 | 新增 `(dashboard)/projects/[id]/missions/page.tsx` 项目维度入口；修改 `components/mission-console.tsx` 以展示 worker 目标工作区；修改 `lib/agent.ts` 新增项目 mission API client；`lib/api-types.ts` 随 OpenAPI 重新生成。`components/sessions/new-session-form.tsx` 本次不改动，仅复用既有组件。 |
| docs | 无源码变更 | 仅 SillySpec 规范文档（design.md/plan.md 等）更新，不改动 `docs/` 业务文档。 |
| sillyspec | 无源码变更 | 仅变更目录内规范产物更新，不改动 SillySpec 工具本身。 |

## 依赖变更说明

- `backend/app/modules/agent/placement.py` 新增对 `workspace/member_runtimes/queries.py` 的 `resolve_representative_binding` 调用。
- `backend/app/modules/agent/execution.py` 新增依赖 `target_workspace_id` 字段与 representative 旗标逻辑。
- `backend/app/modules/agent/finalizer.py` 新增按 `target_workspace_id` 分组收敛。
- `backend/app/modules/mcp_gateway/tools.py` 需与 `backend/app/modules/agent/mcp_tools.py` 保持行为对齐（双 MCP 通道）。
- `sillyhub-daemon/src/mcp-server.ts` 需透传新增字段，与 backend `agent/mcp_tools.py` 契约一致。
- `frontend/src/components/mission-console.tsx` 与 `frontend/src/lib/agent.ts` 依赖 backend `/api/projects/{pid}/missions` 端点与 MissionResponse 新字段。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新 backend 模块卡（agent 子域跨 ws 改造、新端点、双 MCP 对齐、target 落列语义修正） | **completed** |
| `modules/frontend.md` | 更新 frontend 模块卡（新增 projects/[id]/missions 页面、MissionConsole projectMode 扩展、项目 mission API client） | **completed-note-pending** |
| `modules/sillyhub-daemon.md` | 更新 sillyhub-daemon 模块卡（mcp-server.ts schema 透传、hub-client 可选参透传） | **completed** |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

## 主要新增/改造清单

- **后端 API 新端点**：`POST /api/projects/{project_id}/missions`、`GET /api/projects/{project_id}/missions`
- **后端 schema 新字段**：`AgentMission.project_id`、`AgentMission.scope_workspace_ids`、`AgentRun.target_workspace_id`；`MissionCreateRequest/MissionResponse` 扩展 `anchor_workspace_id` / `scope_workspace_ids` 等
- **后端新查询/旗标**：`workspace/member_runtimes/queries.resolve_representative_binding`、`placement.representative_fallback`、`execution.target_workspace_id` 路由与回写、`finalizer` 按 target 分组 merge/cleanup
- **双 MCP 通道对齐**：`agent/mcp_tools.py` / `mcp_gateway/tools.py` 同步 target 校验与透传，保持单 ws NULL 语义
- **守护进程透传**：`sillyhub-daemon/src/mcp-server.ts` dispatch_worker schema + `hub-client.ts` 可选参透传
- **前端新页面**：`app/(dashboard)/projects/[id]/missions/page.tsx`
- **前端组件/API 扩展**：`components/mission-console.tsx` projectMode + 目标工作区徽标列；`lib/agent.ts` `createProjectMission` / `listProjectMissions`；`lib/api-types.ts` / `sillyhub-daemon/src/api-types.ts` 随 OpenAPI 重新生成
- **测试**：新增 `test_integration_cross_workspace.py`、`test_mcp_tools_cross_workspace.py`、`missions-page.test.tsx`；agent 模块 586 passed / 1 预存债；frontend vitest 1684 passed；mypy 0 issues

> execute/verify 阶段根据实际代码落点回填上表状态；未实际影响的模块可改为 skipped。
