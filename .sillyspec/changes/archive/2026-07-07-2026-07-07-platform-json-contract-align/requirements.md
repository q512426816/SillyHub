---
author: qinyi
created_at: 2026-07-07T23:18:24
change: 2026-07-07-platform-json-contract-align
stage: brainstorm
status: draft
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| sillyhub-daemon（spec-sync.ts） | 读写自己的 `spec-version.json` 状态文件；退出 `.sillyspec-platform.json` 写入 |
| sillyspec 工具（全局包） | 独占管理 `.sillyspec-platform.json`；其契约为本变更的对齐目标（不可改） |
| backend（init lease 下发方） | 下发 init lease payload（不变），含 `workspaceId` / `rootPath` / `latestSpecVersion` |
| 开发者 | 维护 spec-sync.ts 契约；执行迁移与测试 |

## 功能需求

### FR-01: daemon 停止写 `.sillyspec-platform.json`

daemon 的 init lease 不再写 `.sillyspec-platform.json`，该文件交 sillyspec 工具独占。

**Given** daemon 拉到 init lease（`mode='init'`）
**When** `handleInitLease` 执行第 1 步"配置写入"
**Then** 写入 `~/.sillyhub/daemon/specs/<ws>/.runtime/spec-version.json`（**而非** `{rootPath}/.sillyspec-platform.json`）
**And** `.sillyspec-platform.json` 不被 daemon 创建或修改

### FR-02: `spec_version` 状态独立文件

daemon 的 `spec_version` 保鲜状态存储到独立的 `spec-version.json`。

**Given** `spec-version.json` schema = `{ spec_version: number, synced_at: string }`
**When** init lease 首次写入（`writeDaemonState`）
**Then** 创建 `{specCacheRoot}/.runtime/spec-version.json`（`mkdir -p .runtime`，容忍已存在）
**And** `spec_version` 取 lease `latestSpecVersion` 兜底 `0`
**And** `synced_at` 取当前 ISO 8601 UTC 时间

### FR-03: 保鲜读写迁移到新位置

`readLocalSpecVersion` / `bumpLocalSpecVersion` 读写 `.runtime/spec-version.json`。

**Given** task-runner / daemon 跑 agent/scan 任务前要比对版本
**When** 比对 lease `latestSpecVersion` 与本地 `spec_version`
**Then** `readLocalSpecVersion(resolveSpecDir(wsId))` 读 `{cacheRoot}/.runtime/spec-version.json.spec_version`
**And** 落后则 pull，成功后 `bumpLocalSpecVersion(resolveSpecDir(wsId), newVersion)` 回写 `spec_version` + `synced_at`
**And** 文件不存在时 `bump` 静默跳过（保留原"不主动创建，init 负责"语义）

### FR-04: `hasUnsyncedLocalChanges` 读新位置

`synced_at` 从 `spec-version.json` 读（不再从 `.sillyspec-platform.json`）。

**Given** `pullSpecBundle` 内调 `hasUnsyncedLocalChanges(specDir)` 判断本地有无未回灌改动
**When** 比较 `specDir` 最新文件 mtime 与 `synced_at`
**Then** `synced_at` 从 `{specDir}/.runtime/spec-version.json` 读
**And** `opts.rootPath` 删除（`specDir` 即缓存根，自带 `.runtime/`），调用方 `pullSpecBundle` 不改

### FR-05: dead code 清理

删除 `writePlatformConfig` / `readPlatformConfig` / `PlatformConfig` / `PLATFORM_CONFIG_FILENAME`。

**Given** `sillyhub-daemon/src`
**When** `grep -r "PLATFORM_CONFIG_FILENAME\|writePlatformConfig\|readPlatformConfig\|PlatformConfig"`
**Then** 零命中（历史注释/解释性引用除外）

## 非功能需求

- **NFR-01 零回归**：sillyhub-daemon 全量 vitest 通过。
- **NFR-02 跨平台**：`spec-version.json` 路径用 `path.join`，Windows/Linux/macOS 一致。
- **NFR-03 向后兼容**：旧 `.sillyspec-platform.json`（含 daemon 旧 snake_case 格式）残留无害，daemon 不再读它；不主动清理以免误删 sillyspec pointer。
- **NFR-04 自愈**：`spec-version.json` 缺失时 `bump` 跳过、`read` 返回 null 触发再 pull，保鲜机制自洽。

## D-xxx@vN 覆盖关系

- **D-001@v1（本变更新增）**：采纳方案 1（daemon 停写 + 状态独立 + 清理 dead code）。详见 `decisions.md`。
- **覆盖 workspace-config-flow D-010**：`spec_version` 保鲜读取处从 `.sillyspec-platform.json` 改为 `.runtime/spec-version.json`。
- 不影响 workspace-config-flow D-002（init lease 编排骨架：`config_written → bundle_pulled → local_pushed`，仅 `config_written` 的写入目标变更）。
