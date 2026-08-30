---
author: qinyi
created_at: 2026-08-30 16:52:47
scale: large
tier: independent
---

# daemon 自愈两连修 — 设计文档

> 修订记录：2026-08-30 Design Grill 独立审查（16 交叉点，4 fail / 3 P1 blocker）
> 后修订——D-001/X-07 措辞、D-005/F1 自相矛盾、Phase 4/F4 契约不实、B-01~B-03
> 三个机制决策（D-007~D-009，主代理按推荐代行，用户可翻案）。

## 背景

2026-08-30 生产事故（本机 DESKTOP-HJ0AM09，Postgres + daemon 实证）暴露两个自愈缺口：

**缺口①（心跳闪断后 suspended 会话无人恢复）**：Windows 睡眠 >10 分钟 → backend
offline sweep（60s 轮巡，`RUNTIME_OFFLINE_GRACE_SEC=600`，`backend/app/modules/daemon/sweep.py:86`）
把该 runtime 名下 19 个 active 主会话同一毫秒翻 `suspended`（实证
`last_active_at` 全部 = 2026-08-29 13:36:43.87152+00）。机器唤醒后 daemon
**进程未退出**（`started_at` 不变），而 suspended 的恢复入口是 daemon
**boot** 时的 `_recoverSessionsOnBoot`（`sillyhub-daemon/src/daemon.ts:2348`，
backend 侧 `recover_session_after_daemon_restart`，`backend/app/modules/daemon/session/service.py:4498`）
——进程没重启就永远没人恢复（suspend-batch 优雅停止产生的 suspended 则必然
伴随 daemon 停止→重启，boot 恢复已覆盖，不在本缺口内）。19 个会话卡挂起 19
小时，靠手工重启 daemon 捞回；超 24h 未处理将被 `SUSPENDED_MAX_AGE_SEC` GC
判 `failed`（终态不可恢复）。

**缺口②（selfupdate 污染生产 bin）**：2026-08-30 00:11 生产
`~/.sillyhub/daemon/bin/sillyhub-daemon.js` 与 `mcp-server.js` 被写成 15/12 字节的
`NEW BUNDLE BODY` 占位文本。根因实锤：`sillyhub-daemon/tests/preflight.test.ts:645`
起的 `runPreflight` 集成用例 mock 了 `spawn`/`fetch`/`BUILD_ID` 但**未 mock
`node:fs/promises` 且 `runPreflight` 无 binDir 注入参数**，真实
`downloadAndReplace`（`src/preflight.ts:434`）把假 bundle 写进真实 bin 目录。
现有防线只有 tmp+rename 原子性，**无内容校验、无备份轮换**；坏 bundle 一旦被
`respawnDaemonAndExit` 拉起即 SyntaxError 起不来（本次靠 8-29 部署遗留的
`.bak-20260829` 手工恢复）。另：2026-08-30 16:39 实证自更新交接后进程消失一次，
复跑正常，疑似 Zcode bash 前台进程树被清理的环境假象，生产环境 respawn 曾正常
工作（8-29 build c28605f9 即 selfupdate 上线），不作缺陷立项，但防线 3 顺带覆盖
"坏盘被拉起"路径。

前作边界：`2026-08-29-daemon-platform-resilience`（已归档）设计了 suspended 语义
（D-001：daemon 重启后原会话自动恢复）但未覆盖"心跳恢复但进程未重启"的反向通道；
`2026-08-29-daemon-selfupdate-safety`（已归档）做了忙推迟/磁盘探测/保活，本次
补写入内容可信性。两前作已定 Non-Goals 延续：不做新版本健康门控/自动回退。

## 设计目标

1. 心跳闪断（进程存活、仅心跳断 >10 分钟）恢复后，suspended 会话**无需重启
   daemon 自动恢复**：suspended → reconnecting → active，与 boot 恢复同语义；
   恢复不打断本地仍在执行的工作。
2. selfupdate 三道防线：测试永远写不进真实 bin（根因）；下载内容不过校验不落盘
   （拦占位/半截内容）；坏盘永不被 respawn 拉起（stop 前校验拦截，旧进程完整
   在线可重试）。
