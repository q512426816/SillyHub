---
author: flow-machine-draft
created_at: 2026-10-25T11:51:27.294Z
---
# 设计记录（Design Record）— 2026-10-25-marquee-awaiting-real-data

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

调研结论：daemon→backend→SSE 已有 `tokens` 事件（执行中累积实时推送：input/output/
cache/ctx/duration_api_ms），轮级 `inputTokens`/`outputTokens` 已实时写入 turn 状态——
数据通道现成，无需 daemon/backend 改动。等待计时方面 daemon 无专门"请求已发出"事件，
最真实的可行口径 = 最后一条事件的**服务端时间戳**。

实现（纯前端三处）：

1. `TurnLiveMarquee` 新增 props `lastEventAt?: number | null` 与
   `turnTokens?: { input: number | null; output: number | null } | null`：
   - 等待起点优先 `lastEventAt`（`Date.now() - lastEventAt`，挂载即正确累计，刷新不重置），
     缺省回退客户端首次观察起点；
   - 等待条目文案有 token 时追加 `· ↑8,400 ↓1,250`（toLocaleString）。
2. `SegmentedTurnBody`（turn-timeline）派生 `lastEventAt = max(entry.endedAt ?? entry.startedAt ?? entry.ts)`
   并把 turn 的 `inputTokens`/`outputTokens` 一并传入（整页/弹窗共用路径，接线一次双生效）。
3. 子代理卡片内嵌条不传这两个 props（token 作用域是主轮；卡片有自身时间语义）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `TurnLiveMarqueeProps` 新增 `lastEventAt?: number | null`、`turnTokens?: {...} | null`。
- 等待条目文案变化（追加 token 段）；计时起点来源变化（服务端优先）。
- daemon / backend / SSE 协议 / `api-types.ts`：**无变化**。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立。lastEventAt 取当前条目集最大值，迟到事件只会推大它（等待重新起算，符合"刚有新事件"语义）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 无写面；token 快照来自 turn 状态（SSE 单流顺序更新）。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。lastEventAt 为纯派生值；Date.now 与服务端时间有秒级偏差（挂钟差异），对"感知级"等待计时可接受。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不会。token/时间均为当前轮 turn 状态派生。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：本机与服务器时钟偏差使等待时长有几秒误差——感知级展示可接受；如需精确可后续由 daemon 推等待起点事件（跨服务改动，本次不做）。
- 等待期间 token 不再增长（tokens 事件随日志批次到达，等待期无新批次）——显示的是"本轮已消耗"快照，语义如实。
- 放弃方案：① daemon 新增"API 请求开始"心跳事件（跨服务改动大，收益秒级）；② 等待条目显示 ctx 环（已有轮头状态条展示，避免重复）；③ 前端轮询 usage 接口（无谓请求）。
