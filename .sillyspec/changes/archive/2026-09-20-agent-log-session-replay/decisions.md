---
author: qinyi
created_at: 2026-09-20 09:10:00
---

# 决策记录 — 2026-09-20-agent-log-session-replay

## D-001@v1: 回放主体实现方案（A TurnTimeline 直适配 / B 扩展现有渲染器 / C 后端物化落库）

- 类型：architecture
- 状态：accepted
- 来源：user
- 问题：origin=tool_report 且 turn_count===0 会话的回放主体用哪种实现？
- 答案：A——适配 NormalizedLogMessage→SessionTurnView 直接用现有 TurnTimeline 渲染；B 被否（与普通会话长期两套皮、缺对话/全部切换与轮导航）；C 被否（属已排除的 L3 落库路线）。
- 规范化要求：回放主体复用 TurnTimeline（视图模式/超长折叠/轮样式继承）；运行态 props 空置；不新造相似渲染器、不做后端 turns 物化。
- 影响：[FR-01, task-07, task-08]
- 证据：用户 AskUserQuestion 亲选（2026-09-20 方案选择轮）；用户原话「直接按会话样式展示，只是数据来源不一样」（2026-09-19 会话）
