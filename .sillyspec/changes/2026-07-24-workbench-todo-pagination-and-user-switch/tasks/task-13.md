---
id: task-13
title: APP page 状态 + ProfileCard 切换入口（覆盖：FR-02）
title_zh: APP workbench — targetUserId 状态 + ProfileCard 切换 sheet
author: qinyi
created_at: 2026-07-24 09:07:27
priority: P0
depends_on: [task-07]
blocks: [task-14]
requirement_ids: [FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/app/m/ppm/workbench/page.tsx
goal: >
  APP 工作台 page 维护 targetUserId 状态，透传 profile/指标/日历/待办；ProfileCard 加「切换查看其他成员」入口（底部 sheet），can_view_others 时显示。
implementation:
  - page 增 targetUserId 状态，透传 loadProfile/loadSummary/loadCalendar
  - ProfileCard 接收 can_view_others + switchableUsers，true 时渲染「切换查看其他成员 ›」
  - 点击弹出底部 sheet（复用 mobile 组件）列出可见用户 + 我自己
  - 选中→setTargetUserId；切回自己→null；查看他人时卡片标题或提示区分
acceptance:
  - can_view_others=false 不显示切换入口
  - sheet 列出可见用户，选中后全工作台跟随 target
  - 返回我自己可用
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test app/m/ppm/workbench
constraints:
  - 触摸热区 ≥44px、正文 ≥14px（对齐现有 APP 规范）
  - 复用 MobileCard/sheet 风格，不复用桌面组件
---
