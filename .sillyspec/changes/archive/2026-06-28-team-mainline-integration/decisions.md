---
author: qinyi
created_at: 2026-06-28T02:55:42
status: decisions（本次变更决策台账，含 Design Grill 修正）
parent_change: 2026-06-19-multi-agent-orchestration
---

# Decisions：团队接入主流程

> 本次变更的决策台账（非长期术语表）。原 `2026-06-19` 的 D1-D7 全部沿用，本文记录本变更新增/调整的决策。**D-004@v1 经 Design Grill F1 证实不可行，已 superseded 为 D-004@v2；D-007/D-008 为 Grill 新增修复决策。**

## D-001@v1: team 档可选 / single 默认（不破坏生产路径）
- type: boundary / architecture
- priority: P0
- status: accepted
- source: user（step6 范围倾向）+ code（生产路径保护）
- question: bootstrap / execute 接 team 是否替换现有单 Agent 默认？
- answer: team 为可选档，single 保持默认；auto 档按任务特征选。
- normalized_requirement: 现有 single-agent bootstrap（interactive）/ execute（start_stage_dispatch）默认不变；team/auto 为新增可选路径。
- impacts: [Wave2, Wave3, Wave4, design §5/§9]
- evidence: 用户 step6 + 生产路径保护原则

## D-002@v1: auto/team 第一版仅 bootstrap + execute 入口
- type: boundary
- priority: P1
- status: accepted
- source: user（"接入主流程"方向）
- question: auto/team 路由在哪些 stage 入口生效？
- answer: 第一版接 bootstrap + execute；其他 stage 保持 single。
- normalized_requirement: auto/team 仅作用于 bootstrap 与 execute。
- impacts: [Wave3 T5.3]
- evidence: 用户方向

## D-003@v1: scan 与 bootstrap team 合一（只读场景）
- type: term / boundary
- priority: P1
- status: accepted
- source: docs（proposal §9 + workspace-scan-bootstrap.md）
- question: scan team 与 bootstrap team 是否独立？
- answer: 合一为只读场景，Finalizer 单点写 `.sillyspec/docs`。
- normalized_requirement: bootstrap team 复用 scan 目录扫描作确定性前置；共享 team 编排链路。
- impacts: [Wave2 T6.1]
- evidence: proposal §9 + flows/workspace-scan-bootstrap.md

## D-004@v1: 工具治理降级（先 canUseTool 人审）—— ⚠️ SUPERSEDED
- type: architecture / risk
- priority: P1
- status: superseded（被 D-004@v2 取代）
- source: design 初版
- question: daemon 不支持 `--allowedTools`，原 D5 工具白名单如何落地？
- answer（已被推翻）: read-only Worker bypass、写类 Worker 走现有 canUseTool 远程人审。
- 推翻原因: Design Grill F1 证实 canUseTool 仅 interactive session 注入（permission_service.py:75），Worker 走 batch lease（execution.py:105）不触发 canUseTool——「写类走 canUseTool」不可行。
- supersedes: 原 2026-06-19 D5
- evidence: Grill F1/F2

## D-004@v2: 工具治理降级（v1 不强制、patch 人审兜底）
- type: architecture / risk / compatibility
- priority: P1
- status: accepted
- supersedes: D-004@v1
- source: design-grill（F1/F2 代码核实）
- question: batch 路径无 canUseTool、daemon 无 --allowedTools，v1 工具治理如何收口？
- answer: v1 现实约束下，read-only 与写类 Worker 工具层均不强制（batch 路径，靠 prompt 约束 + daemon 默认 policy）；安全收敛点放 Finalizer patch 人审 apply-back（execute，D-006）。`--allowedTools` 白名单 + batch canUseTool 注入作为后续增强（需 daemon 支持）。
- normalized_requirement: v1 Worker 工具治理不在工具层强制审批；read-only 与写类均走 batch 默认 policy；execute 安全靠 patch 人审 apply-back；不改 sillyhub-daemon。
- impacts: [Wave1 工具治理, Wave4 execute 写类 Worker, design §3/§5/§10 R-02]
- evidence: permission_service.py:75 + execution.py:14-17/105 + Grill F1/F2
- note: 这是代码现实约束下的修正，最终目标仍是工具级强制，分阶段（待 daemon 支持）。

