---
author: flow-machine-draft
created_at: 2026-10-27T23:39:20.199Z
---
# 设计记录（Design Record）— 2026-10-28-model-retry-visible

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题实证（2026-10-27 两会话各卡约 3 分钟）：模型 API 限流（智谱 429/错误码 1311）时 claude CLI 指数退避重试约 3 分钟，期间 SDK 逐次发出 `system/api_retry` 帧（sdk.d.ts SDKAPIRetryMessage：attempt/max_retries/retry_delay_ms/error_status/error），但 daemon 归一化器 `_normalizeSystemMessage` 白名单（init/task_*/thinking_tokens/status）不含 api_retry，帧落到 `return []` 被丢弃；平台零事件，前端 turn-status-bar 段树空、走终级回退恒显「思考中」，用户无法区分「正常慢」与「卡死」。轮终态链路本身正确（CLI result `subtype="success"` 但 `is_error=true` + `terminal_reason="api_error"`，本机假 429 上游复现实证；daemon 按 is_error 归类 ModelError，backend `close_run_steps.py:429` 的 `or is_error` 分支正确落 failed 并存 error_detail，会话面板页 2026-10-20-session-error-visibility 已能渲染失败卡）——缺口只在「重试过程不可见」与「紧凑卡不透出失败原因」。

方案：复用仓内同构先例 ql-20260917-006（上下文压缩状态）。daemon 侧两跳——①`claude-events.ts _normalizeSystemMessage` 新增 api_retry 分支产出 status 事件（metadata 带 attempt/max_retries/retry_delay_ms/error_status/error 摘要）；②`session-manager/events.ts _dispatchStatusEvent` 新增 case，把事件经 `onTurnMessage` 落 `[MODEL_RETRY] ` + 单行 JSON 的 stdout 文本协议行（与 `[COMPACT_STATUS]` 同形态同通道，backend 照既有文本行落库 + SSE 透传，零 backend 改动）。前端三跳——`session-log-assembler.ts` 新增 kind=model_retry 分类（先于 reply 兜底）；`turn-segment-views.tsx` 运行中轮渲染「模型限流重试中 第N/M次」提示、终态轮对话正文不渲染（失败卡承担）；`turn-status-bar.tsx` currentActivity 回退链纳入最新 model_retry 段，替代恒挂「思考中」。

