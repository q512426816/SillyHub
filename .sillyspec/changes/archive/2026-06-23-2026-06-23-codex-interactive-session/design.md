---
author: qinyi
created_at: 2026-06-23 21:40:36
---

# 设计文档：/runtimes Codex Interactive Session

## 1. 背景

`/runtimes` 的 Claude Code runtime 当前使用 backend `AgentSession` + daemon `SessionManager` 的 interactive 链路，支持多轮对话、同会话日志、运行中打断、结束、历史回看和 reopen/recovery。

Codex runtime 的按钮在 `codex-runtime-conversation-fix` 临时变更里被切到 quick-chat SSE，避免触发 daemon `UnsupportedProviderError`，但这只是降级路径：

- Codex 无法复用 `AgentSession` 生命周期；
- 无法像 Claude Code 一样以同一 session 连续 inject 多轮；
- ended/failed Codex session 当前不能 reopen；
- daemon 重启恢复逻辑对 Codex 仍被 `SessionManager.restoreAndReconnect()` 拦截；
- `/runtimes` UI 对 provider 的分流让 Codex 和 Claude Code 行为不一致。

本变更目标是把 Codex 纳入同一条 interactive session 控制链，而不是继续扩展 quick-chat。

## 2. 目标

### 2.1 功能目标

1. `/runtimes` 中 Codex runtime 使用 `InteractiveSessionChatSection` / `InteractiveSessionPanel`，不再走 `QuickChatSessionSection`。
2. Codex 支持与 Claude Code 同等级的 session 功能：
   - 创建会话；
   - 同一会话多轮 inject；
   - 运行中 interrupt；
   - end 后终止会话；
   - 历史 run/log 回看；
   - ended/failed session reopen；
   - daemon 重启后的 recover/reconnect。
3. Claude Code 现有 interactive 行为、审批弹窗、AskUserQuestion、SSE 日志展示不回退。
4. backend 继续以 `AgentSession`、`AgentRun`、`DaemonTaskLease` 作为 session 控制面，不新增平行的 Codex 会话模型。

### 2.2 非目标

1. 不把 quick-chat 删除为全局能力；只是不再作为 `/runtimes` Codex interactive 的主路径。
2. 不新增 Codex 专属审批 UI。Codex 的 approval / request_user_input 走现有 backend `PERMISSION_REQUEST/RESPONSE` 与前端 AskUserDialog/审批事件通道，保持与 Claude Code 同一交互面。
3. 不引入新 provider。范围仅覆盖 `provider="codex"`。
4. 不重构 batch `TaskRunner` 执行协议，只复用其已验证的 Codex app-server JSON-RPC 解析思路。

## 3. 现状依据

### 3.1 daemon

- `sillyhub-daemon/src/interactive/types.ts` 已把 interactive provider 定义为 `'claude' | 'codex'`。
- `sillyhub-daemon/src/interactive/session-store-persistence.ts` 的持久化校验已允许 `claude` 和 `codex`。
- `sillyhub-daemon/src/interactive/session-manager.ts` 当前硬编码只允许 Claude：
  - `create()` 中 `if (input.provider !== 'claude') throw new UnsupportedProviderError(...)`；
  - `restoreAndReconnect()` 中 `if (record.provider !== 'claude') throw new UnsupportedProviderError(...)`；
  - `interrupt()` 使用单一 `deps.driver.interrupt(...)`。
- `sillyhub-daemon/src/daemon.ts` `_startInteractiveSession()` 当前总是查 `this._agentPaths.get('claude')`，Codex runtime 即使注册在线也不会取 Codex executable path。
- `sillyhub-daemon/src/adapters/json-rpc.ts` / `src/task-runner.ts` 已能用 `codex app-server --listen stdio://` 跑 batch Codex，并解析 `thread/start`、`turn/start`、`turn/completed` 等事件。

### 3.2 backend

