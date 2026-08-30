---
id: task-06
title: kanban client 新增 fetchWorkloadGrid（覆盖 FR-02）
title_zh: 看板工时网格前端取数
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: [task-05]
blocks: [task-09]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - frontend/src/lib/ppm/kanban.ts
expects_from:
  task-05:
    - contract: WorkloadGridResponse
      needs: [days, users]
provides:
  - contract: fetchWorkloadGrid
    fields: [days, users]
goal: >
  在 kanban client 新增工时网格取数函数，按日期范围与过滤条件请求后端并返回网格响应。
implementation:
  - 读 kanban.ts 现有取数函数保持风格一致
  - 新增 fetchWorkloadGrid 传 start end project_id user_ids
  - 用生成的 api-types 类型标注返回
acceptance:
  - fetchWorkloadGrid 返回生成的 WorkloadGridResponse 类型
  - 可选过滤参数与后端端点对齐
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 类型来自 api-types 不手写
  - 仅新增函数不改现有取数
---
