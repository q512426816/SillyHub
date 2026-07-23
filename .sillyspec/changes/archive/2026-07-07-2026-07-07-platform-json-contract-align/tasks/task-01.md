---
id: task-01
title: spec-sync.ts 新增状态文件层（DAEMON_STATE_FILENAME + DaemonState + writeDaemonState）
author: qinyi
created_at: 2026-07-07 23:26:42
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
provides:
  - contract: writeDaemonState
    fields: [specCacheRoot, state]
  - contract: DaemonState
    fields: [spec_version, synced_at]
  - contract: DAEMON_STATE_FILENAME
    fields: [relative_path]
goal: >
  新增 daemon 独占的状态文件层，取代旧 writePlatformConfig 对 .sillyspec-platform.json 的写入。
implementation:
  - 新增常量 DAEMON_STATE_FILENAME = '.runtime/spec-version.json'
  - 新增接口 DaemonState { spec_version: number; synced_at: string }
  - 新增 writeDaemonState(specCacheRoot, state)：mkdir -p {specCacheRoot}/.runtime（recursive 容忍已存在），写 {specCacheRoot}/.runtime/spec-version.json（2 字段，synced_at 缺省取 new Date().toISOString()）
  - spec_version 取 lease latestSpecVersion 兜底 0
acceptance:
  - 三符号导出且 tsc 类型检查通过
  - writeDaemonState 调用后 {cacheRoot}/.runtime/spec-version.json 存在含 spec_version + synced_at
  - 不触碰 .sillyspec-platform.json
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 仅新增，不改/删现有函数（task-02~05 负责）
  - 跨平台路径用 path.join；mkdir recursive 容忍已存在
---

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `pnpm exec tsc --noEmit` | `DAEMON_STATE_FILENAME`/`DaemonState`/`writeDaemonState` 导出且类型正确 |
| 2 | 调用 `writeDaemonState(cacheRoot, {spec_version: 5})` | `{cacheRoot}/.runtime/spec-version.json` 存在，含 `spec_version:5` + `synced_at`（ISO） |
| 3 | 检查项目根 `.sillyspec-platform.json` | 本函数不触碰该文件 |
