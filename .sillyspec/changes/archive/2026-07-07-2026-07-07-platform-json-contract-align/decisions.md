---
author: qinyi
created_at: 2026-07-07T23:18:24
change: 2026-07-07-platform-json-contract-align
stage: brainstorm
status: draft
---

# Decisions

## D-001@v1: daemon 退出 `.sillyspec-platform.json` 写入，状态独立 + 清理 dead code

**背景**：`.sillyspec-platform.json` 被 sillyspec 工具（写 `{specRoot, runtimeRoot, workspaceId, scanRunId, savedAt}` camelCase）与 sillyhub daemon（写 `{workspace_id, server_origin, strategy, spec_version, cache_root, synced_at}` snake_case，无 `specRoot`）双写同一文件。sillyspec 工具读时必须 `specRoot`（`progress.js:68`），对 daemon 版本 `isPointerCorrupted=true`（`constants.js:68`）→ `PointerUnreachableError` fail-closed 拒跑。

**核实依据**（详见 `docs/sillyspec/platform-json-contract-mismatch.md`）：
1. `readPlatformConfig`（`spec-sync.ts:814`）零调用方 = dead code。
2. daemon 6 字段中 `workspace_id/server_origin/strategy/cache_root` 为 dead-write（daemon 实际从 `config.server_url` / `resolveSpecDir()` 拿）。
3. 真正被读的仅 `spec_version`（`daemon.ts:2816` + `task-runner.ts:427`）与 `synced_at`（`hasUnsyncedLocalChanges:236`）。
4. sillyspec `run` 每次覆盖整文件 → daemon 保留额外字段不可行。

**决策**：方案 1——
- daemon 停止写 `.sillyspec-platform.json`（交 sillyspec 独占）。
- `spec_version` 保鲜状态独立到 `~/.sillyhub/daemon/specs/<ws>/.runtime/spec-version.json`。
- 清理 dead code（`write/readPlatformConfig` + `PlatformConfig` + `PLATFORM_CONFIG_FILENAME` + 4 dead-write 字段）。

**理由**：核实确认 daemon 字段多为 dead-write 且 sillyspec 覆盖使保留不可行，方案 1 彻底消除双写冲突且减负，是唯一既修契约又去技术债的选择。

**否决方案**：
- **方案 2**（保留 `writePlatformConfig` 改 sillyspec 5 字段格式作 fallback pointer）：与 sillyspec 双写冗余，daemon 字段全砍后写入无实际收益；保留无意义调用链。
- **方案 3**（混合格式：sillyspec 5 字段 + daemon 额外字段）：sillyspec 覆盖丢 daemon 字段，需在 sillyspec 跑后补写，时机难控、字段易丢，不稳定。

**覆盖关系**：
- 覆盖 workspace-config-flow **D-010**（`spec_version` 保鲜读 `.sillyspec-platform.json` → 读 `.runtime/spec-version.json`）。
- 不影响 workspace-config-flow D-002（init lease 编排骨架不变，仅 `config_written` 步骤写入目标变更）。

**用户确认**：2026-07-07，Step 6 选定方案 1（推荐），Step 9 确认完整设计。
