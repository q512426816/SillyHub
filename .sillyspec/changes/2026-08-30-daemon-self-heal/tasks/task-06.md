---
id: task-06
title: 'Heartbeat degraded-recovery trigger (720s guard) + busy-gate pending recheck + _isBusyForUpdate recovery-in-flight + 401/403 failSince backfill + unit tests'
title_zh: '心跳恢复触发点（720s 守卫）+ 忙门控 pending 复查 + _isBusyForUpdate 扩展 + 401/403 补置 failSince + 单测（daemon-heartbeat-pending / integration/selfupdate-scenarios）'
author: 'qinyi'
created_at: 2026-08-30 17:45:33
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001, D-002, D-007, D-008]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts
  - sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts
goal: >
  补上「心跳闪断（进程存活）超 10 分钟被 backend sweep 翻 suspended、恢复后
  无人恢复」的反向通道：在 _sendHeartbeatOnce 成功分支按 degraded 超 720s
  （或 busy-pending 复查通过）触发 _recoverPersistedSessions('heartbeat_recover')，
  忙时无损推迟（D-007）、401/403 凭证断连同样累计 failSince（D-008）、恢复与
  selfupdate 双向互斥（D-002），并补触发边界/忙推迟/401-403/互斥单测。
implementation:
  - "模块级导出常量（先例 REGISTER_RETRY_BASE_MS daemon.ts:177-182、SELF_UPDATE_RETRY_INTERVAL_MS:182）：`export const RECOVER_AFTER_DEGRADED_MS = 720_000;`（720s = sweep 600s 宽限 + 60s 轮次余量 + 缓冲，D-001；导出供测试断言）"
  - "类成员新增（_heartbeatFailSince daemon.ts:1339 / _degradedWarned 1342 附近）：`private _recoverInFlight = false;`、`private _recoverPendingAfterDegraded = false;`（均不持久化，daemon 重启自然消失，boot 恢复兜底；R6：boot 时 failSince 初始 null，首拍心跳不会触发）"
  - "_sendHeartbeatOnce 成功分支（daemon.ts:3526-3527 `this._heartbeatFailSince = null` 重置前）按 design.md Phase 1 插入：先捕获 `const failSince = this._heartbeatFailSince;` 再重置 null + _degradedWarned=false；`degradedMs = failSince === null ? 0 : Date.now() - failSince`；`if (degradedMs > RECOVER_AFTER_DEGRADED_MS || this._recoverPendingAfterDegraded) { this._maybeRecoverAfterDegraded(degradedMs); }`（同步检查 + fire-and-forget，不 await）"
  - "GAP-2：触发点不设 _recoverInFlight 外层门——恢复在途由 D-007 忙门控「恢复在途算忙→置 pending」统一收口；外层门会使 busy-pending 复查臂不可达，极端双断连角落丢触发。_recoverInFlight 仅作 _isBusyForUpdate 的数据源与恢复主体 finally 复位，不参与触发判定"
  - "新增 `private _maybeRecoverAfterDegraded(degradedMs: number): void`（放 task-05 提取出的 _recoverPersistedSessions 附近）：先查 `_isBusyForUpdate()`——忙 → 置 `this._recoverPendingAfterDegraded = true` + `this._logger.warn('session_recover_deferred_busy', { degraded_ms: degradedMs })` 返回（不清标志，心跳每拍成功路径复查）；不忙 → 清标志 + `this._recoverInFlight = true` + `void this._recoverPersistedSessions('heartbeat_recover').finally(() => { this._recoverInFlight = false; })`（恢复主体内部全隔离不 reject，.finally 复位保证异常路径也放行）"
  - "_isBusyForUpdate（daemon.ts:1998）扩展：在 hasRunningTurn / hasActiveLease 两判定后加 `if (this._recoverInFlight) return true;`，注释引 D-002（恢复中途不被 selfupdate stop 打断；反向 selfupdate 过忙判定进入 stop 流程时心跳已停，天然互斥）；保持同步方法签名不动（终检同步性前提，见 1993-1996 注释）"
  - "401/403 分支（daemon.ts:3541-3549 heartbeat_auth_rejected，return false 前）补置：`if (this._heartbeatFailSince === null) { this._heartbeatFailSince = Date.now(); }`（D-008：该分支现状提前 return 早于 3555-3557 置位，纯凭证断连 failSince 恒 null、恢复后不触发，而期间 sweep 同样翻 suspended；已非 null 保持原值不覆盖；FATAL 日志语义不变）"
  - "单测 tests/daemon-heartbeat-pending.test.ts（复用「Daemon._sendHeartbeatOnce 注入 pending_update」describe 173 行起的注入 harness）：>720s 触发 / <720s 不触发 / 阈值边界 / failSince=null 首拍不触发 / 401 断连后恢复触发 / 403 同款 / 已非 null 不被 401 分支覆盖"
  - "单测 tests/integration/selfupdate-scenarios.test.ts（在「task-08 SELF_UPDATE 安全层四路径集成回归」describe 193 行起旁新增 describe）：忙推迟三源（hasRunningTurn / hasActiveLease / _recoverInFlight）→ warn session_recover_deferred_busy + 置 pending、不打断本地工作；随后空闲拍补触发并清标志；恢复在途时触发 _tryUpdate → 走既有推迟（pending_update + 30s 复查），互斥双向各一条"
acceptance:
  - "degraded 超 RECOVER_AFTER_DEGRADED_MS（720_000）的下一拍心跳成功触发一次 _recoverPersistedSessions('heartbeat_recover')（trigger 字段进日志）；不超过 720s 的闪断不触发；boot 首拍 failSince=null 不触发（无重复）"
  - "忙时只置 _recoverPendingAfterDegraded + warn session_recover_deferred_busy，本地在跑 turn/lease/恢复不被打断；随后空闲拍补触发并清标志"
  - "401/403 分支置 _heartbeatFailSince（原 null 时），凭证断连超 720s 恢复后同样触发；heartbeat_auth_rejected FATAL 日志语义不变"
  - "_recoverInFlight 期间 _isBusyForUpdate() 返回 true，selfupdate 触发走既有推迟（pending_update + 30s 复查）；恢复主体 finally 复位 _recoverInFlight"
  - "RECOVER_AFTER_DEGRADED_MS 模块级导出（720_000）可被测试直接断言；两测试文件新用例全绿、既有用例零回归"
verify:
  - 'cd sillyhub-daemon && pnpm typecheck'
  - 'cd sillyhub-daemon && pnpm exec vitest run tests/daemon-heartbeat-pending.test.ts'
  - 'cd sillyhub-daemon && pnpm exec vitest run tests/integration/selfupdate-scenarios.test.ts'
constraints:
  - "GAP-2（必守）：_sendHeartbeatOnce 触发点不设 _recoverInFlight 外层门——外层门使 busy-pending 复查臂不可达、双断连角落丢触发；_recoverInFlight 只作 _isBusyForUpdate 数据源与恢复主体 finally 复位"
  - "不改 boot 路径行为（boot 恢复仍是 start() 内 await 的既有链路）；不动 _tryUpdate（归 task-07）"
  - "ESM import 带 .js 后缀；禁止跑全量测试，仅跑 verify 枚举两文件；Windows/Linux/macOS 兼容（仅 Date.now 等无平台 API）"
  - "两测试文件仅本任务触碰（Wave 铁律）；新增用例不得写真实 ~/.sillyhub 目录"
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
