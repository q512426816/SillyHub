---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-14
title: gen:types
---

# task-14: gen:types

- **allowed_paths**: `frontend/src/lib/api-types.ts`、`backend/openapi.json`
- **改动**：后端 schema 改完 → `pnpm gen:types`（gen 前确认 node_modules 健康，CLAUDE.md 规则 20）→ 提交 `api-types.ts` + `backend/openapi.json`。
- **完成标准**：gen:types 无 error；类型与后端 schema 一致；`gen:types:check`（git diff --exit-code）通过。
- **依赖**：W1 task-01 + W3 task-09（前后端 schema 都定型）。
