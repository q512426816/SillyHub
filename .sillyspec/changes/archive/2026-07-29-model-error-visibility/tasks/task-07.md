---
id: task-07
title: backend 新增 GET /sessions/{id}/runs + SSE 推 error + gen:types
title_zh: 后端暴露运行错误查询端点与 SSE 推送
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: [task-06]
blocks: [task-08]
requirement_ids: [FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
provides:
  - contract: ApiTypesErrorDetail
    fields: [error_detail]
expects_from:
  task-06:
    - contract: CloseInteractiveRunWrite
      needs: [error_detail]
goal: >
  新增 GET /sessions/{id}/runs 返回 error_detail，SSE 推 error 事件，跑 pnpm gen:types 同步前端类型与 OpenAPI。
implementation:
  - router.py 新增 GET /sessions/{id}/runs 端点，响应 run 项含 error_detail
  - router.py:1880 SSE 在 run 失败时推 error 事件（含 ModelError）
  - 跑 pnpm gen:types 同步 backend/openapi.json 与 frontend/src/lib/api-types.ts
  - gen:types 前先确认 frontend node_modules 健康（pnpm exec tsc --version）
acceptance:
  - GET /sessions/{id}/runs 返回 run 列表含 error_detail
  - SSE run 失败时推 error 事件
  - api-types.ts 与 openapi.json 含 error_detail 字段
verify:
  - cd backend && uv run pytest tests/modules/daemon -q --no-cov
  - cd frontend && pnpm gen:types && pnpm typecheck
constraints:
  - gen:types 产出 api-types.ts 与 openapi.json 一次同步（CLAUDE.md 规则20）
  - node_modules 半坏报假 CSSProperties 错时先 pnpm install --force（规则20）
  - 不改 SSE 既有成功事件流
---