- `backend/app/modules/daemon/router.py` 的 session create request 已允许 `provider: "claude" | "codex"`。
- `backend/app/modules/daemon/session/service.py` `create_session()`、`inject_session()`、`interrupt_session()`、`end_session()` 已按 `AgentSession` / `AgentRun` / interactive lease 建模，不需要 provider 专属表。
- `SessionService.reopen_session()` 当前只允许 `provider == "claude"`，并在非 Claude 时抛 `DaemonSessionResumeUnsupported`，需要扩展为 `{"claude", "codex"}`。
- `RunSyncService.submit_messages()` 可接收 flat message（`event_type` + `content`），也可展开 Claude SDK raw message；Codex driver 应优先发送 flat message，避免把 Codex app-server schema 泄漏到 backend。

### 3.3 frontend

- `frontend/src/lib/daemon.ts` `InteractiveProvider` 已是 `"claude" | "codex"`。
- `frontend/src/components/daemon/interactive-session-panel.tsx` 已按 provider 参数调用 `createSession()` 和 `injectSession()`，核心 panel 不天然排斥 Codex。
- quick 修复在 `frontend/src/components/daemon/runtime-session-dialog.tsx` 把 Codex runtime 分流到 `QuickChatSessionSection`。
- `runtime-session-helpers.tsx` 当前对 ended Codex session 的继续对话提示为"codex 暂不支持续聊"，需要随 backend/daemon reopen 支持同步放开。

## 4. 总体方案

采用 provider driver 抽象，把 `SessionManager` 从"只驱动 Claude SDK"改为"按 provider 选择 interactive driver"：

```
Frontend RuntimeSessionDialog
  -> InteractiveSessionPanel(provider=claude|codex)
  -> backend SessionService(create/inject/interrupt/end/reopen)
  -> daemon Daemon._startInteractiveSession / _routeSessionResume
  -> SessionManager(provider driver registry)
       |-> ClaudeSdkDriver        -> Claude Agent SDK query()
       |-> CodexAppServerDriver   -> codex app-server stdio JSON-RPC
```

核心原则：

- `AgentSession.id` 仍是平台 session id；
- `AgentSession.agent_session_id` 对 Claude 保存 Claude SDK session id，对 Codex 保存 Codex thread id；
- 每个 turn 仍对应一个 `AgentRun`；
- daemon message 上报仍走 `submitMessages()` / `closeInteractiveRun()`；
- frontend SSE 仍按 session/run 订阅，不新增 Codex 专属前端协议。
- 决策覆盖：D-001@V1、D-002@V1、D-003@V1、D-004@V1、D-005@V1、D-006@V1、D-007@V1、D-008@V1、D-009@V1、D-010@V1。

## 4.1 文件变更清单

