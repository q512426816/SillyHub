---
author: flow-machine-draft
created_at: 2026-10-12T00:26:50.073Z
---
# 提案书（Proposal）— 2026-10-12-duration-backfill-harness-align

## 动机

任务原话转写：动机：昨日守卫（duration_api_ms > duration_ms 拒收）被用户正确质疑——子代理并行时 Σ(各代理 API 窗口) > 父轮墙钟是合法形态，守卫会拒掉真实值。对照 deepseek-harness（packages/session/session-stats/src/projection.ts:154-175）本地源码：终态时长权威=事件层自测窗口逐步累加（llmMs/decodeMs），不消费提供方 duration 聚合，Σ窗口>墙钟合法无守卫。本平台等价物=已建的实时窗口累加（usage.api_duration_ms），close 的 SDK 元数据只能当回填。
成功标准：
- close_interactive_run 撤墙钟拒收守卫，改为仅回填：AgentRun.duration_api_ms 列已有值（daemon 实时窗口累计）时 close 不覆盖，列 NULL 时才写 close 值
- 删除昨日两守卫用例，新增/改写用例：已有值不覆盖、NULL 时回填
- 模块卡（backend daemon.md）同步修正语义描述
- 两侧测试绿，不跑全量

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. close_interactive_run 撤墙钟拒收守卫，改为仅回填：AgentRun.duration_api_ms 列已有值（daemon 实时窗口累计）时 close 不覆盖，列 NULL 时才写 close 值
2. 删除昨日两守卫用例，新增/改写用例：已有值不覆盖、NULL 时回填
3. 模块卡（backend daemon.md）同步修正语义描述
4. 两侧测试绿，不跑全量

## 成功标准（可验证）

1. close_interactive_run 撤墙钟拒收守卫，改为仅回填：AgentRun.duration_api_ms 列已有值（daemon 实时窗口累计）时 close 不覆盖，列 NULL 时才写 close 值
2. 删除昨日两守卫用例，新增/改写用例：已有值不覆盖、NULL 时回填
3. 模块卡（backend daemon.md）同步修正语义描述
4. 两侧测试绿，不跑全量
