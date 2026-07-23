---
author: qinyi
created_at: 2026-07-07T23:30:00
change: 2026-07-07-platform-json-contract-align
stage: verify
---

# 验证报告

## 结论

**PASS WITH NOTES** —— daemon 侧实现完成 + 单测（真实文件 IO）全绿 + 设计一致；sillyspec 工具端到端（真跑 `sillyspec platform pointer` 读 daemon 不再写的 `.sillyspec-platform.json`）需部署环境手动验证（本变更无部署环境，遗留）。

## 任务完成度

| Task | 状态 | 说明 |
|---|---|---|
| task-01 | ✅ | writeDaemonState / DaemonState / DAEMON_STATE_FILENAME 新增，落盘 2 字段到 `.runtime/spec-version.json` |
| task-02 | ✅ | read/bumpLocalSpecVersion 入参 `specCacheRoot`，读写新位置，保留"不存在则跳过" |
| task-03 | ✅ | hasUnsyncedLocalChanges `synced_at` 迁新位置，删 `opts.rootPath` |
| task-04 | ✅ | handleInitLease 第 1 步 `writePlatformConfig` → `writeDaemonState` |
| task-05 | ✅ | 删除 writePlatformConfig / readPlatformConfig / PlatformConfig / PLATFORM_CONFIG_FILENAME（grep 代码零残留） |
| task-06 | ✅ | task-runner.ts:427/448 入参改 `resolveSpecDir(wsId)` |
| task-07 | ✅ | daemon.ts:2816/2849 入参改 `resolveSpecDir(workspaceId)`；:2844 pullSpecBundle rootPath 未动 |
| task-08 | ✅ | 3 测试文件重写（test_init_lease / test_spec_version_refresh / test_pull_before_push） |
| task-09 | ✅ | 全量 vitest 1831 passed / 0 failed；grep 残留零（代码） |
| task-10 | ⚠️ | 模块文档 MANUAL_NOTES 留 archive 阶段（plan 设计，execute 不做） |

完成率 9/10（task-10 按 plan 留 archive）。

## 验收标准达成（design §10）

- **AC-01** grep 代码零残留 ✅ —— `grep -r "PLATFORM_CONFIG_FILENAME\|writePlatformConfig\|readPlatformConfig\|PlatformConfig" sillyhub-daemon/src` 代码零命中（剩余为 D-001@v1 解释性注释 + api-types.ts:368 OpenAPI 生成文件 docstring 过时，下次 `gen:types` regenerate 更新，不在本变更范围）。
- **AC-02** daemon 不写 `.sillyspec-platform.json` ✅ —— handleInitLease 改 writeDaemonState（test_init_lease 验证 result.daemonState + 不产生 rootPath/.sillyspec-platform.json）。
- **AC-03** spec-version.json 2 字段落盘 `.runtime/` ✅ —— writeDaemonState 单元测试（tmp specCacheRoot）+ handleInitLease 测试（真实 ~/.sillyhub/daemon/specs/<ws>/.runtime/spec-version.json）验证 spec_version + synced_at。
- **AC-04** 全量 vitest 零回归 ✅ —— 106 files / 1831 passed / 8 skipped / 0 failed。
- **AC-05** 保鲜 read/bump 自洽 ✅ —— read 落后/null → pull → bump 回写（test_spec_version_refresh D-010 端到端序列覆盖）。

## Runtime Evidence

```
$ cd sillyhub-daemon && pnpm typecheck
> tsc --noEmit
exit 0   # 注释清理后复跑，类型零错误

$ cd sillyhub-daemon && pnpm exec vitest run
Test Files  106 passed (106)
     Tests  1831 passed | 8 skipped (1839)
  Duration  176.43s
# 关键改动测试：
#   test_init_lease.test.ts          13 passed（handleInitLease 真实文件 IO + writeDaemonState 单元）
#   test_spec_version_refresh.test.ts 21 passed（read/bump 迁新位置全分支 + D-010 端到端序列）
#   test_pull_before_push.test.ts    10 passed（hasUnsyncedLocalChanges 新签名 + newestMtime 排除 .runtime/）

$ grep -rn "PLATFORM_CONFIG_FILENAME\|writePlatformConfig\|readPlatformConfig\|PlatformConfig" sillyhub-daemon/src
# 代码零命中（仅注释行：D-001@v1 历史说明）
```

