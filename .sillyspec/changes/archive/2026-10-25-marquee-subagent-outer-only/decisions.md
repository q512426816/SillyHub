---
author: flow-machine-draft
created_at: 2026-10-25T02:17:59.765Z
---
# 决策记录（Decisions）— 2026-10-25-marquee-subagent-outer-only

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 风险：startedAt 为历史挂钟时间时，挂载即显示已运行很久的时长——这是真实时长（attach 场景），符合预期；缺省客户端起点在重挂载后偏短（既有披露边界）。 - 1s tick 每秒重渲染列表（13 条）——与等待条目共用同一 tick，成本可忽略。 - 放弃方案：① 外部保留内部消息但折叠（用户明确外部只要容器信息）；② 为 running 条目单独每条一个 interval（多条 running 时多 interval，统一 tick 更省）；③ 子代理卡片内再加跑马灯（重复信息，卡片已有完整过程行）。
