---
id: task-07
title: '_tryUpdate pre-stop validateBundleOnDisk interception (GAP-1 order pinning, abort releases ownership) + unit tests'
title_zh: '_tryUpdate stop 前 validateBundleOnDisk 主拦截（GAP-1 顺序钉扎，拦截释放所有权）+ 单测（daemon-selfupdate-orchestrator）'
author: 'qinyi'
created_at: 2026-08-30 17:45:33
priority: P0
depends_on: ['task-01', 'task-06']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-009]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts
goal: >
  在 _tryUpdate 的 stop() 之前加 validateBundleOnDisk（task-01 提供）主拦截：
  坏盘 → warn daemon_update_aborted_bad_bundle + 释放 _updateBusy + 清 pending +
  return（不走 stop/respawn），旧进程完整在线、盘修复后可重试（D-009）——
  消除「stop 后才校验 → 拦截时进程已停摆且 _updateBusy 永久 true → 后续触发
  全被 self_update_skipped_inflight 成永久僵尸」的死角。
implementation:
  - "import：daemon.ts 顶部 `from './preflight.js'` import 块（109 行附近）加 validateBundleOnDisk（ESM .js 后缀）"
  - "server_command 路径：在 runDaemonSelfUpdate 成功返回（daemon.ts:2150-2154，即 2155 `if (!updated)` noop 分支之后）、★终检（2166）之前插入 `const ok = await validateBundleOnDisk(DAEMON_BIN_DIR, this._preflightLog.bind(this), 'server_command');`——即 GAP-1 的「校验放忙终检之前」，终检 2166 与 stop 2177 之间保持零 await；拦「下载内容可信但落盘后、拉起前盘又被写坏」的窗口"
  - "disk_change 路径（daemon.ts:2136-2146）：现有序列为入口忙判定（2128，该路径判定即终检、判定后到 stop 2143 之间不得有 await）→ 清定时器（2142）→ stop（2143）→ respawn（2145）。GAP-1 二选一实现：校验放 2136 分流之前（_updateBusy 占位 2126 之后、2128 忙判定之前统一先 `await validateBundleOnDisk(...)`），或分流内校验后再重跑 `this._isBusyForUpdate()`（忙 → 走 _deferUpdate 推迟）；本卡钉死同一选择并写进注释"
  - "两路径共用拦截动作：校验不过 → `this._logger.warn('daemon_update_aborted_bad_bundle', { reason, target_version: targetVersion })` + `this._updateBusy = false` + `this._clearUpdateRetryTimer()`（防御性，正常流程无活动定时器）+ `await this.clearPendingUpdate()` + return；不调 stop()、不调 respawnDaemonAndExit——旧进程 WS/心跳/会话完整在线，盘修复后下次触发（磁盘探测 600s 周期或下条指令）正常重试"
  - "代码注释必须引用 D-009 并写明 GAP-1 顺序钉扎理由：validateBundleOnDisk 是 async，其调用点不得插在忙终检（disk_change 入口 2128 / server_command 终检 2166）与 stop() 首动作（2143/2177）之间——否则把竞态窗口从毫秒级放大到一次文件 IO"
  - "单测 tests/daemon-selfupdate-orchestrator.test.ts（复用「task-04 S1 _tryUpdate 所有权/推迟/复查（D-002）」describe 254 行起的 mock harness，已 mock runDaemonSelfUpdate/stop/respawn）：拦截用例构造坏盘（<64KB 或无 BUILD_ID）→ 断言 warn daemon_update_aborted_bad_bundle、stop 与 respawnDaemonAndExit 均未被调、_updateBusy 复位、随后再触发 _tryUpdate 不被 self_update_skipped_inflight（2122-2124）挡死（所有权已释放可重试）；server_command 与 disk_change 各一条"
  - "好盘用例：校验通过 → 既有交接序列不变（终检 → stop → respawn）；「task-04 S1 start() 磁盘探测接线」（527 行起）与「R1 stop() 可重入」（606 行起）既有 describe 零回归"
acceptance:
  - "坏盘时 server_command 与 disk_change 两路径均不走 stop()/respawnDaemonAndExit；_updateBusy 复位 false、pending 已清，再触发可正常进入（不被 skipped_inflight 挡死）"
  - "好盘时正常交接（stop → respawn）语义不变；noop/defer/终检既有分支逻辑不动"
  - "GAP-1 顺序钉扎成立：忙终检（2128/2166）与 stop() 首动作（2143/2177）之间无任何 await；代码注释引用 D-009"
  - "tests/daemon-selfupdate-orchestrator.test.ts 全绿（含既有全部 describe）"
verify:
  - 'cd sillyhub-daemon && pnpm typecheck'
  - 'cd sillyhub-daemon && pnpm exec vitest run tests/daemon-selfupdate-orchestrator.test.ts'
  - 'grep -n "validateBundleOnDisk" sillyhub-daemon/src/daemon.ts （期望命中 import + 两路径调用）'
constraints:
  - "GAP-1（必守，D-009）：校验放忙终检之前，或校验后重跑 _isBusyForUpdate()——实现二选一并写明；禁止把 await validateBundleOnDisk(...) 插在忙终检（2128/2166）与 stop() 首动作（2143/2177）之间"
  - "消费 task-01 导出的 validateBundleOnDisk，本卡不改 preflight.ts（Wave 铁律）；不碰 _sendHeartbeatOnce / 心跳恢复（归 task-06）"
  - "ESM import 带 .js 后缀；禁止跑全量测试，仅跑 verify 枚举文件；Windows/Linux/macOS 兼容"
  - "不改 _tryUpdate 既有所有权/推迟/终检语义，只新增拦截分支与顺序约束注释"
  - "新增测试不得写真实 ~/.sillyhub/daemon/bin（makeTmpDir 隔离，tests/helpers.ts 既有）"
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
