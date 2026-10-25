---
author: flow-machine-draft
created_at: 2026-10-24T16:08:34.422Z
---
# 设计记录（Design Record）— 2026-10-24-trajectory-context-rows

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

DB 取证（agent_run_logs 按 channel 聚合）确认系统注入信息以 user_input 落库、装配成 `turn_trigger` 段，而上变更接的 processItems.system_event 在实时/历史路径均近乎为空。本变更把数据源修正到真实载体：`rowKindOf` 将 `turn_trigger` 从 `user` 改映射为 `system`，并在行构造处置 `meta.contextEvent=true`（账本标签「上下文」，对齐 dsh「收到任务消息」形态）；`segmentStart` 改为对所有段统一「先 startedAt、再 ts」读取，使 turn_trigger / user_msg / stderr 等 ts 系段获得真实锚点、不再全部挤在轮首。两处都在 `from-turn-views.ts` 单文件内，派生是纯函数、幂等。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外接口变化。`trajectoryFromTurnViews` 签名不变，产物行为差异：turn_trigger 段由「用户」行变为「上下文」行（kind=system + meta.contextEvent）；ts 系段锚点由轮首变为真实 ts。无后端/API/DTO 变更。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。行仍按 startedAt 排序（既有机制）；锚点来源变化只影响排序位置的正确性，不改排序算法。turn_trigger 段 id 含段 id，流式追加稳定。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

无并发写面：纯函数派生 + 只读消费。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。无新增状态；上下文行是派生产物，随 turns 更新幂等重算。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。段来自当前会话轮视图，无跨会话读取。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险：turn_trigger 含「用户亲笔来源标注」类（shadow_chat/group_chat/schedule，contentHidden=false）——它们也显示为「上下文」行。接受：dsh 同款形态（触发源即 context 行），且行摘要有原文，用户可辨识；如需区分可后续按 trigger 字段细分。放弃的方案：继续用 processItems.system_event 作数据源——DB 实证该路径近乎恒空，修不动；为注入信息新增后端 channel——跨端大改，本平台注入已有 turn_trigger 承载，无需新通道。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/trajectory/from-turn-views.ts | rowKindOf：turn_trigger → system（行构造置 meta.contextEvent）；segmentStart：统一先 startedAt 再 ts |
| 修改 | frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts | turn_trigger 上下文行用例 + user_msg ts 锚点用例 |
