---
author: qinyi
created_at: 2026-08-17 10:20:00
repo: main
id: task-09
title: task-09
title_zh: OpenAPI 与 api-types 同步
goal: 后端 schema 改动后生成并提交 openapi.json 与 api-types.ts。
implementation: |
  1. 跑 pnpm gen:types 前先用 pnpm exec tsc --version 检查 node_modules 健康；若异常则 pnpm install --force 后重试。
  2. 跑 pnpm gen:types。
  3. 提交 backend/openapi.json 与 frontend/src/lib/api-types.ts。
acceptance: |
  - 新端点出现在 openapi.json 中；
  - gen:types 后无新增 tsc 错误。
verify: pnpm exec tsc --noEmit
constraints: |
  - 半坏 node_modules 会导致假 CSSProperties 错误，必须先修环境。
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
---

# task-09 OpenAPI 与 api-types 同步
