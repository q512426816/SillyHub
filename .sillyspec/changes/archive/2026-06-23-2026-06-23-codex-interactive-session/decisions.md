---
author: qinyi
created_at: 2026-06-23 21:40:36
---

# Decisions

## D-001@v1: 使用 provider driver registry

- type: architecture
- priority: P0
- status: accepted
- supersedes:
- source: code
- question: 如何让 Codex 复用 Claude Code interactive 生命周期，同时避免在 `SessionManager` 内继续写 provider 分支？
- answer: `SessionManager` 只管理 session 生命周期，具体 provider 通过 `InteractiveDriver` registry 选择；Claude 与 Codex 分别实现 driver。
- normalized_requirement: `SessionManager.create/restoreAndReconnect/interrupt/end` 必须按 session provider 路由到对应 driver；未注册 provider 抛 `UnsupportedProviderError`。
- impacts: [FR-01, FR-02, FR-03, FR-06, task-01, task-02, verify-01]
- evidence: `sillyhub-daemon/src/interactive/session-manager.ts`, `sillyhub-daemon/src/interactive/types.ts`, `design-grill.md X-006`

## D-002@v1: Codex interactive 使用 app-server stdio JSON-RPC

- type: architecture
- priority: P0
- status: accepted
- supersedes:
- source: code
- question: Codex 的 interactive runtime 应该用什么执行协议？
- answer: 使用本机 `codex app-server --listen stdio://`，通过 `thread/start`、`thread/resume`、`turn/start`、`turn/interrupt` 实现多轮和控制。
- normalized_requirement: Codex driver 必须 spawn detected Codex executable，并使用 app-server JSON-RPC；`AgentSession.agent_session_id` 对 Codex 保存 thread id。
- impacts: [FR-01, FR-02, FR-03, FR-04, FR-06, task-02, verify-01]
- evidence: `sillyhub-daemon/src/adapters/json-rpc.ts`, `/tmp/codex-app-schema/v2/TurnInterruptParams.json`, `/tmp/codex-app-schema/ClientRequest.json`

## D-003@v1: backend 不新增 Codex session 表

- type: architecture
- priority: P0
- status: accepted
- supersedes:
- source: code
- question: Codex 是否需要独立于 `AgentSession` 的会话模型？
- answer: 不新增表，继续使用 `AgentSession`、`AgentRun`、`DaemonTaskLease`。
- normalized_requirement: Codex create/inject/interrupt/end/reopen 必须通过现有 daemon session API 和同一组持久化实体完成。
- impacts: [FR-01, FR-02, FR-04, FR-05, FR-06, task-03, task-04, verify-02]
- evidence: `backend/app/modules/daemon/session/service.py`, `backend/app/modules/daemon/router.py`

## D-004@v1: Codex 日志使用 flat message 契约

- type: compatibility
- priority: P1
- status: accepted
- supersedes:
- source: code
- question: backend 是否需要理解 Codex raw JSON-RPC 事件？
- answer: 不需要。Codex driver 向 backend 上报 `{event_type, content, metadata, session_id}` flat message。
- normalized_requirement: Codex 中间输出和工具事件必须经 driver 归一化为 `RunSyncService.submit_messages()` 已支持的 flat message。
- impacts: [FR-04, task-02, task-03, verify-01, verify-02]
- evidence: `backend/app/modules/daemon/run_sync/service.py`, `sillyhub-daemon/src/adapters/json-rpc.ts`

## D-005@v1: `/runtimes` Codex 不再走 quick-chat

- type: boundary
- priority: P0
- status: accepted
- supersedes:
- source: user
- question: `/runtimes` 中 Codex runtime 的主交互入口是否继续使用 quick-chat？
- answer: 不继续使用。Codex 与 Claude Code 一样渲染 `InteractiveSessionChatSection` / `InteractiveSessionPanel`。
- normalized_requirement: Codex runtime 首条消息必须调用 `createSession({provider:"codex"})`，后续消息必须调用 `injectSession()`；不得调用 quick-chat API。
- impacts: [FR-01, FR-02, FR-07, task-05, verify-03]
- evidence: 用户目标“保证实现的功能与 Claude code 的一致”, `frontend/src/components/daemon/runtime-session-dialog.tsx`

## D-006@v1: Codex permission/dialog 遵循现有 manual_approval 策略