3. 替换前自动保留 `.bak` 轮换备份，坏盘时人工有得救（8-30 的实际救援路径）。

## 非目标（Non-Goals）

- 不做坏 bundle **自动回退**（.bak 自动重启）——谁触发/如何判定起不来/回退循环
  风险复杂度高，三道防线已把坏盘拦在落盘与拉起之前，残余场景人工兜底。
- 不做新进程健康自证看护（旧进程延迟退出确认继任者存活）——对齐前作
  daemon-selfupdate-safety Non-Goals。
- 不改 backend（recover API 幂等语义、sweep、`SUSPENDED_MAX_AGE_SEC` 24h GC 全部
  复用现状）。
- 不做常驻对账循环（方案 B 已否决：职责与 backend sweep 重叠、事件本不会丢）。
- 不做 Windows 服务/计划任务注册等宿主看护形态。
- 不覆盖 suspend-batch 优雅停止路径（该路径 daemon 必然重启，boot 恢复已覆盖）。

## 决策（D-xxx）

| 编号 | 决策 | 依据 |
|---|---|---|
| D-001 | 缺口①采用心跳恢复事件触发：`_sendHeartbeatOnce` 成功分支、degraded 累计 >720s 守卫、直接复用 boot 恢复链全量跑 fresh 记录。**本机制针对的 suspended 来源是 offline sweep 档**（心跳断 >600s）；suspend-batch 优雅停止是第二来源但必然伴随重启、boot 恢复已覆盖（Grill X-07 修正） | offline sweep 是"进程存活却产生 suspended"的唯一来源，因果精确；720s = 600s 宽限 + 60s sweep 轮次余量 + 缓冲，保证触发时 sweep 必已翻完；backend 对终态拒绝复活，幂等安全 |
| D-002 | 恢复与 selfupdate 双向互斥：`_isBusyForUpdate` 增加"恢复进行中"算忙（更新推迟，30s 复查天然衔接）；更新已推进时心跳已停、无恢复触发（天然互斥） | 与 selfupdate-safety D-001"仅进行中算忙"同语义；避免恢复中途被 stop 打断 |
| D-003 | 下载校验零子进程口径：buffer ≥ 64KB **且** 正则可提取 `BUILD_ID`（gen-build-id.mjs 格式，与磁盘探测 `DISK_BUILD_ID_RE` 同款，daemon.ts:210），任一不过不 rename 不 respawn | 实测主 bundle 3,572,030B / mcp 1,157,632B，64KB 有 17 倍余量；`NEW BUNDLE BODY`（15 字节无 BUILD_ID）必被拦；零 spawn 开销，Windows AV/杀软零干扰 |
| D-004 | 备份轮换：rename 前把现有 target 复制为 `target.bak-<yyyyMMdd-HHmmss>`，同前缀保留最近 3 份（按文件名字典序排序取尾 3 份，同秒覆盖视为同名替换），超出清理；mcp-server.js 伴生同款 | 磁盘占用 ≈10MB 可忽略；保留多份防"最新备份也坏"；8-30 实际靠 .bak 救回，把人工路径制度化 |
| D-005 | `respawnDaemonAndExit` spawn 前对盘上 bundle 跑同款校验，不过 → error 日志 + **提前 return 不退出**（返回类型维持 void，Grill F1 修正；两调用点语义见 D-009） | 把"坏盘被拉起 SyntaxError 静默死"拦在发生前；作为最后防线保留 |
| D-006 | 测试隔离：`runPreflight` 增加可选 `binDir` 参数透传 `runDaemonSelfUpdate`（已支持注入），集成用例全部传临时目录；**既有用例 fixture 由 'NEW BUNDLE BODY' 换为合法假 bundle（≥64KB 且含 BUILD_ID，如 Buffer.pad 到 64KB+ 前缀含 `BUILD_ID="test-..."`）**（Grill X-14 修正：防线 3 上线后旧 fixture 会全红） | 根因修复；可选参数向后兼容（生产唯一调用点 daemon.ts:1525 两参）；防线 3 校验兜住未来漏隔离的用例（双保险） |
| D-007 | **恢复忙门控**（Grill B-01，主代理按推荐代行）：触发点检查 `_isBusyForUpdate()`（在跑 interactive turn / 在跑 batch lease / 恢复已在途）——忙则置 `_recoverPendingAfterDegraded = true` 并 warn，**不清除该标志，心跳每拍成功路径复查**：不再忙且标志在 → 触发恢复并清标志；daemon 重启标志自然消失（boot 恢复兜底） | 网络断但 SDK driver 本地仍在跑的长 turn 不被 restoreAndReconnect 驱逐终止（session-manager.ts:3546-3550 驱逐语义）；与 selfupdate 忙推迟同模式；无新定时器（复用心跳节奏复查） |
| D-008 | **凭证断连补覆盖**（Grill B-02，主代理按推荐代行）：`_sendHeartbeatOnce` 失败路径的 `heartbeat_auth_rejected`（401/403，daemon.ts:3541-3549 提前 return 处）在 return 前同样置 `this._heartbeatFailSince = Date.now()` | 现状该分支提前 return 发生在 failSince 置位（3555-3557）之前，纯凭证断连 failSince 恒 null、恢复后不触发；期间 sweep 同样翻 suspended（backend 不区分断连原因），凭证恢复后理应触发 recover，语义与网络断连一致 |
| D-009 | **respawn 前校验提前到 stop 之前**（Grill B-03，主代理按推荐代行）：`preflight.ts` 新增导出 `validateBundleOnDisk(binDir, logger): boolean`；daemon.ts `_tryUpdate` 在执行 `stop()` **之前**调用，不过 → 释放 `_updateBusy` + 清 pending + warn 返回（不走 stop、不走 respawn，旧进程**完整在线**——WS/心跳/会话全在，盘修复后下次触发可正常重试）。`respawnDaemonAndExit` 内部校验保留作最后防线：拦截时 error 日志 + 提前 return 不退出（覆盖 `runPreflight` 启动路径——该路径无 stop，进程正常继续启动） | 拦截语义两路径分别成立：启动路径无 stop、完整在线；_tryUpdate 路径若维持"stop 后才校验"，拦截时进程已停摆且 `_updateBusy` 永久 true → 后续触发全被 skipped_inflight（2122-2124），坏盘场景成永久僵尸——校验提前后拦截点落在任何破坏性动作之前，无状态损失，所有权正常释放 |

