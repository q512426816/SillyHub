---
author: flow-machine-draft
created_at: 2026-10-27T04:37:17.255Z
---
# 提案书（Proposal）— 2026-10-27-turn-phase-observability-monotonic

## 动机

任务原话转写：生产实证（2026-10-27 会话 7eff99e1，run 4f2e2cdd）：first_event 信号丢失后前端 phase 停 delivered 干等 141 秒，而 daemon 上报是 fire-and-forget——POST 失败仅 debug 日志（生产 info 级不可见），排障只能靠打点推断；另评估确认 steering 忙轮注入的 dispatched/delivered 会覆盖已推进 phase（last-write-wins 无阶段序），显示退化真实存在。本次两项：daemon 上报失败提为首警 warn；前端 applyTurnPhase 加阶段单调守卫（投递段不覆盖执行段/first_event）并扩展 log 退位集合。

成功标准：
- daemon 层 turn_phase POST 失败从 debug 提为首警 warn（复用 turn-phase-observability 的 warnOncePhaseFailure 同 session+phase 去重惯例），成功仍静默
- 前端 applyTurnPhase 单调守卫：dispatched/delivered 不覆盖已是执行期阶段（skills_sync 至 inject_received）或 first_event 的 currentPhase（回退写静默丢弃，正常推进与乱序前跳不受影响）
- log 到达退位集合从 {dispatched, delivered} 扩展含 inject_received（AI 已输出的场合送达信号同样失去展示意义）
- 既有相关测试全绿，新增用例覆盖上述三项行为
- 后端 backend 代码零改动（daemon 与 frontend 各自范围内）

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. daemon 层 turn_phase POST 失败从 debug 提为首警 warn（复用 turn-phase-observability 的 warnOncePhaseFailure 同 session+phase 去重惯例），成功仍静默
2. 前端 applyTurnPhase 单调守卫：dispatched/delivered 不覆盖已是执行期阶段（skills_sync 至 inject_received）或 first_event 的 currentPhase（回退写静默丢弃，正常推进与乱序前跳不受影响）
3. log 到达退位集合从 {dispatched, delivered} 扩展含 inject_received（AI 已输出的场合送达信号同样失去展示意义）
4. 既有相关测试全绿，新增用例覆盖上述三项行为
5. 后端 backend 代码零改动（daemon 与 frontend 各自范围内）

## 成功标准（可验证）

1. daemon 层 turn_phase POST 失败从 debug 提为首警 warn（复用 turn-phase-observability 的 warnOncePhaseFailure 同 session+phase 去重惯例），成功仍静默
2. 前端 applyTurnPhase 单调守卫：dispatched/delivered 不覆盖已是执行期阶段（skills_sync 至 inject_received）或 first_event 的 currentPhase（回退写静默丢弃，正常推进与乱序前跳不受影响）
3. log 到达退位集合从 {dispatched, delivered} 扩展含 inject_received（AI 已输出的场合送达信号同样失去展示意义）
4. 既有相关测试全绿，新增用例覆盖上述三项行为
5. 后端 backend 代码零改动（daemon 与 frontend 各自范围内）
