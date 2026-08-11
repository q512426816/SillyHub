---
id: task-06
title: regenerate api types
title_zh: 重新生成前端接口类型
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P0
depends_on: [task-03]
blocks: [task-07, task-08]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  pnpm gen:types 重新生成 api-types.ts 与 backend/openapi.json 并提交。
implementation:
  - 先确认前端 node_modules 健康，跑 pnpm exec tsc --version，不健康则 pnpm install --force
  - 跑 pnpm gen:types 生成 api-types.ts 与 openapi.json
  - 提交两文件
acceptance:
  - api-types.ts 的 AgentProfileCreate/Update/Read 含 llm_provider_id
  - pnpm gen:types:check 绿
verify:
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm gen:types:check
constraints:
  - 规则20，禁止手写 api-types
  - node_modules 健康检查，避免假 CSSProperties 报错
  - 提交 openapi.json 不让类型落后后端
  - 覆盖 NFR-04
---
