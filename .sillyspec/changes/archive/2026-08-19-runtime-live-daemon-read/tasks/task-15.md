---
schema_version: 1
doc_type: task
id: task-15
title: Sync OpenAPI types
title_zh: 同步 OpenAPI 类型
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 15
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
goal: 前端类型与 backend OpenAPI 一致
implementation: 跑 pnpm gen:types；提交 api-types.ts 与 openapi.json
acceptance: 无手写类型；tsc 0 错
verify: cd frontend && pnpm typecheck
constraints: gen:types 前确认 node_modules 健康
---

# task-15：同步 OpenAPI 类型
