---
author: qinyi
created_at: 2026-07-14 10:28:00
plan_level: light
---

# 轻量计划（Light Plan）：Agent 团队（Mission）页面重设计

## 来源
brainstorm 结论（design.md / proposal.md / requirements.md / tasks.md / decisions.md D-001~008@v1）。方案 A 单栏流式 + 固定 team，**后端零改动**。

## 范围
- `frontend/src/components/mission-summary-card.tsx`（新增）
- `frontend/src/components/mission-console.tsx`（主重构）
- `frontend/src/app/(dashboard)/workspaces/[id]/missions/page.tsx`（标题区统一）
- `frontend/src/components/__tests__/mission-console.test.tsx`（测试重写）
- 模块：frontend 单模块；后端零改动。

## Tasks
- [x] task-01: 删 mode 选择（`ModeCard` / `mode` state / `if (mode === "team")` 分支）+ `onCreate` 无条件传 `mode="team"` + `main_agent_config`（默认值始终传）+ `worker_preset`（默认 `[]`）；启动按钮文案改「启动」（覆盖：FR-2/FR-5, D-001@v1, G2/G3）
- [x] task-02: 创建态重排——删 `mission-console.tsx:696` 重复 h2；textarea 输入框顶置；placeholder 换人话（无代码路径）；副标题改一句话（覆盖：FR-1, D-004@v1）
- [x] task-03: 历史 Mission 收进顶部「历史(N)▾」下拉按钮（`<details open>` → 默认 close + Dropdown/Popover 浮层）（覆盖：FR-4, D-007@v1）
- [x] task-04: `TeamConfigPanel` 包 `<details>` 默认 close（「高级：手动配分身」）；`workers` state 初始改空数组（默认主 agent 自动拆）（覆盖：FR-3, D-002@v1）
- [x] task-05: 新增 `MissionSummaryCard` 组件——中文状态徽标 + 成败统计（**只算 `role!=="orchestrator"` 真分身，主控单独展示不计入**）+ 累计成本（`cost_so_far` / `budget_usd`）（覆盖：FR-6, D-003@v1, G1）
- [x] task-06: AI 最终结论——提取 `mission.workers.flatMap(w=>w.artifacts).find(a=>a.kind==="summary")?.content_ref` 展示；降级（running/planning 显「进行中，暂无结论」，failed/cancelled 无 summary 显「无最终结论」）（覆盖：FR-6/FR-12, D-003@v1）
- [x] task-07: `WorkerRow` 改造——删 `[role]` 方括号英文代号（mission-console.tsx:299）；`objective` 分工目标包折叠容器默认收起，点开看完整（覆盖：FR-7/FR-8, D-005@v1/D-006@v1）
- [x] task-08: 历史条目 truncate + `title` hover 全文，不撑爆布局（覆盖：FR-11, D-006@v1）
- [x] task-09: `STATUS_LABEL` 中文化映射（mission 级 6 值 + worker 级 5 值）+ UI 黑话替换（Coordinator→主控 / Worker→分身 / daemon→后台 / Mission→任务 / Orchestrator→主控）+ workspace/mission/run 三层标识隐藏（覆盖：FR-9/FR-10, D-005@v1）
- [x] task-10: `page.tsx` 标题区与 mission-console 统一 + 更新 `mission-console.test.tsx`（删 mode 断言；加高级默认折叠 / MissionSummaryCard 总览 / 中文状态 / 分工目标折叠 / 黑话不出现 断言）+ 前端全量 `pnpm test && pnpm lint && pnpm typecheck` 零回归（覆盖：FR 全, NFR-2）

## 验收
- AC-1 创建态无 single/team 切换；输入框顶置；placeholder 人话
- AC-2 「高级：手动配分身」默认折叠；默认不填 worker（主 agent 自动拆）
- AC-3 详情 MissionSummaryCard 显示中文状态 + 成败统计 + 成本 + AI 最终结论
- AC-4 分身角色只显中文，无 `[arch]`/`[orchestrator]` 方括号代号
- AC-5 分身分工目标默认折叠，点开看完整
- AC-6 所有状态词中文（无 degraded/failed/planning 英文露出）
- AC-7 历史默认收起，点顶部「历史(N)」下拉展开
- AC-8 历史条目长描述 truncate，不撑爆
- AC-9 UI 全程不出现 Coordinator/Worker/daemon/role/orchestrator/Mission 黑话
- AC-10 `mission-console.test.tsx` 更新通过 + 前端全量零回归

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 固定 team | task-01 | AC-1 |
| D-002@v1 分身默认自动 | task-04 | AC-2 |
| D-003@v1 总览+AI结论 | task-05, task-06 | AC-3 |
| D-004@v1 单栏流式 | task-02, task-03 | AC-1 / AC-7 |
| D-005@v1 中文化藏黑话 | task-07, task-09 | AC-4 / AC-6 / AC-9 |
| D-006@v1 长文本折叠 | task-07, task-08 | AC-5 / AC-8 |
| D-007@v1 历史收起 | task-03 | AC-7 |
| D-008@v1 范围限定 Mission | 整体非目标（仅 frontend） | §范围 |
