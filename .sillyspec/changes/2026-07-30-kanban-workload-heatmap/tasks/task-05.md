---
id: task-05
title: 跑 pnpm gen:types 提交 api-types 与 openapi.json（覆盖 NFR-03）
title_zh: 前端接口类型生成
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: [task-03]
blocks: [task-06]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
provides:
  - contract: WorkloadGridResponse
    fields: [start_date, end_date, days, users]
  - contract: WorkloadGridUserRow
    fields: [user_id, username, plan_hours, actual_hours]
goal: >
  从后端 OpenAPI 重新生成前端接口类型，让工时网格响应类型可供前端 client 消费，禁止手写。
implementation:
  - 先确认前端 node_modules 健康，能跑 tsc 且 bin 有 shim
  - 运行 pnpm gen:types 重新生成 api-types 与 openapi.json
  - 确认 WorkloadGrid 相关类型出现在生成产物中
acceptance:
  - api-types 含 WorkloadGridResponse 与 WorkloadGridUserRow 类型
  - 生成类型可被 kanban client 正常导入
verify:
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - api-types 禁止手写必须生成
  - node_modules 半坏先用 pnpm install --force 修复
---
