---
id: task-04
title: WorkspaceDaemonSwitcher per-member 化（D-011）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: []
blocks: [task-05, task-17]
allowed_paths:
  - frontend/src/components/workspace-daemon-switcher.tsx
  - frontend/src/components/__tests__/workspace-daemon-switcher.test.tsx
---

## 目标
`WorkspaceDaemonSwitcher` 从改 workspace 全局 daemon_runtime_id 改为改 per-member runtime_id（D-011），与编辑入口统一。

## 实现步骤
- `handleSwitch`（workspace-daemon-switcher.tsx:98）从 `updateWorkspace(workspaceId, {daemon_runtime_id})` 改 `upsertMyBinding(workspaceId, {runtime_id})`。
- 文案保持「切换守护进程」；props 去掉 workspace 级 currentRuntimeId，改用当前用户 member binding。
- 测试（__tests__/workspace-daemon-switcher.test.tsx）改 mock upsertMyBinding + 断言。

## 验收标准
- switcher 改的是当前用户 member binding 的 runtime_id（PUT /my-binding），不写 workspace 全局列。

## 验证方式
`cd frontend && pnpm exec vitest run src/components/__tests__/workspace-daemon-switcher.test.tsx`。

## 约束
- 不破坏现有「online 排前 + 状态徽标」交互（D-011 只改写入目标）。
