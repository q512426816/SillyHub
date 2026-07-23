---
id: task-12
title: 执行记录详情前端整合（task-plans + problem-list 表格统一）
phase: W5
priority: P1
status: draft
owner: qinyi
estimated_hours: 2
affected_components: [frontend]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/task-plans/page.tsx
  - frontend/src/app/(dashboard)/ppm/problem-list/page.tsx
depends_on: [task-06, task-10]
blocks: [task-13]
goal: "执行记录详情前端整合（task-plans + problem-list 表格统一）"
implementation:
  - "确认 task-06/task-10 详情区已调 /task-execute/page 并渲染表格"
  - "统一列(开始/结束/耗时/说明/结果)，结果 task=[提交|完成]，problem=[完成→待验证|提交→处置中]"
acceptance:
  - "两端详情可见历次执行记录"
  - "vitest 绿"
verify:
  - "cd frontend && pnpm test"
constraints:
  - "复用 /task-execute/page（D-008），不新增端点"
---

## 目标
确认并统一 task-plans / problem-list 执行记录详情区表格（开始/结束/耗时/说明/结果）。

## 依据
design §5.5；D-008。

## steps
1. 确认 task-06（task-plans）+ task-10（problem-list）详情区已调 /task-execute/page 并渲染表格
2. 统一列定义（开始时间/结束时间/耗时/说明/结果），结果列 task=[提交|完成]，problem=[完成→待验证 | 提交→处置中]

## 验收标准
- 两端详情可见历次执行记录
- vitest 绿
