---
author: qinyi
created_at: 2026-06-28 12:23:18
change: 2026-06-28-daemon-subagent-transcript
---

# 决策台账 · daemon 子代理日志可见性

本变更的决策台账（非长期术语表）。仅记录有实现/验收影响的决策。

## D-001@v1: 子代理消息归属字段来源
- type: boundary
- status: accepted
- source: code
- priority: P0
- question: 心跳级（forwardSubagentText=false 默认进来的）tool_use/tool_result 是否带归属字段？text/thinking 需要什么条件才流出？
- answer: SDK 0.3.181 的 `SDKAssistantMessage`（`sdk.d.ts:2647-2666`）与 `SDKUserMessage`（`sdk.d.ts:4127-4166`）均含 `parent_tool_use_id: string|null` + `subagent_type?: string` + `task_description?: string`。默认 forwardSubagentText=false 时进来的心跳级 tool_use/tool_result **天然带归属**，链路读取即可标注；仅 text/thinking 需开 `forwardSubagentText=true` 才流入主流。
- normalized_requirement: backend `_extract_sdk_messages` 必须从 msg 顶层读 `parent_tool_use_id`/`subagent_type`/`task_description` 注入 flat record，覆盖 assistant + user 两类 SDK message。
- impacts: [design-§7.3, Phase3-backend, task-driver-forwardSubagentText, task-backend-extract]
- evidence: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1544-1550, 2647-2666, 4127-4166`

## D-002@v1: partial buffer 按 parent_tool_use_id 分桶隔离
- type: architecture
- status: accepted
- source: code
- priority: P0
- question: 主/子代理共享 sessionId，子代理 assistant 消息是否干扰主 agent 的 partial buffer？
- answer: 会干扰。`_clearPartialBufferSync`（`session-manager.ts:2131`）是 per-sessionId 清理，主/子代理共享同一 `state.sessionId`；子代理 assistant 完整消息到达会清主 agent partial 尾部 + `_emitOverrideSignals` 误发覆盖信号。同理 `_bufferPartial`/`_flushPartial` 也共用 buffer。
- normalized_requirement: `_partialBuffers` 从 `Map<sessionId, PartialFlushBuffer>` 改为 `Map<sessionId, Map<parentKey, PartialFlushBuffer>>`，`parentKey = msg.parent_tool_use_id ?? 'main'`；`_clearPartialBufferSync`/`_emitOverrideSignals`/`_flushPartial`/`_bufferPartial` 全部按 parentKey 分桶；`_resolveSegmentId` 的 segmentId 带 parent 前缀 `${parentKey}:${messageId}:${blockIndex}` 避免主/子 segment 撞 id。
- impacts: [design-§5-Phase2, design-§10-R-02, task-session-manager-partial, verify-partial隔离回归]
- evidence: `sillyhub-daemon/src/interactive/session-manager.ts:2131`（_clearPartialBufferSync per-sessionId）；`:243`（_partialBuffers Map<sessionId>）；`:1782`（_resolveSegmentId）

## D-003@v1: agentSessionId 不被子代理 init 覆盖
- type: risk
- status: accepted
- source: code
- priority: P1
- question: 子代理的 system/init 消息是否覆盖主 session 的 resume key（agentSessionId）？
- answer: 不会。`_onMessage`（`session-manager.ts:1686`）写 agentSessionId 有 `state.agentSessionId === undefined` 守卫，主 session 的 system/init 必先于子代理到达（子代理是主 agent 调 tool 才产生），子代理 init 被守卫挡住 no-op。但建议加防御性双重守卫。
- normalized_requirement: `_onMessage:1686` 写 agentSessionId 增加守卫——`msg.parent_tool_use_id` 非空（子代理 init）直接跳过，不依赖单一 ===undefined 守卫。
- impacts: [design-§5-Phase2, verify-init不覆盖]
- evidence: `sillyhub-daemon/src/interactive/session-manager.ts:1678-1691`（_onMessage system/init 写 agentSessionId 守卫）

## D-004@v1: 归属承载方式 = AgentRunLog 新增列（方案 B）
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 子代理归属信息（parent_tool_use_id/subagent_type/depth）以何种方式持久化？方案 A=metadata JSON 注入 / 方案 B=新增列 / 方案 C=前端实时推断不入库。
- answer: 用户选方案 B——`agent_run_logs` 表新增 `parent_tool_use_id`/`subagent_type`/`depth` 三列 + `parent_tool_use_id` 索引。现实依据：`agent_run_logs` 表**无 metadata 列**（`run_sync/service.py:273` 注释明示），方案 A 需先加 metadata JSON 列，代价不比 B 低；B 的列式承载可索引、可按子代理聚合查询（方案 A 的 JSON 不便索引）。方案 C 不满足持久化诉求（刷新丢归属）已排除。
- normalized_requirement: alembic migration 给 `agent_run_logs` 加 parent_tool_use_id(VARCHAR200,null)/subagent_type(VARCHAR100,null)/depth(INTEGER,null) + ix_agent_run_logs_parent 索引；ORM `AgentRunLog` + `AgentRunLogEntry`/Read DTO 加三字段；migration down_revision 接 execute 时真实 head（R-01）。
- impacts: [design-§6, design-§8, design-§10-R-01, task-migration, task-model, task-schema, task-落库]
- evidence: 用户在 brainstorm step 8 选 "方案B"；`backend/app/modules/agent/model.py:285-337`（AgentRunLog 现有字段无 metadata）；`backend/app/modules/daemon/run_sync/service.py:273`（注释"AgentRunLog 无 metadata 列"）

## D-005@v1: 展示形态分阶段（本期平铺带标签，预留嵌套）
- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 子代理日志前端展示形态——嵌套折叠（树状 transcript）还是平铺带标签？
- answer: 用户选分阶段。本期 Phase 4 只做"平铺带 [子代理:subagent_type] 徽标 + depth 缩进 + 同 parent 视觉归组"；数据层（parent_tool_use_id/depth 列）完整落库预留，未来升级嵌套折叠只改前端、不动 daemon/backend。
- normalized_requirement: 前端 agent-log-viewer 本期渲染徽标+缩进，**不实现折叠交互**；嵌套折叠列为非目标 N2。
- impacts: [design-§5-Phase4, design-N2, task-frontend-render]
- evidence: 用户在 brainstorm step 6 确认 Q1=C 分阶段；`prototype-daemon-subagent-transcript.html`（双视图原型验证）

## D-006@v1: provider 范围只 Claude
- type: boundary
- status: accepted
- source: user
- priority: P2
- question: 本期是否覆盖 Codex provider 的子代理日志？
- answer: 不覆盖。`forwardSubagentText` 是 Claude Agent SDK 0.3.181 特性；Codex 无 Task-tool subagent 概念，子代理机制完全不同。本期只改 Claude 路径。
- normalized_requirement: driver 改动只在 `ClaudeSdkDriver`（`claude-sdk-driver.ts`）；Codex driver（codex-app-server-driver 等）不动；Codex flat message 路径不注入归属字段。
- impacts: [design-N3, task-driver-claude-only]
- evidence: 用户在 brainstorm step 6 确认 Q2=只 Claude；`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1544-1550`（forwardSubagentText 是 Claude SDK option）

## D-007@v1: depth 由 daemon session 级维护，随 message 透传
- type: architecture
- status: accepted
- source: design
- priority: P1
- question: 子代理层级深度 depth 由谁计算？daemon 算（session 级维护）还是 backend 算（落库时按 parent 链路解析）？
- answer: daemon 算。daemon `SessionState` 维护 `subagentDepth: Map<tool_use_id, depth>`（主=0，子=父+1），随每条 message 顶层注入 `depth` 字段透传；backend 读 `msg.depth` 落库，不算。理由：daemon 有完整 session 视野（主 agent tool_use 先到可预登记），不依赖 backend 落库顺序，最准；backend 只持久化不计算，职责清晰。
- normalized_requirement: `SessionState` 加 `subagentDepth: Map<string, number>`；`_onMessage` 处理 assistant message 时遍历 tool_use blocks 预登记 `subagentDepth[tool_use.id] = msgDepth + 1`；子代理消息按其 parent_tool_use_id 查得 depth 注入 msg；退化策略：查不到 → depth=1（R-04）。
- impacts: [design-§5-Phase2, design-§7.1, design-§7.5-depth算法, design-§10-R-04, task-session-manager-depth, verify-depth多层]
- evidence: 设计推导（daemon session 视野 vs backend 落库顺序依赖）

## D-008@v1: 归属字段注入每条 flat record（非首条 stamp）
- type: consistency
- status: accepted
- source: design-grill
- priority: P0
- question: `_extract_sdk_messages` 把 parent_tool_use_id/subagent_type/depth 注入 flat record 时，走 `stamp()` 只注入首条（与 usage/session_id 同模式）是否正确？
- answer: 不正确。usage/session_id 是 message 级**聚合量**，只注入首条避免重复累加是对的；但归属字段是 message 级**属性**，同一 SDK message 的所有 content block（text/thinking/tool_use 等）同属一个子代理，**每条** flat record（= 每条 agent_run_logs 行）都要带归属。只注首条会导致同一子代理 message 展开的多行 log 归属不一致（thinking 行有归属、紧随的 text 行 NULL），前端渲染时 text 行退化为无徽标主 agent 行。
- normalized_requirement: `_extract_sdk_messages` 归属字段（parent_tool_use_id/subagent_type/depth）直接写入每条产出的 flat record，**不经过** `stamp()` 单次机制；usage/session_id 仍走 `stamp()` 首条。
- impacts: [design-§5-Phase3, design-§7.3, task-backend-extract, verify-多block归属一致]
- evidence: Design Grill X-001（design.md §5 Phase 3 原"首条"与 §7.3 每行落库冲突）
