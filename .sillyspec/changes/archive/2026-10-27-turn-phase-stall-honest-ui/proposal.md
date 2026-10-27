---
author: flow-machine-draft
created_at: 2026-10-27T03:15:55.524Z
---
# 提案书（Proposal）— 2026-10-27-turn-phase-stall-honest-ui

## 动机

任务原话转写：会话忙时用户消息在 backend 排队/派发链路滞留（生产实证 2026-10-27 会话 7eff99e1：消息 10:38 发出、10:47:36 才注入 daemon），期间前端轮状态条唯一 phase=delivered 无限计时且无排队语义，用户误以为卡死（等待 141 秒截图求助）；且该轮一旦有真实输出，停滞的 delivered 也不自动退位。本次为纯前端显示层兜底修复。

成功标准：
- 轮状态条对 dispatched/delivered 阶段停留超时（沿用 30 秒阈值）的展示改为排队语义文案（保留已等待秒数），其余阶段超时行为零变化
- 当轮收到任意 log 事件且 currentPhase 仍为 dispatched 或 delivered 时，立即清除该 phase，状态条退位回轮状态文案
- frontend 既有 turn-phase 相关测试全部通过，并新增测试覆盖上述两个行为
- 不改动后端与 daemon 代码

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 轮状态条对 dispatched/delivered 阶段停留超时（沿用 30 秒阈值）的展示改为排队语义文案（保留已等待秒数），其余阶段超时行为零变化
2. 当轮收到任意 log 事件且 currentPhase 仍为 dispatched 或 delivered 时，立即清除该 phase，状态条退位回轮状态文案
3. frontend 既有 turn-phase 相关测试全部通过，并新增测试覆盖上述两个行为
4. 不改动后端与 daemon 代码

## 成功标准（可验证）

1. 轮状态条对 dispatched/delivered 阶段停留超时（沿用 30 秒阈值）的展示改为排队语义文案（保留已等待秒数），其余阶段超时行为零变化
2. 当轮收到任意 log 事件且 currentPhase 仍为 dispatched 或 delivered 时，立即清除该 phase，状态条退位回轮状态文案
3. frontend 既有 turn-phase 相关测试全部通过，并新增测试覆盖上述两个行为
4. 不改动后端与 daemon 代码
