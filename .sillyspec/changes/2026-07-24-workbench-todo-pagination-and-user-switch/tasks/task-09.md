---
id: task-09
title: ProfileSummaryCard 切换用户下拉（覆盖：FR-02, D-005@v1）
title_zh: WEB 个人信息卡 — can_view_others 时渲染切换用户下拉
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/workbench/_components/profile-summary-card.tsx
goal: >
  ProfileSummaryCard 在 can_view_others=true 时显示「切换用户」下拉，选项=switchable-users + 「我自己」；选中回调 onSwitchUser(targetUserId)。
implementation:
  - 组件接收 can_view_others、switchableUsers、targetUserId、onSwitchUser
  - can_view_others 时渲染下拉（fetchWorkbenchSwitchableUsers 结果 + 「我自己」选项）
  - 选中他人→onSwitchUser(user_id)；选「我自己」→onSwitchUser(null)
  - 空值兜底文案不变
acceptance:
  - can_view_others=false 时不渲染下拉
  - 下拉列出可见用户 + 我自己
  - 选中触发 onSwitchUser 正确值
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test profile-summary-card
constraints:
  - 纯展示+回调，不直接改 page 状态（由 page 处理）
  - 复用现有 Badge/Avatar 视觉
---
