---
id: task-09
title: kanban-workload-grid 工时热力网格组件（覆盖 FR-05/06/07）
title_zh: 工时热力网格组件
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: [task-06, task-07]
blocks: [task-10]
requirement_ids: [FR-05, FR-06, FR-07]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-workload-grid.tsx
expects_from:
  task-06:
    - contract: fetchWorkloadGrid
      needs: [days, users]
  task-07:
    - contract: workloadCellColor
      needs: [bg, fg]
goal: >
  实现工时热力网格组件，按人员乘日期渲染当日工时数字并用颜色编码负荷，区分计划与实际。
implementation:
  - 新增网格组件按 mode 取 plan 或 actual 数据渲染
  - 行渲染人员与甘特一致，列渲染日期范围每日
  - 格内显示工时数字并用 workloadCellColor 染色，休息态灰底
  - 加图例说明锚点偏离式配色与口径边界
acceptance:
  - 人员行与甘特一致，列覆盖日期范围每日
  - 格内工时数字与底色正确，休息态灰底
  - 计划与实际两 mode 渲染正确
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 工时数字始终显示颜色仅作辅助
  - 深底色单元格文字转白保证对比度
---
