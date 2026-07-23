---
id: task-07
title: daemon.ts:2816/2849 调用 read/bumpLocalSpecVersion 入参改 resolveSpecDir(workspaceId)（:2844 不动）
author: qinyi
created_at: 2026-07-07 23:26:42
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
expects_from:
  - contract: readLocalSpecVersion
    needs: [specCacheRoot]
  - contract: bumpLocalSpecVersion
    needs: [specCacheRoot, newVersion]
goal: >
  interactive 路径保鲜调用点改传 daemon 缓存根，适配 task-02 新签名；pullSpecBundle 的 rootPath 不动。
implementation:
  - daemon.ts:2816 readLocalSpecVersion(specRootPath) → readLocalSpecVersion(resolveSpecDir(workspaceId))
  - daemon.ts:2849 bumpLocalSpecVersion(specRootPath, …) → bumpLocalSpecVersion(resolveSpecDir(workspaceId), …)
  - workspaceId 已在作用域（:2800）
  - :2844 pullSpecBundle({…rootPath: specRootPath}) 保持不变
acceptance:
  - 两调用点入参为 resolveSpecDir(workspaceId)
  - :2844 pullSpecBundle rootPath 不变
  - tsc 编译通过
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - pullSpecBundle 的 rootPath 参数不动（pull 路径解析/mirror 用途，与状态读取正交）
---

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `pnpm exec tsc --noEmit` | 编译通过 |
| 2 | 阅读两调用点（:2816/:2849） | 入参为 `resolveSpecDir(workspaceId)` |
| 3 | 阅读 `:2844` | `pullSpecBundle` 的 `rootPath: specRootPath` 不变 |
