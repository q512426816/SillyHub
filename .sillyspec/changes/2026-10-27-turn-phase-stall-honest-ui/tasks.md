---
author: flow-machine-draft
created_at: 2026-10-27T03:15:55.524Z
---
# 任务注册表（Tasks）— 2026-10-27-turn-phase-stall-honest-ui

- [x] task-01: 轮状态条对 dispatched/delivered 阶段停留超时（沿用 30 秒阈值）的展示改为排队语义文案（保留已等待秒数），其余阶段超时行为零变化
- [x] task-02: 当轮收到任意 log 事件且 currentPhase 仍为 dispatched 或 delivered 时，立即清除该 phase，状态条退位回轮状态文案
- [x] task-03: frontend 既有 turn-phase 相关测试全部通过，并新增测试覆盖上述两个行为
- [x] task-04: 不改动后端与 daemon 代码
