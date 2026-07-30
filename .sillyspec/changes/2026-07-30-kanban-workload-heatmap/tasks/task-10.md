---
id: task-10
title: page 计划与实际 tab 视图切换接线（覆盖 FR-01）
title_zh: 看板页工时热力视图切换
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: [task-09]
blocks: [task-11]
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/kanban/page.tsx
goal: >
  在计划与实际两个 tab 各加甘特与工时热力切换，切到热力时取数渲染网格，甘特功能保持不受影响。
implementation:
  - 计划与实际 tab 各加甘特与工时热力视图切换控件
  - 切到工时热力时调用取数并渲染网格组件传对应 mode
  - 切回甘特保持现有渲染与交互
acceptance:
  - 两个 tab 均可切换视图且默认仍是甘特
  - 切回甘特后功能不受影响
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 不改动现有甘特组件逻辑
  - 未切换视图时行为与现状一致
---
