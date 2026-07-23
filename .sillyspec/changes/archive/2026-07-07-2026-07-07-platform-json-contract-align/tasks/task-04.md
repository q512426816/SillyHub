---
id: task-04
title: handleInitLease 第1步 writePlatformConfig → writeDaemonState
author: qinyi
created_at: 2026-07-07 23:26:42
priority: P0
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
expects_from:
  - contract: writeDaemonState
    needs: [specCacheRoot, state]
goal: >
  init lease 配置写入步骤改用 writeDaemonState，写 daemon 状态文件而非 .sillyspec-platform.json。
implementation:
  - handleInitLease 第1步 writePlatformConfig(params.rootPath, …) → writeDaemonState(resolveSpecDir(params.workspaceId), { spec_version: latestSpecVersion ?? 0 })
  - 生命周期标记 config_written 语义改为「daemon 状态文件已写」
  - pull（pullSpecBundle）/ post（postSpecSync）步骤不变
acceptance:
  - handleInitLease 执行后产生 ~/.sillyhub/daemon/specs/<ws>/.runtime/spec-version.json
  - 不再产生/写 {rootPath}/.sillyspec-platform.json
  - pull/post 编排顺序不变
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 不改 handleInitLease 的 pull/post 编排顺序
  - 任一步硬失败仍 abort（保留原语义）
---

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `pnpm exec tsc --noEmit` | 编译通过 |
| 2 | 执行 `handleInitLease` | 产生 `~/.sillyhub/daemon/specs/<ws>/.runtime/spec-version.json` |
| 3 | 检查 `{rootPath}/.sillyspec-platform.json` | 不被 init lease 创建/写入 |
