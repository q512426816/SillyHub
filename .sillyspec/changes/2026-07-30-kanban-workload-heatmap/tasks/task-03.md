---
id: task-03
title: router 新增 GET kanban workload-grid 端点（覆盖 FR-02）
title_zh: 看板工时网格查询端点
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: [task-02]
blocks: [task-05]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/kanban/router.py
expects_from:
  task-02:
    - contract: WorkloadGridResponse
      needs: [start_date, end_date, days, users]
goal: >
  新增工时网格查询端点，解析日期范围与过滤参数并调用聚合 service 返回响应。
implementation:
  - 在 kanban router 新增 GET kanban/workload-grid 端点
  - Query 参数 start_date end_date 必填，project_id user_ids 可选
  - 复用现有权限依赖与参数解析风格调用 get_workload_grid
acceptance:
  - 端点返回 WorkloadGridResponse 且鉴权与 kanban 其他端点一致
  - 缺 start_date 或 end_date 时返回参数校验错误
verify:
  - cd backend && uv run pytest app/modules/ppm/kanban -q --no-cov
constraints:
  - 路由不自带前缀由 main 统一挂载
  - 仅认证不授权与现有端点一致
---
