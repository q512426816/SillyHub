---
author: flow-machine-draft
created_at: 2026-10-27T00:54:57.791Z
---
# 设计记录（Design Record）— 2026-10-27-task-wakeup-inject-retry

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

改动集中在 daemon 侧两处：

1. **主修**（`sillyhub-daemon/src/interactive/session-manager/background-tasks.ts` `scheduleTaskWakeup`）：2s debounce 定时器回调内的注入 `await cb(...)` 从「单发即弃」（catch 仅 console.error）改为**退避重试循环**——默认计划 `[5s,15s,30s,60s,120s,300s]`（首发 1 次+重试 6 次，总窗约 9.3 分钟，盖住生产部署重建窗 35s~数分钟 + WS 重连 reconcile 间隔）；每次退避等待结束后先查 `mgr._store.has(sessionId)`，会话已终态清理即中止。计划常量与 env 解析放 `daemon.ts`（`taskWakeupRetryDelaysMs()`，与 `taskWakeupQuietThresholdMs` 同款惯例：逐次读取、非法容错、`0`/空=禁用回单发——止血开关对齐既有 FR-03 总关闭阀先例）。
2. **附带修**（`sillyhub-daemon/src/turn-phase-observability.ts` `notePhaseEmit`）：增加 per `(point, sessionId, runId)` 防重（有界 512 逐出最旧，与 `warnOncePhaseFailure` 同惯例；测试清理入口复用 `resetTurnPhaseObservabilityForTest` 一并清零）。背景：TRACE 门控本身无 bug，但记点无防重——session-manager 侧每 envelope 无状态直发（D-013④ 设计，防重在 daemon 层），TRACE 开启时记点随 envelope 数刷屏（实证 daemon.log 323219-323256 同一 run 同秒 30+ 行）；防重后 TRACE 每 (point, run) 恰一行，断链定位配对语义不变（两点间缺一即锁定断链环节，只需首记即可判在）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `scheduleTaskWakeup(mgr, sessionId, info)` 签名不变；行为变化：`deps.onTaskWakeupInject` 失败后按计划重试至成功/耗尽/会话终态中止。
- 新增导出 `taskWakeupRetryDelaysMs(): number[]`（`sillyhub-daemon/src/daemon.ts`，紧邻 `taskWakeupQuietThresholdMs`）：读 env `SILLYHUB_TASK_WAKEUP_RETRY_DELAYS_MS`——未设→默认 `[5000,15000,30000,60000,120000,300000]`；`0`/空串→`[]`（禁用）；逗号列表逐项 `parseInt`，非正整数项忽略，全非法→默认。
- `notePhaseEmit(point, sessionId, runId, phase, log?)` 签名不变；行为变化：同 `(point, sessionId, runId)` 键仅首次输出（TRACE 开启时）。
- `resetTurnPhaseObservabilityForTest()` 行为扩展：同时清空 notePhaseEmit 防重集合。
- 对外协议（backend inject 端点、hub-client、CLI）零改动；无。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。重试链只针对已组装完成的 debounce prompt 逐次重发同一内容，不依赖事件顺序；等待期新任务终态到达会另起一条独立 debounce 链（`_taskWakeupPending` 条目在定时器触发时已删），两条链并行注入的最坏后果=空闲期两个唤醒轮（prompt 自带「不要重复执行这些任务」防重执行）或忙轮期被后端 `_merge_task_wakeup_prompt` 并入恒≤1 条（ql-20260827-015 排队合并）。首注入实际已落库但响应丢失（超时误判失败）时，重试至多造成一次重复唤醒轮——通知类消息幂等可接受。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   重试循环是单会话单链的内存异步流程，无共享可变数据（防重集合 Set 操作原子于 JS 单线程）；`_taskWakeupPending` 并发形态与现状一致（每会话恒一条 debounce，触发即删），无新增写竞争。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。会话终态路径（`lifecycle.ts:329 _store.delete`）是重试中止的判定锚——每次退避等待后检查，终态后不再注入；`_taskWakeupPending` 的既有终态清理（lifecycle 4b-2 clearTimeout）不受影响（重试链在定时器已触发后运行，不持定时器句柄）。daemon 进程重启则重试链随之消亡——可接受（任务终态行已在 transcript，用户消息/下次任务终态仍可唤醒）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。重试状态（退避循环）为会话级局部闭包，不落盘、不跨实例；notePhaseEmit 防重键含 sessionId+runId，多会话/多实例天然不串台；env 开关为 daemon 进程级（与 QUIET_MS 同粒度）。

5. 三方向评估（FR-04 落档）：

   - **A 退避重试（选定）**：改动局部（一处函数内循环），覆盖全部失败形态（502/504/网络/WS 断），通知延迟不敏感；幂等性有后端排队合并兜底。
   - **B 唤醒注入成功才清锚点（落选）**：锚点（`hasBackgroundTaskGrace`）只影响「CLI 正在执行时写通道守卫放行」，不产生新轮次——注入失败时会话仍不醒，楔死未解决；且清锚点需从 `handleTaskNotificationEvent` 同步路径迁到异步注入完成回调，跨模块耦合加深。锚点保持现状（末任务注销即清）。
   - **C daemon 本地直投不经后端（落选）**：run/user_input 落库与前端时间线展示是 backend inject 端点的职责，本地直投绕不开「后端建 run」这一步；且后端不可用窗内 run 记录同样建不了，等于把故障后移。架构级改动收益不匹配。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：重试造成的重复唤醒轮（首注入实际成功但响应丢失时）。缓解：后端忙轮合并恒≤1 条 + prompt 防重执行指令；空闲期重复轮为纯汇报轮，成本可容忍。
- **次风险**：env 覆写错误计划（如全 0 列表）导致重试风暴——解析层非正整数项忽略、默认计划兜底；止血开关 `=0` 一键回旧行为。
- **放弃的方案**：B/C 两方向（理由见上问评估）；「WS onConnected 立即重试一轮」（recover 链先例）——需挂 WS 连接回调穿层接线，收益（最快场景省 ≤5s）不配复杂度，退避首档 5s 已够短；TRACE 刷屏曾考虑在 daemon.ts 拦截点把 `notePhaseEmit` 挪到 first_event 防重 Set 判定之后——只治桥侧半边，emit 侧（events.ts 每 envelope）仍刷，防重做进 helper 一处治两侧。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/daemon.ts | 新增 `taskWakeupRetryDelaysMs()` env 解析（默认计划/禁用/容错），紧邻 quiet 阈值惯例 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/background-tasks.ts | `scheduleTaskWakeup` 注入改退避重试循环：成功即止/store 终态中止/耗尽 error 留痕/期间 warn 留痕 |
| 修改 | sillyhub-daemon/src/turn-phase-observability.ts | `notePhaseEmit` 增 per(point,session,run) 有界防重；测试清理入口同步清零 |
| 修改 | sillyhub-daemon/tests/interactive/task-lifecycle.test.ts | 新增重试四态用例：首败重试成功/耗尽放弃/终态中止/开关禁用 |
| 修改 | sillyhub-daemon/tests/turn-phase-observability.test.ts | 新增 notePhaseEmit 防重用例 |
