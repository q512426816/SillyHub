---
author: qinyi
created_at: 2026-07-14 10:22:00
---
# 任务清单（Tasks）— 2026-07-14-missions-page-redesign

实现任务（plan 阶段按依赖分 Wave）。每条标注对应 design.md 章节 + decisions。

## 创建态
- [ ] **task-01** 删 mode 选择：移除 `ModeCard` 组件、`mode` state、`if (mode === "team")` 分支；`onCreate` 无条件传 `mode="team"` + `main_agent_config`（默认值始终传）+ `worker_preset`（默认 `[]`）。（D-001 / G2 / G3，design §4 / §7）
- [ ] **task-02** 创建态重排：删 `mission-console.tsx:696` h2 重复标题；textarea 输入框顶置；placeholder 换人话（无代码路径）；副标题改一句话。（design §4）
- [ ] **task-03** 历史收顶部下拉：历史 `<details open>` 改收起，置入顶部「历史(N)▾」下拉按钮（Dropdown/Popover），点开浮层列表。（D-007，design §4）
- [ ] **task-04** 高级手动配分身折叠：`TeamConfigPanel` 包 `<details>` 默认 close；`workers` state 初始改为空数组（默认主 agent 自动拆）。（D-002，design §4）
- [ ] **task-05** 启动按钮文案改「启动」（删"启动团队"）；费用上限保留。（design §4）

## 详情态
- [ ] **task-06** 新增 `MissionSummaryCard` 组件：中文状态徽标 + 成败统计（**只算 `role!=="orchestrator"` 真分身，主控单独展示不计入**）+ 累计成本（`cost_so_far` / `budget_usd`）。（D-003 / G1，design §5）
- [ ] **task-07** AI 最终结论：提取 `mission.workers.flatMap(w=>w.artifacts).find(a=>a.kind==="summary")?.content_ref` 展示；降级（running/planning 显「进行中，暂无结论」，failed/cancelled 无 summary 显「无最终结论」）。（D-003 / R-01，design §5 / §12）
- [ ] **task-08** `WorkerRow` 改造：删 `[role]` 方括号英文代号（mission-console.tsx:299）；`objective`（分工目标）包折叠容器默认收起，点开看完整。（D-005 / D-006，design §5）
- [ ] **task-09** 历史条目 truncate：objective 加 `truncate` CSS + `title` hover 全文，不撑爆。（D-006，design §5）

## 全局文案 / 状态映射
- [ ] **task-10** `STATUS_LABEL` 中文化映射（mission 级 planning→规划中 / running→运行中 / done→已完成 / degraded→部分完成 / failed→失败 / cancelled→已取消；worker 级 pending→排队中 / running→运行中 / completed→已完成 / failed→失败 / killed→已终止）；UI 黑话替换（Coordinator→主控 / Worker→分身 / daemon→后台 / Mission→任务 / Orchestrator→主控）；workspace/mission/run 三层标识隐藏。（D-005，design §6）

## 收尾
- [ ] **task-11** `missions/page.tsx` 标题区调整（PageHeader h1 与 mission-console 内标题统一，避免重复）。
- [ ] **task-12** 更新 `mission-console.test.tsx`：删 mode 切换相关断言；加高级默认折叠、MissionSummaryCard 总览、中文状态、分工目标折叠、黑话不出现等断言。
- [ ] **task-13** 前端全量测试 + lint + typecheck 零回归（`cd frontend && pnpm test && pnpm lint && pnpm typecheck`）。
