---
author: qinyi
created_at: 2026-06-20
status: plan（spike 04 通过后立项；前置 Wave0 已完成）
---

# Plan：多 Agent 委派编排

> 基于 proposal.md（§3 架构 + spike 04 修正）+ brainstorm-decisions.md（D1–D7）。
> 立项前置已解除：Wave0 重复 Run bug 已修 + delegate_task spike 路径 B 通过（H1/H2=100%）。
> 关键定调：**Coordinator 分派 = backend 直接 GLM API（非 agentic）；Worker = daemon-spawned AgentRun。**
> 每个 Wave 可独立交付 + 测试 + 上生产。Wave 间有依赖，按序推进。

## Wave 1：领域模型基础（可独立交付）

**目标**：把 AgentRun 升级为可表达编排关系，引入 Mission/Dependency/Artifact 聚合根。纯数据层，零执行逻辑改动。

- T1.1 `AgentRun` 加字段：`mission_id`（FK→agent_missions, nullable）、`parent_run_id`（self-FK, nullable）、`role`（String, nullable）、`objective`（Text, nullable）、`attempt`（Int, default 0）。
- T1.2 新表 `agent_missions`：id / workspace_id / change_id(nullable) / objective / constraints(JSON) / budget_tokens / budget_usd / created_by / created_at / cancelled_at。**不存 status**（派生，见 brainstorm 坑3）。
- T1.3 新表 `agent_run_dependencies`：id / run_id(FK) / depends_on_run_id(FK) / created_at。（DAG 边）
- T1.4 新表 `agent_artifacts`：id / run_id(FK) / kind（summary/patch/test_result/evidence） / content_ref（文件路径或内联摘要）/ created_at。
- T1.5 migrations（PG ADD COLUMN + CREATE TABLE，对齐 202607050900 风格）。
- T1.6 `Mission.derive_status(runs)` 纯函数：从子 Run 状态聚合（planning/running/degraded/cancelled/failed/done）。单测。
- **验收**：migration up/down 干净；现有单 Agent 流程零行为变化（新字段全 nullable）；derive_status 单测全过。
- **依赖**：无（Wave0 已完成）。

## Wave 2：Coordinator 分派服务（backend 直接 API）

**目标**：backend 内嵌 GLM 调用，输入 Mission objective → 输出可解析委派清单 → 建 Worker AgentRun（DAG）。复用 spike 04 验证过的 prompt + 解析。

- T2.1 `CoordinatorService.plan(objective, constraints)` → 调 GLM messages API（复用 spike 04 prompt/解析/validate）→ 返回 `delegations[]`。HTTP client 复用项目已有 provider 配置（`trust_env` 注意）。
- T2.2 `MissionService.create_from_plan(mission, delegations)` → 建 Worker AgentRun（status=pending, mission_id, role, objective）+ AgentRunDependency（DAG）。一层不递归。
- T2.3 工具治理落地（brainstorm 坑1）：Coordinator 调用不给工具（纯输出）；Worker 的 allowedTools 从 prompt 声明提升到 CLI `--allowedTools` 显式白名单（取代 batch 的 `bypassPermissions` 全放行）——**需先跑现有 stage 流程回归确认影响面**（❓ 待确认）。
- T2.4 硬约束校验：1 层、≤5 Worker、objective 非空、role 枚举。
- **验收**：给定 objective，能产出合法 Worker Run DAG；解析失败有明确错误（不静默）；现有单 Agent dispatch 不受影响。
- **依赖**：Wave 1。

## Wave 3：Worker 执行 + Artifact 回灌

**目标**：Worker Run 走现有 daemon lease 路径执行，产出结构化 Artifact 回灌（不回原始日志）。

- T3.1 Worker dispatch 复用 `start_stage_dispatch` / placement（零改 daemon）。
- T3.2 Worker prompt 约束：只回结构化 Artifact（schema），read_only Worker 走 bypass、写类 Worker 走 canUseTool 人审（brainstorm D5）。
- T3.3 Artifact 收集：Worker 完成后解析输出 → 写 agent_artifacts。
- T3.4 Finalizer 单点收敛（brainstorm 坑3 + proposal §9）：一个 Worker 负责合并 Artifact 出最终产物，避免多 Agent 并发改文档冲突。
- **验收**：N 个 Worker 并行执行各自产出 Artifact；Finalizer 合并出统一产物；Coordinator 不吞原始日志（UI 可查）。
- **依赖**：Wave 2。

## Wave 4：Mission 控制面（治理）

**目标**：平台对 Mission 的并发/成本/取消/部分失败治理。

- T4.1 成本预算（brainstorm 坑4）：每次 Worker dispatch 前查 Mission 累计成本，超预算拒绝新 Worker + 通知收敛。默认值待 baseline（❓）。
- T4.2 并发上限：≤5 Worker（信号量/调度）。
- T4.3 取消：Mission.cancelled_at 标记 + 平台取消所有 active 子 Run。
- T4.4 部分失败（D6）：Worker failed → Mission derive_status=degraded，不阻断其他；Coordinator 据 Artifact 完整度决策。
- **验收**：超预算/超并发被拒；取消能停止所有子 Run；1/N 失败不整体崩。
- **依赖**：Wave 3。

## Wave 5：前端 Mission 树 + 路由

**目标**：UI 以 Mission 树展示，single/team/auto 三档。

- T5.1 Mission 详情页：Mission 摘要 + Worker Run 树（状态/role/Artifact 引用）+ 成本/预算条。
- T5.2 Worker 日志分层回看（复用现有 agent-log-viewer，按 run_id）。
- T5.3 路由：single（quick/小改/问答，现状）/ team（bootstrap/大 scan/多模块 execute/复杂 verify）/ auto（按任务数·模块跨度·风险·预计上下文自动选）。
- **验收**：Mission 树正确渲染；Worker 日志可回看；三档可选手动/自动。
- **依赖**：Wave 4。

## Wave 6：Bootstrap Team MVP（端到端，只读场景先行）

**目标**：把 Wave 1–5 串起来，先上风险最低的只读场景（proposal §9 上半：并行读、集中写）。

- T6.1 Bootstrap/Scan 接 team 档：平台先确定性扫描 → Coordinator 拆 → 只读 Worker 并行分析 → Finalizer 单点写 `.sillyspec/docs`。
- T6.2 成本/预算观测 → 回填默认值（❓）。
- T6.3 多 worktree Execute 团队（proposal §9 下半：patch + 受控 apply-back）——风险更高，MVP 后再做。
- **验收**：一次 bootstrap 用 team 档产出文档质量 ≥ 单 Agent 且上下文占用更低；成本在预算内。
- **依赖**：Wave 5。

## 待确认（❓，不阻塞 Wave 1–2）

1. batch 路径 `bypassPermissions` → 显式 `--allowedTools` 白名单的回归影响（Wave 2 T2.3 前必须确认）。
2. Mission 默认成本预算值（Wave 4 T4.1 / Wave 6 T6.2 需 baseline）。

## 推进建议

Wave 1（数据模型）范围可控、类似已完成的 Wave0（created_at），是下一个可独立上生产的交付。建议本路线从 Wave 1 起按序推进，每 Wave 独立验证。
