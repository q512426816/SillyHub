---
id: task-07
title: gen:types（api-types.ts+openapi.json）+ lib/quicklog.ts API client（覆盖 FR-04~FR-07）
title_zh: 前端类型生成与 quicklog API client
author: qinyi
created_at: 2026-08-17 00:38:00
priority: P0
depends_on: [task-02, task-05]
blocks: [task-08]
requirement_ids: [FR-04, FR-06, FR-07]
decision_ids: [D-002]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/quicklog.ts
provides:
  - contract: quicklog_frontend_client
    fields: [list_quicklog, get_quicklog_detail, types]
expects_from:
  task-02: [quicklog_push_api]
  task-05: [quicklog_query_api]
goal: >
  后端新端点跑 pnpm gen:types 同步 api-types.ts + backend/openapi.json（规则 21 禁手写），
  新增 frontend/src/lib/quicklog.ts 封装列表/详情 API client。依赖 task-02（POST 端点）+ task-05（GET 端点）保证 openapi 两端点齐。
implementation:
  - 确认前端 node_modules 健康（pnpm exec tsc --version 可跑）后跑 pnpm gen:types，提交 api-types.ts + backend/openapi.json
  - lib/quicklog.ts：QuicklogEntry 类型 + listQuicklog(workspaceId, params) + getQuicklogDetail(workspaceId, qlId)
  - 类型从 api-types.ts operations 引用（不手写 DTO）
acceptance:
  - gen:types 后 tsc 零错（node_modules 健康前提下无假 CSSProperties 错）
  - lib/quicklog.ts 类型全部来自 api-types.ts；列表/详情函数签名正确
  - openapi.json 含新端点
verify:
  - cd frontend && pnpm exec tsc --version && pnpm gen:types && pnpm exec tsc --noEmit
constraints:
  - 不手写 api-types.ts（gen:types 生成）
  - gen:types 前先验 node_modules 健康；半坏则 pnpm install --force
related_tests: []
---
