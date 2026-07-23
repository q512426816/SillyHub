---
id: task-06
title: task-plans/page.tsx 行按钮按状态 + 移除 submit checkbox + 执行记录详情区
phase: W2
priority: P0
status: draft
owner: qinyi
estimated_hours: 3
affected_components: [frontend]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/task-plans/page.tsx
depends_on: [task-05, task-07]
blocks: [task-12]
goal: "task-plans/page.tsx 行按钮按状态 + 移除 submit checkbox + 执行记录详情区"
implementation:
  - "行按钮：未开始→启动(调startTask存task_execute_id)；进行中→执行(开弹窗带id)；已完成→查看记录"
  - "移除 submit checkbox（page.tsx:410/256-264 改 action）"
  - "执行记录详情区：调 GET /task-execute/page?plan_task_id，表格(开始/结束/耗时/说明/结果)"
acceptance:
  - "vitest：按钮按 status 显隐、详情列表渲染历次记录"
verify:
  - "cd frontend && pnpm test task-plans"
constraints:
  - "复用 /task-execute/page（D-008），不新增端点"
---

## 目标
任务行按钮按 status（启动/执行/查看记录）；移除 submit checkbox；执行记录详情区。

## 依据
design §5.2 / §5.5；D-002 / D-008（复用 /task-execute/page）。

## steps
1. 行按钮：未开始→「启动」（调 startTask，存返回 task_execute_id 到行 state）；进行中→「执行」（开 ExecuteTaskDialog 带 task_execute_id）；已完成→「查看记录」（展开详情）
2. 移除 submit checkbox（page.tsx:410 submit:false / 256-264 executePlanTask 调用改 action）
3. 执行记录详情区：调 `GET /task-execute/page?plan_task_id`，表格列（开始时间/结束时间/耗时/说明/结果[提交|完成]）

## 验收标准
- vitest：按钮按 status 显隐、详情列表渲染历次记录
