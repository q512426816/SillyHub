---
id: task-14
title: frontend「同步到服务器」按钮 + 状态机轮询（D-012）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P1
depends_on: [task-13]
blocks: [task-17]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/lib/spec-workspaces.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/page-sync.test.tsx
---

## 目标
就绪态加「同步到服务器」按钮 + 状态机轮询（D-012），对齐 change-detail-file-tree-editor 状态机。

## 实现步骤
- page.tsx 就绪态加「同步到服务器」按钮 → 调 task-13 的 POST sync-manual → 返 pending 后轮询 GET pending 直到 done/failed。
- 状态机：idle→syncing→done|failed；2s 间隔 + 5min 上限 + visibilitychange 暂停（对齐 change-detail D-001/R-06）。
- lib/spec-workspaces.ts 加 syncManual + listPendingSync API。

## 验收标准
- 点同步→「同步中」→轮询→「已同步」/「失败」。
- 页面不可见停止轮询；5min 上限提示「仍在排队」。

## 验证方式
`cd frontend && pnpm exec vitest run src/app/(dashboard)/workspaces/[id]/__tests__/page-sync.test.tsx`。

## 约束
- 轮询参数与 change-detail-file-tree-editor 一致（复用哲学，避免两套节奏）。
