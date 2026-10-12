---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 设计记录（Design Record）— 2026-10-12-duration-nan-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

daemon.ts 的 duration_api_ms 差分（2026-10-10-duration-api-cumulative-fix 引入）入口只做 `typeof === 'number'` 门——NaN/Infinity 均通过；同函数上方 total_cost_usd 既有 `Number.isFinite` 守卫，口径不对称。SDK 若报非有限值：NaN 参与 `durSnapshot < durBase` 比较恒 false 走差分分支得 NaN，序列化为 null 被 backend `duration_api_ms: int|None` 静默吞掉（终态 tok/s 分母缺失、无日志痕迹），且 `set(sessionId, NaN)` 污染基线使后续合法快照差分恒 NaN。修法：入口叠 `Number.isFinite`（对齐 cost 口径），非有限值整体跳过该块——payload 不带键（语义同「SDK 未报」）、基线零触碰。一行条件变更，零新日志面。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 仅 onTurnResult 内 duration_api_ms 差分块入口条件；可观察变化：非有限 duration_api_ms 不再产生 NaN payload/污染基线（缺陷行为修正，无消费方依赖）；有限值行为逐字不变。无 schema/端点变化，`pnpm gen:types` 不需跑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不受影响：门控在差分计算之前，非法值即跳过；合法值的差分/复位/基线生命周期（onSessionEnd/onSessionReloaded 回收）零变化。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   基线 Map 写入路径唯一（本块），门控只减少写入（NaN 不再写），无新并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用：纯值门控；基线回收（会话终态/重载）与门控正交，NaN 永不入 Map 后回收语义无新增例外。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不适用：sessionId 作用域的基线读写边界零变化。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：极低——SDK 实际报 NaN/Infinity 概率极低（审查原判「触发概率极低，仅口径不对称」），门控只在异常输入时改变行为。
- 放弃方案 A：非有限值记 warn 日志——审查明示「零新日志面」，且低概率事件打日志徒增噪音；跳过即静默对齐「SDK 未报」既有语义。
- 放弃方案 B：payload 显式置 null 上报——backend `int|None` 收 null 等价于不报，但会把「未报」与「报了非法值」两种形态混为一谈；直接不携带键更干净。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | sillyhub-daemon/src/daemon.ts | duration_api_ms 差分入口叠 Number.isFinite 门 |
| 改 | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | 新增 NaN 不进 payload/不污染基线用例 |
