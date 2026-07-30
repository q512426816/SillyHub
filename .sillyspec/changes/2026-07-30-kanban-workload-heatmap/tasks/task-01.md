---
id: task-01
title: schema 新增 WorkloadGridUserRow 与 WorkloadGridResponse（覆盖 FR-02）
title_zh: 看板工时网格响应 schema 新增
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/kanban/schema.py
provides:
  - contract: WorkloadGridUserRow
    fields: [user_id, username, plan_hours, actual_hours]
  - contract: WorkloadGridResponse
    fields: [start_date, end_date, days, users]
goal: >
  在 kanban schema 新增工时网格响应模型，为聚合接口与前端类型生成提供统一数据契约。
implementation:
  - 读 kanban schema 现有 VO 风格保持命名与字段一致
  - 新增 WorkloadGridUserRow 含 user_id username plan_hours actual_hours，工时为日期到人天的字典
  - 新增 WorkloadGridResponse 含 start_date end_date days users
acceptance:
  - 两个新模型字段与 design §7.2 定义一致
  - 模型可被 service 导入且被 OpenAPI 正常生成
verify:
  - cd backend && uv run mypy app/modules/ppm/kanban/schema.py
constraints:
  - 仅新增模型不改动现有 VO
  - 工时单位统一人天，响应中缺省日期视为 0
---
