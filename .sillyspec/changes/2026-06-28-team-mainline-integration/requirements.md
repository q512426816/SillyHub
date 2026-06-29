---
author: qinyi
created_at: 2026-06-28 03:10:28
status: requirements（brainstorm 产出）
parent_change: 2026-06-19-multi-agent-orchestration
---

# Requirements：团队接入主流程

## 角色

| 角色 | 说明 |
|---|---|
| Coordinator | backend 内嵌 GLM messages API，拆解/分派/收敛，不占 daemon lease |
| Worker | daemon-spawned AgentRun，并行执行子任务，只回结构化 Artifact（不回原始日志） |
| Finalizer | 单点收敛：bootstrap=backend 内嵌合并，execute=特殊 Worker Run 合并 patch |
| 平台控制面 | can_dispatch_worker 治理：预算/并发上限/取消，每次 dispatch 前检查 |
| 开发者 | 通过三档路由（single/team/auto）选择 agent 编排模式 |
| 审阅者 | execute team patch 人审 apply-back（不自动提交） |

## 功能需求

### FR-01: Finalizer 单点收敛（触发锚点 complete_lease）
覆盖决策：D-005@v1, D-007@v1
Given 一个 mission 的所有 Worker Run 进入终态（completed/failed/killed）
When 最后一个 Worker 的 lease 在 complete_lease（lease/service.py:278）完成
Then complete_lease 末尾 mission 分支检测到 `run.mission_id 非空` 且 `derive_status(mission) in (done,degraded)`，调用 FinalizerService 触发收敛，产出合并 Artifact（bootstrap=写文档 / execute=patch 列表）

Given mission 仍有 pending/running Worker
When 某 Worker lease complete
Then 不触发 Finalizer（仅 collect Artifact），等待全终态

### FR-02: Artifact 自动收集触发（与 session end 解耦）
覆盖决策：D-007@v1（C2 修正）
Given Worker Run 属于某 mission（run.mission_id 非空）
When 该 Worker 的 lease 在 complete_lease 完成（batch 或 interactive 路径）
Then complete_lease 开头按 lease.agent_run_id 调 collect_completed_artifacts 回灌 AgentArtifact 行（kind=summary），不依赖 session end

Given interactive 多轮会话不 end session
When Worker lease complete
Then 仍触发 collect（按 run 维度，非 session 维度）

### FR-03: 治理门挂载到 dispatch 循环
覆盖决策：D-008@v1
Given mission 的 dispatch 循环（router.py:680-687）准备 dispatch 下一个 Worker
When 调 can_dispatch_worker(mission_id) 返回 (false, reason)
Then 拒绝 dispatch 该 Worker；剩余未 dispatch 的 pending Run 标记 killed；Mission 进入收敛流程（Finalizer 用已有 Artifact 收敛）

Given 累计成本 < 预算 且 active worker < 5 且未取消
When can_dispatch_worker 检查
Then 返回 (true, None)，允许 dispatch

### FR-04: 超预算收敛信号（非错误）
覆盖决策：D-008@v1, 原坑4
Given mission 累计成本达到预算上限
When can_dispatch_worker 检查
Then 返回 (false, "budget_exceeded")；已完成的 Worker Artifact 不丢弃，Finalizer 用已有（可能不完整的）Artifact 出最终结果；Mission 标 degraded 而非 failed

### FR-05: 工具治理 v1 降级（不强制、patch 人审兜底）
覆盖决策：D-004@v2
Given v1 Worker（read-only 或写类）dispatch
When Worker 在 daemon 执行
Then 工具层不强制审批（batch 默认 policy + prompt 约束）；read-only 与写类均走 batch

Given execute team 写类 Worker 产出 patch
When Finalizer 收敛
Then patch 经人审 apply-back 才合并（不自动提交），作为安全收敛点