- type: consistency
- priority: P0
- status: accepted
- supersedes:
- source: design-grill
- question: Codex app-server 的 approval/request_user_input 如何与 Claude Code runtime 行为一致？
- answer: 统一走 provider-neutral permission/dialog hook，并尊重 `manual_approval + ask_user_only`。`ask_user_only=true` 时普通 command/file/permission request allow-through，只阻塞用户提问类请求；`ask_user_only=false` 时普通 request 才进入前端审批卡。
- normalized_requirement: Codex driver 处理 server request 时必须读取 driver options 中的 `manualApproval/askUserOnly` 策略；不得无条件自动 accept，也不得在 ask-only 模式对普通工具强制弹卡。
- impacts: [FR-08, FR-09, task-01, task-02, task-04, verify-01, verify-03]
- evidence: `frontend/src/components/daemon/interactive-session-panel.tsx`, `sillyhub-daemon/src/interactive/session-manager.ts`, `backend/app/modules/daemon/permission_service.py`, `design-grill.md X-002`

## D-007@v1: reopen 支持 Codex 但要求已有 thread id

- type: compatibility
- priority: P1
- status: accepted
- supersedes:
- source: code
- question: ended/failed Codex session 如何继续对话？
- answer: backend 放开 Codex reopen；daemon 使用 `thread/resume(threadId)`。缺少 `agent_session_id` 的历史 Codex session 不伪造恢复。
- normalized_requirement: `SessionService.reopen_session()` 支持 provider in `{"claude","codex"}`；Codex restore 必须要求 `record.agentSessionId` 非空。
- impacts: [FR-06, task-03, task-05, verify-02, verify-03]
- evidence: `backend/app/modules/daemon/session/service.py`, Codex schema `thread/resume`

## D-008@v1: permission/dialog hook 放在 SessionManager 层

- type: architecture
- priority: P1
- status: accepted
- supersedes:
- source: design-grill
- question: provider 的人工交互能力应该放在 driver 内部还是 session 控制层？
- answer: 放在 `SessionManager` 层提供 provider-neutral hook；Claude driver 映射为 SDK `canUseTool/onUserDialog`，Codex driver 映射为 app-server server request response。
- normalized_requirement: hook 必须以 sessionId/currentRunId/requestId 为核心，复用 `PermissionResolver` 和 backend `PERMISSION_REQUEST/RESPONSE`。
- impacts: [FR-08, FR-09, task-01, task-02, verify-01]
- evidence: `sillyhub-daemon/src/interactive/permission-resolver.ts`, `backend/app/modules/daemon/permission_service.py`

## D-009@v1: 输入队列改为 provider-neutral UserTurnInput

- type: consistency
- priority: P0
- status: accepted
- supersedes:
- source: design-grill
- question: `InputQueue` 是否可以继续暴露 Claude SDK 专属 `SDKUserMessage`？
- answer: 不可以。`SessionManager` 只 push `{type:"user", text}`；Claude driver 内部转换为 `SDKUserMessage`，Codex driver 内部转换为 `turn/start.input`。
- normalized_requirement: `InputQueue` 和 `SessionState.inputQueue` 类型必须脱离 `@anthropic-ai/claude-agent-sdk`；Claude SDK 类型只能出现在 Claude driver 内部。
- impacts: [FR-01, FR-02, task-01, verify-01]
- evidence: `sillyhub-daemon/src/interactive/input-queue.ts`, `sillyhub-daemon/src/interactive/claude-sdk-driver.ts`, `design-grill.md X-001`

## D-010@v1: Codex dialog payload 双向归一化

- type: feasibility
- priority: P1
- status: accepted
- supersedes:
- source: design-grill
- question: Codex `request_user_input` / MCP elicitation 能否直接丢给现有前端 dialog 卡片？
- answer: 不能。daemon 先归一化为现有 `AskUserDialogCard` 可渲染的 `questions/options`，用户回答后再还原为 Codex schema。
- normalized_requirement: `item/tool/requestUserInput` response 必须输出 `{answers:{[questionId]:{answers:string[]}}}`；不支持归一化的复杂 MCP elicitation 必须 fail-closed 并记录 error log。
- impacts: [FR-09, task-02, task-05, verify-01, verify-03]
- evidence: `/tmp/codex-app-schema/ToolRequestUserInputParams.json`, `/tmp/codex-app-schema/ToolRequestUserInputResponse.json`, `frontend/src/components/ask-user-dialog-card.tsx`, `design-grill.md X-003`
