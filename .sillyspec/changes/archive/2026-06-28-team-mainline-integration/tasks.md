---
author: qinyi
created_at: 2026-06-28 03:10:28
status: tasks（brainstorm 产出，细节在 plan 阶段展开）
parent_change: 2026-06-19-multi-agent-orchestration
---

# Tasks：团队接入主流程

> 任务列表（名称 + 文件路径 + 覆盖的 FR/D-xxx）。细节（具体方法签名、测试用例、依赖排序）在 plan 阶段展开。按 Wave 组织，Wave 间有依赖（底层修复 → bootstrap team → auto+前端 → execute team），每 Wave 可独立交付。

## Wave 1 — 底层修复（前置，让现有 team 链路可用且能收敛）

| 任务 | 文件路径 | 覆盖 |
|---|---|---|
| T1.1 Finalizer 服务（bootstrap 内嵌合并 + execute patch 合并入口） | backend/app/modules/agent/finalizer.py（新增） | FR-01, D-005@v1 |
| T1.2 complete_lease mission 分支（开头 collect + 末尾 Finalizer 触发） | backend/app/modules/daemon/lease/service.py:278 | FR-01, FR-02, D-007@v1 |
| T1.3 治理门挂载到 dispatch 循环 + 拒绝时未 dispatch Run 标 killed | backend/app/modules/agent/router.py:680-687, control.py:52 | FR-03, FR-04, D-008@v1 |
| T1.4 工具治理 v1 降级（不强制、注释说明、worker_tool_config 标注） | backend/app/modules/agent/execution.py:14-49 | FR-05, D-004@v2 |
| T1.5 Wave1 测试（Finalizer 触发、collect 回灌、治理门拒绝、超预算收敛） | backend/tests/... | FR-01~FR-05 |

## Wave 2 — bootstrap team 闭环（第一个真实场景，只读并行）

| 任务 | 文件路径 | 覆盖 |
|---|---|---|
| T2.1 SpecBootstrapService 新增 team 模式（single=现状 interactive 默认） | backend/app/modules/spec_workspace/bootstrap.py:52,346 | FR-06, D-001@v1, Grill E |
| T2.2 bootstrap team 编排链路（确定性扫描复用 WorkspaceService.scan → Coordinator 拆任务 → 并行只读 Worker → Finalizer 单点写 .sillyspec/docs） | bootstrap.py + delegation.py + finalizer.py | FR-06, D-003@v1 |
| T2.3 bootstrap team 成本观测回填默认预算 | control.py + delegation.py | FR-04, 原坑4 |
| T2.4 Wave2 测试（team 档 bootstrap 端到端 + single 档回归=现状） | backend/tests/... | FR-06, FR-10 |

## Wave 3 — auto 路由 + 前端 Mission 可观测性

| 任务 | 文件路径 | 覆盖 |
|---|---|---|
| T3.1 auto/team/single 三档路由 route()（第一版 bootstrap+execute 入口，auto 四因子阈值待 plan） | backend/app/modules/agent/delegation.py | FR-07, D-002@v1 |
| T3.2 MissionWorkerRunResponse + 前端 MissionWorkerRun 接口补 artifact 字段 | backend/app/modules/agent/mission_schema.py:18-27, frontend/src/lib/agent.ts:189-197 | FR-08 |
| T3.3 Mission 树（Worker 层级）+ Worker 日志分层回看（复用 agent-log-viewer 按 run_id） | frontend/src/components/mission-console.tsx, agent-log-viewer.tsx:584 | FR-08 |
| T3.4 成本/预算进度条可视化（超预算告警色）+ bootstrap team 进度 | frontend/src/components/mission-console.tsx:109-111 | FR-08 |
| T3.5 三档路由选择 UI | frontend/src/app/(dashboard)/workspaces/[id]/missions/page.tsx | FR-07 |
| T3.6 Wave3 测试（路由判定 + 前端组件渲染 + artifact 字段） | frontend/... + backend/tests/... | FR-07, FR-08 |

## Wave 4 — execute team（最后，可独立交付，风险最高）

| 任务 | 文件路径 | 覆盖 |
|---|---|---|
| T4.1 EXECUTE stage team 分流（single→start_stage_dispatch / team→start_mission，挂载点待 plan D2） | backend/app/modules/change/dispatch.py, backend/app/modules/agent/service.py:931 | FR-09, Grill D2 |
| T4.2 Task↔Worker↔worktree 映射机制（待 plan D1 定义，可能 task 表加字段，注意 R-04 migration 链） | backend/app/modules/task/model.py:17-70 + agent/model.py | FR-09, Grill D1 |
| T4.3 多 worktree 并行（每 Worker 独立 worktree 基于主分支出 patch Artifact kind=patch） | backend/app/modules/worktree + execution.py | FR-09 |
| T4.4 execute Finalizer（特殊 Worker Run 合并 patch）+ 人审 apply-back（不自动提交） | finalizer.py + worktree patch apply | FR-09, D-005@v1, D-006@v1 |
| T4.5 Wave4 测试（execute team 端到端 + patch 合并冲突处理 + apply-back 人审） | backend/tests/... | FR-09 |

## 跨 Wave

| 任务 | 文件路径 | 覆盖 |
|---|---|---|
| T-X1 兼容回归（single 档全流程=现状、complete_lease 非 mission Run 零影响） | 全链路回归测试 | FR-10, D-001@v1 |
| T-X2 文档同步（模块文档/flow 文档更新：agent-execution / workspace-scan-bootstrap / change-lifecycle） | .sillyspec/docs/.../flows/ + modules/ | 全 FR |

> plan 阶段需补：auto 四因子量化阈值（FR-07）、Task↔worktree 映射机制（T4.2/D1）、execute 分流挂载点（T4.1/D2）、各任务依赖排序与 Wave 内并行度、Wave4 风险评估（D-006）。
