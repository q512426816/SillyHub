---
author: qinyi
created_at: 2026-07-07T23:20:00
change: 2026-07-07-platform-json-contract-align
plan_level: light
stage: plan
status: draft
---

# 轻量计划：daemon 退出 .sillyspec-platform.json 写入，spec_version 状态独立

## 来源
直接引用 brainstorm 四件套（`proposal.md` / `design.md` / `requirements.md` / `tasks.md` / `decisions.md`）。D-001@v1 采纳方案 1。详见 changeDir 下各文档，本计划不重新扩写设计。

## 范围
- `sillyhub-daemon/src/spec-sync.ts`（核心：删 / 改 / 新增 / 编排）
- `sillyhub-daemon/src/task-runner.ts`（`:427/448` 调用点）
- `sillyhub-daemon/src/daemon.ts`（`:2816/2849` 调用点；`:2844` pullSpecBundle rootPath **不动**）
- `sillyhub-daemon/tests/test_init_lease.test.ts`
- `sillyhub-daemon/tests/test_spec_version_refresh.test.ts`
- `sillyhub-daemon/tests/`（hasUnsynced 相关 fixture）
- `docs/multi-agent-platform/modules/sillyhub-daemon.md`（archive 阶段 MANUAL_NOTES 补条目）

## Tasks

> 按依赖顺序列出（spec-sync 内部改造 → 跨文件调用点 → 测试 → 验证 → 文档）。同文件 task 顺序执行；task-06/07 依赖 task-02 新签名；task-08 依赖 task-01~07。

- [x] task-01: spec-sync.ts 新增状态文件层 —— `DAEMON_STATE_FILENAME` 常量 + `DaemonState` 接口 + `writeDaemonState`（内部 `mkdir -p .runtime`，spec_version 取 lease 值兜底 0，synced_at 取 ISO 现在）（覆盖：FR-02, D-001@v1）
- [x] task-02: spec-sync.ts 改写 `readLocalSpecVersion` + `bumpLocalSpecVersion` —— 入参 `rootPath`→`specCacheRoot`，读写 `{cacheRoot}/.runtime/spec-version.json`；保留 bump「文件不存在则跳过」语义（覆盖：FR-03）
- [x] task-03: spec-sync.ts 改写 `hasUnsyncedLocalChanges` —— `synced_at` 从 `{specDir}/.runtime/spec-version.json` 读，删 `opts.rootPath`（`pullSpecBundle:148` checker 调用方式不变）（覆盖：FR-04）
- [x] task-04: spec-sync.ts `handleInitLease` 第 1 步 `writePlatformConfig` → `writeDaemonState`（依赖 task-01；pull/post 步骤不变，`config_written` 语义改为「daemon 状态文件已写」）（覆盖：FR-01, FR-02）
- [x] task-05: spec-sync.ts 删除 dead code —— `writePlatformConfig` / `readPlatformConfig` / `PlatformConfig` / `PLATFORM_CONFIG_FILENAME`（依赖 task-04 已替换唯一调用点）（覆盖：FR-01, FR-05）
- [x] task-06: `task-runner.ts:427/448` 调用 `read/bumpLocalSpecVersion` 入参改 `resolveSpecDir(wsId)`（依赖 task-02 新签名；`wsId` 已在作用域 :420）（覆盖：FR-03）
- [x] task-07: `daemon.ts:2816/2849` 调用入参改 `resolveSpecDir(workspaceId)`；`:2844` `pullSpecBundle({rootPath: specRootPath})` **不动**（依赖 task-02；`workspaceId` 已在作用域 :2800）（覆盖：FR-03）
- [x] task-08: 测试更新 —— `test_init_lease.test.ts` 断言改「写 spec-version.json 2 字段 + 不写 .sillyspec-platform.json」+ `test_spec_version_refresh.test.ts` 路径常量与 fixture 迁移 + hasUnsynced 相关测试 fixture 迁移（依赖 task-01~07）（覆盖：FR-01, FR-02, FR-03, FR-04, NFR-01）
- [x] task-09: 全量验证 —— `cd sillyhub-daemon && pnpm test`（vitest 全绿零回归）+ `grep -r "PLATFORM_CONFIG_FILENAME\|writePlatformConfig\|readPlatformConfig\|PlatformConfig" sillyhub-daemon/src` 零命中（注释除外）（覆盖：FR-05, NFR-01）
- [x] task-10: 模块文档 `sillyhub-daemon.md` MANUAL_NOTES 补变更索引条目（archive 阶段同步，execute 不做）（覆盖：—）

## 验收
- **AC-01**：`grep -r "PLATFORM_CONFIG_FILENAME\|writePlatformConfig\|readPlatformConfig\|PlatformConfig" sillyhub-daemon/src` 零命中（解释性注释除外）。
- **AC-02**：daemon 处理 init lease 后**不再**创建/写入 `{rootPath}/.sillyspec-platform.json`（test_init_lease 断言）。
- **AC-03**：`spec-version.json`（`spec_version` + `synced_at`）产生于 `~/.sillyhub/daemon/specs/<ws>/.runtime/`。
- **AC-04**：sillyhub-daemon 全量 vitest 零回归（`pnpm test` 全绿）。
- **AC-05**：`readLocalSpecVersion` / `bumpLocalSpecVersion` 读写新位置，保鲜机制自洽（版本落后 → pull → bump 回写）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（采纳方案 1：daemon 停写 + spec_version 状态独立 + 清理 dead code） | task-01~05, task-09 | AC-01, AC-02, AC-03, AC-04 |
| 覆盖 workspace-config-flow D-010（spec_version 保鲜读取处迁移） | task-02, task-06, task-07 | AC-05 |

## 自检（plan 生成后）
- ✅ 任务数 10 条（≤ light 上限 10）。
- ✅ 所有 task 用 `- [x] task-XX:` checkbox 格式（execute 依赖）。
- ✅ D-001@v1 出现在 Tasks + 覆盖矩阵（decisions.md 当前版本决策全覆盖）。
- ✅ 无 P0/P1 unresolved blocker（D-001@v1 priority 正常）。
- ✅ 依赖关系明确：task-01→04→05（spec-sync 内部链）、task-02→06/07（跨文件签名依赖）、task-01~07→08（测试）、→09（验证）。
- ✅ 来源直接引用 brainstorm 文档，未重新扩写设计。