| 文件 | 类型 | 说明 | 覆盖决策 |
| --- | --- | --- | --- |
| `sillyhub-daemon/src/interactive/driver.ts` | 新增 | provider-neutral `InteractiveDriver`、`UserTurnInput`、message/result/hook 类型 | D-001@V1, D-008@V1, D-009@V1 |
| `sillyhub-daemon/src/interactive/input-queue.ts` | 修改 | 从 `SDKUserMessage` 队列改为 `UserTurnInput` 队列 | D-009@V1 |
| `sillyhub-daemon/src/interactive/claude-sdk-driver.ts` | 修改 | 实现 driver interface，并在 driver 内部转换 `UserTurnInput` → `SDKUserMessage` | D-001@V1, D-009@V1 |
| `sillyhub-daemon/src/interactive/codex-app-server-driver.ts` | 新增 | Codex app-server stdio JSON-RPC 长驻 driver | D-001@V1, D-002@V1, D-004@V1, D-006@V1, D-010@V1 |
| `sillyhub-daemon/src/interactive/session-manager.ts` | 修改 | provider driver registry、provider-neutral permission/dialog hook、provider-specific interrupt/recovery | D-001@V1, D-006@V1, D-008@V1, D-009@V1 |
| `sillyhub-daemon/src/interactive/types.ts` | 修改 | `SessionState`/deps 从 Claude SDK 单 driver 改为 provider driver model | D-001@V1, D-009@V1 |
| `sillyhub-daemon/src/interactive/session-store-persistence.ts` | 修改 | 持久化字段注释/校验保留 Codex provider 与 executable path | D-007@V1 |
| `sillyhub-daemon/src/daemon.ts` | 修改 | `_startInteractiveSession` 按 provider 取 executable，message/result 类型放宽，recovery 不写死 Claude | D-001@V1, D-002@V1, D-007@V1 |
| `sillyhub-daemon/src/cli.ts` | 修改 | 注册 Claude/Codex drivers | D-001@V1, D-002@V1 |
| `backend/app/modules/daemon/session/service.py` | 修改 | `reopen_session` 支持 Codex | D-003@V1, D-007@V1 |
| `backend/app/modules/daemon/tests/test_session_service.py` | 修改 | Codex reopen 测试 | D-003@V1, D-007@V1 |
| `backend/app/modules/daemon/tests/test_session_permissions.py` | 修改 | permission/dialog 策略回归测试 | D-006@V1, D-008@V1 |
| `frontend/src/components/daemon/runtime-session-dialog.tsx` | 修改 | Codex runtime 改渲染 interactive session panel | D-005@V1 |
| `frontend/src/components/daemon/runtime-session-helpers.tsx` | 修改 | Codex ended/failed session 允许 reopen；quick-chat 不作为 runtime 主路径 | D-005@V1, D-007@V1 |
| `frontend/src/components/ask-user-dialog-card.tsx` | 修改 | 必要时支持归一化后的 Codex dialog payload 展示 | D-010@V1 |
| `frontend/src/components/daemon/**/*.test.tsx` | 修改 | Codex interactive create/inject/reopen/dialog 测试 | D-005@V1, D-010@V1 |
| `.sillyspec/docs/**` | 修改 | 模块文档同步 | D-001@V1..D-010@V1 |

## 5. 详细设计

### 5.1 新增 interactive driver 契约

新增文件：

- `sillyhub-daemon/src/interactive/driver.ts`

定义 provider 无关接口：

```ts
export interface UserTurnInput {
  type: 'user';
  text: string;
}

export type InteractiveDriverMessage = Record<string, unknown>;

export interface InteractiveDriverResult {
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface InteractiveDriverHandle {
  readonly provider: 'claude' | 'codex';
  readonly processId?: number;
  close?(): Promise<void> | void;
}

export interface InteractiveDriver {
  start(input: AsyncIterable<UserTurnInput>, options: InteractiveDriverStartOptions): Promise<InteractiveDriverHandle>;
  consume(
    handle: InteractiveDriverHandle,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void>;
  interrupt(handle: InteractiveDriverHandle | null): Promise<boolean>;
}
```

`InputQueue` 从 Claude SDK 专属 `AsyncIterable<SDKUserMessage>` 调整为 provider-neutral `AsyncIterable<UserTurnInput>`，`SessionManager.create()` / `inject()` 只 push `{type:"user", text}`。`ClaudeSdkDriver` 内部把 `UserTurnInput` 转为 `SDKUserMessage`，`CodexAppServerDriver` 内部把 `UserTurnInput` 转为 app-server `turn/start.input`。原先的 `SDKMessage` / `SDKResultMessage` 在 Claude driver 内部保留，不让 `SessionManager` 依赖 Claude SDK 类型。

`SessionManagerDeps` 从单一 `driver: ClaudeSdkDriver` 扩展为：

```ts
drivers: Partial<Record<'claude' | 'codex', InteractiveDriver>>;
```

为降低改动面，可保留兼容入口 `driver?: ClaudeSdkDriver`，构造函数内映射到 `drivers.claude`。新代码使用 `drivers`。

### 5.2 SessionManager provider 化

修改文件：

- `sillyhub-daemon/src/interactive/session-manager.ts`
- `sillyhub-daemon/src/interactive/types.ts`
- `sillyhub-daemon/src/interactive/session-store-persistence.ts`（如需补齐字段注释/校验）

改动：

1. `create(input)` 不再 hardcode Claude，而是：
   - `const driver = this._getDriver(input.provider)`；
   - 没有 driver 时抛 `UnsupportedProviderError`；
   - 用 provider 对应 driver `start()` / `consume()`。
