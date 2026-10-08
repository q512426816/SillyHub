---
author: flow-machine-draft
created_at: 2026-10-08T17:55:09.446Z
---
# 决策记录（Decisions）— 2026-10-09-daemon-api-types-regen

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：大 diff（5625+/1591-）可能携带生成器版本差异噪音（openapi-typescript 7.13.0 与上次生成版本的输出形态差）——已由 daemon tsc 0 error 消解编译面疑虑；类型联合收缩理论上可能破坏穷举 switch，但 grep 实证 daemon 源码零处按值消费被删键。试过放弃：(a) 手改 Permission 联合一处——放弃，其余多轮落后面仍在且手改生成物必漂移；(b) 顺带把 gen:types:check 接进 CI workflow——放弃，超出本变更（审查风险收口）范围，留作后续建议。
