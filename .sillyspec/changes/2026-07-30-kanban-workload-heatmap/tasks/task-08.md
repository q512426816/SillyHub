---
id: task-08
title: kanban-workload-helpers 颜色单测（覆盖 FR-06, R-07）
title_zh: 工时网格颜色映射单测
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-06]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-workload-helpers.test.ts
goal: >
  用颜色映射单测钉死锚点偏离式各档与休息态边界，防止配色回归。
implementation:
  - 覆盖 0 人天小于 1 等于 1 大于 1 大于等于 3 各档颜色
  - 覆盖周末法定假日休息态与调休补班
  - 覆盖 0.95 与 1.04 等浮点边界
acceptance:
  - 各档颜色与锚点偏离式规则一致
  - 休息态灰底调休补班正常
  - 全部断言通过
verify:
  - cd frontend && pnpm test kanban-workload-helpers
constraints:
  - 不改实现来凑测试通过
  - 用 jsdom 环境运行组件测试约定
---
