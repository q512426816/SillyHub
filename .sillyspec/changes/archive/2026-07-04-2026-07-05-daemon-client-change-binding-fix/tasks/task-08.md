---
id: task-08
title: 前端测试更新（create-change 不传 runtime_id）
author: qinyi
created_at: 2026-07-05 00:52:43
priority: P1
depends_on: [task-06]
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/create-change/__tests__/page.test.tsx
goal: "更新 create-change page 测试对齐 task-06（删 runtime_id）"
implementation: "page.test.tsx:146 断言改不带 runtime_id；:163 toHaveBeenCalledWith 删 runtime_id 字段；保留 DAEMON_CLIENT_NO_SESSION 错误引导用例；删 runtime_id 相关 mock"
acceptance: "daemon-client 建变更 page 测试通过（不传 runtime_id）（AC-07）；错误引导用例保留通过"
verify: "pnpm --filter frontend test -- create-change"
constraints: "不改 page.tsx 实现（task-06 负责）"
---

# task-08 — 前端测试更新

## goal
更新 create-change page 测试对齐 task-06（删 runtime_id）（AC-07）。

## 实现步骤
1. `page.test.tsx:146` "daemon-client 工作区且 daemon 在线时走 proxy-create 并带
   runtime_id" 改为 "不带 runtime_id"（断言 proxyCreateChange 调用参数无 runtime_id）。
2. `page.test.tsx:163` `toHaveBeenCalledWith("ws-1", { ... })` 删 runtime_id 字段。
3. 保留 DAEMON_CLIENT_NO_SESSION 错误引导渲染用例（line 202）。
4. 删除 page.tsx 中与 runtime_id 相关的 mock/state（如果 test 引用）。

## 验收标准
- daemon-client workspace 建变更 page 测试通过（不传 runtime_id）（AC-07）。
- 错误引导渲染用例保留通过。

## 验证
- `pnpm --filter frontend test -- create-change`

## 约束
- 不改 page.tsx 实现（task-06 负责）。
