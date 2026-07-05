---
id: task-05
title: 「编辑我的接入配置」入口（已绑定可改 root_path/runtime_id）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: [task-03, task-04]
blocks: [task-17]
allowed_paths:
  - frontend/src/components/workspace-access-guide.tsx
  - frontend/src/components/workspace-binding-guard.tsx
  - frontend/src/components/__tests__/workspace-access-guide.test.tsx
---

## 目标
已绑定成员能在详情页改自己的 root_path/runtime_id/path_source（D-007）。

## 实现步骤
- `WorkspaceAccessGuide` 支持两种模式：首次绑定（unbound，空值）+ 已绑定编辑（回填当前 member binding 值，prop 传入 initial）。
- `WorkspaceBindingGuard` 已绑定时不再 return null，而在详情页规范管理区渲染「编辑我的接入配置」入口（点击展开 AccessGuide 编辑模式）。
- 保存调 `upsertMyBinding`（已存在）。

## 验收标准
- 已绑定成员点「编辑」→ 表单回填当前 runtime_id/root_path/path_source → 改后保存 → PUT /my-binding 成功。

## 验证方式
`cd frontend && pnpm exec vitest run src/components/__tests__/workspace-access-guide.test.tsx`（补编辑模式用例）。

## 约束
- 复用 task-04 的 per-member switcher（编辑入口 + switcher 统一写 my-binding）。
