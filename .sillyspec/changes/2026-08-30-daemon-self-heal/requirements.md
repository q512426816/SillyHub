---
author: qinyi
created_at: 2026-08-30 17:21:47
---

# 需求（Requirements）

来源：design.md（经 Design Grill 两轮审查修订，D-001~D-009）。

## FR-01 心跳恢复主动 recover

daemon 心跳从失败恢复（`_sendHeartbeatOnce` 成功分支，daemon.ts:3526 重置
`_heartbeatFailSince` 前）且 degraded 累计 >720s（`RECOVER_AFTER_DEGRADED_MS`，
模块级导出常量）时，自动触发本地持久化会话恢复：复用 boot 恢复链
（`_recoverPersistedSessions('heartbeat_recover')`，由 `_recoverSessionsOnBoot`
参数化提取，boot 路径行为零变化），suspended → reconnecting → active。
degraded ≤720s 不触发；本地无记录零成本跳过。触发点不设 `_recoverInFlight`
外层门（Grill GAP-2），恢复在途由忙门控统一收口。

## FR-02 恢复忙门控（推迟无损）

触发时检查 `_isBusyForUpdate()`（在跑 interactive turn / 在跑 batch lease /
恢复在途）：忙则置 `_recoverPendingAfterDegraded = true` 并 warn
（`session_recover_deferred_busy`），不清标志；心跳每拍成功路径复查该标志，
不再忙时触发恢复并清标志。断连期间本地仍在跑的长 turn 不被恢复链驱逐终止。

## FR-03 凭证断连补覆盖

`_sendHeartbeatOnce` 失败路径 `heartbeat_auth_rejected`（401/403）分支 return
前补置 `_heartbeatFailSince`（原 null 时才置，非 null 保持原值）。凭证断连
>720s 恢复后同样触发 recover；现有 FATAL 日志语义不变。

## FR-04 恢复与 selfupdate 双向互斥

`_recoverInFlight` 期间 `_isBusyForUpdate()` 返回 true（selfupdate 推迟走既有
30s 复查）；selfupdate 已过忙判定进入 stop 流程后无恢复触发点（心跳已停）。

## FR-05 bundle 内容校验器

`preflight.ts` 导出 `validateBundleContent(buf): {ok, buildId, size}`：buffer
≥ `MIN_BUNDLE_BYTES`（65536）**且** 正则 `BUILD_ID\s*=\s*["']([^"']+)` 可提取
（与 `DISK_BUILD_ID_RE` 同款）。导出 `validateBundleOnDisk(binDir, logger,
label?): Promise<boolean>`（读失败视为不过）。纯函数零子进程，跨
Windows/Linux/macOS 行为一致。

## FR-06 写入校验 + 备份轮换

`downloadAndReplace` 在 `writeFile(tmp)` 前调用 `validateBundleContent`，不过 →
warn（`daemon_bundle_validation_failed`，含 size/buildId）+ 清理 tmp + 返回
false（不 rename 不 respawn）。校验通过且 rename 前 target 存在 → 复制为
`target.bak-<yyyyMMdd-HHmmss>`，同前缀保留最近 3 份（字典序取尾，同秒视为同名
替换），超出清理；备份失败 warn 不阻塞替换。mcp-server.js 伴生同款。

## FR-07 respawn 双层拦截

- 主拦截（D-009）：`_tryUpdate` 在 stop() 之前调 `validateBundleOnDisk`，不过 →
  warn（`daemon_update_aborted_bad_bundle`）+ 释放 `_updateBusy` + 清 pending +
  return（不走 stop/respawn，旧进程完整在线可重试）。**顺序钉扎（GAP-1）**：
  校验必须在忙终检之前或校验后重跑 `_isBusyForUpdate()`，禁止插在忙终检与
  stop() 之间（不得破坏"终检与 stop 首动作间无 await"前作不变量）。
- 最后防线（D-005）：`respawnDaemonAndExit` spawn 前同款校验，不过 → error
  （`daemon_self_update_respawn_validation_failed`）+ 提前 return 不退出；返回
  类型维持 void。覆盖 `runPreflight` 启动路径（preflight.ts:110 调用，无 stop）。

## FR-08 测试隔离（根因修复）

`runPreflight(config, logger, binDir?)` 增可选第三参透传（生产调用点
daemon.ts:1525 不传，行为不变）。preflight.test.ts 全部 `runPreflight` 集成
用例传 `makeTmpDir()`；既有 `NEW BUNDLE BODY` fixture 换合法假 bundle
（`validFakeBundle` helper：≥64KB 且含 `BUILD_ID="test-<id>"`）。

## FR-09 测试覆盖

- 触发边界：>720s 触发 / ≤720s 不触发 / 无记录零成本。
- 忙推迟：忙置 pending、空闲复查补触发、恢复在途算忙。
- 401/403 断连恢复后触发；凭证日志语义不变。
- 校验器：好/坏内容（<64KB / 无 BUILD_ID / 合法）。
- 下载拦截：坏内容不落盘不留 tmp；备份轮换 3 份上限与清理。
- respawn：盘上坏 bundle 拦截不退出；`_tryUpdate` 主拦截释放所有权。
- 根因回归：全量测试跑完真实 bin 目录文件 hash 不变。
