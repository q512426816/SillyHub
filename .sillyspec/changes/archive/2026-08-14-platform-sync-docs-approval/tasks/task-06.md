---
id: task-06
title: gen api-types + openapi
title_zh: gen:types 类型同步
author: qinyi
created_at: 2026-08-14 21:55:00
priority: P2
depends_on: [task-04]
blocks: [task-07]
requirement_ids: [FR-08]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  pnpm gen:types 再生成 api-types.ts + openapi.json 并随本变更提交（不让类型落后后端形成债）。
implementation:
  - 先确认 frontend node_modules 健康（pnpm exec tsc --version 能跑；半坏则 pnpm install --force 修）
  - 项目根跑 pnpm gen:types
  - 核对 openapi.json 含 /api/changes/{name}/documents 与 /api/changes/{name}/approval 两 POST schema
acceptance:
  - openapi.json 含两新端点；api-types.ts diff 仅增量
verify:
  - grep openapi.json 两端点路径命中
constraints: 纯生成物，不手写 api-types.ts。
---
