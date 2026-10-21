---
author: flow-machine-draft
created_at: 2026-10-21T03:53:34.220Z
---
# 决策记录（Decisions）— 2026-10-21-task-wakeup-restore

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是产品语义回退复发——本次恢复与 10-13 删除是同一取舍的正反对翻，为防「短任务噪音」复发，阈值门槛 + 0 关闭阀 + stopped 不唤醒三重降噪全部保留；若未来 claude 引擎在流式模式原生自续跑，会出现双轮，届时设 SILLYHUB_TASK_WAKEUP_QUIET_MS=0 一键关闭（[TASK_NOTIFICATION]/注入行可观测，当天可发现）。次要风险：未知帧降级桶（codex/cursor 未知事件映射 subtype='task_notification'）理论上可携带 task_id 进入唤醒判定——旧链六周共存无误触发记录（降级桶帧通常无 task_id，strOf 早退），恢复时保持原样不加新防线，避免为理论面扩表。死路：①「daemon 私推引擎流绕过 backend」——已否决，幽灵轮无审计无权限路由（$46 事故先例）；②「前端折叠系统行升级」——原裁定本变更不做，执行期用户改判（dsh「收到任务消息」形态实证后明确要求可见留痕），已并入 FR-06；③「local.yaml 阈值载体」——放弃改 env，理由见做法概述。
