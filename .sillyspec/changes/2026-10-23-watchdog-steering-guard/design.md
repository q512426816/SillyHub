---
author: flow-machine-draft
created_at: 2026-10-23T08:09:55.208Z
---
# 设计记录（Design Record）— 2026-10-23-watchdog-steering-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：在 daemon `SessionState` 增加两个仅内存态字段：`lastTurnEventAt`（`onMessage` 每收到 envelope 刷新）与 `observedRunIds`（有界 Set，记录已经产生过事件的 run）。`inject()` 在 stale 判定前先算 `sameRunInject = currentRunId === runId`：命中时说明是 backend mid-turn steering 复用活跃 run，跳过 stale-reset，并把 `wasRunningBeforeInject` 置真走排队分支（不布防看门狗）。stale 判定改用 `max(lastActiveAt, lastTurnEventAt)` 作为静默基准，而不是上次 inject 时间。首轮布防前再查 `observedRunIds`，已观测 run 一律不布防。看门狗触发逻辑本身不改，保留 2026-10-21-daemon-zombie-turn 的迟到 result 归属锚语义，真僵尸轮（新 runId、零事件）仍按 90 秒收敛。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：

- `SessionState` 新增可选字段 `lastTurnEventAt?: number`、`observedRunIds?: Set<string>`；均为仅内存态，不进入 `snapshotPersistable` 持久化白名单。
- `inject()` 行为变化：`runId === currentRunId` 时不再触发 stale-reset、不布防看门狗，按排队/追加输入处理；stale 静默基准改为最后轮内事件时间；已观测 run 不布防。
- `onMessage()` 行为变化：每个 envelope 到达时刷新 `lastTurnEventAt`，并把当前 `currentRunId` 记入 `observedRunIds`（256 上限 FIFO 驱逐）。
- `onResult()` 保持既有语义不变（status→active、按后台任务决定是否清 currentRunId、pendingInjectCount 递减）。
- 对外 HTTP/WS 协议、`onTurnStartTimeout` 回调签名、backend 契约零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 答：同 runId inject 与 result 的先后都已覆盖。result 先到会清空 currentRunId（无后台任务时），此时 `sameRunInject=false`，但 `observedRunIds` 已记录该 run，布防前检查仍会跳过（FR-03 兜底）；result 未到时 `sameRunInject=true`，直接按排队处理。两种顺序都不会误杀活轮，也不会漏掉真僵尸轮（真僵尸轮的 runId 从未产生事件、也不在 observedRunIds）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 答：`inject`、`onMessage`、`onResult` 都在 Node 单线程事件循环内执行；`lastTurnEventAt` 与 `observedRunIds` 的更新都是同步语句，没有 await 窗口，不存在交错写。`observedRunIds` 的 FIFO 驱逐也在同一同步段完成。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 答：会话 end/fail 后 state 丢弃，新字段随之回收；resume/restore 生成新 state，`observedRunIds` 为空，不改变既有恢复语义。看门狗仍由 onMessage/onResult/end/stop 撤防。`reloadWithProvider`/`reloadWithConfig` 不清这两个字段，切换后的新轮 runId 不同，不受旧集合影响。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 答：字段挂在 per-session state 上，run id 全局唯一；不跨会话共享。多 daemon 实例各自维护内存态，backend 的 run 归属与 pending 清扫逻辑不变，不存在跨实例串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：

- 最大风险：`observedRunIds` 无界增长。用 256 上限 FIFO 驱逐；单个 UUID 约 36 字节，单会话上限约 9KB。
- 风险：同 runId inject 跳过 stale-reset 后，若 backend 重启导致旧 turn 已死但 currentRunId 残留，会不会永远不收敛？不会：该形态下不会布防看门狗，但 backend 的 pending run 300 秒清扫仍兜底；且真正的「新 run 被吞」runId 与残留 currentRunId 不同，仍会正常布防。
- 放弃方案：只提高 60 秒/90 秒阈值。治标不治本，长 turn + 慢模型仍会命中，且会延迟真僵尸轮的收敛。
- 放弃方案：在看门狗触发时再检查 `lastTurnEventAt`。此时错误布防已经发生，根因在布防前；前置守卫比事后补救更可靠。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/types.ts | SessionState 新增 lastTurnEventAt / observedRunIds 两个可选内存态字段 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/turn-control.ts | 同 runId steering 守卫、stale 静默基准、布防前 observedRunIds 检查 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/events.ts | onMessage 刷新 lastTurnEventAt 并记录 observedRunIds |
| 修改 | sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts | 新增同 runId steering、事件新鲜 stale、已观测 run 三类回归用例 |
