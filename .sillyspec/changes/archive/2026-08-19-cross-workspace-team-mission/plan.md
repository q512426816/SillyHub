---
author: qinyi
created_at: 2026-08-19 10:35:00
plan_level: full
---

# 实现计划：跨工作区团队执行 + 项目维度会话

## 复杂度分类

```
plan_level: full
reason: 17+ 文件跨 backend/frontend/sillyhub-daemon 三子项目、6+ 模块，含 DB schema 变更、新 API 端点、MCP 双通道对齐、派发路由改造与按工作区分组收敛，task 数 16 个，需多 wave 并行执行。
estimated_files: 20+
cross_module: true
has_schema_change: true
has_state_machine_change: false
needs_parallel_execution: true
needs_human_review: true
```

## Spike 前置验证

本方案基于已落地的 workspace-role-type（8 值 type 词表）、`workspace_member_runtimes` 多 binding 结构、`HostFsDelegate._via_rpc` 按 workspace→daemon 路由、以及 `ppm_project_workspace` M:N 关联表，技术确定性高，无新技术栈或未经证成的集成点，**跳过 Spike**。

## Wave 1：数据模型与派发路由（backend 核心，无外部依赖）

- [x] task-01：migration 20260819100000 + model.py 字段（AgentMission.project_id / scope_workspace_ids；AgentRun.target_workspace_id）
- [x] task-02：member_runtimes/queries.py 新增 `resolve_representative_binding`（owner 在线优先 → 任意在线按 daemon 最近心跳）
- [x] task-03：placement.py `_resolve_dispatch_runtime` 新增 `representative_fallback` 旗标分支（旗标关时维持 borrow 现状）
- [x] task-04：execution.py `dispatch_worker` 按 `target_workspace_id` 路由（effective_target 贯穿 worktree/provider/placement）

## Wave 2：mission 域与编排（backend，依赖 W1）

- [x] task-05：mission_schema.py 扩展（Create 加 anchor/scope；Response 加 project/scope/ws 概要；WorkerRun 加 target 概要）
- [x] task-06：orchestrator.py `team_mission_entry` 接收 scope + `render_orchestrator_prompt` 注入项目名/scope 清单/target 用法
- [x] task-07：agent/router.py 新增 `POST/GET /api/projects/{pid}/missions`（scope ⊆ 项目校验、anchor ∈ scope、PPM 项目经理鉴权、binding 预检）

## Wave 3：MCP 双通道对齐（backend + daemon，依赖 W2）

- [x] task-08：agent/mcp_tools.py（链路A）`_get_mission` scope 放宽 + `dispatch_worker` 加 target 参 + scope 校验 + profile 归属放宽
- [x] task-09：mcp_gateway/tools.py（链路B）同款对齐 + converge 兜底路由走 representative 旗标
- [x] task-10：sillyhub-daemon `src/mcp-server.ts` `dispatch_worker` schema 加 `target_workspace_id` 透传

## Wave 4：收敛 merge 分组（backend，依赖 W1 + W3）

- [x] task-11：finalizer.py merge 按 `(target_workspace_id, worktree_branch)` 分组，冲突按组独立

## Wave 5：cleanup 分组 + 前端（依赖 W4 / W2 + W3）

> task-12 与 task-11 同改 finalizer.py，须分 Wave 串行（同 Wave 共享文件会被 postcheck 拦截）；前端 task-13~15 与 finalizer 无文件交集，可并行。

- [x] task-12：finalizer.py cleanup_mission 按 `target_workspace_id` 分组删除 worktree 副本
- [x] task-13：pnpm gen:types + 提交 `openapi.json` + `api-types.ts`
- [x] task-14：frontend/src/lib/agent.ts 新增 `createProjectMission` / `listProjectMissions`
- [x] task-15：frontend/src/app/(dashboard)/projects/[id]/missions/page.tsx + MissionConsole 扩展（worker 目标工作区徽标列）

## Wave 6：收尾（依赖 W1~W5）

