---
id: task-11
title: WorkbenchTaskTable 透传 targetUserId（覆盖：FR-02, D-004@v1）
title_zh: WEB 我的任务表 — 透传 targetUserId 到 listPersonalPlanTasks
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P1
depends_on: [task-07]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/workbench/_components/workbench-task-table.tsx
goal: >
  WorkbenchTaskTable 接收 targetUserId，透传到 listPersonalPlanTasks，使切换用户后任务表跟随目标用户。
implementation:
  - 组件增 targetUserId prop
  - 内部 fetch listPersonalPlanTasks 时带 targetUserId（undefined=自己，兼容）
  - targetUserId 变化重载
acceptance:
  - 切换用户后任务表显示目标用户任务
  - 不切换时行为不变
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改任务表现有筛选/分页 cap 逻辑（仅加 target 透传）
---
