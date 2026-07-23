---
id: task-03
title: 改写 hasUnsyncedLocalChanges（synced_at 改从 .runtime/spec-version.json 读，删 opts.rootPath）
author: qinyi
created_at: 2026-07-07 23:26:42
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
provides:
  - contract: hasUnsyncedLocalChanges
    fields: [specDir]
goal: >
  回灌判断的 synced_at 从 .sillyspec-platform.json 迁到 .runtime/spec-version.json。
implementation:
  - synced_at 改从 join(specDir, DAEMON_STATE_FILENAME) 读
  - 删 opts.rootPath（specDir 即缓存根，自带 .runtime/）
  - pullSpecBundle:148 checker 调用方式 checker(specDir) 不变 → pullSpecBundle 不改
acceptance:
  - hasUnsyncedLocalChanges(specDir) 读 spec-version.json.synced_at
  - opts.rootPath 已移除
  - pullSpecBundle 不改
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 状态文件不存在保守返回 false（不阻塞 pull）
  - pullSpecBundle 不改
---

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `pnpm exec tsc --noEmit` | 签名变更编译通过 |
| 2 | 读 `synced_at` 路径 | 从 `{specDir}/.runtime/spec-version.json` 读，不再读 `.sillyspec-platform.json` |
| 3 | grep `opts.rootPath` | 已移除 |
