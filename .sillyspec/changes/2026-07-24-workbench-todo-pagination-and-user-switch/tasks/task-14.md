---
id: task-14
title: APP 新增「我的待办」卡片 + 分页（覆盖：FR-01）
title_zh: APP workbench — 新增待办卡片（移动端分页）
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-07, task-13]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/m/ppm/workbench/page.tsx
goal: >
  APP 工作台新增「我的待办」卡片（当前缺失），调 fetchWorkbenchTodos，移动端分页（上一页/下一页 + 页码），跟随 targetUserId。
implementation:
  - 新增 TodoCard 子组件（同 page.tsx 内或 _components），调 fetchWorkbenchTodos(targetUserId, page, 10)
  - 内部 page 状态，底部分页（‹ 1/3 ›）
  - 列表项：type 徽标 + 名称，点击按 source 跳转
  - 空态「暂无待办」
  - 排在 ProfileCard 之后、指标卡之前（对齐桌面左栏语义）
acceptance:
  - 出现「我的待办」卡片且带分页
  - 翻页切片正确，total/页码正确
  - targetUserId 变化重载第 1 页
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test app/m/ppm/workbench
constraints:
  - 须在 task-13 之后（同改 page.tsx，依赖其 targetUserId 状态）
  - 复用 fetchWorkbenchTodos，不自写请求
---
