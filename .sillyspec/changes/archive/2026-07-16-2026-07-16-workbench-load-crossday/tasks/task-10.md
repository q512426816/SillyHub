---
id: task-10
title: problem-list 前端（处置提交/完成 + 执行记录详情）
phase: W3
priority: P0
status: draft
owner: qinyi
estimated_hours: 3
affected_components: [frontend]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/problem-list/page.tsx
  - frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx
depends_on: [task-08, task-03]
blocks: [task-12]
goal: "problem-list 前端：处置提交/完成 + 执行记录详情"
implementation:
  - "处置表单(_forms.tsx)：提交(completed=false)/完成(completed=true)按钮"
  - "执行记录详情区(page.tsx)：调 GET /task-execute/page?problem_task_id，表格(结果映射完成→待验证/提交→处置中)"
acceptance:
  - "vitest：处置按钮、详情列表渲染"
verify:
  - "cd frontend && pnpm test problem-list"
constraints:
  - "复用 /task-execute/page?problem_task_id（D-008）"
---

## 目标
problem-list 处置交互（提交 completed=false / 完成 completed=true）；执行记录详情区。

## 依据
design §5.3 / §5.5；D-007 / D-008。

## steps
1. 处置表单（_forms.tsx）：提交（completed=false，保持处置中）/ 完成（completed=true，→待验证）按钮
2. 执行记录详情区（page.tsx）：调 `GET /task-execute/page?problem_task_id`，表格（开始/结束/耗时/说明/结果，结果映射完成→待验证 / 提交→处置中）

## 验收标准
- vitest：处置按钮、详情列表渲染
