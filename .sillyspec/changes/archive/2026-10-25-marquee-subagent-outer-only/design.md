---
author: flow-machine-draft
created_at: 2026-10-25T02:08:04.767Z
---
# 设计记录（Design Record）— 2026-10-25-marquee-subagent-outer-only

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

1. **外部收敛**：`deriveLiveMarqueeEntries` 的 `tool`（带 children）与 `subagent_stub` 分支删除
   `collectEntries(seg.children, ...)` 递归——外部轨道只保留容器条目（名称/状态/耗时）；
   子代理内部消息继续由对话流子代理卡片（SubagentBlockView，isConversationSegment 放行路径）展示，
   该路径零改动。
2. **运行中走秒计时**：组件加统一 1s tick（存在 running 条目或等待条目时运行），running 条目的
   已运行时长 = `now - (entry.startedAt ?? runtimeStarts[id])`，由 `MarqueeItemView` 新增 prop
   `runningElapsedMs` 在转圈旁以 `⏱ Ns` 展示；无起点只转圈。完成后仍显示总耗时（现状）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `deriveLiveMarqueeEntries`：不再产出子代理内部条目（行为变化，签名不变）。
- `MarqueeItemView` 新增可选 prop `runningElapsedMs?: number | null`（内部组件，不导出）。
- 组件内部新增 1s tick state；无新增对外 props / 导出函数。
- CSS / 后端接口 / `api-types.ts`：**无变化**。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立。容器条目与内部条目独立；不递归后顺序更简单；计时起点用段 startedAt（挂钟）或首次观察时刻，与顺序无关。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 无写面；1s tick 为组件内部 state。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。tick interval 在 cleanup 清除；条目完成即从走秒切换为总耗时；子代理卡片路径未动。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不涉及数据；每实例独立。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：startedAt 为历史挂钟时间时，挂载即显示已运行很久的时长——这是真实时长（attach 场景），符合预期；缺省客户端起点在重挂载后偏短（既有披露边界）。
- 1s tick 每秒重渲染列表（13 条）——与等待条目共用同一 tick，成本可忽略。
- 放弃方案：① 外部保留内部消息但折叠（用户明确外部只要容器信息）；② 为 running 条目单独每条一个 interval（多条 running 时多 interval，统一 tick 更省）；③ 子代理卡片内再加跑马灯（重复信息，卡片已有完整过程行）。
