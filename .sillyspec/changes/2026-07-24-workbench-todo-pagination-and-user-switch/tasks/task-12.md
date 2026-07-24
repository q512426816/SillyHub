---
id: task-12
title: WEB 前端测试（覆盖：FR-01, FR-02）
title_zh: WEB 单测 — 待办分页 + 切换用户交互
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P1
depends_on: [task-09, task-10]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/workbench/_components/todo-list-panel.test.tsx
  - frontend/src/app/(dashboard)/ppm/workbench/_components/profile-summary-card.test.tsx
goal: >
  为 TodoListPanel 分页与 ProfileSummaryCard 切换用户交互补单测。
implementation:
  - todo-list-panel.test：分页翻页（下一页/上一页切片）、badge=total、空态、targetUserId 变化重载
  - profile-summary-card.test：can_view_others=false 不渲染下拉、true 渲染列表、选中回调
  - mock fetchWorkbenchTodos / fetchWorkbenchSwitchableUsers
acceptance:
  - 分页切片与 total 正确
  - 切换控件显隐与回调正确
verify:
  - cd frontend && pnpm test app/\(dashboard\)/ppm/workbench
constraints:
  - mock 网络层，不真发请求
---