## 总体设计

### Phase 1 — 心跳恢复主动 recover（`src/daemon.ts`）

**触发点**：`_sendHeartbeatOnce`（daemon.ts:3498）成功分支，`this._heartbeatFailSince
= null`（3526）**重置前**：

```ts
const failSince = this._heartbeatFailSince;           // 重置前捕获
this._heartbeatFailSince = null;
this._degradedWarned = false;
const degradedMs = failSince === null ? 0 : Date.now() - failSince;
if (degradedMs > RECOVER_AFTER_DEGRADED_MS || this._recoverPendingAfterDegraded) {
  this._maybeRecoverAfterDegraded(degradedMs);        // 见 D-007 忙门控
}
```

（Grill GAP-2 修正：此处**不设** `_recoverInFlight` 外层门——恢复在途由
D-007 忙门控的"恢复在途算忙 → 置 pending"统一收口，外层门会使该臂不可达，
极端双断连角落丢触发。`_recoverInFlight` 仍存在，仅作为 `_isBusyForUpdate`
的数据源与恢复主体 finally 复位，不参与触发判定。）

- 守卫常量 `RECOVER_AFTER_DEGRADED_MS = 720_000`（模块级导出供测试断言，先例
  `REGISTER_RETRY_BASE_MS`，daemon.ts:177-182）。短于 720s 的闪断不产生
  suspended，不触发。
