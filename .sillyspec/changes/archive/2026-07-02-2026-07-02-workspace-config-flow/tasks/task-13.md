---
id: task-13
title: backend + daemon 手动同步 outbox（D-012，复用 DaemonChangeWrite）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: [task-09]
blocks: [task-14, task-15, task-16]
allowed_paths:
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/daemon/change_write_router.py
  - sillyhub-daemon/src/task-runner.ts
---

## 目标
「同步到服务器」复用 DaemonChangeWrite outbox（kind=spec-sync）：backend 建行（path_source 分流）+ daemon 拉取 postSpecSync 回灌（D-012）。

## 实现步骤
- backend：新增 `POST /workspaces/{id}/spec-workspace/sync-manual`（或复用 sync 端点扩展）：path_source 分流——server-local 直接 apply_sync 落盘返 done；daemon-client 建 DaemonChangeWrite 行 `kind="spec-sync"`（files 带 workspace_id 元信息），返 task_id。`GET .../pending` 查状态。
- daemon：task-runner 识别 kind=spec-sync 行 → 调 postSpecSync 整树回灌 → complete。
- **kind 字段**：依赖 2026-07-02-change-detail-file-tree-editor 的 kind 列先合；若未合，本变更 task-09 migration 兜底加 kind 列（down_revision 协调）。

## 验收标准
- daemon-client：点同步→建 outbox 行（kind=spec-sync）→ daemon postSpecSync 回灌 → pending→done。
- server-local：直接 apply_sync 落盘返 done。

## 验证方式
`cd backend && uv run pytest app/modules/spec_workspace/tests/test_sync_manual.py -q`（两分支）；`cd sillyhub-daemon && pnpm exec vitest run -k spec-sync`。

## 约束
- kind=spec-sync 是 free-form str 取值（DaemonChangeWrite.kind 现无 CHECK 约束），**零 schema 变更**（若 kind 列已存在）。
- 复用 change-detail-file-tree-editor 的 outbox 状态机/轮询基础设施，不另起表。
