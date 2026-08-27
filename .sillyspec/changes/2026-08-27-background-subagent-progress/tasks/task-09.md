---
id: task-09
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P1
title: gen:types 重生成（frontend api-types.ts + backend openapi.json 提交）
title_zh: gen:types 重生成（frontend api-types.ts + backend openapi.json 提交）
depends_on: [task-05]
blocks: [task-10]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
provides:
  - contract: api_types_regenerated
    fields: [AgentTaskStatusEvent 新字段（含 async）, notify 端点请求体类型]
expects_from:
  - task: task-05
    contract: api_schema
    fields: [openapi 含扩展字段]
goal: |
  前端 API 类型与后端 schema 对齐（CLAUDE.md 规则 21 / NFR-03），为 task-10 提供类型基础。
implementation: |
  1. 确认前端 node_modules 健康（pnpm exec tsc --version 能跑；不健康先 pnpm install --force——CLAUDE.md 规则 21 已知坑）。
  2. cd frontend && pnpm gen:types 生成 src/lib/api-types.ts。
  3. 确认 backend/openapi.json 已含新事件字段（task-05 已导出；本任务核对并一并提交）。
  4. pnpm exec tsc --noEmit 确认无类型破坏。
acceptance: |
  api-types.ts 含 agent_task_status 新字段（grep async/elapsed_ms/last_tool_name 命中）；gen:types 二次运行无 diff（幂等）；既有类型零破坏。
verify: |
  cd frontend && pnpm gen:types && git diff --stat src/lib/api-types.ts（有预期变更后二次跑无新 diff）&& pnpm exec tsc --noEmit。
constraints: |
  禁止手写 api-types.ts 同名接口；node_modules 半坏会产假 CSSProperties 错误（先验健康）。
---
