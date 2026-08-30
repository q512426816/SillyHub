---
plan_level: full
author: qinyi
created_at: 2026-08-30 17:23:47
---

# 实现计划（Plan）：daemon 自愈两连修

任务名唯一真相在 tasks.md（`- [ ] task-XX: 名称`），本文件 Wave 段纯 ID 引用。

> Wave 划分铁律（TaskCard 步约束）：共享同一文件的任务必须分到不同 Wave
> （`preflight.ts` 由 task-01→02→03 串行、`daemon.ts` 由 task-05→06→07 串行、
> 两个 preflight 测试文件由 task-04 独占）；preflight 侧单测集中落在 task-04。

## 依赖总览

```
preflight 线（src/preflight.ts 串行）         daemon 线（src/daemon.ts 串行）
  task-01 校验器三件套                          task-05 boot 恢复参数化提取
    │                                             │
  task-02 downloadAndReplace 校验+备份  ⟂并行⟂  task-06 触发点+忙门控+401/403
    │                                             │
  task-03 respawn 最后防线+binDir 参数  ⟂并行⟂  task-07 _tryUpdate stop 前主拦截
    │                                             │
  task-04 preflight 两个测试文件全套   ⟂并行⟂   （task-06/07 各自单测随任务）
    └───────────────┬─────────────────────────────┘
                task-08 整体回归（依赖全部）
```

## Wave 1 — 校验器三件套

- task-01

- task-01：`src/preflight.ts` 新增 `MIN_BUNDLE_BYTES = 65_536`、`validateBundleContent(buf)`（≥64KB 且 `BUILD_ID\s*=\s*["']([^"']+)` 可提取，与 `DISK_BUILD_ID_RE` 同款）、`validateBundleOnDisk(binDir, logger, label?)`（读失败视为不过）；纯函数零子进程，仅实现（单测归 task-04）。

**完成标准**：三个新导出编译通过（`pnpm typecheck` 0 错）；不触碰其他函数。

## Wave 2 — downloadAndReplace 校验+备份 ∥ boot 恢复提取

- task-02
- task-05

- task-02：`downloadAndReplace` 在 `writeFile(tmp)` 前调 `validateBundleContent`（不过 → warn `daemon_bundle_validation_failed`（含 size/buildId）+ 清 tmp + 返回 false）；rename 前备份 `target.bak-<yyyyMMdd-HHmmss>`（字典序保留 3 份，同秒同名替换；备份失败 warn 不阻塞）；mcp 伴生同款（fileName 参数既有）。仅实现。
- task-05：`_recoverSessionsOnBoot`（daemon.ts:2348）主体提取为 `_recoverPersistedSessions(trigger: 'boot' | 'heartbeat_recover')`，boot 调用点（1583）传 `'boot'`，`session_recover_start/done` 日志增 `trigger` 字段——**boot 路径行为零变化**（既有用例全绿为证，回归落 task-08 的 daemon-recovery-boot 套件）。

**完成标准**：typecheck 0 错；`tests/interactive/daemon-recovery-boot.test.ts` 全绿（task-05 零变化证据）；两任务文件不相交（preflight.ts / daemon.ts）。

## Wave 3 — respawn 最后防线+binDir ∥ 心跳触发+门控

- task-03
- task-06

- task-03：`respawnDaemonAndExit` spawn 前调 `validateBundleOnDisk`（不过 → error `daemon_self_update_respawn_validation_failed` + 提前 return 不退出）；签名**钉死方案 (a)**：同步 `void` 改 `async … Promise<void>`（两处调用 preflight.ts:110 / daemon.ts:2145/2179 均 fire-and-forget，兼容；plan 审查问题 3 裁定）；`runPreflight(config, logger, binDir?)` 增可选第三参透传（daemon.ts:1525 调用点不改）。仅实现（单测归 task-04）。
- task-06：模块级导出 `RECOVER_AFTER_DEGRADED_MS = 720_000`（先例 `REGISTER_RETRY_BASE_MS` daemon.ts:177-182）；`_sendHeartbeatOnce` 成功分支（3526 重置 failSince 前）插入触发（**不设 `_recoverInFlight` 外层门**，GAP-2）；新增 `_maybeRecoverAfterDegraded(degradedMs)` 忙门控（`_isBusyForUpdate()` 忙 → 置 `_recoverPendingAfterDegraded` + warn `session_recover_deferred_busy`；空闲 → 清标志 + fire `_recoverPersistedSessions('heartbeat_recover')`；主体 finally 复位 `_recoverInFlight`）；`_isBusyForUpdate` 增"恢复在途"判定；401/403 `heartbeat_auth_rejected` 分支（3541-3549）return 前补置 `_heartbeatFailSince`（原 null 时）。单测落 `tests/daemon-heartbeat-pending.test.ts` 与 `tests/integration/selfupdate-scenarios.test.ts`（触发边界/忙推迟/401-403/互斥，该两文件仅本任务触碰）。

**完成标准**：typecheck 0 错；task-06 的两个测试文件新用例绿；两任务文件不相交。

## Wave 4 — preflight 测试全套 ∥ stop 前主拦截

- task-04
- task-07

- task-04：`preflight.test.ts` 与 `preflight-download-replace.test.ts` 集成用例 binDir 隔离 + `validFakeBundle` fixture 合法化（含 download-replace 的 `'// bundle v2'` 13 字节旧 fixture，plan 审查问题 1 补入）+ 校验器/备份轮换/respawn 拦截新用例 + 真实 bin hash 不变回归用例（该两文件仅本任务触碰）。
- task-07：`_tryUpdate` 在 stop() 之前调 `validateBundleOnDisk`（server_command：下载替换成功后、stop 前；disk_change：探测到差异后、stop 前）；不过 → warn `daemon_update_aborted_bad_bundle` + 释放 `_updateBusy` + 清 pending + return（不走 stop/respawn）。**GAP-1 顺序钉扎**：校验放忙终检**之前**或校验后重跑 `_isBusyForUpdate()`——实现时二选一并在代码注释引用 D-009；禁止插在忙终检与 stop 首动作之间。单测落 `tests/daemon-selfupdate-orchestrator.test.ts`（拦截释放所有权可重试 / 好盘正常交接；该文件仅本任务触碰）。

**完成标准**：两 preflight 测试文件全绿；orchestrator 测试全绿；typecheck 0 错；两任务文件不相交。

## Wave 5 — 整体回归

- task-08

- task-08：`pnpm typecheck` + 相关测试文件跑绿——**枚举清单（plan 审查问题 2 补全）**：`tests/preflight.test.ts`、`tests/preflight-download-replace.test.ts`、`tests/daemon-heartbeat-pending.test.ts`、`tests/integration/selfupdate-scenarios.test.ts`、`tests/daemon-selfupdate-orchestrator.test.ts`、`tests/interactive/daemon-recovery-boot.test.ts`（task-05 boot 零变化正主证据）、`tests/daemon-interactive-codex.test.ts`、`tests/integration/resilience-scenarios.test.ts`，另 grep `_recoverSessionsOnBoot|_heartbeatFailSince` 命中的全部文件；真实 bin 防污染回归（测试前后 `~/.sillyhub/daemon/bin/` 文件 hash 不变）；对照 design.md 文件变更清单核对无超范围改动。

**完成标准**：上述全绿；`git status` 改动仅限清单内文件（preflight.ts / daemon.ts / preflight.test.ts / preflight-download-replace.test.ts / daemon-heartbeat-pending.test.ts / integration/selfupdate-scenarios.test.ts / daemon-selfupdate-orchestrator.test.ts）。
