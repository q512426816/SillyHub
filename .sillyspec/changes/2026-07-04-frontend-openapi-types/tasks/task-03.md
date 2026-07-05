---
id: task-03
title: 生成首版 api-types.ts 并提交
author: qinyi
created_at: 2026-07-04T00:51:06
priority: high
depends_on: [task-01, task-02]
blocks: [task-04]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
---

## 目标
生成首版 `frontend/src/lib/api-types.ts` 并验证漂移修复（pending 状态）。

## 实现步骤
- `cd frontend && pnpm gen:types`
- 检查生成文件含 `paths` + `components.schemas`
- 搜 `WorkspaceStatus`（或 WorkspaceRead.status）应含 `"pending"`

## 验收标准
- `frontend/src/lib/api-types.ts` 生成
- 文件头是 openapi-typescript 自动生成标识（type-only，零运行时）
- WorkspaceStatus schema 含 `pending`（漂移修复铁证）

## 验证方式
`grep -c "pending" frontend/src/lib/api-types.ts`（应 ≥1）

## 约束
- api-types.ts 提交进 git（D-003@V1）
- 不手改生成文件
- 确认 `.gitignore` 未忽略 `api-types.ts` / `openapi.json`