2. `restoreAndReconnect(record)` 同样按 `record.provider` 选 driver。
3. `interrupt(sessionId)` 使用该 session 当前 `state.driver` 或 `state.provider` 找 driver，不再使用全局 `deps.driver`。
4. `SessionState` 增加 driver/handle 的 provider 归属，避免 Claude/Codex 打断错路由。
5. 现有 `pathToClaudeCodeExecutable` 字段作为历史字段保留，但语义调整为"provider executable path"；如新增 `pathToAgentExecutable`，需同时保持旧字段读写兼容。
6. Claude 专属审批：
   - `canUseTool` / `onUserDialog` 只作为 Claude SDK 的 driver option 注入；
   - `PermissionResolver` 与 backend `PERMISSION_REQUEST/RESPONSE` 是 provider-neutral 能力，Codex server request 也复用它。
7. Codex 审批/对话：
   - `SessionManager` 提供 provider-neutral review/dialog helper；
   - Codex driver 收到 app-server server request 时调用 helper，等待用户响应后写 JSON-RPC response。

### 5.3 CodexAppServerDriver

新增文件：

- `sillyhub-daemon/src/interactive/codex-app-server-driver.ts`

职责：

1. spawn Codex：
   - executable path 来自 `Daemon._agentPaths.get("codex")`；
   - args 为 `app-server --listen stdio://`；
   - env 复用 `_startInteractiveSession()` 的 `buildSpawnEnv()` 结果。
2. 建立 app-server 会话：
   - 新建：`initialize` → `notifications/initialized` → `thread/start` → 首轮 `turn/start`；
   - 恢复：`initialize` → `notifications/initialized` → `thread/resume(threadId=record.agentSessionId)`，后续 inject 再 `turn/start`。
3. 按 input queue 顺序处理多轮：
   - 每次只允许一个 running turn；
   - 收到 `turn/completed` 后再消费下一条 prompt；
   - 避免在 Codex app-server 内并发 turn。
4. 打断：
   - 监听 `turn/started` 保存 `turnId`；
   - `interrupt()` 发送 `turn/interrupt({ threadId, turnId })`；
   - 无当前 turn 时返回 `false`。
5. 权限审批与用户输入：
   - 策略必须对齐现有 Claude Code runtime：`manual_approval=true, ask_user_only=true` 时只阻塞用户输入/提问类请求，普通 command/file permission request 按 allow-through 策略响应并记录 metadata；`ask_user_only=false` 时普通 request 才走前端审批卡。
   - `item/commandExecution/requestApproval` → plain permission request 或 allow-through；用户/策略 allow 返回 `{ decision: "accept" }`，deny 返回 `{ decision: "decline" }`。
   - `item/fileChange/requestApproval` → plain permission request 或 allow-through；用户/策略 allow 返回 `{ decision: "accept" }`，deny 返回 `{ decision: "decline" }`。
   - `item/permissions/requestApproval` → plain permission request 或 allow-through；allow 时按 Codex schema 返回 requested permissions 对应的 granted profile，deny/超时时返回不扩权 profile。
   - `item/tool/requestUserInput` → backend dialog permission request，`dialog_kind` 标记为 `codex_request_user_input`；daemon 先把 Codex payload 归一化为前端可渲染的 `questions/options`，用户答案再按 schema 还原为 `{ answers: { [questionId]: { answers: string[] } } }`。
   - `mcpServer/elicitation/request` → backend dialog permission request，`dialog_kind` 标记为 `mcp_elicitation`；只对可归一化成现有 question/options UI 的简单 form/url 场景阻塞等待用户，不支持的复杂 schema fail-closed，并上报 error log 说明暂不支持。
   - 若 backend send 失败、超时、session 已结束或 driver 被 interrupt，按 fail-closed 响应 deny/cancel，不无条件自动 accept。