- [x] task-16：单 ws mission 零回归集成测试 + backend/frontend/daemon 全量测试跑绿 + 文档更新

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | migration + model.py 字段 | W1 | P0 | — | FR-01, FR-02, D-002@v1, D-007@v1, D-009@v1 | 单 migration 加 project_id/scope_workspace_ids/target_workspace_id，workspace_id 列不动 |
| task-02 | resolve_representative_binding 查询 | W1 | P0 | — | FR-02, D-001@v2 | owner 在线 binding 优先，否则该 ws 任意在线 binding |
| task-03 | placement.py representative 旗标 | W1 | P0 | task-02 | FR-02, D-001@v2, D-004@v2 | 旗标开走代表 binding，旗标关维持 borrow 零回归 |
| task-04 | execution.py target 路由 | W1 | P0 | task-01, task-03 | FR-02, D-001@v2 | effective_target 贯穿 worktree/provider/placement，target≠anchor 传 representative=True |
| task-05 | mission_schema.py 扩展 | W2 | P0 | task-01 | FR-01, FR-04, D-005@v1 | Create/Response/WorkerRun 扩展字段，全部可选零回归 |
| task-06 | orchestrator.py 项目上下文 | W2 | P0 | task-05 | FR-06, D-004@v2 | 主 agent prompt 注入项目名 + scope 清单 + target 用法 |
| task-07 | router.py /projects/{pid}/missions | W2 | P0 | task-05, task-06 | FR-01, FR-05, D-005@v1, D-006@v1 | scope 校验 + PPM 项目经理鉴权 + binding 预检 |
| task-08 | mcp_tools.py 链路A 对齐 | W3 | P0 | task-04, task-05 | FR-02, FR-04, FR-05, D-010@v1 | _get_mission 放宽 scope + dispatch_worker target + profile 归属放宽 |
| task-09 | mcp_gateway/tools.py 链路B 对齐 | W3 | P0 | task-04, task-05 | FR-02, FR-04, FR-05, D-010@v1 | 与链路A 同款，converge 兜底路由 |
| task-10 | daemon mcp-server.ts 透传 | W3 | P0 | task-08 | FR-02, FR-04 | dispatch_worker schema 透传 target_workspace_id |
| task-11 | finalizer.py merge 分组 | W4 | P0 | task-01, task-04 | FR-03, D-003@v1, D-011@v1 | 按 (target_workspace_id, worktree_branch) 分组 merge |
| task-12 | finalizer.py cleanup 分组 | W5 | P0 | task-01, task-11 | FR-03, D-011@v1 | cleanup_mission 按 target_workspace_id 分组删除副本（与 task-11 分 Wave 串行） |
| task-13 | gen:types + OpenAPI 产物 | W5 | P1 | task-07 | FR-04, FR-07, 验收 10 | backend 稳定后重新生成并提交 |
| task-14 | lib/agent.ts 项目 mission client | W5 | P1 | task-07, task-13 | FR-07 | createProjectMission / listProjectMissions |
| task-15 | /projects/[id]/missions 页面 | W5 | P1 | task-07, task-13, task-14 | FR-07 | 发起表单 anchor/scope + MissionConsole 扩展 |
| task-16 | 收尾与零回归验收 | W6 | P0 | task-08~12, task-15 | FR-04, 验收 1~10 | 全量 pytest/vitest + 集成冒烟 + 文档更新 |

## 关键路径

task-01 → task-04 → task-08/task-09 → task-11/task-12 → task-16 为后端核心交付链；task-07 → task-15 为前端交付链。两条链在 task-16 汇合，决定整体交付周期。

## 全局验收标准

对照 design.md §10：
- [ ] 验收 1：单 ws mission 全链路零回归（创建/主 agent 派发/worker dispatch/converge/MCP 工具）。
- [ ] 验收 2：项目维度创建 scope 越界/anchor 越界/非项目经理均正确拒绝。
- [ ] 验收 3：跨 ws dispatch_worker target ∈ scope 放行且 worktree 落 target root；target ∉ scope 400；target 无在线 binding 不崩 mission。
- [ ] 验收 4：代表 binding 解析 owner 优先 → 任意在线 → 报错三分支单测。
- [ ] 验收 5：converge merge 与 cleanup_mission 均按工作区分组，A 冲突不挡 B 合并。
- [ ] 验收 6：主 agent prompt 含项目名 + scope 清单（type 徽标语义）。
- [ ] 验收 7：daemon mcp-server.ts schema 新参透传。
- [ ] 验收 8：链路B（mcp_gateway）对齐。
- [ ] 验收 9：representative 旗标关时 binding-None 仍走 borrow。
- [ ] 验收 10：gen:types 同 change 内提交。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2 | task-02, task-03, task-04, task-09 | 验收 3 / 验收 4 / 验收 9 |
| D-002@v1 | task-01, task-05 | 验收 1 |
| D-003@v1 | task-11 | 验收 5 |
| D-004@v2 | task-03, task-06 | 验收 6 / 验收 9 |
| D-005@v1 | task-05, task-07 | 验收 2 |
| D-006@v1 | task-07 | 验收 2 |
| D-007@v1 | task-01, task-07 | 验收 2 |
| D-008@v1 | task-07 | 验收 2 |
| D-009@v1 | task-01 | 验收 1 |
| D-010@v1 | task-08, task-09 | 验收 8 |
| D-011@v1 | task-11, task-12 | 验收 5 |
| FR-01 | task-01, task-05, task-07 | 验收 2 |
| FR-02 | task-02, task-03, task-04, task-08, task-09, task-10 | 验收 3 / 验收 4 / 验收 7 / 验收 8 |
| FR-03 | task-11, task-12 | 验收 5 |
| FR-04 | task-05, task-08, task-09, task-10, task-13, task-16 | 验收 1 / 验收 7 / 验收 8 / 验收 9 / 验收 10 |
| FR-05 | task-07, task-08, task-09 | 验收 2 / 验收 8 |
| FR-06 | task-06 | 验收 6 |
| FR-07 | task-13, task-14, task-15 | 验收 10 |

## 完成摘要

plan step 2：按 full 模板重写 plan.md，6 Wave 16 task 已落盘，关键路径、全局验收标准、D/FR 覆盖矩阵完整。
