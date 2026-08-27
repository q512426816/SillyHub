---
author: qinyi
created_at: 2026-08-27 22:31:40
change: 2026-08-27-session-token-usage-fix
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话面板查看上下文用量环与每轮 token 徽标的最终用户 |
| daemon | sillyhub-daemon，usage 数据 producer（流事件解析/轮级计数/SSE 上报） |
| backend | FastAPI，usage 数据落库与分发（AgentRun 列、SSE publish、REST 回填） |
| frontend | Next.js，环与徽标 consumer（SSE 实时 + runs 历史回填） |

## 功能需求

### FR-01: 上下文环显示最近一次调用的提示词大小
覆盖决策：D-002@v1, D-003@v1, D-006@v1

Given 一个进行中/已完成的交互会话（daemon 已上报 ctx_tokens）
When 用户查看会话面板上下文用量环
Then 环分子 = displayTurns 逆序第一个非 null 的 ctxTokens（= 最近一次 API 调用 input+cache_read+cache_creation），百分比 = 分子 / 窗口分母（1M 勾选→1000k，否则模型默认 200k），浮层文案为 last-call 口径

Given 会话含子代理轮（子桶消息流）
When 子代理桶 flush 消息到达 backend
Then 子桶 pendingUsage 不含 ctx_tokens，环不被子代理上下文切换（仅 main 桶携带）

Given 历史会话（所有 run ctx_tokens 均为 NULL，如老 daemon 产生）
When 用户查看环
Then usedTokens 为 null → pct=null 未知态：中心显示"—"，不算百分比，不显示 0.0%

Given 运行中轮首个 message_start 到达前
When 环取最新非 null
Then 允许短暂取到上一轮 ctx（秒级自愈，接受，R-06）

### FR-02: 轮中实时值与终态值统一为本轮计费量口径
覆盖决策：D-001@v2, D-004@v1

Given 新的一轮开始（_onResult 已清零 turn 级计数器）
When daemon 流式处理该轮的 message_start / message_delta 并周期 flush
Then pendingUsage 的 input/output = 本轮至今累计（非会话累计），AgentRun 实时写回仅增不减；每轮徽标 ↑↓ 单调递增

When 轮终态 close_interactive_run 到达
Then input/output 以 SDK result 值权威覆盖（同为"本轮"语义；与实时累计的数值出入表现为终态定格时小幅校准，非跨语义暴涨回落）

Given R-09 spike（execute 首任务）
When 真实会话对照 daemon 轮级累计与终态 SDK result 两路数值
Then 偏差 ≤5% → 维持权威覆盖；偏差 >5% → 启用 fallback（close 仅当 result > 实时值才覆盖 input/output），结论记录 QUICKLOG

### FR-03: 会话累计量与既有行为零回归
覆盖决策：D-001@v2（会话累计保留）、D-005@v1（复用附带管线）

Given budget_tokens 已配置的会话
When 多轮对话（含子代理）后触发 _checkBudgetCutoff
Then 预算聚合仍基于会话级累计计数器（input+output 口径不变），跨轮不漏计；turn 级计数器不参与折算（折算时轮已结束）

Given 老 daemon（不发 ctx_tokens）与老数据（ctx_tokens NULL）
When backend 提取 usage / 前端渲染
Then 缺键跳过、NULL 不报错，既有 API/列语义不变

## 非功能需求

- 兼容性：SSE/REST payload 仅增 nullable 字段，旧前端忽略；请求 DTO 形状不变（close 不加字段）；alembic nullable 加列无回填。
- 可回退：ctx_tokens 全链路缺省即回到现状（求和口径前端另改，可独立回退）；daemon 轮级计数器回退 = 恢复跨轮不清零。
- 可测试：daemon vitest（计数器/清零/main 桶限定/budget 回归）、backend pytest（提取/写回守卫/SSE/序列化/终态不覆盖）、frontend vitest（环分子/未知态/实时更新）三层覆盖。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v2 | FR-02, FR-03 | 统一本轮增量 + 终态权威校准（supersedes D-001@v1，Grill B1） |
| D-002@v1 | FR-01 | ctx_tokens 落库 AgentRun 列 |
| D-003@v1 | FR-01 | 历史会话环未知态，不估算 |
| D-004@v1 | FR-02 | 每轮徽标本轮计费量语义 |
| D-005@v1 | FR-03 | 方案 A：复用 usage 附带管线全链路透传 |
| D-006@v1 | FR-01 | ctx_tokens 仅 main 桶（Grill B2） |

剩余风险：D-001@v1 已 superseded 无遗留；R-09（SDK result 口径单轮实证→execute 首任务验证 + fallback）为计划内验证项。