6. 消息映射：
   - 使用 `sillyhub-daemon/src/adapters/json-rpc.ts` 的解析能力或抽取可复用解析函数；
   - 对 backend 上报 flat message，例如：
     - `{ event_type: "text", content, session_id: threadId }`
     - `{ event_type: "tool_use", content, metadata, session_id: threadId }`
     - `{ event_type: "tool_result", content, metadata, session_id: threadId }`
     - `{ event_type: "error", content, metadata, session_id: threadId }`
   - `thread/started` 或 `thread/resumed` 结果写入 `session_id: threadId`，让 backend 将 `AgentRun.session_id` / `AgentSession.agent_session_id` 对齐 Codex thread id。
7. turn result：
   - `turn/completed` status 正常时回调 `{ subtype: "success", is_error: false }`；
   - 中断、失败、进程退出异常时回调 `{ subtype: "error_during_execution", is_error: true, result: ... }`；
   - 可解析 usage 时透传，不强依赖 usage。
8. 生命周期：
   - `close()` 关闭 stdin 并终止子进程；
   - input queue 关闭、session end、daemon stop 均需释放 Codex child；
   - stderr 作为 warning/error flat message 上报，避免静默失败。

### 5.4 Daemon 接入

修改文件：

- `sillyhub-daemon/src/daemon.ts`
- `sillyhub-daemon/src/cli.ts`
- 相关测试文件

改动：

1. `cli.ts` 创建 `SessionManager` 时注入：
   - `drivers.claude = new ClaudeSdkDriver()`
   - `drivers.codex = new CodexAppServerDriver()`
2. `_startInteractiveSession()`：
   - 用 `provider = execPayload.provider ?? "claude"`；
   - executable path 改为 `this._agentPaths.get(provider)`；
   - provider 无 executable 时记录 `interactive_${provider}_executable_not_found` 并 fail 当前 lease；
   - 调用 `SessionManager.create({ provider, pathTo...: executablePath, ... })`。
3. `_routeSessionResume()`：
   - `provider` 从 message/session record 归一化为 `claude | codex`；
   - 交给 `SessionManager.restoreAndReconnect(record)`，不在 daemon 层写死 Claude。
4. `onTurnMessage()` / `onTurnResult()`：
   - 参数类型从 Claude SDK 类型放宽为 driver message/result；
   - 保持对 Claude SDK raw message 的兼容；
   - 对 Codex flat message 直接 `submitMessages()`。
5. stop/end 清理：
   - 确认 `SessionManager.end()` 会调用 driver handle close 或通过 input queue close 触发 driver 退出。

### 5.5 Codex 与 Claude Code 功能一致性矩阵

| 能力 | Claude Code 当前路径 | Codex 目标路径 | 本变更要求 |
| --- | --- | --- | --- |
| 创建会话 | `createSession` → `SessionManager.create` → Claude SDK query | `createSession` → `SessionManager.create` → Codex app-server `thread/start` + `turn/start` | 同一 UI、同一 backend API、同一 session 生命周期 |
| 多轮对话 | `InputQueue` 跨 turn | `InputQueue` 串行驱动多个 `turn/start` | 第二轮以后必须走 `injectSession`，不得开 quick-chat 新 run |
| 流式输出 | SDK message → `submitMessages` → session SSE | app-server notification → flat message → `submitMessages` → session SSE | 前端日志体验一致 |
| 工具/命令审批 | Claude SDK `canUseTool`；`ask_user_only=true` 时普通工具 allow-through | app-server server request；同样尊重 `ask_user_only` | 策略一致：ask-only 只阻塞用户提问，full-review 才弹普通审批 |
| AskUser / 用户输入 | Claude SDK `onUserDialog` / `AskUserQuestion` | `item/tool/requestUserInput` / 可归一化 MCP elicitation | 归一化为现有 `AskUserDialogCard` payload，响应时还原 provider schema |
| 打断 | SDK `interrupt()` | `turn/interrupt(threadId,turnId)` | 运行中按钮行为一致 |
| 结束 | close queue + `onSessionEnd` | close queue + kill app-server child + `onSessionEnd` | session 终态一致 |
| 历史回看 | `AgentRunLog` + session turns | flat log 入同一表 | 左侧 session 历史一致 |
| reopen | SDK resume | `thread/resume(threadId)` | ended/failed Codex 可继续 |
| daemon recovery | persisted record + SDK resume | persisted record + `thread/resume` | 不抛 `UnsupportedProviderError` |

