---
author: flow-machine-draft
created_at: 2026-10-22T02:18:51.962Z
---
# 提案书（Proposal）— 2026-10-21-task-wakeup-event-queue

## 动机

任务原话转写：唤醒通知排队呈现改为事件形式
动机与背景：2026-10-21-task-wakeup-restore 恢复终态唤醒链后，忙轮滞留期的唤醒通知仍以「排队消息」形式呈现（message-queue-bar 用户消息 chip、占计数、与用户排队混列）——用户裁定应采用 dsh turn-trigger 同款事件反馈形式（收到任务消息·待本轮结束自动继续），全程不出现「排队消息」用户语义。后端已就绪零改动：排队行持久化 origin='task_wakeup'（TASK_WAKEUP_QUEUE_ORIGIN）、pending 计数豁免、多条合并；前端排队 hook DTO 已带 origin 字段。

成功标准：
- message-queue-bar 将 origin==='task_wakeup' 的排队条目移出「排队消息」用户消息列表，不占计数 N
- 唤醒条目单独渲染为事件行「✈ 收到任务消息 · N 个后台任务已结束 · 本轮结束后自动继续」折叠形态，可展开看通知全文（视觉平移 TaskWakeupNoticeView）
- 用户消息排队条目渲染与计数行为零变化
- 前端 tsc 零错 + message-queue-bar/use-message-queue 目标套件绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. message-queue-bar 将 origin==='task_wakeup' 的排队条目移出「排队消息」用户消息列表，不占计数 N
2. 唤醒条目单独渲染为事件行「✈ 收到任务消息 · N 个后台任务已结束 · 本轮结束后自动继续」折叠形态，可展开看通知全文（视觉平移 TaskWakeupNoticeView）
3. 用户消息排队条目渲染与计数行为零变化
4. 前端 tsc 零错 + message-queue-bar/use-message-queue 目标套件绿

## 成功标准（可验证）

1. message-queue-bar 将 origin==='task_wakeup' 的排队条目移出「排队消息」用户消息列表，不占计数 N
2. 唤醒条目单独渲染为事件行「✈ 收到任务消息 · N 个后台任务已结束 · 本轮结束后自动继续」折叠形态，可展开看通知全文（视觉平移 TaskWakeupNoticeView）
3. 用户消息排队条目渲染与计数行为零变化
4. 前端 tsc 零错 + message-queue-bar/use-message-queue 目标套件绿