## D-005@v1: Finalizer 分场景（bootstrap 内嵌 / execute 特殊 Worker Run）
- type: architecture
- priority: P1
- status: accepted
- source: design（proposal T3.4 + §9）
- question: Finalizer 单点收敛如何实现？
- answer: bootstrap 用 backend 内嵌 GLM 合并 summary；execute 用特殊 Worker Run 合并 patch。
- normalized_requirement: FinalizerService 提供 finalize_bootstrap_mission（内嵌，不占 lease）与 finalize_execute_mission（调度特殊 Worker Run）。
- impacts: [Wave1, Wave4, design §5/§7]
- evidence: proposal §3/§9

## D-006@v1: execute team 排最后且可独立交付，风险过高可延后
- type: risk / boundary
- priority: P0
- status: accepted
- source: design（原 plan T6.3）+ user（知情选"全做"）
- question: execute team 风险最高，如何推进？
- answer: Wave4 排最后且可独立交付；前置 Wave1/2/3 跑通后再做；风险过高可延后不阻塞主变更。
- normalized_requirement: execute team 独立可交付 Wave，不与底层/bootstrap/auto 耦合。
- impacts: [Wave4, design §4/§5, R-01]
- evidence: 原 plan T6.3 + 用户 step6

## D-007@v1: Finalizer 触发锚点 = complete_lease 末尾 mission 分支（Grill A2 修复）
- type: architecture / feasibility
- priority: P0
- status: accepted
- source: design-grill（A1/A2）
- question: design §7.5 称"derive_status: all_workers_done → 触发 Finalizer"，但谁触发？derive_status 是纯函数无副作用。
- answer: Finalizer 触发锚点在 complete_lease（lease/service.py:278，batch+interactive 唯一 lease 收口点）末尾的 mission 分支——当完成 run 满足 run.mission_id 非空且该 mission 全 worker 终态（derive_status 返回 done/degraded，非误写的 all_workers_done）时调 FinalizerService。derive_status 本身只是纯函数，不能作触发器。
- normalized_requirement: complete_lease 末尾新增 `if run.mission_id and derive_status(mission) in (done,degraded)` 分支触发 Finalizer；状态名用真实值 done/degraded。
- impacts: [Wave1, design §5/§7/§7.5]
- evidence: Grill A1（mission.py:29-54 状态枚举）+ A2（router.py:641 derive_status 纯函数 + lease/service.py:278 complete_lease 无 mission 分支）
- note: 这是 Wave1 能否收敛的地基修复——无此锚点则"Worker 完成→收敛"链路不存在。

## D-008@v1: 治理门拒绝的未 dispatch pending Run 标 killed（Grill A3 修复）
- type: consistency / feasibility
- priority: P0
- status: accepted
- source: design-grill（A3）
- question: start_mission 一次性 persist N 个 pending Run，dispatch 循环中途 can_dispatch_worker 拒绝（超预算/超并发）后，剩余未 dispatch Run 如何收尾？
- answer: 治理门拒绝时，同步把未 dispatch 的 pending Run 标记终态（killed），让 derive_status 能算出 done/degraded、Mission 收敛、Finalizer 触发。否则 pending Run 悬挂 → derive_status 永远 running → Mission 永不收敛。
- normalized_requirement: can_dispatch_worker 拒绝路径中，调用方（router dispatch 循环）将未 dispatch 的 pending Run 标 killed（非悬挂）。
- impacts: [Wave1, design §5/§7.5]
- evidence: Grill A3（mission.py:106-117 persist N pending + router.py:680-687 for-loop + mission.py:46-47 running 判定）
- note: 与 D-007 配合，共同保证 Mission 在任何 dispatch 情况下都能收敛。
