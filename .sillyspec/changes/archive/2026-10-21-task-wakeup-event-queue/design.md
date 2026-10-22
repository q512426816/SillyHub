---
author: flow-machine-draft
created_at: 2026-10-22T02:18:51.962Z
---
# 设计记录（Design Record）— 2026-10-21-task-wakeup-event-queue

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：纯前端一处分流——MessageQueueBar（message-queue-bar.tsx）内把 entries 按结构化标记 `origin === "task_wakeup"` 分为用户消息组与唤醒通知组：用户消息组走既有 chip 行全逻辑（计数/满员/拖拽/操作，输入序 = 原条目序剔除唤醒条目，拖拽 override 只作用于该组）；唤醒组渲染为独立事件行（✈ 收到任务消息（N 个后台任务已结束 · 本轮结束后自动继续）▸，折叠/展开全文，零操作按钮）。选组件内分流而非新增独立事件条组件：事件行与排队条同源同生命周期（同一队列轮询、派发后同消失），分拆组件会引入重复的加载/空态协调；视觉平移 TaskWakeupNoticeView 的折叠行语义（上一变更产物），两处呈现在时间线与队列栏形成同一事件旅程的两种状态。dsh 考据结论（turn-trigger.ts "claimed to begin a Turn"）证实其机械同样等轮末开新轮、差异纯在呈现，故不改派发机制。后端零改动（origin 已落排队行、计数豁免、合并逻辑均就绪）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- MessageQueueBar（frontend/src/components/daemon/message-queue-bar.tsx）：组件 props 签名不变；渲染行为变化——「排队消息（N）」N 与满员判定改为只计用户消息条目（origin !== 'task_wakeup'）；origin='task_wakeup' 条目渲染为事件行（无 chip、无操作、不可拖拽）。既有条件渲染分支（taskwakeup-hide 前缀剥离、✎ 抑制）保留为兜底（origin 缺失的存量伪造前缀条目行为不变）。
- use-message-queue hook / backend 端点 / 数据格式：零改动（QueueEntry.origin 字段 2026-09-12 起已存在，后端排队行 origin='task_wakeup' 2026-10-11 起已持久化）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。分流是渲染期纯函数（按 entry.origin 过滤），条目到达顺序/轮询刷新时序不影响分组结果；后端合并语义保证 pending 唤醒条目至多一条（_merge_task_wakeup_prompt 不新增行），多条唤醒条目并发到达的窗口内前端按数组序各渲染一行事件行，防御性正确。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：组件为纯展示（不持队列真相、不写），并发面归 useMessageQueue 的轮询/load 单真相源（R-02 既有口径）；拖拽 override 状态只由用户消息条目产生（唤醒条目不可拖、不进 orderIds），无交叉写。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。事件行随条目删除（派发成功即删行的既有语义）自然消失；本轮结束自动派发后新轮头部由上一变更的 task_wakeup 折叠行接管呈现——事件从「待续」到「已继续」的旅程由两条已实现的呈现路径衔接，无中间态残留；expandedId/editingId 状态在条目移除时既有防御（byId 查不到即消失）覆盖唤醒条目。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。分流判定基于本会话队列条目自带的 origin 字段（服务端凭证写入、Bearer 用户不可伪造——2026-10-11 门控），无跨会话/跨实例聚合面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是唤醒条目操作能力收窄的争议——事件行不提供 ✕ 删除/⚡ 立即发送，用户若想丢弃一条待派发通知没有入口（现状 chip 有 ✕）。接受理由：通知是系统自治行为（派发由本轮结束自动触发、会话 interrupt 后立即派发），人工删除是伪需求；且后端删除端点对 task_wakeup 行的权限语义未经核实，前端先不给入口避免能力错配。若后续真有需求，单开小变更核实后端语义后补。死路：①「mid-turn steering 直注入活跃轮」——已否决，router 层 2026-09-20 起恒排队（steering 收敛到队列条 ⚡ 显式入口），为通知重开 steering 通道违背收敛裁定且打断用户可见的执行流；②「泛化 turn_trigger 段（schedule/channel/auto_resume 全分类学）」——本变更不做，呈现架构级泛化留独立变更；③「事件行移出 MessageQueueBar 独立组件」——放弃理由见做法概述。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | frontend/src/components/daemon/message-queue-bar.tsx | origin 分流 + 事件行渲染 + 计数/满员/拖拽收窄到用户消息组 |
| 改 | frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx | 分流/事件行/纯唤醒队列/伪造前缀不误判用例 |
