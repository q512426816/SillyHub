---
id: task-04
title: health.ts 示范迁移（手写类型 → 引用 api-types.ts）
author: qinyi
created_at: 2026-07-04T00:51:06
priority: medium
depends_on: [task-03]
blocks: [task-06]
allowed_paths:
  - frontend/src/lib/health.ts
  - backend/app/modules/health/router.py
  - backend/app/modules/health/schema.py
---

## 目标
把 `health.ts` 的手写 interface 改为从 `api-types.ts` 引用，证明闭环 work；若 `/api/health` 无 schema 则后端补响应模型。

## 实现步骤
- 读 `backend/app/modules/health/router.py`，确认 `/api/health` 响应是否有 `response_model`
- 若无（返回 dict）→ 后端补 `HealthResponse` Pydantic 模型并挂到端点 `response_model`（小修，本变更范围内）
- 重跑 `pnpm gen:types` 同步
- 改 `health.ts`：删手写 `HealthResponse` / `SystemStatus` interface，从 `api-types.ts` 的 `components["schemas"]` 引用

## 验收标准
- `health.ts` 类型来自 `api-types.ts`，无手写 interface
- `pnpm typecheck` 通过

## 验证方式
`cd frontend && pnpm typecheck` 退出码 0

## 约束
- 仅迁移 health.ts（D-005@V1，其余 32 模块作后续 task）
- 后端补 health 响应模型是本变更范围小修，非违反「dict→Pydantic 大规模改造」非目标
- 不改 health 返回内容，只让 OpenAPI 有 schema
