---
schema_version: 1
doc_type: module-card
module_id: daemon
author: qinyi
created_at: 2026-06-10T16:55:00
---

# daemon

## 定位
核心守护进程管理。编排 daemon 完整生命周期：启动 → 检测 agent → 注册到 server → 启动心跳与 WebSocket 监听循环。负责接收 server 推送的 task_available 消息，驱动 lease claim → start → execute → complete 全流程；并承载交互式（interactive）AgentSession 的创建、注入、打断、结束、reopen 与重启恢复。WebSocket 逻辑已拆出独立模块 ws-client，本模块通过回调消费消息。

## 契约摘要
- `DaemonOptions` — 构造参数：config / client / taskRunner
- `Daemon(options)` — 初始化
- `start(): Promise<void>` — 启动：检测 agent → 注册每个 → 启动心跳循环与 WS 客户端
- `stop(): Promise<void>` — 优雅关闭：取消所有 task → 等待完成 → 关闭 WS 与 HTTP client
- `isRunning: boolean` — 运行状态查询（getter）
- `_startInteractiveSession(execPayload)` — 按 `execPayload.provider ?? "claude"` 取 `this._agentPaths.get(provider)` 作为 executable path（D-002@v1）；provider 无对应 executable 时记录 `interactive_${provider}_executable_not_found` 并 fail 当前 lease；调用 `SessionManager.create({ provider, pathTo...: executablePath, ... })`
- `_routeSessionResume(message/session)` — 从 message/session record 归一化 `provider` 为 `claude | codex`，交给 `SessionManager.restoreAndReconnect(record)`，不再在 daemon 层写死 Claude（D-007@v1）
- `onTurnMessage/onTurnResult` — 参数类型从 Claude SDK 类型放宽为 driver message/result；Claude SDK raw message 仍兼容，Codex flat message（`event_type` + `content` + `metadata` + `session_id=threadId`）直接 `submitMessages()` 上报 backend（D-004@v1）

## 关键逻辑
```
start()
  1. AgentDetector.detectAll() → availableAgents
  2. for each agent: client.register({ runtimeId: `${baseId}--${name}`, provider, version, protocol })
     → registeredRuntimes[name] = runtimeId
  3. 启动心跳循环：每 heartbeatInterval 发 client.heartbeat
  4. new WsClient(url, callbacks)
       onTaskAvailable → _executeTask(payload)
       onHeartbeatAck / onClose / onError
       wsClient.start()  // 内含 5s 自动重连 + HTTP 轮询兜底

_executeTask(payload)
  claimLease → startLease → taskRunner.executeTask → completeLease

_startInteractiveSession(execPayload)  // interactive 主入口
  provider = execPayload.provider ?? "claude"
  executablePath = this._agentPaths.get(provider)   // D-002@v1：按 provider 取 executable
  SessionManager.create({ provider, pathTo..., input })  // D-001@v1：SessionManager 按 provider 选 driver

_routeSessionResume(record)            // D-007@v1：recovery 按 provider 路由
  provider = normalize(record.provider)  // claude | codex
  SessionManager.restoreAndReconnect(record)  // 不写死 Claude
```

### Provider Driver 架构（D-001@v1, D-009@v1）

daemon 的交互式会话由 `SessionManager`（`src/interactive/session-manager.ts`）驱动，已从「只驱动单一 Claude SDK driver」改为「按 provider 选择 driver」：

```
SessionManager(provider driver registry)
  this._getDriver(provider) →
    |-> ClaudeSdkDriver        -> Claude Agent SDK query()   （claude）
    |-> CodexAppServerDriver   -> codex app-server stdio://  （codex，D-001@v1/D-002@v1/D-004@v1）
```

