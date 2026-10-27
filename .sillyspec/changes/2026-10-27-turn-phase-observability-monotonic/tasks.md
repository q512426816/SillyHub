---
author: flow-machine-draft
created_at: 2026-10-27T04:37:17.255Z
---
# 任务注册表（Tasks）— 2026-10-27-turn-phase-observability-monotonic

- [x] task-01: daemon 层 turn_phase POST 失败从 debug 提为首警 warn（复用 turn-phase-observability 的 warnOncePhaseFailure 同 session+phase 去重惯例），成功仍静默
- [x] task-02: 前端 applyTurnPhase 单调守卫：dispatched/delivered 不覆盖已是执行期阶段（skills_sync 至 inject_received）或 first_event 的 currentPhase（回退写静默丢弃，正常推进与乱序前跳不受影响）
- [x] task-03: log 到达退位集合从 {dispatched, delivered} 扩展含 inject_received（AI 已输出的场合送达信号同样失去展示意义）
- [x] task-04: 既有相关测试全绿，新增用例覆盖上述三项行为
- [x] task-05: 后端 backend 代码零改动（daemon 与 frontend 各自范围内）
