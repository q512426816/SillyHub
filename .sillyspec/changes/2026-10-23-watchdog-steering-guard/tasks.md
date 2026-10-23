---
author: flow-machine-draft
created_at: 2026-10-23T08:09:55.208Z
---
# 任务注册表（Tasks）— 2026-10-23-watchdog-steering-guard

- [x] task-01: 先写失败测试：同 runId steering 不 stale-reset/不布防、事件新鲜不 stale、已观测 run 不布防（turn-start-watchdog.test.ts 新增用例先红）
- [ ] task-02: SessionState 增 lastTurnEventAt/observedRunIds；onMessage 刷新最后事件时间并记录当前 run（FR-02/FR-03 数据面）
- [ ] task-03: inject 增同 runId 守卫（跳过 stale-reset + 排队语义）与 stale 静默基准改最后事件时间（FR-01/FR-02）
- [ ] task-04: 首轮布防前检查 observedRunIds，已观测 run 跳过布防；补真僵尸轮不回归断言（FR-03/FR-04）
- [ ] task-05: 跑 daemon 相关 vitest 与 tsc --noEmit，全绿（FR-05）
