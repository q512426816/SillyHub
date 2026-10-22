---
author: flow-machine-draft
created_at: 2026-10-22T02:51:16.292Z
---
# 决策记录（Decisions）— 2026-10-21-task-wakeup-event-queue

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是唤醒条目操作能力收窄的争议——事件行不提供 ✕ 删除/⚡ 立即发送，用户若想丢弃一条待派发通知没有入口（现状 chip 有 ✕）。接受理由：通知是系统自治行为（派发由本轮结束自动触发、会话 interrupt 后立即派发），人工删除是伪需求；且后端删除端点对 task_wakeup 行的权限语义未经核实，前端先不给入口避免能力错配。若后续真有需求，单开小变更核实后端语义后补。死路：①「mid-turn steering 直注入活跃轮」——已否决，router 层 2026-09-20 起恒排队（steering 收敛到队列条 ⚡ 显式入口），为通知重开 steering 通道违背收敛裁定且打断用户可见的执行流；②「泛化 turn_trigger 段（schedule/channel/auto_resume 全分类学）」——本变更不做，呈现架构级泛化留独立变更；③「事件行移出 MessageQueueBar 独立组件」——放弃理由见做法概述。
