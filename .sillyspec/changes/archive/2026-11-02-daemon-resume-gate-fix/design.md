---
author: flow-machine-draft
created_at: 2026-11-02T02:07:22.613Z
---
# 设计记录（Design Record）— 2026-11-02-daemon-resume-gate-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：事故根因是 `sillyhub-daemon/src/daemon.ts` `_routeSessionResume` 构造恢复记录时 `lastActiveAt: Date.now()`（:9363）——backend 断网恢复风暴一拍全量下发 SESSION_RESUME 时，把全部恢复会话的「最后活跃」集体刷新为恢复时刻；会话闸（`session-manager.ts:1101-1120`，2026-08-26-team-subsession-recursion design §5.D）的「30 分钟内活跃」口径被顶满（46≥20），新建会话全部 `SESSION_LIMIT_REACHED` 拒绝。boot 恢复路径（`session-manager/persistence.ts:164` restoreAndReconnect）本来就保留 `record.lastActiveAt`，唯一污染点就是 reopen 路径这一行。修法（最小面）：reopen 记录的 `lastActiveAt` 改三级取值——payload 显式值（协议前向兼容位，本期不下发）→ 本地 sessions.json 记录原值（`this._persistence.load()` 按 sessionId 查找）→ `Date.now()` 兜底（无记录的跨机移交形态，维持现状；单点 reopen 不足以顶满闸，且 backend 24h suspended GC 限制了 record-less 全量恢复的规模）。配套 `SessionState.restoredAt`（仅内存态，仿 `staleRunResetAt` 先例）：restoreAndReconnect 写恢复时刻，idle 扫描空闲时长从 `max(lastActiveAt, restoredAt)` 起算——保保留旧时间戳后默认关闭的 idle 回收（`SESSION_IDLE_TIMEOUT_SEC>0` 形态）不把恢复会话立即误杀。

第二处：切换轮丢弃静默（本机 11-02 09:08:28 实证：`session_switch_config_session_not_found` 仅 warn，run 卡 pending 300 秒才被僵尸轮清扫收敛）。`_routeSessionSwitchConfig` 的 not_found 分支与 `markPendingConfigSwitch` 异常分支对齐 `_reportInjectDropped` 先例回报 run 失败；回报寻址需要 lease_id，而切换轮 payload（backend `session/service/control.py` 切换分支，camelCase）现无 lease_id——补一个键（会话 lease_id 当下可得），daemon snake/camel 双读，旧 payload 缺键降级为仅 warn（不报错）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- `Daemon._routeSessionResume`（daemon.ts）：内部行为变化——构造 `PersistedSessionRecord` 的 `lastActiveAt` 由恒 `Date.now()` 改三级取值；对外签名无变化。
- `SessionState`（interactive/types.ts）：新增可选字段 `restoredAt?: number`（仅内存态，`snapshotPersistable` 不落盘，语义同 `staleRunResetAt`）；`PersistedSessionRecord` 不变。
- `restoreAndReconnect`（session-manager/persistence.ts）：恢复构造 state 时写 `restoredAt: Date.now()`；其余行为不变。
- `scanIdle`（session-manager/lifecycle.ts）：空闲判定 `(now - lastActiveAt)` 改 `(now - max(lastActiveAt, restoredAt ?? 0))`。
- `Daemon._routeSessionSwitchConfig`（daemon.ts）：not_found / markPending 异常两分支新增 `notifyRunResult` 丢弃回报（三要素齐时）；新增私有辅助 `_reportSwitchDropped(raw, reason)`（复用 `_reportInjectDropped` 的字段解析与上报手法）；既有签名无变化。
- backend `control.py` 切换分支 payload：新增键 `leaseId`（str(session.lease_id)）；SESSION_INJECT 及其余协议字段不动；旧 daemon 忽略未知键，向后兼容。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。SESSION_RESUME 与 sessions.json 并发 flush 的时序上，load() 读到的是最近一次落盘快照；reopen 前 `_recoverPersistedSessions`/日常 `_scheduleFlush` 已把记录写盘（恢复风暴场景记录恰在盘上），查不到记录走 `Date.now()` 兜底与现状一致，乱序无害。恢复期间旧 store 残留条目由 restoreAndReconnect 既有静默驱逐/SessionBusyError 守卫处理，本变更不触碰该路径。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：无新增并发面。46 条 resume 并发到达时每条各自 `load()` 整文件（只读）后交 `save()`——save 已由 persistence 单一 promise queue 串行化（既有约束），最后一条 win 不交错损坏；`restoredAt` 是单会话单写者字段（恢复链单入口），无竞争。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。恢复会话若正处 `reconnecting`（boot 恢复在途）收到同 id reopen——既有 `SessionBusyError`（同 lease）/静默驱逐（lease 已 rotate）守卫覆盖，本变更不改该路径；restoredAt 在静默驱逐重建时随新 state 重写为当下，idle 保护不失效。切换轮回报路径回报失败（网络断）仅 warn——backend 300 秒僵尸轮清扫兜底仍在，退化到现状而非更糟。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。sessions.json 是 daemon 本机文件（跨机不共享），按 sessionId 精确匹配不串台；backend payload 新键只进切换轮消息（会话级寻址），无跨工作区/多实例共享面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是保留旧 `lastActiveAt` 后，显式启用 idle 回收（`SESSION_IDLE_TIMEOUT_SEC>0`）的部署会把刚恢复的会话立即回收——以 `restoredAt` 起算空闲时长封闭该路径（boot 恢复路径顺带修复既有同形态隐患）；默认关闭形态零影响。次风险：record-less 兜底 `Date.now()` 在「跨机移交全量 reopen」的罕见形态下仍可顶闸——接受（规模受 backend 24h GC 约束；彻底封死需协议加 last_active_at 字段，本期不做，留作后续升级位：daemon 已按 payload 显式值优先实现，backend 未来补发即生效，零 daemon 改动）。

