---
author: flow-machine-draft
created_at: 2026-10-22T02:18:51.962Z
---
# 任务注册表（Tasks）— 2026-10-21-task-wakeup-event-queue

- [x] task-01: message-queue-bar 将 origin==='task_wakeup' 的排队条目移出「排队消息」用户消息列表，不占计数 N
- [x] task-02: 唤醒条目单独渲染为事件行「✈ 收到任务消息 · N 个后台任务已结束 · 本轮结束后自动继续」折叠形态，可展开看通知全文（视觉平移 TaskWakeupNoticeView）
- [x] task-03: 用户消息排队条目渲染与计数行为零变化
- [x] task-04: 前端 tsc 零错 + message-queue-bar/use-message-queue 目标套件绿