- 该函数是"心跳循环每拍 + 重连对账第 1 步"共用点：两通道自然都覆盖；触发为
  同步检查 + fire-and-forget，`_recoverInFlight` 标志防重入（恢复主体 finally
  复位），单线程事件循环下至多一个在途。
- **忙门控（D-007）**：`_maybeRecoverAfterDegraded` 内先查 `_isBusyForUpdate()`；
  忙 → 置 `_recoverPendingAfterDegraded` + warn（`session_recover_deferred_busy`）
  返回；不忙 → 清标志 + fire `_recoverPersistedSessions('heartbeat_recover')`。
  每拍心跳成功路径复查 pending 标志，空闲即补触发。
- **凭证断连（D-008）**：`heartbeat_auth_rejected` 分支（3541-3549）return 前补
  `this._heartbeatFailSince = Date.now()`（如已非 null 保持原值不覆盖）。

**恢复动作**：把 `_recoverSessionsOnBoot`（daemon.ts:2348，主体自包含 2348-2436）
提取为 `_recoverPersistedSessions(trigger: 'boot' | 'heartbeat_recover')`（行为零
变化，boot 调用点 1583 改传 `'boot'`），心跳触发传 `'heartbeat_recover'`，仅影响
日志事件字段（`session_recover_start/done` 增 `trigger` 字段），便于生产区分恢复
来源。boot 时 `_heartbeatFailSince` 初始为 null（1339），首拍心跳不会触发，无重复。

**筛选口径**：不做 daemon 侧状态预查询。>720s 守卫保证触发时 backend 已把非终态
会话翻成 suspended；终态（ended/failed）记录由 backend recover 幂等拒绝（返回
terminal → daemon 删本地记录），7 天超龄由现有 `_recoveryRecordExpired` 剔除。
极端竞态（sweep 轮次抖动个别会话仍 active）：recover 把它写 reconnecting +
rotate token，随后 restoreAndReconnect 收敛回 active——最终状态正确，无害。

**互斥**（D-002）：`_recoverInFlight` 期间 `_isBusyForUpdate()`（daemon.ts:1998）
返回 true → selfupdate 推迟（写 pending + 30s 复查，恢复完成后复查即升级）；
反向：selfupdate 已过忙判定进入 stop 流程时，心跳已停（WS/心跳随 stop 关闭），
不存在恢复触发点。

### Phase 2 — 测试隔离（`tests/preflight.test.ts` + `src/preflight.ts`）

- `runPreflight(config, logger, binDir?)` 增加第三个可选参数，透传给
  `runDaemonSelfUpdate(BUILD_ID, config, logger, binDir)`（binDir 参数已存在，
  preflight.ts:190；现有调用点 daemon.ts:1525 不传 → 默认 `DAEMON_BIN_DIR`，
  向后兼容）。
- preflight.test.ts 中所有 `runPreflight(...)` 调用（含 :645 集成用例）改传
  `makeTmpDir()`；**既有断言换合法 fixture**（D-006）：假 bundle 内容改为 ≥64KB
  且含 `BUILD_ID="test-def5678"` 的 Buffer（新测试 helper `validFakeBundle(buildId)`），
  断言 `readFileSync` 结果相应改为提取 BUILD_ID 校验。
- 防回归双保险：即使未来新用例漏传 binDir，Phase 3 校验会拦下不可信内容（不落盘）。

### Phase 3 — 写入校验 + 备份轮换（`src/preflight.ts`）

新增导出校验器（纯函数，零依赖，单测直调）：

```ts
/** 校验下载的 bundle 内容可信：≥64KB 且能提取 BUILD_ID（零子进程）。 */
export function validateBundleContent(buf: Buffer): {
  ok: boolean; buildId: string | null; size: number;
}
/** 校验盘上 bundle 文件（respawn/stop 前最后防线；读失败视为不过）。 */
export async function validateBundleOnDisk(
  binDir: string, logger: PreflightLogger, label?: string,
): Promise<boolean>
```

