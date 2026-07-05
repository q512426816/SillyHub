---
id: task-07
title: daemon init lease 处理 + .sillyspec-platform.json 写入（D-002/D-009）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: [task-06]
blocks: [task-16]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/interactive/
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/tests/test_init_lease.ts
---

## 目标
daemon 处理 init lease：写 `.sillyspec-platform.json` + pullSpecBundle + postSpecSync + 上报 init_synced_*。

## 实现步骤
- task-runner/interactive 路径识别 init lease：写 `{rootPath}/.sillyspec-platform.json`（{workspace_id, server_origin, strategy, spec_version, cache_root, synced_at}）→ `pullSpecBundle`（复用）→ `postSpecSync`（若本地有改动）→ lease complete 上报 init_synced_at/init_synced_spec_version（backend 更新 WorkspaceMemberRuntime）。
- spec-sync.ts 加 platform.json 读写工具。

## 验收标准
- daemon 拉到 init lease → 写 platform.json（内容含 6 字段）+ pull 文档；complete 后 backend WorkspaceMemberRuntime.init_synced_at 更新。

## 验证方式
`cd sillyhub-daemon && pnpm exec vitest run tests/test_init_lease.ts`。

## 约束
- platform.json 写到成员 rootPath（lease payload 带），不是 daemon 缓存目录。
- init_synced_spec_version = pull 后的 spec_version。
