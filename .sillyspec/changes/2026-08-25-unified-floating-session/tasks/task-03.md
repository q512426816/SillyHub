---
id: task-03
title: 'regenerate openapi and frontend api types'
title_zh: 'OpenAPI 与前端类型再生成'
author: 'qinyi'
created_at: 2026-08-25 03:14:30
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-5]
decision_ids: [RULE-21]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
goal: >
  后端 schema 变更后同步生成产物，不让前端类型落后后端（CLAUDE.md 规则 21）。
implementation:
  - 运行后端 openapi 导出脚本
  - cd frontend && pnpm gen:types
  - 提交 backend/openapi.json 与 frontend/src/lib/api-types.ts
acceptance:
  - 生成 SessionCreateRequest 类型含 page_context（PageContextCreateBlock）
  - gen:types 后 tsc 无新错误
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅生成产物，不手写类型
---
# task-03 类型再生成
