---
id: task-06
title: 前端 create-change page + lib/changes.ts 删 runtime_id + api-types 重生成
author: qinyi
created_at: 2026-07-05 00:52:43
priority: P0
depends_on: [task-02]
blocks: [task-08]
allowed_paths:
  - frontend/src/lib/changes.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx
  - frontend/src/lib/api-types.ts
goal: "前端对齐 task-02 删 runtime_id 入参（proxyCreateChange + api-types 重生成）"
implementation: "changes.ts:226 proxyCreateChange 删 runtime_id；create-change/page.tsx:104 调用删 runtime_id + 清理相关 state；api-types.ts OpenAPI 重生成"
acceptance: "daemon-client 建变更不传 runtime_id 调 proxyCreateChange 成功（AC-07）；tsc --noEmit 零错误"
verify: "pnpm --filter frontend tsc --noEmit + pnpm --filter frontend test -- create-change"
constraints: "daemon_id 不在前端传（后端从 binding）；保留 DAEMON_CLIENT_NO_SESSION 中文引导渲染"
---

# task-06 — 前端删 runtime_id 参数 + api-types 重生成

## goal
前端对齐 task-02 后端入参变更：proxy-create 不再传 runtime_id（D-002@v1 / FR-07）。

## 实现步骤
1. `frontend/src/lib/changes.ts:226` `proxyCreateChange` 删 `runtime_id` 入参
   （请求体只传 title/change_type/description）。
2. `frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx:104`
   `proxyCreateChange(workspaceId, { title, change_type, description })`——不再传
   runtime_id。daemon_id 后端从 binding 拿，前端不需传。
3. `frontend/src/lib/api-types.ts`：用 OpenAPI 重生成（`/changes/proxy-create`
   请求体删 runtime_id 字段）。
4. 清理 page.tsx 中获取 runtime_id 的相关逻辑（如选择 runtime 的下拉/state）。

## 验收标准
- daemon-client workspace 建变更页不传 runtime_id，调 proxyCreateChange 成功（AC-07）。
- tsc --noEmit 零错误；api-types 与后端 OpenAPI 一致。

## 验证
- `pnpm --filter frontend tsc --noEmit`
- `pnpm --filter frontend test -- create-change`（task-08 更新测试）

## 约束
- daemon_id 不在前端传（后端从 binding 解析）。
- 保留 DAEMON_CLIENT_NO_SESSION 错误的中文引导渲染。