### 5.6 Backend reopen 放开 Codex

修改文件：

- `backend/app/modules/daemon/session/service.py`
- `backend/app/modules/daemon/tests/test_session_service.py`

改动：

1. `SessionService.reopen_session()` provider gate 从 `session.provider != "claude"` 改为 `session.provider not in {"claude", "codex"}`。
2. `DaemonSessionResumeUnsupported` 文案改为"only claude/codex interactive sessions can be resumed"。
3. reopen 创建的 lease metadata 保留/补齐：
   - `session_id`;
   - `agent_session_id`；
   - `provider`;
   - `claim_token`。
4. 测试覆盖：
   - Codex ended session 可 reopen，并生成 reconnecting session + pending lease；
   - 非支持 provider 仍抛 `DaemonSessionResumeUnsupported`；
   - Claude reopen 既有测试不变。

### 5.7 Frontend 取消 Codex quick-chat 分流

修改文件：

- `frontend/src/components/daemon/runtime-session-dialog.tsx`
- `frontend/src/components/daemon/runtime-session-helpers.tsx`
- `frontend/src/components/daemon/runtime-session-dialog.test.tsx`
- `frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx`

改动：

1. `RuntimeSessionDialog` 对 Codex runtime 渲染 `InteractiveSessionChatSection`，不再分支到 `QuickChatSessionSection`。
2. `canReopenSession()` / 继续对话按钮支持 `session.provider === "codex"`。
3. 移除或保留未使用的 `QuickChatSessionSection`：
   - 推荐保留组件但不从 `/runtimes` Codex 主路径调用，减少 quick-chat 全局变更面；
   - 模块文档标注 quick-chat 已不是 runtime Codex interactive 主路径。
4. 测试更新：
   - Codex runtime 首条消息调用 `createSession({ provider: "codex" })`；
   - Codex 多轮调用 `injectSession()`；
   - Codex ended session 可点击继续对话并调用 `reopenSession()`；
   - 原 "codex quick-chat" 测试改为"不走 quick-chat"。

### 5.8 模块文档更新

实现完成后同步：

- `.sillyspec/docs/sillyhub-daemon/modules/daemon.md`
- `.sillyspec/docs/backend/modules/daemon.md`
- `.sillyspec/docs/SillyHub/modules/frontend_components.md`
- `.sillyspec/docs/SillyHub/modules/frontend_lib.md`（如 quick-chat 描述需调整）
- `.sillyspec/knowledge/uncategorized.md`（如记录通用经验）

## 6. 生命周期契约表

| 阶段 | Frontend | Backend | Daemon | Codex driver | 持久化/日志 |
| --- | --- | --- | --- | --- | --- |
| Create | `createSession(provider="codex")` | 建 `AgentSession(pending)` + 首个 `AgentRun` + lease | `_startInteractiveSession()` 按 provider 取 Codex path | `thread/start` + `turn/start` | `AgentSession.agent_session_id = threadId`，日志写 `AgentRunLog` |
| Inject | `injectSession(sessionId,prompt)` | 同 session 建新 `AgentRun` + inject 消息 | `SessionManager.inject()` 入队 | 上个 turn 完成后 `turn/start` | 新 run 复用同一 `AgentSession` |
| Interrupt | `interruptSession(sessionId)` | 下发 `SESSION_INTERRUPT` | `SessionManager.interrupt()` 找 provider driver | `turn/interrupt(threadId,turnId)` | 当前 run close 为 killed/failed 语义，session 保持可继续 |
| End | `endSession(sessionId)` | 下发 `SESSION_END` | `SessionManager.end()` close queue/driver | 关闭 app-server child | `AgentSession.status=ended` |
| Reopen | `reopenSession(sessionId)` | ended/failed → reconnecting + lease | `restoreAndReconnect()` | `thread/resume(threadId)` | 重连成功后 active |
| Daemon restart | SSE/history 保持可看 | `recover_session` 标 reconnecting | 启动时读 session store | `thread/resume(threadId)` | `confirm_session_reconnected` |

