---
id: task-13
title: OpenAPI 类型重新生成对齐
title_zh: 前端 OpenAPI 类型生成与对齐
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P1
depends_on: [task-05, task-06]
blocks: []
requirement_ids: [NFR-05]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
goal: >
  后端 API 稳定后,重新生成 OpenAPI 类型,对齐 task-09 手写类型,消除类型漂移。
implementation:
  - 启动 backend(或用导出的 openapi.json)运行 pnpm gen:types 生成 api-types.ts
  - 确认 api-types.ts 含关联端点的请求/响应类型
  - 将 task-09 手写类型替换为生成类型(或确认手写类型与生成一致)
acceptance:
  - api-types.ts 含 /workspaces/{id}/ppm-projects 与 /ppm/projects/{id}/workspaces 类型
  - 前端类型检查通过,无类型漂移
verify:
  - "cd frontend && pnpm gen:types && pnpm exec tsc --noEmit"
constraints:
  - 需 backend 提供最新 OpenAPI(启动 backend 或导出 openapi.json)
  - nullable 字段按现有约定 ?? null 处理(memory 类型迁移坑)
---