### FR-06: bootstrap team 闭环
覆盖决策：D-001@v1, D-003@v1（Grill E）
Given bootstrap 入口选择 team 档
When 启动 team bootstrap
Then 平台确定性扫描（复用 WorkspaceService.scan）→ Coordinator 拆任务（架构/规范/测试/集成/风险）→ 并行只读 Worker → 各回 summary Artifact → Finalizer 单点写 `.sillyspec/docs`

Given bootstrap 入口未选 team（single 默认）
When 启动 bootstrap
Then 保持现状 interactive AgentRun + scan bundle（零行为变化）

### FR-07: auto/team 三档路由（第一版 bootstrap+execute 入口）
覆盖决策：D-002@v1
Given bootstrap 或 execute 入口
When 选择路由模式
Then 可选 single（现状）/ team / auto（按任务数·模块跨度·风险·预计上下文自动选）；其他 stage 固定 single

Given auto 档
When 任务特征（任务数/模块跨度/风险/预计上下文）满足 team 阈值（阈值待 plan 定义）
Then 自动选 team；否则 single

### FR-08: 前端 Mission 可观测性
覆盖决策：D-001@v1
Given mission 详情页
When 渲染
Then 显示 Mission 树（Worker 层级/DAG）；每个 Worker 可点击查看日志（复用 agent-log-viewer 按 run_id）；成本/预算进度条可视化（超预算告警色）；bootstrap team 进度展示

Given 后端 MissionWorkerRunResponse
When 序列化 Worker
Then 包含 artifact 字段（当前前后端均缺失）

### FR-09: execute team（多 worktree patch + 受控 apply-back）
覆盖决策：D-005@v1, D-006@v1（Grill D1/D2）
Given EXECUTE stage 选择 team 档（single 默认）
When 启动 execute team
Then plan.md Wave/Task 分给 Worker，每 Worker 在独立 worktree（基于主分支）写不同 task → 出 patch Artifact（kind=patch）→ Finalizer（特殊 Worker Run）合并 → 人审 apply-back（不自动提交）

Given execute team 风险评估过高
When 前置 Wave1/2/3 未跑通
Then execute team 可延后，不阻塞主变更其他 Wave 上生产

### FR-10: 兼容与回退
覆盖决策：D-001@v1
Given 未配置 team/auto
When 任何入口
Then 走 single=现状，现有 AgentRun/DaemonLease/complete_lease（非 mission 分支）行为不变

Given team 档出问题
When 切回 single
Then 恢复现状（路由默认值回退）

## 非功能需求

- **兼容性**：single 档默认，现有 bootstrap（interactive）/ execute（start_stage_dispatch）/ complete_lease（非 mission Run）零行为变化；现有 `/missions` API 向后兼容（仅扩展 artifact 字段）。
- **可回退**：team/auto 为新增可选路径，切回 single 即恢复；feature flag / 路由默认值控制。
- **可测试**：每个 FR 有 Given/When/Then；complete_lease mission 分支、can_dispatch_worker 拒绝路径、Finalizer 触发均有单测；migration 零新增（复用 Wave1）。
- **跨平台**：兼容 Windows/Linux/macOS（CLAUDE.md 规则 12）。
- **成本可控**：双预算 + 治理门 + 超预算收敛信号，默认 single 4× 待 Wave2 观测回填。
- **不改 daemon**：工具治理降级，sillyhub-daemon 零改动。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-06, FR-08, FR-09, FR-10 | team 可选/single 默认 |
| D-002@v1 | FR-07 | auto/team 第一版 bootstrap+execute |
| D-003@v1 | FR-06 | scan/bootstrap 合一 |
| D-004@v2 | FR-05 | 工具治理 v1 不强制、patch 人审兜底（supersedes D-004@v1） |
| D-005@v1 | FR-01, FR-09 | Finalizer 分场景 |
| D-006@v1 | FR-09 | execute team 排最后可独立交付 |
| D-007@v1 | FR-01, FR-02 | Finalizer 触发锚点 complete_lease mission 分支 |
| D-008@v1 | FR-03, FR-04 | 治理门拒绝 Run 标 killed + 超预算收敛信号 |
