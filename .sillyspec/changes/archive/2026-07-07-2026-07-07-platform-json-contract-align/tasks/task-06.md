---
id: task-06
title: task-runner.ts:427/448 调用 read/bumpLocalSpecVersion 入参改 resolveSpecDir(wsId)
author: qinyi
created_at: 2026-07-07 23:26:42
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
expects_from:
  - contract: readLocalSpecVersion
    needs: [specCacheRoot]
  - contract: bumpLocalSpecVersion
    needs: [specCacheRoot, newVersion]
goal: >
  batch 路径保鲜调用点改传 daemon 缓存根（resolveSpecDir(wsId)），适配 task-02 新签名。
implementation:
  - task-runner.ts:427 readLocalSpecVersion(ctx.rootPath) → readLocalSpecVersion(resolveSpecDir(wsId))
  - task-runner.ts:448 bumpLocalSpecVersion(ctx.rootPath, …) → bumpLocalSpecVersion(resolveSpecDir(wsId), …)
  - wsId 已在作用域（:420），无需新增变量
acceptance:
  - 两调用点入参为 resolveSpecDir(wsId)
  - tsc 编译通过
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 不改 ctx.rootPath 的其它用途（prepareWorkspace 等）
  - 不改同函数内 pullSpecBundle 调用
---

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `pnpm exec tsc --noEmit` | 编译通过 |
| 2 | 阅读两调用点（:427/:448） | 入参为 `resolveSpecDir(wsId)`，非 `ctx.rootPath` |
