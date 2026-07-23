---
author: qinyi
created_at: 2026-07-07T23:18:24
change: 2026-07-07-platform-json-contract-align
stage: brainstorm
status: draft
---

# Proposal

## 动机

`.sillyspec-platform.json` 被 sillyspec 工具（全局包 v3.22.5，不可改）与 sillyhub daemon（`spec-sync.ts`）**同名同位置双写**，字段契约互不兼容：sillyspec 写 `{specRoot, …}` camelCase，daemon 写 `{workspace_id, …}` snake_case（无 `specRoot`）。sillyspec 工具读时必须 `specRoot`（`progress.js:68`），缺则 `PointerUnreachableError` fail-closed 拒跑。新工作区 init 后、sillyspec 还没跑就被读时即崩溃。

## 关键问题（为什么现有方案不够）

1. **契约不兼容导致拒跑**：daemon 写的版本 `isPointerCorrupted=true`（`constants.js:68`），sillyspec 直接拒跑并提示 `sillyspec platform pointer --cleanup`。
2. **daemon 字段大量 dead-write**：6 字段中 `workspace_id/server_origin/strategy/cache_root` 写后从无人读（`readPlatformConfig` 零调用 = dead code），真正被读的只有 `spec_version`（保鲜）和 `synced_at`（回灌判断）。
3. **sillyspec 覆盖使"混合格式"不可行**：sillyspec `run` 每次用 5 字段覆盖整文件，daemon 即使补 `specRoot`，自己的额外字段也会被冲掉。

## 变更范围

- daemon 停止写 `.sillyspec-platform.json`（交 sillyspec 工具独占）。
- daemon 的 `spec_version` 保鲜状态迁到 `~/.sillyhub/daemon/specs/<ws>/.runtime/spec-version.json`（2 字段：`spec_version` + `synced_at`）。
- 清理 dead code：`writePlatformConfig` / `readPlatformConfig` / `PlatformConfig` 接口 / `PLATFORM_CONFIG_FILENAME` 常量 + 4 个 dead-write 字段。
- `readLocalSpecVersion` / `bumpLocalSpecVersion` / `hasUnsyncedLocalChanges` 改读写新位置（入参 `rootPath` → `specCacheRoot`）。
- 调用点 `task-runner.ts:427/448` + `daemon.ts:2816/2849` 入参改 `resolveSpecDir(wsId/workspaceId)`。
- 新增 `writeDaemonState` + `DaemonState` + `DAEMON_STATE_FILENAME`；`handleInitLease` 第 1 步替换。
- 测试更新（`test_init_lease` / `test_spec_version_refresh` / `hasUnsynced` 相关）。

## 不在范围内（显式清单）

- 不改 sillyspec 工具（全局第三方包，单向对齐）。
- 不迁移现有 `.sillyspec-platform.json`（daemon 删除读取路径后旧文件自然失效；sillyspec 格式文件由 sillyspec 继续管）。
- 不改 spec 同步传输层（tar bundle、`pullSpecBundle` / `postSpecSync` / `syncSpecTreeIfNeeded`）。
- 不改 workspace-config-flow 其它决策（D-002 init lease 编排骨架不变，仅替换第 1 步写入目标）。
- 不改 backend（init lease payload 不变）/ frontend（无 UI）/ deploy。
- 不主动清理用户项目里的旧 `.sillyspec-platform.json`（避免误删 sillyspec 的 pointer）。

## 成功标准（可验证）

- `grep -r "PLATFORM_CONFIG_FILENAME\|writePlatformConfig\|readPlatformConfig\|PlatformConfig" sillyhub-daemon/src` 零命中（注释解释除外）。
- daemon 处理 init lease 后**不再**创建/写入 `{rootPath}/.sillyspec-platform.json`。
- `spec-version.json`（2 字段）产生于 `~/.sillyhub/daemon/specs/<ws>/.runtime/`。
- sillyhub-daemon 全量 vitest 零回归。
- 新工作区 init 后，`.sillyspec-platform.json`（sillyspec 写）与 `spec-version.json`（daemon 写）互不干扰，sillyspec 读 pointer 不再 fail-closed。