### 6.1 事件 × 状态转换矩阵

| 事件 | 前置 session 状态 | Backend 状态转换 | Daemon 状态转换 | AgentRun/lease 状态 | 结果 |
| --- | --- | --- | --- | --- | --- |
| create first turn | 无 session | 新建 `AgentSession.pending → active` | `SessionManager.create(): running` | 新建 `AgentRun.pending → running`，interactive lease pending/claimed | Codex thread 创建，首 turn 开始 |
| first turn completed | active | `AgentSession.active` 保持 | `running → active` | 当前 `AgentRun.running → completed/failed/killed` | 可继续 inject |
| inject next turn | active | 同 session 创建新 `AgentRun.pending` | `active → running` | 新 run pending/running，lease claim token 复用 | 下一 turn 入队 |
| inject while running | active 且有 current run | backend 拒绝或排队策略按现有 active run 约束 | 如允许入队则 pending count 增加 | 新 run 等待前一 turn 收敛 | 不并发启动 Codex turn |
| interrupt | active/running | 下发 `SESSION_INTERRUPT` | `running` 内发送 provider interrupt，等待 result 收敛 | 当前 run 收敛为 killed/failed 语义 | session 不结束 |
| end | active/running/reconnecting | `AgentSession.* → ended` | `* → ended`，close queue/driver | lease completed，当前 run 按现有收口 | 历史可回看，不可 inject |
| driver error | running/reconnecting | `AgentSession.* → failed` | `* → failed` | 当前 run failed，lease completed/failed | 历史可回看，可 reopen |
| reopen | ended/failed 且有 thread id | `ended/failed → reconnecting → active` | `restoreAndReconnect(): reconnecting → active` | 新 interactive lease pending/claimed | `thread/resume` 后可 inject |
| recovery failed | reconnecting | `reconnecting → failed` | 删除内存 state | lease completed/failed | 不伪造 thread |
| permission request | running | session 状态不变 | pending resolver/dialog hook 等待 | 当前 run 仍 running | 用户响应后 provider 继续 |
| permission timeout/deny | running | session 状态不变 | fail-closed 返回 deny/cancel | 当前 run 由 provider 决定继续或失败 | 不自动扩大权限 |

## 7. 错误处理

1. Codex executable 不存在：
   - daemon 记录 provider-specific warning；
   - 当前 interactive lease fail；
   - frontend 显示 session 创建失败或 run error。
2. Codex app-server 启动失败：
   - driver 上报 error flat message；
   - `onTurnResult()` 以 `is_error=true` close 当前 run；
   - session 标 failed 或保持可 end，按现有 SessionManager 异常路径处理。
3. JSON-RPC schema/事件不识别：
   - 保留 raw metadata；
   - 不阻断已识别的 text/tool/error 事件；
   - unknown event 作为 debug message 或忽略，但不能导致 session manager 崩溃。
4. `turn/interrupt` 无 active turn：
   - driver 返回 `false`；
   - backend/API 行为沿用现有 interrupt false 分支。
5. daemon 重启后 session store 缺 Codex threadId：
   - 标记 recovery failed；
   - 不伪造新 thread，避免历史串线。

## 8. 测试计划

### 8.1 daemon

运行：

```bash
pnpm --dir sillyhub-daemon test
pnpm --dir sillyhub-daemon typecheck
```

新增/调整测试：

- `SessionManager` 支持 `drivers.claude` 与 `drivers.codex`；
- `create(provider="codex")` 调 Codex driver，不抛 `UnsupportedProviderError`；
- `restoreAndReconnect(provider="codex")` 调 Codex driver resume；
- `interrupt()` 按 session provider 路由到对应 driver；
- `CodexAppServerDriver` 用 fake child/stdin/stdout 覆盖 `thread/start`、`turn/start`、`turn/completed`、`turn/interrupt`。

### 8.2 backend

运行：

```bash
cd backend && uv run pytest app/modules/daemon/tests/test_session_service.py
```

覆盖 Codex reopen。

### 8.3 frontend

运行：

