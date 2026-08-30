---
author: qinyi
created_at: 2026-08-27 22:32:10
change: 2026-08-27-session-token-usage-fix
---

# 任务清单（Tasks）

- [x] task-01: R-09 spike——真实会话验证 SDK result usage 与 daemon 轮级累计一致性（结论记 QUICKLOG，偏差 >5% 则 task-05 启用 fallback）→ 降级离线分析：7 会话 28 轮全支持 result=Σ per-call，维持权威覆盖、不预置 fallback（spike-r09.md）
- [x] task-02: daemon turn 级计数器 + lastCallCtxTokens（仅 main 桶）+ 轮边界清零 + pendingUsage 轮级化与 ctx_tokens 注入 + cache 注释修正（含 batch 错引）
- [x] task-03: daemon vitest——跨轮清零 / ctx 三分量与 main 桶限定 / 子桶 max 聚合断言 / budget 与会话级折算零回归 (depends_on: task-02)
- [x] task-04: backend AgentRun.ctx_tokens 列 + alembic 迁移
- [x] task-05: backend submit_messages 提取 ctx_tokens（last-write-wins）+ SSE 两路 payload 透传 + SessionRunRead 加字段（close 不加不覆盖） (depends_on: task-01, task-04)
- [x] task-06: backend pytest——提取与写回守卫 / SSE payload / SessionRunRead / close 不覆盖 ctx_tokens (depends_on: task-05)
- [x] task-07: frontend gen:types + lib/daemon.ts SessionStreamEnvelope 补 ctx_tokens（手写 SSE 类型跳） (depends_on: task-05)
- [x] task-08: frontend session-panel 环分子改逆序最新非 null ctxTokens + ctx-usage-bar usedTokens 可空与未知态渲染 + 文案更新 (depends_on: task-07)
- [x] task-09: frontend vitest——环分子口径 / 未知态 / SSE 实时更新 (depends_on: task-08)