放弃的方案：① 改闸计数口径（如排除「恢复后从未 inject」的会话）——需新增跨路径状态位且改动防风暴闸本体，风险面大于收益；改时间戳源头一处即闭环。② backend 全量恢复改分批/限速下发——治标不治本（30 分钟窗口仍在，只是推迟），且改动 backend 调度节奏牵连重连收敛时序。③ 用 `turnCount===0` 判恢复态——新会话首轮未完成前同为 0，误伤新建会话判据，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/daemon.ts | `_routeSessionResume` lastActiveAt 三级取值；`_routeSessionSwitchConfig` 两分支丢弃回报；新增 `_reportSwitchDropped` 辅助 |
| 修改 | sillyhub-daemon/src/interactive/types.ts | `SessionState` 新增 `restoredAt?: number`（仅内存态） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/persistence.ts | `restoreAndReconnect` 写 `restoredAt` |
| 修改 | sillyhub-daemon/src/interactive/session-manager/lifecycle.ts | `scanIdle` 空闲时长改 `max(lastActiveAt, restoredAt ?? 0)` 起算 |
| 修改 | backend/app/modules/daemon/session/service/control.py | 切换轮 payload 新增 `leaseId` 键 |
| 修改 | sillyhub-daemon/tests/daemon-session-resume-route.test.ts | FR-01 用例：保留持久化 lastActiveAt / payload 显式优先 / 无记录兜底 now / load 抛错兜底 |
| 修改 | sillyhub-daemon/tests/interactive/session-idle-scanner.test.ts | FR-01 配套用例：restoredAt 空闲起算保护（恢复会话不被立即回收） |
| 修改 | sillyhub-daemon/tests/daemon-session-switch-config.test.ts | FR-02 用例：not_found 回报 run 失败 / 缺 leaseId 降级不回报 / 异常分支回报 / 正常路由零误伤 |
| 修改 | backend/app/modules/daemon/tests/test_session_switch_config.py | FR-02 后端契约断言：切换 payload 携带 leaseId |
