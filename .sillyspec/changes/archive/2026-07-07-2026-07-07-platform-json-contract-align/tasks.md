---
author: qinyi
created_at: 2026-07-07T23:18:24
change: 2026-07-07-platform-json-contract-align
stage: brainstorm
status: draft
---

# Tasks

> 任务细节（Wave 分组、依赖、步骤）在 plan 阶段展开。此处只列名称、对应文件、覆盖的 FR/D。

| Task | 文件路径 | 覆盖 |
|---|---|---|
| T-01 新增 `DAEMON_STATE_FILENAME` + `DaemonState` 接口 | `sillyhub-daemon/src/spec-sync.ts` | FR-02 |
| T-02 新增 `writeDaemonState`（含 mkdir `.runtime`） | `sillyhub-daemon/src/spec-sync.ts` | FR-02 |
| T-03 删除 `writePlatformConfig` / `readPlatformConfig` / `PlatformConfig` / `PLATFORM_CONFIG_FILENAME` | `sillyhub-daemon/src/spec-sync.ts` | FR-01, FR-05 |
| T-04 改写 `readLocalSpecVersion`（入参→`specCacheRoot`，读 `.runtime/spec-version.json`） | `sillyhub-daemon/src/spec-sync.ts` | FR-03 |
| T-05 改写 `bumpLocalSpecVersion`（同上新位置，保留"不存在则跳过"） | `sillyhub-daemon/src/spec-sync.ts` | FR-03 |
| T-06 改写 `hasUnsyncedLocalChanges`（`synced_at` 从 `{specDir}/.runtime/spec-version.json` 读，删 `opts.rootPath`） | `sillyhub-daemon/src/spec-sync.ts` | FR-04 |
| T-07 `handleInitLease` 第 1 步 `writePlatformConfig` → `writeDaemonState` | `sillyhub-daemon/src/spec-sync.ts` | FR-01, FR-02 |
| T-08 `task-runner.ts:427/448` 调用点入参改 `resolveSpecDir(wsId)` | `sillyhub-daemon/src/task-runner.ts` | FR-03 |
| T-09 `daemon.ts:2816/2849` 调用点入参改 `resolveSpecDir(workspaceId)`（`:2844` pullSpecBundle rootPath 不动） | `sillyhub-daemon/src/daemon.ts` | FR-03 |
| T-10 `test_init_lease.test.ts` 断言更新（写 spec-version.json + 不写 platform.json） | `sillyhub-daemon/tests/test_init_lease.test.ts` | FR-01, FR-02, NFR-01 |
| T-11 `test_spec_version_refresh.test.ts` 路径常量 + fixture 迁移 | `sillyhub-daemon/tests/test_spec_version_refresh.test.ts` | FR-03, NFR-01 |
| T-12 `hasUnsynced` 相关测试 fixture 迁移（`synced_at` 路径） | `sillyhub-daemon/tests/` | FR-04, NFR-01 |
| T-13 全量 vitest 验证零回归 + grep 残留引用 | `sillyhub-daemon` | FR-05, NFR-01 |
| T-14 模块文档 MANUAL_NOTES 补变更索引条目（archive 阶段同步） | `docs/multi-agent-platform/modules/sillyhub-daemon.md` | — |
