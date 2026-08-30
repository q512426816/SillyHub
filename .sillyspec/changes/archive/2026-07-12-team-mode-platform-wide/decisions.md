---
author: qinyi
created_at: 2026-07-12 02:55:00
---

# 决策记录（Decisions）

> ⚠️ **标停（2026-07-12）**：本变更 Wave1+2 已 apply 进 main（commit a98de3ef）作为 v2 `2026-07-12-team-main-agent-orchestration` 复用基础。Wave3-5 转交 v2。D-001/D-006 被 v2 推翻（v2 D-001 主 agent 动态编排 / v2 D-005 per-worker 独立 worktree），D-002/003/004/005 沿用。v1 部分完成，不走完整 archive。
> **superseded-by**: 2026-07-12-team-main-agent-orchestration

## D-001@v1 — 会话 team = 对话中发起 mission
**决策**：会话 team = 在对话面板点「用团队分析」触发 `create_mission`（绑 session_id），结果回传对话。**不**做会话内多 agent 轮转。
**理由**：会话内多 agent 轮转需在 driver 层全新设计多 agent 协调机制（claude/codex driver 现为单 agent），高风险高成本。发起 mission 复用现成 create_mission + mission 链路，价值相近，成本低约 5x。
**影响**：Phase 4 实现复用 mission，新组件 session-mission-progress 展示。

## D-002@v1 — stage team 只做 execute + verify
**决策**：变更流程仅 execute + verify 阶段提供 team；brainstorm/plan 保持 single。
**理由**：brainstorm（探索性头脑风暴）和 plan（结构化任务拆解）单 agent 足够；多 agent 并行反而难收敛、易产生重复/冲突结论。execute（并行写代码）和 verify（多角度核验）是 team 真正发挥价值的场景。
**影响**：Phase 2/3 只动 execute/verify，不碰 brainstorm/plan dispatch。

## D-003@v1 — 默认 single，team 全 opt-in
**决策**：所有入口默认 single，team 需用户主动勾选。
**理由**：team 模式尚未充分端到端验证（ROADMAP 列 delegate_task spike 待运行时验证）；默认 single 保证零回归，用户主动选 team 时知晓成本。
**影响**：所有 team 入口加显式开关，不自动触发。

## D-004@v1 — 方案 B 归一 mission（非 A 统一抽象 / C 各自独立）
**决策**：三入口（mission/stage/会话）触发 team 都 = 建一个 AgentMission，复用现成 mission→dispatch_worker→finalizer 链路。
**理由**：mission 只读链路已端到端验证通（审计第 3 节发现 3）；execute_team 已证明 stage→mission 模式可行；最大化复用 + 改动最小。方案 A 统一 TeamDispatcher 抽象是 YAGNI（抽象先于多实例需求）；方案 C 各自独立会重复 stage team 分流逻辑。
**影响**：所有入口归一到 MissionService.start_mission，差异仅在触发源 + 结果展示位置。

## D-005@v1 — verify gate 收敛采策略 A（fail-safe）
**决策**：verify team 多 worker 各产 gate_result，合并为 stage 单一 gate 时采策略 A——全 worker exit=0 才算过，任一非 0 取最严重值（exit 2 优先于 exit 1）。
**理由**：fail-safe（保守）。verify 是核验环节，宁枉勿纵（误放行比误打回危险）。策略 B 多数决容忍个别误判有风险；策略 C GLM 裁决增加依赖。误判 worker 可在 plan 阶段加单独重跑机制缓解。
**影响**：Phase 3 实现 merge_gate_results helper（策略 A）。

## D-006（延后）— execute 写 team 共享 worktree
**决策**：v1 execute 写 team 多 impl worker 共享同一 worktree（`execution.py:104-130` 同一 root_path），靠 Coordinator 按 plan task 分工避免同文件并发写冲突。per-worker 独立 worktree 隔离延后。
**理由**：per-worker worktree（git worktree add 临时分支）是 D-006 完整实现的硬阻塞，工作量大。v1 先靠 task 分工约定，列风险。
**影响**：Phase 2 标注风险；若实际跑发现冲突频发，升级优先级做隔离。
**accepted risk**：impl worker 不保证遵守 task 分工，可能并发改同一文件导致 patch 互相覆盖。缓解：Finalizer 人审 apply-back 环节人工核验。
