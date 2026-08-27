---
author: qinyi
created_at: 2026-08-27 22:40:15
change: 2026-08-27-session-token-usage-fix
plan_level: full
---

# 实现计划（Plan）— 会话 token 统计口径修复

## Spike 前置验证

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| spike-01（task-01，R-09） | 真实会话 2+ 轮（含子代理更佳）：daemon 流内逐 message_start 的 input_tokens 求和（临时日志，不提交）对照该轮终态 SDK result `usage.input_tokens`（DB `agent_runs` 落库值） | 各轮偏差 ≤5%（DB 已有 turn 1 单轮实证相等） | task-05 的 close 终态覆盖加 fallback 守卫（仅当 result > 实时写入值才覆盖 input/output），结论记 QUICKLOG |

> 环境不可跑真实会话时的降级：依据既有 turn 1 DB 实证 + SDK result 与轮级累计同为"本轮 Σ per-call"口径推定，维持权威覆盖（D-001@v2 默认），风险记 QUICKLOG，fallback 代码不预置。

## Wave 0（spike 前置）
- task-01

## Wave 1（并行，无依赖）
- task-02
- task-04

## Wave 2（依赖 Wave 1）
- task-03
- task-05

## Wave 3（依赖 Wave 2）
- task-06
- task-07

## Wave 4（依赖 Wave 3）
- task-08

## Wave 5（依赖 Wave 4）
- task-09

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | R-09 spike：真实会话验证 SDK result 与轮级累计一致性 | W0 | P1 | — | FR-02, D-001@v2 | 临时日志补丁不提交；结论决定 task-05 是否带 fallback |
| task-02 | daemon turn 级计数器 + lastCallCtxTokens（仅 main 桶）+ 轮边界清零 + pendingUsage 轮级化 + 注释修正 | W1 | P0 | — | FR-01, FR-02, FR-03, D-001@v2, D-006@v1 | session-manager.ts；turn 级不折算；会话级计数器原样保留 |
| task-03 | daemon vitest | W2 | P0 | task-02 | FR-01, FR-02, FR-03, R-05 | 跨轮清零/ctx 三分量与 main 桶限定/子桶 max 聚合断言/budget 与会话级折算零回归 |
| task-04 | backend AgentRun.ctx_tokens 列 + alembic 迁移 | W1 | P0 | — | FR-01, D-002@v1 | nullable 加列无回填；down_revision 锚当前唯一 head |
| task-05 | backend submit_messages 提取（last-write-wins）+ SSE 两路透传 + SessionRunRead 加字段 | W2 | P0 | task-04（列）；task-01（fallback 与否） | FR-01, FR-02, D-005@v1 | close 不加不覆盖 ctx_tokens；input/output 终态权威覆盖（spike 不通过则加守卫） |
| task-06 | backend pytest | W3 | P0 | task-05 | FR-01, FR-03 | 提取与写回守卫/SSE payload/SessionRunRead/close 不覆盖 |
| task-07 | frontend gen:types + lib/daemon.ts envelope 补 ctx_tokens | W3 | P0 | task-05 | FR-01, D-005@v1 | 先查 node_modules 健康（规则 20）；手写 SSE 类型单独补 |
| task-08 | frontend session-panel 环分子改逆序最新非 null + ctx-usage-bar 可空与文案 | W4 | P0 | task-07 | FR-01, FR-02, D-003@v1, D-004@v1 | usedTokens: number \| null + 未知态渲染；徽标不动 |
| task-09 | frontend vitest | W5 | P0 | task-08 | FR-01, FR-02 | 环分子口径/未知态/SSE 实时更新 |

## 关键路径

task-01 → task-05 → task-07 → task-08 → task-09（backend 契约链决定最短交付；task-02→03 与 task-04 为并行支线）

## 全局验收标准

1. daemon 相关测试（session-manager usage 系列）通过：跨轮清零、ctx 仅 main 桶、budget 聚合仍会话级（R-01/R-05 断言口径见 design §10）。
2. backend 相关测试通过：ctx_tokens last-write-wins 写回、SSE payload 含 ctx_tokens、SessionRunRead 序列化、close 不覆盖 ctx_tokens。
3. frontend 相关测试通过：环分子 = 逆序最新非 null、全 null 未知态（非 0.0%）、SSE 实时更新。
4. 集成冒烟（integration-critical）：本地部署跑真实会话 2+ 轮，DB `agent_runs.ctx_tokens` 非 NULL 且量级 ≈ 上下文大小（< 窗口分母）；环显示与 DB 一致。
5. （brownfield）老 daemon/老数据路径：ctx 缺失时环未知态、无报错；budget 行为零回归。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2 | task-01, task-02, task-05 | spike QUICKLOG + 轮级实时值 + 终态权威覆盖（AC-1/2） |
| D-002@v1 | task-04, task-05, task-08 | ctx_tokens 列 + 落库 + 环读取（AC-2/4） |
| D-003@v1 | task-08, task-09 | 全 null 未知态用例（AC-3/5） |
| D-004@v1 | task-02, task-08 | 轮级实时值递增、徽标终态定格（AC-1） |
| D-005@v1 | task-05, task-07 | usage 附带管线全链路透传（AC-2/3） |
| D-006@v1 | task-02, task-03 | ctx 仅 main 桶 + 用例（AC-1） |
