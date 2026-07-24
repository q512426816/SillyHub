---
id: task-10
title: TodoListPanel 自带 fetch + 分页（覆盖：FR-01, D-001@v1）
title_zh: WEB 我的待办 — 改自带 fetch /workbench/todos + 分页器（默认10条/页）
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/workbench/_components/todo-list-panel.tsx
goal: >
  TodoListPanel 由纯展示改为自带 fetch：调 fetchWorkbenchTodos(targetUserId, page, page_size)，默认 10 条/页，底部分页器上一页/下一页 + 共 total 条，badge=total。
implementation:
  - 组件接收 targetUserId，内部维护 page 状态（默认1）
  - useEffect 调 fetchWorkbenchTodos(targetUserId, page, 10)，独立 loading/error
  - 渲染当前页 items + 分页器（上一页/下一页/第N/M页·共total条）
  - badge 显示 total；空态「暂无待办」
  - 点击待办跳转逻辑保留（plan_task→task-plans，problem→problem-list）
acceptance:
  - 默认每页 10 条，可翻页，切片正确
  - badge=total（非当前页条数）
  - targetUserId 变化重载第 1 页
  - 空态正确
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test todo-list-panel
constraints:
  - 不再从 page 接收 todos prop（契约变更，page.tsx 同步拆开 task-08 处理）
  - 分页 page_size 固定 10（默认）
---
