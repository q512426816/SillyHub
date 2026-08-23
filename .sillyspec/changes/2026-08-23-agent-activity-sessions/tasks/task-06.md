---
id: task-06
title: 'frontend-gen-types'
title_zh: '前端 gen:types 同步（origin/title/新 schema/内容端点）'
author: qinyi
created_at: 2026-08-23 14:11:00
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-09]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  task-04/05 后端 schema 落地后重新生成前端类型（AgentSessionRead.origin/title、
  agent-logs v2 字段、content 端点），不让类型落后后端（CLAUDE.md 规则 21）。
implementation:
  - 确认 node_modules 健康 → pnpm gen:types → tsc 快速验证
acceptance:
  - api-types 含 origin/title/新字段与 content path；gen:types 幂等；tsc 零错
verify:
  - cd frontend && pnpm typecheck && pnpm gen:types:check
constraints:
  - 生成物禁手写
---

# task-06 补充说明
无。
