---
author: qinyi
created_at: 2026-06-28 03:10:28
status: proposal（brainstorm 产出）
parent_change: 2026-06-19-multi-agent-orchestration
---

# Proposal：团队接入主流程（Team Mainline Integration）

> 本变更是 `2026-06-19-multi-agent-orchestration` 的续集。原变更已落地 Wave1（领域模型）/Wave2（Coordinator 分派）并锁定架构（proposal §3 + D1-D7），本变更执行其未完成的 Wave5/6 并修复核实发现的底层接线缺口，让 team 功能真正接入 bootstrap/execute 主流程。

## 动机

平台当前是「单 Agent 串行 + 零委派」模型。原变更 `2026-06-19` 已搭起 team 骨架（领域模型 + Coordinator 分派 service），但**骨架未接线、未接入主流程**：能创建 Mission、看 worker 状态 badge，却产出不了合并结果、看不到 Worker 日志、bootstrap/execute 仍走单 Agent。本变更把 team 从 demo 变成真正接入 bootstrap/execute 主流程、能产出合并结果的可用能力。

## 关键问题（为什么现有方案不够）

1. **team 链路是空壳，永不收敛**：核实发现 Wave3/4 的 service 类写了但没接线——Finalizer 未实现（无合并）、`collect_completed_artifacts` 是死代码（Worker 产出永远不回灌）、`can_dispatch_worker` 治理门没挂到 dispatch 循环（预算/上限失效）。更严重的是 Design Grill 发现：即便接上，也**没有 Finalizer 触发锚点**（`derive_status` 是纯函数无 watcher），且超预算时未 dispatch 的 pending Run 会悬挂导致 Mission 永不收敛。现有方案连"Worker 完成→出结果"这条最小闭环都走不通。

2. **team 未接入任何主流程**：bootstrap（项目初始化）、execute（代码执行）都仍是单 Agent 串行，team 能力是孤立的——用户无法在实际工作流中用到 team 的并行/分工优势。

3. **前端是黑盒**：Mission Console 只有扁平 worker list + 10s 轮询 + 成本文字，Worker 日志无法查看（组件已存在未接线）、Artifact 不展示、无 Mission 树、无成本可视化。team 跑了什么、产出了什么、为什么失败都看不到。

## 变更范围

按风险分层推进（方案 B），4 个 Wave：

- **Wave 1 底层修复**：Finalizer 单点收敛（触发锚点在 complete_lease mission 分支，D-007）+ Artifact 收集触发（挂 complete_lease 开头，C2）+ 治理门挂载 + 超预算 Run 标 killed（D-008）+ 工具治理 v1 降级（D-004@v2）。
- **Wave 2 bootstrap team 闭环**：SpecBootstrapService 新增 team 模式（single=现状 interactive 默认，E），并行只读 Worker + Finalizer 单点写 `.sillyspec/docs`。
- **Wave 3 auto 路由 + 前端**：single/team/auto 三档（D-002，第一版接 bootstrap+execute）+ Mission 树/Worker 日志分层回看/成本预算条。
- **Wave 4 execute team**：EXECUTE stage team 档（single 默认），多 worktree patch + 受控 apply-back 人审。排最后且可独立交付（D-006）。

## 不在范围内（显式清单）

- ❌ 不重新设计已锁定架构（Coordinator=backend 内嵌 GLM API / Worker=daemon Run 只回 Artifact / Finalizer / 三档路由 / Mission 派生状态）。
- ❌ 第一版不支持 Worker 递归委派（一层 Coordinator + Workers，≤5 Worker）。
- ❌ 不做多 provider 团队（聚焦 claude/GLM）。
- ❌ 不替换 task-runner（现有批处理 lease 路径零改动）。
- ❌ 不改 sillyhub-daemon（不增 `--allowedTools`、不增 batch canUseTool 注入）。
- ❌ **v1 不做工具层强制审批**（batch 路径无 canUseTool，强制需改 daemon；靠 patch 人审 apply-back 兜底）。
- ❌ Worker 不回灌原始日志到 Coordinator（只回 Artifact）。
- ❌ execute team 不自动提交（受控 apply-back 人审）。
- ❌ 不加新 migration（复用 Wave1，Grill G1/G2 确认）。
- ❌ 前端不做 SSE 实时推送（先用轮询，SSE 后续）。
- ❌ execute team 的 Task↔worktree 映射细节、auto 路由四因子量化阈值留 plan 阶段定义。

## 成功标准（可验证）

- **SC-1 收敛闭环**：给定 objective 创建 Mission → Worker 完成（lease complete）时 Artifact 自动入库 → 全 worker 终态时 Finalizer 自动触发并产出合并产物（complete_lease 锚点，D-007）。
- **SC-2 治理有效**：超预算/超并发时 can_dispatch_worker 拒绝新 Worker、未 dispatch Run 标 killed、Mission 仍能收敛（D-008）；成本在预算内或超预算时优雅收敛。
- **SC-3 bootstrap team 可用**：team 档 bootstrap 产出文档质量 ≥ 单 Agent 且 Coordinator 上下文占用更低；single 档 bootstrap 行为与现状（interactive）完全一致（兼容）。
- **SC-4 可观测**：Mission 树正确渲染；Worker 日志可按 run_id 分层回看；成本/预算条可视化；三档路由可选手动/自动。
- **SC-5 兼容**：未配置 team/auto 时所有入口走 single=现状，现有 AgentRun/DaemonLease 行为不变；complete_lease 新增 mission 分支仅 `run.mission_id 非空` 时生效。
- **SC-6 execute team 隔离**：Wave4 排最后且可独立交付，前置 Wave1/2/3 跑通后才做，风险过高可延后不阻塞主变更（D-006）。
