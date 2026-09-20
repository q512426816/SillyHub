---
author: qinyi
created_at: 2026-09-20 09:10:00
---

# 决策记录 — 2026-09-20-agent-log-session-replay

格式：id / status: accepted|rejected|superseded / source: user|code|docs / question / answer / normalized_requirement / impacts / evidence。修正走新版本 D-xxx@v2 + supersedes。

---

- id: D-001
  status: accepted
  source: user
  question: 回放主体（origin=tool_report 且 turn_count===0 会话）用哪种实现方案？（A TurnTimeline 直适配 / B 扩展现有 AgentLog 渲染器 / C 后端物化 turns 落库）
  answer: A：TurnTimeline 直适配——适配 NormalizedLogMessage→SessionTurnView，直接用现有 TurnTimeline 组件渲染回放主体。B 被否（视觉/交互与普通会话长期两套皮，缺对话/全部切换与轮导航）；C 被否（属已排除的 L3 落库路线，存储/同步协议大改）。
  normalized_requirement: 回放主体复用 TurnTimeline 组件体系（对话/全部视图模式、超长折叠、轮样式全部继承）；适配层负责消息→SessionTurnView 映射，无意义 props（pendingRequests/dialogHistory/onResend 等运行态）空置；不新造相似渲染器、不做后端 turns 物化。
  impacts: [FR-1, task-L1 全部]
  evidence: 用户方案选择轮次（AskUserQuestion 亲选「A：TurnTimeline 直适配」）；调研结论「直接按会话样式展示，只是数据来源不一样」（用户原话，2026-09-19 会话）
