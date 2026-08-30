---
author: qinyi
created_at: 2026-08-27 22:31:05
change: 2026-08-27-session-token-usage-fix
---

# 提案书（Proposal）

## 动机

会话面板的"上下文用量环"数值严重失真（实证 6 轮会话累加 ≈394 万 vs 200K 窗口，永远显示爆表 100%），且每轮进行中数字暴涨、轮结束骤降。用户排查确认三处口径错误：环分子求和语义错、ctx 指标缺失、实时/终态两套口径混用。本提案引入"最近一次 API 调用提示词大小（ctx_tokens）"指标并统一轮级口径，使环真实反映上下文窗口占用。

## 关键问题

1. **环分子口径错误**：`session-panel.tsx` 把各轮 `input_tokens` 求和当上下文用量；但每轮值是该轮内所有 API 调用（含工具循环重发上下文）的输入总和，跨轮求和重复计算整个历史，数字超线性膨胀。
2. **ctx 指标缺失**：开 prompt caching 后大部分上下文在 cache_read 里，现有数据模型没有任何字段表示"最近一次调用的提示词大小"，环无法算对。
3. **实时/终态口径不一致**：daemon 实时上报会话累计值，轮终态又被 SDK result 本轮值覆盖（实证 turn1 终态 1,092,740 → turn2 轮中 ≥1.09M → turn2 终态 144,212），数字每轮暴涨骤降。

## 变更范围

- daemon：PartialFlushBuffer 新增轮级计数器（turnInput/turnOutput）与 lastCallCtxTokens（仅 main 桶），轮边界清零，pendingUsage 改轮级值并携带 ctx_tokens，cache 语义注释修正。
- backend：`agent_runs` 加 `ctx_tokens` 列（迁移）；submit_messages 提取 ctx_tokens（last-write-wins）+ SSE 两路 payload 透传；SessionRunRead 加字段；close 终态不覆盖 ctx_tokens。
- frontend：环分子改"逆序最新非 null ctxTokens"；usedTokens 可空 + 未知态渲染；SSE envelope 手写类型补字段；文案更新。
- execute 首任务跑 R-09 spike（真实会话验证 SDK result 与轮级累计一致性，备 fallback）。

## 不在范围内（显式清单）

- 不改 `AgentRun.cache_read/cache_creation_tokens` 列语义与 runtimes 用量页 SUM(cache) 既有偏差（NG-01，记 R-08 后续变更）。
- 不做会话累计总量的后端聚合列（NG-02）。
- 不动 budget/预算检查逻辑（NG-03，仅保证数据源零回归）。
- 不迁移历史数据/旧值换算（NG-04，历史 run ctx_tokens=NULL → 环未知态）。
- 不改环组件视觉/布局/交互，无 HTML 原型（NG-05）。

## 成功标准（可验证）

- 新会话多轮对话后，环显示值 ≈ 最近一次调用的提示词大小且 < 窗口分母（不再恒 100%）。
- 同一 run 轮中实时值与终态值语义一致（均为本轮计费量）：轮中徽标单调递增，终态定格无跨语义暴涨回落（允许终态小幅校准，R-09）。
- 老 daemon / 历史会话：环显示未知态，无报错。
- budget 检查行为零回归（daemon 测试断言会话级聚合）。
- 既有测试全绿（仅本变更相关测试新增/调整）。