```bash
pnpm --dir frontend exec vitest run \
  src/components/daemon/runtime-session-dialog.test.tsx \
  src/components/daemon/__tests__/interactive-session-panel.test.tsx
pnpm --dir frontend exec eslint \
  src/components/daemon/runtime-session-dialog.tsx \
  src/components/daemon/runtime-session-helpers.tsx \
  src/components/daemon/runtime-session-dialog.test.tsx
```

覆盖 Codex runtime interactive 主路径。

### 8.4 集成验收

在本机 Codex CLI 可用时，手动/半自动验证：

1. `/runtimes` 打开 Codex runtime；
2. 发送第一条消息，产生 Codex `AgentSession` 和首个 `AgentRun`；
3. 发送第二条消息，仍在同一 `AgentSession`，新增第二个 `AgentRun`；
4. 运行中点击打断；
5. 结束 session；
6. 从历史列表 reopen；
7. daemon restart 后 recover。

## 9. 兼容与迁移

项目未正式上线，不为历史脏数据做复杂迁移。

需要注意：

- quick 修复产生的前端分流代码会被本变更覆盖；
- 已存在的 ended Codex session 如果缺 `agent_session_id` / threadId，不能可靠 reopen，应显示失败；
- `AgentSession.provider` 已存在，数据库无需新增列；
- `AgentSession.agent_session_id` 对 Codex 的语义明确为 Codex thread id。

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Codex app-server JSON-RPC schema 与本机版本变化 | driver 事件解析失败 | 以本机 `codex app-server generate-json-schema` 校验；解析 unknown event 时降级 |
| SessionManager 改 driver 抽象影响 Claude | Claude interactive 回退 | 保留 Claude driver 包装测试，先让现有 Claude 测试通过 |
| Codex child 未释放 | daemon 泄漏子进程 | `end()` / queue close / driver finally 均 close child |
| interrupt 时 turnId 未捕获 | 打断无效 | `turn/started` 必须记录当前 turnId；无 turn 返回 false |
| flat message 与 backend 日志展示不匹配 | 前端看不到内容 | 复用 `RunSyncService.submit_messages()` 支持的 `event_type/content` 契约 |
| Codex approval response schema 映射错误 | Codex turn 卡住或拒绝 response | 用本机 generated schema 和 fake app-server request 单测覆盖每类 server request |
| 自动接受权限破坏 Claude parity | Codex 行为比 Claude 更危险 | server request 默认走 `PermissionResolver`，异常/超时 fail-closed |

## 11. 验收标准

- [ ] Codex runtime 首条消息走 `createSession(provider="codex")`，不调用 quick-chat。
- [ ] Codex 同 session 第二条消息走 `injectSession()`，产生第二个 run。
- [ ] Codex running turn 可 interrupt。
- [ ] Codex session 可 end。
- [ ] Codex ended/failed session 可 reopen，backend 不再返回"codex 暂不支持续聊"。
- [ ] daemon restart recover 对 Codex 不抛 `UnsupportedProviderError`。
- [ ] Codex command/file/permission request 不自动 accept，能通过现有 permission/dialog 流等待用户响应。
- [ ] Codex request_user_input/MCP elicitation 能显示可答卡片或等价 dialog，并把答案回写 app-server。
- [ ] Claude Code 现有 interactive tests 全通过。
- [ ] backend / frontend / daemon 相关测试通过。
- [ ] 模块文档同步完成。

## 12. 自审清单

- [x] 目标限定为 `/runtimes` Codex interactive parity，不扩散到无关 provider。
- [x] 使用现有 `AgentSession` / `AgentRun` / lease 控制面，不新增平行模型。
- [x] 保留 Claude Code 现有路径和测试，避免把 Codex 需求做成 Claude 回归。
- [x] 设计说明了 create/inject/interrupt/end/reopen/recovery 全生命周期。
- [x] 设计补齐了 approval/dialog parity，避免 Codex 自动批准造成行为不一致。
- [x] 设计包含 backend、daemon、frontend 三层文件路径和测试计划。
- [x] 已明确 quick-chat 是临时降级，不是最终 Codex runtime 会话路径。
