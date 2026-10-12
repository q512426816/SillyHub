---
author: flow-machine-draft
created_at: 2026-10-12T01:46:57.448Z
---
# 决策记录（Decisions）— 2026-10-12-duration-nan-guard

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 风险：极低——SDK 实际报 NaN/Infinity 概率极低（审查原判「触发概率极低，仅口径不对称」），门控只在异常输入时改变行为。 - 放弃方案 A：非有限值记 warn 日志——审查明示「零新日志面」，且低概率事件打日志徒增噪音；跳过即静默对齐「SDK 未报」既有语义。 - 放弃方案 B：payload 显式置 null 上报——backend `int|None` 收 null 等价于不报，但会把「未报」与「报了非法值」两种形态混为一谈；直接不携带键更干净。