- 大小下限 `MIN_BUNDLE_BYTES = 65_536`；BUILD_ID 正则与磁盘探测同款
  `BUILD_ID\s*=\s*["']([^"']+)`（`DISK_BUILD_ID_RE`，daemon.ts:210，gen-build-id.mjs
  格式已实证稳定）。
- `downloadAndReplace`（preflight.ts:434）：`writeFile(tmp)` **之前**调用
  `validateBundleContent`；不过 → warn（`daemon_bundle_validation_failed`，含
  size/buildId 字段）+ 清理 tmp + 返回 false（调用链 `runDaemonSelfUpdate` 返回
  false → 不 respawn，旧进程保活继续跑，下次触发重试）。
- 备份（D-004）：校验通过后、`rename(tmp, target)` 之前，若 target 存在 →
  `copyFile(target, target.bak-<yyyyMMdd-HHmmss>)`；随后列目录清理同
  `target.bak-*` 前缀超出最近 3 份的旧备份（文件名字典序即时间序；同秒覆盖
  视为同名替换，天然去重）。备份失败（磁盘满等）→ warn 但**不阻塞替换**
  （备份是人工兜底路径，不拦自更新主线）。
- mcp-server.js 伴生替换复用同函数（fileName 参数已有），同校验同备份。

### Phase 4 — respawn 拉起前校验（`src/preflight.ts` + `src/daemon.ts`）

**主拦截点（D-009，stop 之前）**：daemon.ts `_tryUpdate` 在执行 `stop()` 之前调
`validateBundleOnDisk(DAEMON_BIN_DIR, logger)`：

- `server_command` 路径：下载替换成功后（盘上已是新内容）、stop 前校验——拦
  "下载内容可信但落盘后、拉起前盘又被写坏"的窗口。
- `disk_change` 路径：探测到盘上版本变化、stop 前校验——拦外部写入的坏盘。
- 校验不过 → warn（`daemon_update_aborted_bad_bundle`）+ 释放 `_updateBusy` +
  清 pending + return。**旧进程完整在线**（WS/心跳/会话未动），盘修复后下次
  触发（磁盘探测 600s 周期或下条指令）正常重试。
- **顺序钉扎（Grill GAP-1，plan 不变量）**：`validateBundleOnDisk` 是 async，其
  调用点必须满足"忙终检（Grill B3 终检）与 stop() 首动作间无任何 await"的前作
  不变量不被破坏——校验放在**忙终检之前**（download/磁盘探测完成后先校验再终检
  再 stop），或校验后重跑 `_isBusyForUpdate()`；禁止按字面插在终检与 stop 之间
  （会把竞态窗口从毫秒级放大到一次文件 IO）。

