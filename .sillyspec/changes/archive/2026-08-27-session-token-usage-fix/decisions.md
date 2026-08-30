---
author: qinyi
created_at: 2026-08-27 21:42:15
change: 2026-08-27-session-token-usage-fix
---

# 决策记录（brainstorm）

## D-001@v1: 实时/终态统一口径 = 本轮增量（per-run 计费量）
- type: architecture
- priority: P0
- status: superseded
- supersedes_by: D-001@v2（Design Grill B1：v1 的"实时写回与终态覆盖必须相等"假设依赖未证的 SDK result 聚合口径，改为终态权威校准语义）
- source: code
- question: 轮中实时上报（会话累计）与终态落库（本轮和）口径不一致导致数字跳变，统一到哪边？
- answer: 统一到本轮增量。依据：AgentRun.input/output 列、close_interactive_run 终态覆盖、runtimes 用量页 SUM 三处已是"本轮计费量"语义；daemon 改为按轮重置累积器改动最小；会话累计可由 Σ run 无损导出。
- normalized_requirement: 同一 run 的 input/output 在轮中实时写回与终态覆盖必须相等（daemon 按轮重置 usage 累积器；终态 SDK result 值与实时累积值一致时不得互相覆盖产生跳变）。
- impacts: [FR-02, task-daemon]
- evidence: run_sync/service.py:1137-1146（实时 max 写回）、run_sync/service.py:1622-1625（终态覆盖）、session-manager.ts:476-483（跨轮不清零的 session 累积器）
- 备注: 用户未及时作答（自主模式），AI 按最小改动原则代选，方案展示环节可否决。

## D-002@v1: ctx 指标落库（AgentRun 加列）
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 最近一次 API 调用的提示词大小（input+cache_read+cache_creation）是否持久化？
- answer: 落库。不落库则刷新页面/重进会话后上下文环拿不到数值。项目未上线（CLAUDE.md 规则 11），允许直接加列迁移。
- normalized_requirement: 每轮实时写回 ctx_tokens（最近一次调用口径，last-write-wins）；会话级"当前 ctx"取该会话最新 run 的 ctx_tokens。
- impacts: [FR-01, task-backend]
- evidence: ctx-usage-bar.tsx（环依赖父层传入 usedTokens，历史回看来自 GET /sessions/{id}/runs）
- 备注: 用户未作答，AI 代选，可否决。

## D-003@v1: 历史会话（无 ctx 数据）环显示未知
- type: boundary
- priority: P2
- status: accepted
- source: user
- question: 修复前创建的会话没有 ctx 指标，环怎么显示？
- answer: 如实显示"未知/—"（不算百分比），不用旧口径估算（旧口径 input 是该轮所有调用求和，数字本身失真）。
- normalized_requirement: ctx_tokens IS NULL 的 run 不参与环分子；全部轮缺失时环显示未知态（pct=null 分支已存在）。
- impacts: [FR-01]
- evidence: ctx-usage-bar.tsx:94-99（pct=null 已有未知态渲染）
- 备注: 用户未作答，AI 代选，可否决；项目未上线允许重置数据。

## D-004@v1: 每轮徽标 ↑↓ 语义 = 本轮计费量
- type: term
- priority: P1
- status: accepted
- source: code
- question: turn-timeline 每轮 ↑input ↓output 徽标显示什么？
- answer: 保持"本轮计费量"语义（轮中随实时上报递增，终态定格）。D-001 统一后跳变自然消除。
- normalized_requirement: 轮中实时值与终态值相等，徽标数字单调递增至终态定格。
- impacts: [FR-02]
- evidence: turn-timeline.tsx:1182-1198（↑↓ 徽标）、session-panel.tsx:3287-3331（env 终态/实时写入）

## D-005@v1: 实现方案选 A（复用 usage 附带管线 + daemon 按轮重置）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 方案 A（复用附带管线，~9 文件）/ B（独立 SESSION_USAGE 通道，~12+ 文件）/ C（仅前端近似）三选一？
- answer: 方案 A。daemon 在现有 usage 字典加 ctx_tokens（message_start 算本次调用 input+cache_read+cache_creation）；轮边界重置累积器使实时值=本轮至今量（与终态口径一致）；backend/frontend 全链路加字段透传（AgentRun.ctx_tokens 列 + SSE + SessionRunRead）。完全符合 D-001~D-004。否决 B（改动面翻倍且旧通道无法删除，两套并存反而更乱）；否决 C（环仍爆表、跳变仅被隐藏）。
- normalized_requirement: ctx_tokens 经 usage 附带管线传递；AgentRun.ctx_tokens 实时 last-write-wins 写入、终态不覆盖；daemon input/output 累积器轮边界重置。
- impacts: [FR-01, FR-02, FR-03, 全部 task]
- evidence: 方案选择轮次（brainstorm step 4）；用户未及时作答，AI 按推荐代选，设计文档落盘后可否决重选

## D-001@v2: 统一=本轮增量；终态 SDK result 权威校准
- type: architecture
- priority: P0
- status: accepted
- supersedes: D-001@v1
- source: design-grill
- question: Grill X-05/B1——v1 的"实时写回与终态覆盖必须相等"依赖未证的 SDK result 聚合口径（设计自身实证同轮 live 1,092,740 vs 终态 144,212 为旧语义差，新语义一致性仅 turn 1 单轮实证）。
- answer: 统一仍为本轮增量；终态以 SDK result 值为权威覆盖（校准语义）。消除的是"语义级"跳变（会话累计暴涨→本轮骤降）；若两路数值有小出入，表现为终态定格时小幅校正。execute 首任务跑真实会话 spike 验证，偏差 >5% 启用 fallback（close 仅当 result > 实时值才覆盖 input/output）。
- normalized_requirement: daemon 实时上报 = 本轮至今；close 终态覆盖 = SDK result 本轮值；两者语义同类（本轮计费量）。spike 结论记录 QUICKLOG。
- impacts: [FR-02, R-09, task-spike]
- evidence: design.md FR-02 / Phase 1.5 / R-09；Grill 交叉审查 X-05/X-15/B1

## D-006@v1: ctx_tokens 仅 main 桶计算与注入
- type: boundary
- priority: P1
- status: accepted
- source: design-grill
- question: Grill X-02/B2——子代理桶同样产出 pendingUsage，last-write-wins 下子代理轮会把环切到子代理上下文再跳回。
- answer: lastCallCtxTokens 仅 'main' 桶计算与注入 pendingUsage；子桶 pendingUsage 不含 ctx_tokens（backend usage.get 缺失即跳过，天然兼容）。turnInput/turnOutput 所有桶照常（子代理计费量并入本轮）。
- normalized_requirement: 环分子 ctx_tokens 只来自主 agent 的最近一次调用。
- impacts: [FR-01, task-daemon]
- evidence: design.md Phase 1.1/1.3 / 生命周期契约表；Grill 交叉审查 X-02/B2
