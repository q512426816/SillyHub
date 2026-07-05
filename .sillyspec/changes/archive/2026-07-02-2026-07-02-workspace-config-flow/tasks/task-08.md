---
id: task-08
title: 「初始化」按钮改调 init dispatch + 详情页三态引导（D-002/D-005/D-003@V2）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: [task-02, task-06, task-07]
blocks: [task-17]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/lib/spec-workspaces.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
---

## 目标
详情页「初始化」按钮改调 init dispatch + 轮询；三态引导（未初始化/已初始化未扫描/已扫描）；扫描按钮 owner 门禁前端配合（D-003@V2）。

## 实现步骤
- page.tsx:266 初始化按钮改调 `POST /init`（task-06）+ 轮询 init lease 状态。
- 三态引导：未初始化→「初始化」按钮；已初始化·未扫描→提示「请先扫描」（D-005，不自动扫）；已扫描→就绪态。
- 扫描按钮（page.tsx:286/scan-dialog）：非 owner 禁用 + 提示「仅 owner 可扫描」；owner 点扫描遇 409 弹「已扫过，是否重扫」确认（接 task-02 后端）。
- lib/spec-workspaces.ts 加 initDispatch + 轮询 API。

## 验收标准
- 未初始化→「初始化」按钮；点→轮询→就绪/提示先扫描。
- 非 owner 扫描按钮禁用；owner 已扫→弹确认。

## 验证方式
`cd frontend && pnpm exec vitest run src/app/(dashboard)/workspaces/[id]/page.test.tsx`。

## 约束
- 状态判定用 WorkspaceMemberRuntime.init_synced_at（task-03）+ scan_documents 是否存在。
- 轮询对齐 spec-sync 状态机（2s 间隔 + visibilitychange 暂停）。
