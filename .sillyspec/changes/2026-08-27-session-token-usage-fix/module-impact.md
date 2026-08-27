---
author: qinyi
created_at: 2026-08-27 22:52:30
change: 2026-08-27-session-token-usage-fix
---

# 模块影响分析（Module Impact）

| 模块 | 文档 | 影响 | 操作 | 状态 |
|---|---|---|---|---|
| sillyhub-daemon | modules/sillyhub-daemon.md | session-manager usage 计数语义（轮级计数器新增、pendingUsage 轮级化、ctx_tokens 指标、cache 语义注释修正） | execute 完成后补充 usage 口径说明（本轮计费量 vs ctx 瞬时量、main 桶限定） | pending |
| backend | modules/backend.md | AgentRun 新列 ctx_tokens；submit_messages 提取守卫（ctx LWW vs 其余 max）；SSE payload 加字段；SessionRunRead 加字段 | execute 完成后更新 daemon 模块落库/SSE 契约描述 | pending |
| frontend | modules/frontend.md | session-panel 环分子口径（逆序最新非 null ctxTokens）；ctx-usage-bar usedTokens 可空 + 未知态；lib/daemon.ts envelope 字段 | execute 完成后更新会话面板口径描述 | pending |
| ci | modules/ci.md | 无变化（测试命令/闸门不变；gen:types 既有缺口 known-issue 已在库，本次不扩） | 无 | skipped |
| docs | modules/docs.md | 无变化 | 无 | skipped |
| sillyspec | modules/sillyspec.md | 无变化（本变更产物即流程自身文档） | 无 | skipped |
| _module-map.yaml | — | 无变化（未增删模块） | 无 | skipped |
