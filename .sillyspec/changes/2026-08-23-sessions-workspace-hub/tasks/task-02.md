---
id: task-02
title: 'frontend-gen-types-owner-name'
title_zh: '前端 gen:types 同步 owner_name'
author: qinyi
created_at: 2026-08-23 04:52:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-108@v2]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  task-01 后端字段落地后重新生成前端 OpenAPI 类型（AgentSessionRead 增 owner_name），同变更内提交
  不让类型落后后端形成债（CLAUDE.md 规则 21）。
implementation:
  - 前置确认 node_modules 健康（pnpm exec tsc --version 能跑、.bin 有 shim；半坏报假 CSSProperties 错，必要时 pnpm install --force）
  - pnpm gen:types 重新生成 api-types.ts + backend/openapi.json
  - 生成后 tsc 快速验证无破坏（下游消费在 task-05）
acceptance:
  - api-types.ts 含 owner_name（生成物禁手写）
  - backend/openapi.json 同步；pnpm gen:types:check 无漂移
  - tsc 零错
verify:
  - pnpm typecheck
  - pnpm gen:types:check
constraints:
  - api-types.ts 只能生成禁止手改（CONVENTIONS 框架隐形规则 1）
---

# task-02 补充说明
无。
