---
id: task-08
title: WEB page 状态 targetUserId（覆盖：FR-02）
title_zh: WEB workbench page — targetUserId 状态透传 + 查看他人提示条
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/workbench/page.tsx
goal: >
  WEB 工作台 page 维护 targetUserId 状态（null=自己），透传给 profile/summary/calendar/todos/task 全部 fetch；查看他人时顶部显示提示条 + 返回我自己。
implementation:
  - 新增 targetUserId 状态，null=自己
  - loadProfile/loadSummary/loadCalendar 传 targetUserId
  - TodoListPanel/WorkbenchTaskTable 接收 targetUserId
  - targetUserId≠null 时顶部提示条「正在查看 XX 的工作台 · [返回我自己]」，点返回清空
  - summaryRange/calendarMonth 切换仍按 target 重载
acceptance:
  - 切换 targetUserId 后全部 fetch 带 target_user_id
  - 提示条显示目标姓名 + 返回按钮可用
  - 不切换时行为与旧版一致
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test app/\(dashboard\)/ppm/workbench
constraints:
  - targetUserId 仅在 can_view_others 时可被设置（由 task-09 控件触发）
  - 兼容旧 profile（can_view_others ?? false）
---