## 对照设计

- **design §6 文件变更清单**：spec-sync.ts / task-runner.ts / daemon.ts / 3 测试 全改 ✅
- **design §7 接口定义**：writeDaemonState(specCacheRoot, state) / DaemonState{spec_version, synced_at} / DAEMON_STATE_FILENAME='.runtime/spec-version.json' / read-bump(specCacheRoot) / hasUnsynced(specDir) 签名全落地 ✅
- **design §7.5 生命周期契约表**：init lease `config_written` → writeDaemonState 写状态文件 + pull + post ✅
- **D-001@v1 三要点**：daemon 停写 / spec_version 状态独立 / 清理 dead code 全落地 ✅
- **覆盖 workspace-config-flow D-010**：spec_version 保鲜读取处从 `.sillyspec-platform.json` 迁 `.runtime/spec-version.json` ✅

## 偏差：D-001@v1 连带修复（design §11 自审遗漏）

**newestMtime 排除 `.runtime/` 子目录**（spec-sync.ts）：D-001@v1 把 `synced_at` 移入 `specDir/.runtime/spec-version.json` 后，`newestMtime(specDir)` 会扫到 spec-version.json 自身，导致 `hasUnsyncedLocalChanges` 的信号 2（`localMtime > syncedAtMs`）因毫秒级 mtime 差恒判 true → 误触发 pullSpecBundle 内 D-008 pull 前回灌 post（test_init_lease 初版 4 failed 正是此因）。

修复 = `newestMtime` 递归时跳过 `.runtime/` 子目录（daemon 运行时产物，非 spec 文档）。这是 D-001@v1 的必要语义保持（synced_at 移入 specDir 后，mtime 比较必须排除承载 synced_at 的 .runtime/）。design §11 自审未列出此连带点（遗漏），已补实现 + test_pull_before_push / test_init_lease 验证不回归。

## 风险与遗留

**change_risk_profile：中**。design 触发 daemon/lease/lifecycle 关键词（风险门控要求"生命周期端到端验证"），但实际改动是文件 IO 路径迁移 + 函数签名 + dead code 清理，**无 session/lease 状态机或跨进程协议变更**（init lease 编排骨架 config_written → bundle_pulled → local_pushed 不变，仅 config_written 写入目标换文件）。

**遗留端到端验证**（需部署环境）：
1. 真跑 daemon init lease（backend `start_init_dispatch` → daemon `handleInitLease` 写 `~/.sillyhub/daemon/specs/<ws>/.runtime/spec-version.json`）。
2. sillyspec 工具读 pointer 端到端：daemon 不再写 `.sillyspec-platform.json` → sillyspec `platform pointer` 读它不再因 daemon 字段缺失 fail-closed（仅 sillyspec 自己写的格式存在）。
3. 日常保鲜端到端：agent/scan 任务前 `readLocalSpecVersion` 读 spec-version.json 比对 lease latestSpecVersion → 落后 pull → bump 回写。

本 verify 的集成证据为 **daemon 侧单测（真实文件 IO + mock client）**，覆盖 handleInitLease 编排（成功/404 容错/5xx abort/post 软失败）+ writeDaemonState 落盘 + read/bump/hasUnsynced 全分支。sillyspec 侧端到端未覆盖（无 sillyspec 工具集成测试环境）。

**部署注意**：daemon 改动需 `pnpm bundle` + rebuild backend 镜像（同步分发物）+ 重启 daemon（记忆 [[daemon-self-update-downgrades-manual-bundle]]：光 cp bundle 无效，daemon 启动按 backend manifest 对齐）。旧 `.sillyspec-platform.json`（daemon 曾写的 snake_case 格式）残留无害（daemon 删除读取路径后不再读；sillyspec 会覆盖或已覆盖）。

## provides/expects_from 对账（plan-postcheck 已验证）

- task-01 provides `writeDaemonState[specCacheRoot, state]` / `DaemonState[spec_version, synced_at]` / `DAEMON_STATE_FILENAME[relative_path]` → task-04 expects `writeDaemonState{needs:[specCacheRoot, state]}` ✅
- task-02 provides `readLocalSpecVersion[specCacheRoot]` / `bumpLocalSpecVersion[specCacheRoot, newVersion]` → task-06/07 expects 同 ✅