- `SessionManagerDeps.drivers: Partial<Record<'claude' | 'codex', InteractiveDriver>>`（D-001@v1, D-009@v1）；`cli.ts` 注入 `drivers.claude` 与 `drivers.codex`。
- driver 契约（`src/interactive/driver.ts`）provider-neutral：`InteractiveDriver.start(consume(interrupt(...))`，driver 内部各自做 provider 协议 ↔ provider-neutral `UserTurnInput` 转换；`InputQueue` 队列元素从 Claude SDK 专属 `SDKUserMessage` 改为 `UserTurnInput`（D-009@v1）。
- `SessionManager.create(input)` / `inject()` / `restoreAndReconnect(record)` / `interrupt(sessionId)` 均通过 `this._getDriver(provider)` 选 driver；`interrupt` 用该 session 当前 `state.provider`/`state.driver` 路由，不再用全局单一 driver（D-001@v1）。
- Claude 专属审批（`canUseTool` / `onUserDialog`）只作为 Claude SDK driver option 注入；`PermissionResolver` 与 backend `PERMISSION_REQUEST/RESPONSE` 是 provider-neutral 能力，Codex server request 同样复用（D-006@v1, D-008@v1）。

### CodexAppServerDriver（D-001@v1, D-002@v1, D-004@v1, D-006@v1, D-010@v1）

`src/interactive/codex-app-server-driver.ts` 跑 `codex app-server --listen stdio://` 的 JSON-RPC 长驻 driver：

- 新建：`initialize` → `notifications/initialized` → `thread/start` → 首轮 `turn/start`；恢复：`initialize` → `notifications/initialized` → `thread/resume(threadId)` 后续 inject 再 `turn/start`（D-007@v1）。
- 串行 turn：一次只允许一个 running turn，收到 `turn/completed` 后才消费下一条 prompt，避免 Codex app-server 内并发 turn。
- 打断：监听 `turn/started` 保存 `turnId`，`interrupt()` 发 `turn/interrupt({ threadId, turnId })`，无当前 turn 返回 `false`。
- 审批/dialog（D-006@v1, D-008@v1）：`manual_approval+ask_user_only=true` 时普通 command/file/permission request 走 allow-through 并记录 metadata，只阻塞 `request_user_input`/可归一化 MCP elicitation；`ask_user_only=false` 时普通 request 才走前端审批卡；**fail-closed 默认**（backend send 失败/超时/session 已结束/driver 被 interrupt 时返回 deny/cancel，绝不无条件自动 accept 扩权）。MCP elicitation 复杂 schema 暂不支持（fail-closed 并上报 error log）。
- 消息映射：flat message 上报 backend（`{ event_type: "text|tool_use|tool_result|error", content, metadata?, session_id: threadId }`），不把 Codex app-server schema 泄漏到 backend；`thread/started`/`thread/resumed` 结果把 `session_id` 写为 threadId，使 backend `AgentSession.agent_session_id` 对齐 Codex thread id（D-004@v1）。

## 注意事项
- 每个 agent 独立注册为 `"{base_runtime_id}--{agent_name}"` 格式的 runtime
- WebSocket 自动重连逻辑下沉到 ws-client（间隔 5 秒，URL 由 server_url 推导 http→ws / https→wss）
- `_handleWsMessage` 仅处理 `MSG.taskAvailable` 和 `MSG.heartbeatAck`
- Node 版用 `setInterval` / `AbortController` 替代 asyncio.Task，stop 时统一清理
- 对外 REST/WS 消息与 lease 状态机与 Python 版完全相同（G-02 不变）
- Claude Code 现有 interactive / 审批 / AskUserQuestion / SSE 日志行为不变（本变更只新增 Codex driver，Claude 路径不回退）
- Codex ended/failed session 若缺 `agent_session_id`/threadId，不能可靠 reopen，应显示失败且不伪造新 thread（与 design §9 兼容与迁移一致）
- MCP elicitation 复杂 schema 当前 fail-closed，仅支持可归一化为 question/options 的简单场景，不支持复杂 form/schema
- 依赖：agent-detector, client, config, protocol, ws-client, interactive/session-manager, interactive/driver（provider driver 契约）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->

## 变更记录

- 2026-06-23-codex-interactive-session | SessionManager provider driver 化，接入 CodexAppServerDriver，Codex interactive 复用 AgentSession 生命周期（create/inject/interrupt/end/reopen/recovery），`_startInteractiveSession` 按 provider 取 executable，`_routeSessionResume` 按 provider 路由 recovery，message/result 类型放宽为 driver message/result；审批走 fail-closed 策略（D-001@v1/D-002@v1/D-004@v1/D-006@v1/D-007@v1/D-008@v1/D-009@v1/D-010@v1）。