**最后防线（D-005，respawnDaemonAndExit 内部）**：spawn 之前读盘上 bundle 跑同款
校验；读失败或校验不过 → error 日志（`daemon_self_update_respawn_validation_failed`）
+ **提前 return 不退出**。覆盖 `runPreflight` 启动路径（preflight.ts:110 调用，
该路径无 stop——进程尚未起三循环，校验拦截后正常继续启动旧逻辑）。返回类型维持
void：两调用点语义均为"排定交接"，拦截即保活，无需回传（主拦截点已在 stop 前
先行，能到这里的拦截属极端窗口）。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段/条件 | 状态变化 |
|---|---|---|---|---|
| heartbeat 成功且 degraded>720s（或 busy-pending 复查通过） | daemon `_sendHeartbeatOnce`（daemon.ts:3526 前插） | daemon `_maybeRecoverAfterDegraded` | `_heartbeatFailSince` 非 null 且距今 >720_000ms，或 `_recoverPendingAfterDegraded` 为真 | daemon 内部触发；忙则仅置 pending 标志 |
| 恢复忙推迟 | daemon `_maybeRecoverAfterDegraded` | （内部） | `_isBusyForUpdate()` 为真（在跑 turn/lease/恢复在途） | 置 `_recoverPendingAfterDegraded`，无会话状态变化；心跳每拍复查 |
| heartbeat 401/403 凭证拒绝（现状分支补置位，D-008） | daemon `_sendHeartbeatOnce` 失败分支（3541-3549） | （内部） | HTTP 401/403 | 置 `_heartbeatFailSince`（原 null 时）；无会话状态变化 |
| recover（会话恢复，复用现状） | daemon `_recoverOneSession` | backend `recover_session_after_daemon_restart` | session_id/runtime_id/lease_id/provider/interrupted_run_id | backend：suspended→reconnecting（写 last_active_at=now + rotate claim_token）；daemon restoreAndReconnect 后→active；终态→拒绝复活（daemon 删本地记录） |
| 会话挂起（现状，本次不改） | backend offline sweep / suspend-batch | agent_sessions | runtime 心跳 >600s（sweep 档）/ daemon 优雅停止（batch 档） | active→suspended。本变更仅新增 sweep 档的恢复通道；batch 档由 boot 恢复覆盖（现状） |
| 下载校验失败 | daemon `downloadAndReplace` | （内部，无外发） | size<64KB 或 BUILD_ID 不可提取 | 无状态变化：不 rename 不 respawn，旧进程保活 |
| 备份轮换 | daemon `downloadAndReplace` | 磁盘 | rename 前 target 存在 | 无会话/进程状态变化；产生 `*.bak-<ts>`，保留 3 份 |
| stop 前 bundle 校验拦截（主拦截点） | daemon `_tryUpdate` → `validateBundleOnDisk` | （内部，无外发） | 盘上 bundle 读失败或校验不过 | 无状态变化：不走 stop 不走 respawn，释放 `_updateBusy`+清 pending，旧进程完整在线可重试 |
| respawn 前校验拦截（最后防线） | daemon `respawnDaemonAndExit` | （内部，无外发） | 盘上 bundle 读失败或校验不过 | 启动路径：不退出，正常继续启动；_tryUpdate 路径正常到不了此（主拦截点先行）；极端窗口到达则停摆不退出待人工 |
| 恢复进行中遇 selfupdate 触发 | daemon `_tryUpdate` | （内部） | `_recoverInFlight === true` | selfupdate 推迟：写 pending_update + 30s 复查（现状推迟机制复用） |

## 文件变更清单

| 文件 | 变更 |
|---|---|
| `sillyhub-daemon/src/daemon.ts` | 新增 `RECOVER_AFTER_DEGRADED_MS` 常量、`_recoverInFlight` / `_recoverPendingAfterDegraded` 标志、`_maybeRecoverAfterDegraded()`；`_recoverSessionsOnBoot` 主体提取为 `_recoverPersistedSessions(trigger)`（行为零变化）；`_sendHeartbeatOnce` 成功分支插入触发、401/403 分支补置 failSince（D-008）；`_isBusyForUpdate` 增加恢复在途判定；`_tryUpdate` stop 前加 `validateBundleOnDisk` 主拦截（D-009） |
| `sillyhub-daemon/src/preflight.ts` | 新增 `validateBundleContent` / `validateBundleOnDisk` + `MIN_BUNDLE_BYTES`；`downloadAndReplace` 校验 + 备份轮换；`respawnDaemonAndExit` 拉起前校验（不过提前 return 不退出，维持 void）；`runPreflight` 增可选 binDir 参数 |
| `sillyhub-daemon/tests/preflight.test.ts` | 集成用例 binDir 隔离（makeTmpDir 注入）；既有 fixture 换合法假 bundle（`validFakeBundle` helper，≥64KB 含 BUILD_ID，D-006）；新增校验器/备份轮换/respawn 拦截用例 |
| `sillyhub-daemon/tests/preflight-download-replace.test.ts` | 既有直调 `downloadAndReplace` 的成功路径 fixture（`'// bundle v2'` 13 字节无 BUILD_ID）换合法假 bundle（plan 审查发现的清单遗漏，同 D-006 口径） |
| `sillyhub-daemon/tests/`（daemon 心跳相关既有测试文件，plan 阶段定位） | 新增心跳恢复触发用例（>720s 触发 / <720s 不触发 / 忙推迟+pending 复查 / 401/403 断连恢复后触发 / 恢复中 selfupdate 推迟 / 无记录零成本） |

