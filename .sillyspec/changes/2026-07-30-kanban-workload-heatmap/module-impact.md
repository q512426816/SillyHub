---
author: qinyi
created_at: 2026-08-30 20:10:00
change: 2026-07-30-kanban-workload-heatmap
---

# 模块影响分析（Module Impact）— ppm/kanban 人员工时热力网格

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:ppm | 接口变更+新增 | schema WorkloadGridUserRow/WorkloadGridResponse；service get_workload_grid（剩余负载摊天/覆盖日求和/DateRangeTooLarge）；router GET /kanban/workload-grid；聚合测试 9 例 |
| frontend:lib-ppm | 接口变更 | fetchWorkloadGrid（类型走 gen:types 生成物） |
| frontend:app-ppm-pages | 新增 | page.tsx 双 tab Segmented（默认甘特 + 热力，切热力才取数） |
| frontend:components-ppm | 新增 | kanban-workload-grid 网格组件 + workloadCellColor 锚点偏离式 HSL + getDayStatus 接线（颜色 13 单测） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物（413 schemas） |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `backend modules/ppm.md` | kanban 端点清单已含 workload-grid（scan 收录） | skipped（已同步） |
| `frontend modules/lib-ppm.md` | workload 网格类型 gen:types 说明已收录 | skipped（已同步） |
| `frontend modules/app-ppm-pages.md` | KanbanPage 条目补双视图语义（默认看板+热力网格 Segmented、workloadCellColor） | done（归档期补记） |
