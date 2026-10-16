---
author: flow-machine-draft
created_at: 2026-10-16T11:20:00.458Z
---
# 决策记录（Decisions）— 2026-10-16-agent-session-field-pin-sync

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：钉子与真实模型再次漂移（后续给 agent_sessions 加列的人再次漏更）——护栏恰是本钉子自身（届时实测门会再拦，按本次同款流程补钉即可，local.yaml 豁免仅作过渡不长期留存）。曾考虑的替代方案：把字段集断言放宽为"包含关键列子集"以降低维护成本——放弃：钉子的价值恰在精确集，放宽即失去"未登记列变更"的探测能力。
