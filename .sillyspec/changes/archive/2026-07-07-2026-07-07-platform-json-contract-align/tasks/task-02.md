---
id: task-02
title: 改写 readLocalSpecVersion + bumpLocalSpecVersion（入参 rootPath→specCacheRoot，读写 .runtime/spec-version.json）
author: qinyi
created_at: 2026-07-07 23:26:42
priority: P0
depends_on: []
blocks: [task-06, task-07]
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
provides:
  - contract: readLocalSpecVersion
    fields: [specCacheRoot]
  - contract: bumpLocalSpecVersion
    fields: [specCacheRoot, newVersion]
goal: >
  把 spec_version 保鲜的读/写从 .sillyspec-platform.json 迁到 .runtime/spec-version.json。
implementation:
  - readLocalSpecVersion 入参 rootPath→specCacheRoot，读 join(specCacheRoot, DAEMON_STATE_FILENAME) 的 spec_version（缺失→null）
  - bumpLocalSpecVersion 入参同上，patch 同文件 spec_version + synced_at；保留「文件不存在则跳过」语义
  - 移除 PLATFORM_CONFIG_FILENAME 引用，改用 DAEMON_STATE_FILENAME
acceptance:
  - 两函数读写 .runtime/spec-version.json（非 .sillyspec-platform.json）
  - bump 文件不存在时静默跳过不创建
  - 不改 shouldRefreshSpec
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 异常处理保留（read 返回 null、bump warn 不抛）
  - 不改 shouldRefreshSpec（纯函数）
---

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `pnpm exec tsc --noEmit` | 两函数签名变更编译通过 |
| 2 | 读不存在的 `spec-version.json` | `readLocalSpecVersion` 返回 `null`；`bumpLocalSpecVersion` 静默跳过不创建 |
| 3 | grep 两函数体 | 不再引用 `PLATFORM_CONFIG_FILENAME` / `.sillyspec-platform.json` |