backend / frontend / 数据库 schema：**零改动**。

## 风险登记

| 风险 | 评估与对策 |
|---|---|
| R1 守卫竞态：sweep 轮次抖动，触发时个别会话仍 active | recover 幂等写 reconnecting 后收敛 active，最终状态正确，仅多一次 token 轮换；720s 守卫已含 60s 轮次余量，窗口极小。可接受 |
| R2 恢复期间用户操作（inject/新消息） | 与 boot 恢复同款语义：sessionManager 内部串行，恢复中会话先到 reconnecting，操作排队/重试由既有链路处理 |
| R3 64KB 下限误拦合法小 bundle | 当前最小 mcp-server.js 1.1MB（17 倍余量）；常量模块级导出，极端情况可调。校验失败不删除旧文件，自更新保持旧版继续跑（fail-safe 方向正确） |
| R4 备份磁盘占用 | 3×3.4MB ≈ 10MB，可忽略 |
| R5 `runPreflight` 签名变化 | 可选参数向后兼容；全仓调用点仅 daemon.ts:1525 一处（不传） |
| R6 心跳恢复触发与 boot 恢复重复 | 进程内互斥（`_recoverInFlight`）；boot 时 `_heartbeatFailSince` 初始为 null（daemon.ts:1339），首拍心跳不会触发 |
| R7 恢复大量会话的并发压力 | 复用既有并发 4 限流 + 7 天超龄剔除；19 会话规模实证 boot 路径秒级完成 |
| R8 长忙不空闲：pending 恢复标志长期等不到空闲（极端：超长 batch lease） | 等 lease 结束（batch 有超时上限）后下拍心跳补触发；期间 suspended 会话仍受既有 24h GC 约束，与现状相比无退化（现状是永不恢复） |
| R9 401/403 补置 failSince 引入新触发面 | 仅当凭证断连 >720s 且恢复成功才触发；该场景 sweep 已翻 suspended，恢复正确；`heartbeat_auth_rejected` 的 FATAL 日志语义不变 |

## 自审（Self-Review）

- ✅ D-001 守卫与 offline sweep 来源对齐（Grill X-07 修正后）：心跳断 >600s 是
  "进程存活却产生 suspended"的唯一来源，720s 守卫覆盖且仅覆盖该场景；suspend-batch
  档由 boot 恢复覆盖（Non-Goals 明示）。
- ✅ 复用优先：恢复链零新逻辑（参数化提取）；校验器复用 `DISK_BUILD_ID_RE`
  正则；互斥复用 `_isBusyForUpdate` 与 30s 复查机制。backend 零改动。
- ✅ 失败方向全部 fail-safe：校验不过→保活旧版；备份失败→不拦主线；stop 前
  校验拦截→无任何破坏性动作、所有权正常释放可重试；respawn 防线拦截→不退出。
  无任何"失败即死"或"拦截即僵尸"路径（Grill B-03 修正后）。
- ✅ 恢复无损性（Grill B-01 修正后）：忙门控保证本地在跑 turn 不被恢复链驱逐。
- ✅ 生命周期契约表已核：本变更新增 8 行事件，现状引用（sweep/suspend-batch
  挂起、recover）语义逐字不变；`session/lease/daemon/heartbeat` 关键词全覆盖。
- ✅ 测试计划覆盖根因回归（bin 隔离 + fixture 合法化）、三道防线各自拦截点、
  触发边界（720s 两侧/忙推迟/401-403）、互斥两个方向。
- ⚠️ 残留不确定：心跳相关既有测试文件的具体组织（单文件/harness）留 plan
  阶段定位；`_recoverPersistedSessions` 提取时若发现 boot 与触发路径在 flush
  细节上需要分叉（如 pending 记录回写口径），以行为零变化为准在 plan 中细化。
- 📌 D-007/D-008/D-009 为 Design Grill blocker 的代行决策（推荐项依据压倒性），
  用户后续可翻案重开（`--reopen --from-step 7`）。
