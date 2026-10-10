---
author: flow-machine-draft
created_at: 2026-10-10T11:30:35.734Z
---
# 提案书（Proposal）— 2026-10-10-turn-speed-enrich-backfill-test

## 动机

任务原话转写：动机：上一变更 2026-10-10-session-turn-token-speed 独立评审遗留唯一 P3——page-helpers.tsx enrichDisplayTurns 的 apiDurationMs 历史回填（?? 链补缺）与身份稳定守卫无行为测试，仅 typecheck 覆盖；补齐行为测试锁住回填优先级与 memo 稳定语义。
成功标准：
- 新增 enrichDisplayTurns 单测覆盖：快照 duration_api_ms 回填历史轮、turn 实时值优先不被快照覆盖、快照缺字段回填 null、runsMeta 未命中原样返回、字段一致时返回原对象引用（changed 守卫含 apiDurationMs）、仅 apiDurationMs 变化时返回新对象
- 测试文件 vitest 全绿，不跑全量

## 变更范围

按成功标准机械推导，共 2 条验收面：
1. 新增 enrichDisplayTurns 单测覆盖：快照 duration_api_ms 回填历史轮、turn 实时值优先不被快照覆盖、快照缺字段回填 null、runsMeta 未命中原样返回、字段一致时返回原对象引用（changed 守卫含 apiDurationMs）、仅 apiDurationMs 变化时返回新对象
2. 测试文件 vitest 全绿，不跑全量

## 成功标准（可验证）

1. 新增 enrichDisplayTurns 单测覆盖：快照 duration_api_ms 回填历史轮、turn 实时值优先不被快照覆盖、快照缺字段回填 null、runsMeta 未命中原样返回、字段一致时返回原对象引用（changed 守卫含 apiDurationMs）、仅 apiDurationMs 变化时返回新对象
2. 测试文件 vitest 全绿，不跑全量
