---
id: task-07
title: ChangeTaskBoardCard 任务看板摘要卡
title_zh: 任务看板摘要卡（进度条 + 各状态计数 + 打开看板链接，无任务时隐藏）
author: qinyi
created_at: 2026-08-11 11:36:04
priority: P1
depends_on: []
blocks: [task-06]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/changes/detail/change-task-board-card.tsx
  - frontend/src/components/changes/detail/__tests__/change-task-board-card.test.tsx
provides:
  - contract: ChangeTaskBoardCard
    fields: [taskBoard, workspaceId, changeId]
goal: >
  把现 page.tsx 中「任务进度」内联区块（约 :1063-1111）抽成独立组件 ChangeTaskBoardCard，
  放次线侧栏，含总体进度条、各状态计数徽章、「查看看板」链接；无任务时整体隐藏。
implementation:
  - 新建 frontend/src/components/changes/detail/change-task-board-card.tsx，导出 ChangeTaskBoardCard 与 ChangeTaskBoardCardProps
  - Props 三字段 taskBoard（TaskBoard 或 null）、workspaceId、changeId；taskBoard 为 null 或 columns 为空时返回 null 不渲染
  - 总体进度复刻现逻辑 total=各列 count 求和，doneCount=status 为 done 或 completed 列的 count，pct=total 大于 0 时四舍五入百分比
  - 顶部标题「任务进度」+ Link 指向 /workspaces/{workspaceId}/changes/{changeId}/tasks，文案「查看看板」
  - 各状态列用 Badge 渲染计数（done/completed 用 success，in_progress 用 default，blocked 用 destructive，其余 outline），样式与现 page.tsx 一致
  - 新建 __tests__/change-task-board-card.test.tsx 覆盖进度条宽度、各状态计数、无任务隐藏
acceptance:
  - taskBoard 为 null 或 columns 为空时组件渲染为空
  - 传入含多状态列的 taskBoard 时，进度条宽度等于完成数除以总数百分比，各状态计数与徽标颜色正确
  - 「查看看板」链接 href 指向对应 tasks 页
  - cd frontend && pnpm exec tsc --noEmit 通过，新增测试通过
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- change-task-board-card
constraints:
  - 纯展示层抽取，不改 TaskBoard 类型与 getTaskBoard 数据源
  - 样式 className 与现 page.tsx 内联区块保持一致，避免视觉漂移
  - 组件为受控纯渲染，不自己发请求，数据由 page.tsx 注入
---
