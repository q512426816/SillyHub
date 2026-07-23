---
id: task-05
title: "MissionSummaryCard: 中文状态徽标 + 成败统计 + 累计成本"
title_zh: 任务总览卡（状态/成败/成本）
author: qinyi
created_at: 2026-07-14 10:34:25
priority: P1
depends_on: []
blocks: [task-06]
requirement_ids: [FR-6]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/mission-summary-card.tsx
goal: >
  新增详情态顶部总览卡组件，一行展示中文状态徽标 + 成败统计
  （只算真分身 role!=="orchestrator"，主控单独展示不计入成败）+
  累计成本（cost_so_far / budget_usd），让非开发者用户一眼看到任务整体状态。
implementation:
  - 新建文件 frontend/src/components/mission-summary-card.tsx，导出 React 组件 MissionSummaryCard，props 为 { mission: Mission }（Mission 类型复用 lib/agent.ts）。
  - 中文状态徽标：用 STATUS_LABEL 映射 mission.status（planning→规划中 / running→运行中 / done→已完成 / degraded→部分完成 / failed→失败 / cancelled→已取消），沿用 mission-console.tsx 既有 STATUS_BADGE 配色（仅换文案不换色）。
  - 成败统计口径（G1 修正，design §5）：const workers = mission.workers.filter(w => w.role !== "orchestrator")；按 worker.status 统计 completed/failed 数，显示「N 分身 · X 成功 Y 失败」。主控（role==="orchestrator"）单独区块展示（状态+角色名），不并入分身的成功/失败计数。例：1 主控(completed) + 3 真 worker(全 failed) → 「3 分身 · 0 成功 3 失败」。
  - 累计成本：复用 mission.cost_so_far / mission.budget_usd 渲染（可直接调用 mission-console.tsx 既有 CostBar，或内联同款进度条；budget 为 null/0 时显「未设预算」）。
  - 主 agent 区块仅展示「主控 + 状态中文徽标」，不渲染其 worker objective/artifacts（那些仍归 WorkerRow，本卡只做总览）。
  - 组件为纯展示组件，不发请求、不持有状态；mission 数据全部从 props 读（轮询刷新由 MissionConsole 父组件负责，本卡只被动渲染）。
  - 文案全程中文，不出现 Coordinator/Worker/orchestrator/daemon 等黑话（黑话替换 design §6：主控/分身/后台）。
acceptance:
  - 组件 MissionSummaryCard 存在且可被 mission-console.tsx 导入；props 仅 { mission: Mission }。
  - 状态徽标显示中文（done→已完成 而非 "done"），配色沿用 STATUS_BADGE。
  - 成败统计只算 role!=="orchestrator" 的真分身；主控单独区块展示其状态，不计入分身成败数。
  - 成本渲染 cost_so_far，budget 存在时显示进度条+百分比，不存在时显「未设预算」。
  - 1 主控 completed + 3 真 worker 全 failed 的样例，显示「3 分身 · 0 成功 3 失败」而非「4 分身 1 成功 3 失败」。
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 后端零改动：summary artifact 已由 FinalizerService.finalize_bootstrap_mission（finalizer.py:183-190）落库，本任务只做前端展示。
  - 文案默认中文（UI 和文档），必要专业术语除外。
  - 不引入新依赖、不改 lib/agent.ts 类型契约（Mission/MissionWorkerRun 复用现成）。
  - 组件纯展示，不持状态不发请求，轮询归父组件。
  - 复用 mission-console.tsx 既有 STATUS_BADGE 配色 / CostBar 样式，避免重复造视觉。
---

# task-05: MissionSummaryCard — 中文状态 + 成败统计 + 成本

新增详情态顶部总览卡。详情态 mission 渲染区（mission-console.tsx:815-881 的 {mission && ...} 块）顶部目前散落着独立 Badge + CostBar + CoordinatorPanel，无统一总览。本任务抽出 `frontend/src/components/mission-summary-card.tsx`，一行收敛「中文状态 + 成败统计 + 成本」，被 task-06 进一步扩展接入 AI 最终结论。

## 关键口径（成败统计 G1 修正，design §5）

「N 分身」只算真 worker（`mission.workers.filter(w => w.role !== "orchestrator")`），沿用 CoordinatorPanel 同款过滤（mission-console.tsx:145）。主控（role==="orchestrator"）单独区块展示，**不计入分身的成功/失败数**。这样 1 主控 completed + 3 真 worker 全 failed 时，统计显「3 分身 · 0 成功 3 失败」，mission 整体状态由后端 derive_status 派生为 failed（前端只读展示，不自行派生）。

## 非目标

- 不渲染主控/分身的 objective/artifacts/日志（归 WorkerRow，task-07）。
- 不实现 AI 最终结论块（task-06 在本卡内补 summary 提取与降级）。
- 不改 mission 派生状态逻辑（后端 mission.py:29 derive_status）。
- 不改 STATUS_BADGE/ROLE_LABEL 定义位置（task-09 统一中文化映射，本任务可先就地内联或导出共享，不阻塞）。