选此方案的理由：`[COMPACT_STATUS]` 已验证「daemon 协议行 → backend 透传 → 前端分类 → 实时提示」全链路可行且 backend 零 schema 改动；不选 notifyTurnPhase 新阶段方案（TurnPhaseValue 七阶段均为轮启动阶段，retry 属轮内过程，且 backend phase schema 与前端 phase 状态条渲染面都要动，改动面更大）；不选 daemon 侧自动重注入/退避干预（行为变更超出本变更可观测性定位，见 FR-03 禁改面）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sillyhub-daemon/src/interactive/claude-events.ts`：`_normalizeSystemMessage` 新增 `api_retry` 分支——返回 `[{type:'status', subtype:'api_retry', content:'', metadata:{attempt?, max_retries?, retry_delay_ms?, error_status?, error?}}]`；数值字段仅在 SDK 帧字段为 number 时写入（不伪造），error_status 保留 null 原值；error 摘要截断 200 字符。对外行为：新增一种 status 事件（此前该帧被丢弃）。
- `sillyhub-daemon/src/interactive/session-manager/events.ts`：`_dispatchStatusEvent` 新增 `case 'api_retry'`——currentRunId 空则丢弃；否则 `onTurnMessage(sessionId, runId, {event_type:'text', content:'[MODEL_RETRY] '+JSON.stringify(payload), channel:'stdout'})`，payload=`{attempt, max_retries, retry_delay_ms, error_status, error(截断)}`。协议行格式为对外契约：`[ASSISTANT] [MODEL_RETRY] <单行JSON>`（[ASSISTANT] 前缀由既有文本行落库链路添加，同 COMPACT_STATUS）。
- `frontend/src/components/daemon/session-log-assembler.ts`：`SessionLogSegmentKind` 联合新增 `"model_retry"`；分类规则 `/^\[ASSISTANT\]\s*\[MODEL_RETRY\]/` → `{kind:'model_retry', text:<剥前缀JSON原文>, ts}`；判定必须先于 reply 兜底与 isAssistantApiErrorText 丢弃规则。
- `frontend/src/components/daemon/turn-segment-views.tsx`：新增 ModelRetrySegment 渲染分支——运行中轮显示「模型限流重试中 第N/M次」+ 错误摘要（可截断）；终态轮对话正文不渲染；载荷解析失败显示中性「模型重试中」。
- `frontend/src/components/daemon/turn-status-bar.tsx`：`segmentTs` 补 `model_retry` case（取捕获 ts，非 running 候选详尽性编译补点）；`latestStreamingSummary`/`latestActivityWithin` 回退链纳入最新 model_retry 段 → 「模型限流重试中 第N/M次」（解析失败退「模型重试中」）。
- backend：无改动（零文件变更）。协议行经既有 stdout 文本行通道落库与 SSE 推送。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。api_retry 帧只增不改（每次重试一条新行），无覆盖语义，乱序仅影响行序不影响正确性；前端渲染按 ts 取「最新」段，乱序下显示最后一次收到的重试提示，可接受。轮终态后迟到的重试行：终态轮对话正文不渲染（FR-02），无噪声泄漏。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

协议行走 onTurnMessage 既有串行链（与 COMPACT_STATUS 同通道），daemon 侧无新增并发写面；backend 文本行落库与 SSE 推送为既有路径，本变更不触碰。多会话各自独立 runId/currentRunId，互不干扰。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。provider 切换（pendingSwitch reload）发生时 currentRunId 已清，api_retry 帧走 runId 空守卫被丢弃——不会把旧 provider 的重试行落到新 provider 轮；轮中断/会话终止后迟到的帧同样被 runId 空守卫或终态不渲染双保险拦截。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。协议行按会话/run 落库（backend 既有归属），无工作区/跨仓共享面；多 daemon 各自会话独立，无串台。前缀 `[MODEL_RETRY]` 为新命名空间，与既有 `[COMPACT_STATUS]`/`[TASK_*]`/`[ASSISTANT]` 行分类互斥（分类规则先于 reply 兜底判定）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：CLI api_retry 帧的 `error` 字段形态漂移（SDK 类型为 SDKAssistantMessageError 对象，可能随版本变化）——防御：归一化与落行两处都做「非字符串则 JSON.stringify + 截断」，前端渲染对解析失败有中性兜底（FR-02 场景三），最坏退化为不可读摘要行而非报错。次要风险：重试风暴一次轮可产生约 10 行协议行，时间线行数增多——终态轮不渲染已兜住对话正文噪声，进度视图行数可接受（与 thinking 分段同量级）。

试过但放弃的方案：①notifyTurnPhase 新增 `model_retry` 阶段——TurnPhaseValue 七阶段语义均为轮启动阶段，backend schema（daemon/schema.py TurnPhase 枚举）与前端阶段状态条渲染面都要扩，改动面大于协议行方案且信息载量低（phase 无 attempt/error 载荷位）；②daemon 侧对 rate_limited 轮做自动延迟重注入——属行为变更，与 FR-03「纯可观测性透传」定位冲突，且掩盖供应商侧问题（用户应看到限流并决策换模型/稍后再试）；③仅改前端把「API Error」assistant 文本行实时显示——该文本只在轮终态合成一次（重试期间无 assistant 帧），解决不了重试风暴期间的可见性（本次问题的主诉）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/claude-events.ts | _normalizeSystemMessage 新增 api_retry 分支产出 status 事件 |
| 修改 | sillyhub-daemon/src/types.ts | AgentStatusSubtype 联合新增 'api_retry'（schema 闭合枚举同源面） |
| 修改 | sillyhub-daemon/src/agent-event-schema.ts | AGENT_STATUS_SUBTYPES 字面量新增 'api_retry'（与 types.ts 一字面对齐） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/events.ts | _dispatchStatusEvent 新增 api_retry case 落 [MODEL_RETRY] 协议行 |
| 新增 | sillyhub-daemon/tests/interactive/session-manager-status-dispatch.test.ts | api_retry 分发落行/runId 空丢弃/error 截断单测 |
| 修改 | sillyhub-daemon/tests/interactive/claude-events.test.ts | api_retry 归一化单测（含 error_status=null 与缺字段容错） |
| 修改 | frontend/src/components/daemon/session-log-assembler.ts | kind=model_retry 分类（先于 reply 兜底） |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | model_retry 段渲染（运行中提示/终态不渲染/兜底） |
| 修改 | frontend/src/components/daemon/turn-status-bar.tsx | currentActivity 回退链纳入 model_retry 段 |
| 修改 | frontend/src/components/daemon/__tests__/session-log-assembler.test.ts | model_retry 分类与解析失败兜底单测 |
| 修改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | 运行中渲染/终态不渲染单测 |
| 修改 | frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx | 重试文案纳入回退链单测 |
