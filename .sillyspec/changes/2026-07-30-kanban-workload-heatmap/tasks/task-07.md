---
id: task-07
title: kanban-workload-helpers 颜色映射与工作日接线（覆盖 FR-06/07）
title_zh: 工时网格颜色映射 helper
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: []
blocks: [task-08, task-09]
requirement_ids: [FR-06, FR-07]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-workload-helpers.ts
provides:
  - contract: workloadCellColor
    fields: [bg, fg]
goal: >
  提供工时网格单元格颜色纯函数，按锚点偏离式对工时做绿黄红黑的 HSL 渐变并处理休息态。
implementation:
  - 新增 workloadCellColor 按工时人天做锚点偏离式 HSL 插值返回前景背景色
  - 接线 workday 的 getDayStatus 判断周末与法定假日为休息态
  - 调休补班日按正常工作日染色
acceptance:
  - 0 人天纯绿，1 人天无色，小于 1 绿到黄，大于 1 红到黑
  - 休息态灰底不染色，调休补班正常染色
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 颜色判断先四舍五入到 1 位小数防浮点闪烁
  - 工作日判断复用 workday 单一数据源
---
