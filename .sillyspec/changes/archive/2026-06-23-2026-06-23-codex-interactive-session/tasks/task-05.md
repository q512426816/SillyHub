---
author: qinyi
created_at: 2026-06-24 00:13:45
id: task-05
title: 实现 Codex approval、request_user_input 与 MCP elicitation 映射
priority: P0
estimated_hours: 7
depends_on: [task-02, task-04]
blocks: [task-06, task-09]
requirement_ids: [FR-08, FR-09]
decision_ids: [D-006@v1, D-008@v1, D-010@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/src/interactive/permission-resolver.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver-approval.test.ts
---

# task-05: 实现 Codex approval、request_user_input 与 MCP elicitation 映射

## 修改文件

- `sillyhub-daemon/src/interactive/codex-app-server-driver.ts`（**修改 / 续写**，task-04 已提供骨架与生命周期）：在 `consume()` 的 server-request 分发处接入本任务新增的 approval/user-input/elicitation 映射。新增纯函数模块级导出 `normalizeCodexRequestUserInput()` / `denormalizeCodexRequestUserInputAnswers()` / `normalizeMcpElicitation()`，以及每类 server request 的 `handleXxxRequest()` 协程。所有映射函数对 task-04 已有的 JSON-RPC 响应写出（`_respond(id, result)`）与 `PermissionResolver` 注入做对接，不重写 lifecycle。
- `sillyhub-daemon/src/interactive/permission-resolver.ts`（**小改**）：确认 `PermissionRegisterInput.dialogKind` / `dialogPayload` 通道已存在（Claude `onUserDialog` 在用）。本任务只**复用**该通道承载 Codex 的 `codex_request_user_input` / `mcp_elicitation` 两类 dialog_kind，必要时把 `toolName` 语义注释扩成"provider-neutral 审批/dialog 工具名/请求类型"。**不**改 `register/resolve/abortAll` 核心逻辑，**不**改 wire payload 字段（保持 `PERMISSION_REQUEST` 既有 snake_case schema 向后兼容）。
- `sillyhub-daemon/src/hub-client.ts`（**零改 / 仅必要时补一个 helper**）：调研结论——`hub-client.ts` 当前**没有** permission 相关专用方法；`SessionManager` 通过注入的 `wsClient.send({type: MSG.PERMISSION_REQUEST, payload})` 发送（见 `_buildCanUseToolCallback` / `_buildOnUserDialogCallback`）。本任务 Codex 复用同一 `wsClient.send` 路径，**默认不改 hub-client.ts**。仅当 task-04 骨架需要 Codex driver 拿到注入的 `send` 函数且该注入点尚不存在时，才在 hub-client 暴露一个 `sendPermissionRequest(payload)` 薄封装（透传 `wsClient.send`），保持单一出口便于测试 mock。
- `sillyhub-daemon/tests/interactive/codex-app-server-driver-approval.test.ts`（**新增**）：fake app-server stdin/stdout 逐类覆盖 server request → 映射 → JSON-RPC response。

## 覆盖来源

- Requirements：FR-08（Codex 普通 approval 策略与 Claude 一致：ask-only allow-through vs full-review 走前端审批）、FR-09（Codex `request_user_input` / MCP elicitation 复用现有 dialog 卡片，复杂 schema fail-closed）。
- Decisions：D-006@v1（Codex 遵循 `manual_approval + ask_user_only`，不无条件 accept、不 ask-only 强弹卡）、D-008@v1（permission/dialog hook 放 SessionManager 层，Codex 复用 `PermissionResolver` + backend `PERMISSION_REQUEST/RESPONSE`）、D-010@v1（dialog payload 双向归一化，不支持归一化的复杂 MCP elicitation fail-closed + 记 error log）。
- Design：§4.1 文件清单第 4 行（codex-app-server-driver 覆盖 D-006/D-010）、§5.2 第 6/7 点（provider-neutral hook + Codex 复用 PermissionResolver）、§5.3 第 5 点（全部子项）、§5.5 矩阵"工具/命令审批 / AskUser 用户输入"两行、§7 错误处理第 3/4 点、§10 风险表"自动接受权限破坏 Claude parity"与"Codex approval response schema 映射错误"两行。

## 实现要求

依据 design §5.3 第 5 点逐条落地（搬砖工照做）：

1. **策略读取（D-006@v1）**：Codex driver 在 `start()` 接收 task-02/task-04 传入的 `manualApproval: boolean` 与 `askUserOnly: boolean`（与 Claude `_buildCanUseToolCallback(sessionId, askUserOnly)` 同源语义）。收到任一 approval server request 时先判策略：
   - `manualApproval=false`：driver 不阻塞，按 allow-through 返回 accept（与 Claude manualApproval=false SDK 默认策略等价），并记一条 flat `{event_type:"tool_use", metadata:{kind:"approval",auto_accept:true,rpc_method}}` 日志，便于审计。**不**发 `PERMISSION_REQUEST`。
   - `manualApproval=true, askUserOnly=true`：command/file/permissions 三类**普通** approval request allow-through（同 Claude ask-only 对非 AskUserQuestion 工具的逻辑），返回 accept + auto_accept 日志。**只有** `item/tool/requestUserInput` 与可归一化的 `mcpServer/elicitation/request` 才阻塞走前端 dialog。
   - `manualApproval=true, askUserOnly=false`：三类普通 approval 走 `PermissionResolver.register()` 发 `PERMISSION_REQUEST`，等前端 allow/deny 后还原 Codex schema response。
2. **`item/commandExecution/requestApproval` 映射**：
   - ask-only / manualApproval=false → allow-through：response `{ decision: "accept" }`。
   - full-review → register permission request：`toolName="codex_command_approval"`，`toolInput={ command, cwd, commandActions, reason, networkApprovalContext }`（原样透传 params 可审计字段，不读不改），不带 `dialogKind`。前端 allow → `{ decision: "accept" }`；deny / 超时 / send 失败 / abort → fail-closed `{ decision: "decline" }`（不返回 `cancel`，因为 cancel 会立即 interrupt turn，deny 仅让 agent 继续——与 Claude deny 语义一致，由 agent 决定收敛）。
3. **`item/fileChange/requestApproval` 映射**：同上，`toolName="codex_file_change_approval"`，`toolInput={ grantRoot, reason }`。allow → `{ decision: "accept" }`；fail-closed → `{ decision: "decline" }`。
4. **`item/permissions/requestApproval` 映射**（扩权请求，最敏感）：`toolName="codex_permissions_approval"`，`toolInput={ permissions, cwd, reason }`（`permissions` 为 RequestPermissionProfile）。
   - ask-only / manualApproval=false：allow-through 但**不自动扩权**——返回 `{ permissions: { fileSystem: null, network: null }, scope: "turn" }`（空 profile，即不授予任何额外权限，让 Codex 在现有 sandbox 内继续）。记 flat 日志 `metadata:{kind:"permission_request",auto_accept:true,granted:"none"}`。**禁止**把请求的 profile 原样回授（D-006 安全一致：不得比 Claude 更宽松）。
   - full-review：register 后前端 allow → 仍只回 `{ permissions: <requested profile>, scope: "turn" }`（用户显式同意才扩权，scope 限 turn 不持久化到 session）；deny / 超时 / fail → `{ permissions: { fileSystem: null, network: null }, scope: "turn" }`（不扩权，agent 在原 sandbox 内继续）。
5. **`item/tool/requestUserInput` 映射（D-010@v1 双向归一化）**：
   - 永远阻塞（即使 ask-only，因为这是纯用户提问，与 Claude `AskUserQuestion` 一致）。
   - 先调 `normalizeCodexRequestUserInput(params)` 把 Codex `{ questions: [{ id, header, question, options:[{label,description}], isSecret, isOther }] }` 归一化为前端 `AskUserDialogCard` 现有 schema（questions/options 结构——见 task-09 前端契约，本任务只保证 daemon 侧输出的 `dialogPayload` 形态与 Claude `AskUserQuestion` 的 questions 数组对齐：`{ questions: [{ question, header, options:[{label,description}] }] }`，保留 question id 到内部映射用于还原）。
   - `PermissionResolver.register({ dialogKind: "codex_request_user_input", dialogPayload: <归一化后>, toolName: "codex_request_user_input", toolInput: params })` 发 `PERMISSION_REQUEST`。
   - 前端 `PERMISSION_RESPONSE` 带 `dialog_result`（用户答案）返回后，调 `denormalizeCodexRequestUserInputAnswers(params, dialogResult)` 还原为 Codex schema `{ answers: { [questionId]: { answers: string[] } } }`，作为 JSON-RPC response result 写回 app-server。
   - deny / 超时 / send 失败 / abort：fail-closed 返回空 answers `{ answers: {} }`（让 Codex turn 继续，agent 自行决定收敛——对齐 Claude AskUserQuestion 超时回 "user did not answer"）。
6. **`mcpServer/elicitation/request` 映射（D-010@v1 fail-closed）**：
   - 永远阻塞。
   - `normalizeMcpElicitation(params)`：只支持两种可归一化形态——`mode:"url"`（透传 `{ url, message }` 作为单问题 dialog）和 `mode:"form"` 且 `requestedSchema` 仅含简单 string/boolean/enum 字段（映射为 questions/options）。**复杂 schema**（nested object、array of objects、任意 oneOf/anyOf 深层结构、未知 type）→ `normalizeMcpElicitation` 返回 `{ supported: false, reason }`。
   - 可归一化：register `{ dialogKind: "mcp_elicitation", dialogPayload: <归一化>, toolName: "mcp_elicitation", toolInput: params }`，前端 accept 后还原 `{ action: "accept", content: <用户输入> }`；decline → `{ action: "decline", content: null }`；cancel/超时/fail → `{ action: "cancel", content: null }`。
   - **不支持归一化**：fail-closed，立刻 response `{ action: "decline", content: null }`，**并**上报一条 flat error 日志 `{ event_type:"error", content:"unsupported MCP elicitation schema: <reason>", metadata:{ rpc_method:"mcpServer/elicitation/request", kind:"unsupported_elicitation" } }`（D-010 normalized_requirement：记录 error log 说明暂不支持）。不得静默 accept。
7. **dispatch 总入口**：在 `consume()` 解析出 server request（method ∈ 上述 5 类 + `item/tool/requestUserInput`）后，`switch(method)` 路由到对应 handler。**未知 method**：fail-closed，对 approval 类返回 decline（若可推断）/ 否则按 task-04 既有 unhandled 路径上报 error event 并写一条 JSON-RPC error response（code -32601 method not found），不卡死 turn。

## 接口定义

所有映射为纯函数（除 handler 协程外），便于单测。类型仅描述字段形态，运行时做宽松校验（Codex schema 可能跨版本漂移，design §10 风险表）。

### 1. `item/commandExecution/requestApproval`

- **Codex request params**（`CommandExecutionRequestApprovalParams`，必填 `{ itemId, threadId, turnId }`，可选 `command, cwd, commandActions, reason, networkApprovalContext, additionalPermissions, availableDecisions, proposedExecpolicyAmendment, proposedNetworkPolicyAmendments, approvalId }`）。
- **映射函数**：`async handleCommandExecutionApproval(req: CodexServerRequest, ctx: CodexApprovalCtx): Promise<CodexJsonRpcResponse>`。`ctx` 携带 `{ manualApproval, askUserOnly, sessionId, runId, resolver?, send?, signal? }`。
- **JSON-RPC response**（result 字段，`CommandExecutionRequestApprovalResponse`）：
  - allow-through / 用户 allow → `{ id: req.id, result: { decision: "accept" } }`
  - deny / fail-closed → `{ id: req.id, result: { decision: "decline" } }`

### 2. `item/fileChange/requestApproval`

- **params**：`{ itemId, threadId, turnId, grantRoot?, reason? }`。
- **映射函数**：`async handleFileChangeApproval(req, ctx): Promise<CodexJsonRpcResponse>`。
- **response**（`FileChangeRequestApprovalResponse`）：
  - allow → `{ result: { decision: "accept" } }`
  - fail-closed → `{ result: { decision: "decline" } }`

### 3. `item/permissions/requestApproval`

- **params**：`{ itemId, threadId, turnId, cwd, permissions: RequestPermissionProfile, reason? }`。
- **映射函数**：`async handlePermissionsApproval(req, ctx): Promise<CodexJsonRpcResponse>`。
- **response**（`PermissionsRequestApprovalResponse`，注意 required `permissions` 字段，不是 `decision`）：
  - 用户显式 allow → `{ result: { permissions: <req.params.permissions>, scope: "turn" } }`
  - ask-only / manualApproval=false / deny / fail-closed → `{ result: { permissions: { fileSystem: null, network: null }, scope: "turn" } }`

### 4. `item/tool/requestUserInput`（D-010 双向归一化）

- **params**（`ToolRequestUserInputParams`）：`{ itemId, threadId, turnId, questions: [{ id, header, question, options?: [{ label, description }], isSecret?, isOther? }] }`。
- **归一化函数签名**：
  ```ts
  function normalizeCodexRequestUserInput(
    params: Record<string, unknown>,
  ): {
    supported: true;
    dialogPayload: { questions: Array<{ id: string; question: string; header?: string; options?: Array<{ label: string; description?: string }>; isSecret?: boolean }> };
    /** 内部 id 映射，供 denormalize 还原（questions 顺序与原 params 一致）。 */
    questionIds: string[];
  } | { supported: false; reason: string };
  ```
- **denormalize 函数签名**（把前端答案还原为 Codex `{ answers: { [id]: { answers: string[] } } }`）：
  ```ts
  function denormalizeCodexRequestUserInputAnswers(
    questionIds: string[],
    dialogResult: unknown,
  ): { answers: Record<string, { answers: string[] }> };
  ```
  - `dialogResult` 预期为 `{ [id]: string | string[] }`（前端 AskUserDialogCard 用户选择）；非数组包装成 `[value]`；缺字段填 `[]`。
- **映射函数**：`async handleRequestUserInput(req, ctx): Promise<CodexJsonRpcResponse>`。
- **response**（`ToolRequestUserInputResponse`）：
  - 用户回答 → `{ result: { answers: <denormalize 后> } }`
  - fail-closed → `{ result: { answers: {} } }`
- **dialog_kind**：`"codex_request_user_input"`（写入 PERMISSION_REQUEST.dialog_kind）。

### 5. `mcpServer/elicitation/request`（D-010 fail-closed）

- **params**（`McpServerElicitationRequestParams`）：`{ serverName, threadId, turnId?, message, mode: "form" | "url", url?, requestedSchema?, elicitationId? }`。
- **归一化函数签名**：
  ```ts
  function normalizeMcpElicitation(
    params: Record<string, unknown>,
  ):
    | { supported: true; mode: "url"; dialogPayload: { url: string; message: string } }
    | { supported: true; mode: "form"; dialogPayload: { questions: Array<...> } }
    | { supported: false; reason: string };
  ```
  - url 模式恒 supported（单问题透传）。
  - form 模式：遍历 `requestedSchema.properties`，仅当所有属性为 `string | boolean | enum(string[])"` 时 supported；含 object/array/oneOf/anyOf/未知 type → `{ supported: false, reason: "unsupported field type in requestedSchema: <field>" }`。
- **映射函数**：`async handleMcpElicitation(req, ctx): Promise<CodexJsonRpcResponse>`。
- **response**（`McpServerElicitationRequestResponse`）：
  - 用户 accept → `{ result: { action: "accept", content: <用户输入映射>, _meta: null } }`
  - 用户 decline → `{ result: { action: "decline", content: null } }`
  - cancel / 超时 / fail → `{ result: { action: "cancel", content: null } }`
  - **不支持归一化** → 立即 `{ result: { action: "decline", content: null } }` + flat error 日志。
- **dialog_kind**：`"mcp_elicitation"`。

### 公共类型

```ts
interface CodexServerRequest {
  id: number | string;
  method: string;
  params: Record<string, unknown>;
}
interface CodexJsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result: unknown; // 各 handler 按对应 Response schema 填
}
interface CodexApprovalCtx {
  manualApproval: boolean;
  askUserOnly: boolean;
  sessionId: string;
  runId: string;
  resolver?: PermissionResolver;        // manualApproval=true 时必传
  send?: PermissionSendFn;              // manualApproval=true 时必传（wsClient.send）
  signal?: AbortSignal;                 // interrupt 时 abort
  respond: (id, result) => Promise<void>; // task-04 已有的 _respond
  log: (msg) => void;                   // flat message 上报（submitMessages 路径）
}
```

### dialog_kind 取值表

| 场景 | dialog_kind | 是否阻塞（ask-only） | PERMISSION_REQUEST 特殊字段 |
| --- | --- | --- | --- |
| commandExecution approval | 无（普通审批） | 否（allow-through） | 无 dialog_kind，走 allow/deny 审批卡 |
| fileChange approval | 无 | 否 | 同上 |
| permissions approval | 无 | 否 | 同上 |
| request_user_input | `codex_request_user_input` | **是**（永远阻塞） | dialog_kind + dialog_payload |
| mcp elicitation | `mcp_elicitation` | **是**（永远阻塞） | dialog_kind + dialog_payload |

## 边界处理（≥6 条）

1. **backend send 失败**：`resolver.register` 内部 `send()` 返回 false → PermissionResolver 已 fail-closed 返回 deny（既有逻辑）；Codex handler 据 deny 还原对应 decline/空 answers/cancel。**不重试、不本地 allow**。
2. **5min 超时**：`PERMISSION_FALLBACK_TIMEOUT_MS`（305s）触发 deny（PermissionResolver 既有兜底）；handler 收到 deny 同上 fail-closed 还原。
3. **session 已结束 / 非 running turn**：handler 入口校验 `ctx` 与当前 turn 状态，`state.status !== "running"` 或无 `runId` → 直接 fail-closed 写 response（approval 类 decline、user_input 空 answers、elicitation cancel），不调 register（避免在已结束 session 残留 pending）。
4. **interrupt 时**：`ctx.signal` aborted → PermissionResolver 既有逻辑立即 deny（signal already aborted 分支）→ handler fail-closed。driver interrupt 同时应触发 `resolver.abortAll("interrupt")`（task-02 SessionManager 层已有，本任务 handler 只读 signal 不重复 abort）。
5. **ask_user_only=true 时普通 request allow-through**：command/file/permissions 三类**不**走前端审批，直接返回 accept（command/file）或空 profile（permissions），与 Claude ask-only 对非 AskUserQuestion 工具 allow-through 语义一致（FR-08 第一段）。
6. **ask_user_only=false 时走前端审批卡**：三类普通 request 发 `PERMISSION_REQUEST`（无 dialog_kind），前端渲染 allow/deny 审批卡，用户响应后还原 Codex schema（FR-08 第二段）。
7. **复杂 MCP elicitation schema 不支持**：`normalizeMcpElicitation` 返回 `{supported:false}` → 立即 fail-closed decline + flat error 日志，**不**静默 accept、**不**尝试部分渲染（D-010 normalized_requirement）。
8. **不自动扩权**（permissions request）：任何 fail-closed / ask-only 路径都返回空 profile `{fileSystem:null,network:null}`，禁止把 requested profile 原样回授（D-006 安全一致，design §10 风险表"自动接受权限破坏 Claude parity"）。
9. **未知 server request method**：fail-closed 写 JSON-RPC error（code -32601）+ flat error 日志，不卡 turn、不崩 driver（design §7 错误处理第 3 点：unknown event 不导致 session manager 崩溃）。
10. **Codex schema 版本漂移**：所有 params 读取用宽松 `typeof`/`in` 校验，缺字段用默认值（如 permissions request 缺 `permissions` 当作空 profile 请求），记 flat warning 日志但不 throw——与 design §7 第 3 点"保留 raw metadata、不阻断已识别事件"一致。

## 非目标

- **不**改前端 `AskUserDialogCard` / 审批卡渲染细节——归一化后 payload 如何展示由 task-09 负责；本任务只保证 daemon 输出的 `dialog_payload` 形态与现有 Claude `AskUserQuestion` questions 结构对齐。
- **不**改 backend 权限策略 / `permission_service.py` / dialog 持久化逻辑——task-07 负责 backend 侧 Codex reopen + permission 回归测试；本任务复用既有 `PERMISSION_REQUEST/RESPONSE` 通道，不动 backend。
- **不**改 `PermissionResolver` 核心 `register/resolve/abortAll` 逻辑——仅复用其 `dialogKind/dialogPayload` 扩展字段。
- **不**实现 Codex driver 的 lifecycle（spawn / thread-start / turn-start / interrupt / close）——task-04 已提供骨架，本任务只在 server-request 分发点续写映射。
- **不**处理 `item/completed`、`turn/completed` 等通知类事件的日志映射——task-04 范围。

## 参考

- `sillyhub-daemon/src/interactive/permission-resolver.ts`：`PermissionResolver.register/resolve/abortAll`、`PermissionRegisterInput.dialogKind/dialogPayload`、`PERMISSION_FALLBACK_TIMEOUT_MS=305s`、fail-closed 铁律。Codex handler 直接复用其 promise + 5min 兜底 + AbortSignal 链。
- `sillyhub-daemon/src/interactive/session-manager.ts` `_buildCanUseToolCallback`（L449-）+ AskUserQuestion 拦截分支（L485-）+ `_buildOnUserDialogCallback`：Claude 侧 dialog 通道参考实现——`dialogKind:"AskUserQuestion"` + `dialogPayload`，deny message 回传答案的模式。Codex `codex_request_user_input` / `mcp_elicitation` 走同一通道。
- `sillyhub-daemon/src/protocol.ts` `MSG.PERMISSION_REQUEST/RESPONSE`、`PermissionRequestPayload`（含 `dialog_kind/dialog_payload`）、`PermissionResponsePayload`（含 `dialog_result`）：wire schema，Codex 与 Claude 共用，不改字段。
- `sillyhub-daemon/src/adapters/json-rpc.ts` `parseServerRequest`（L344）+ `APPROVAL_RESPONSES` 模板（L50-54）：batch TaskRunner 的自动 accept 模板，本任务 interactive driver **不复用其自动 accept**（interactive 必须 respect manual_approval），但 server request 解析（method/params/id 提取）与 unhandled error event 形态可参考。
- Codex schema（`/tmp/codex-app-schema/*.json`，证据见 decisions D-002/D-010）：`CommandExecutionRequestApprovalParams/Response`、`FileChangeRequestApprovalParams/Response`、`PermissionsRequestApprovalParams/Response`、`ToolRequestUserInputParams/Response`、`McpServerElicitationRequestParams/Response`——逐字对照本任务 response result 字段。

## TDD 步骤

测试文件 `sillyhub-daemon/tests/interactive/codex-app-server-driver-approval.test.ts`，用 fake app-server（mock stdin/stdout + 手动注入 server request JSON），`PermissionResolver`/`send` 全 mock，`vi.useFakeTimers` 推进超时。先写测试再写实现：

1. **纯函数归一化（无 driver 依赖，最先写）**：
   - `normalizeCodexRequestUserInput`：典型 questions → supported + dialogPayload 形态对齐 AskUserQuestion；空 questions 数组 → supported（空）；缺 id 字段 → supported:false。
   - `denormalizeCodexRequestUserInputAnswers`：`{q1:"a", q2:["b","c"]}` → `{answers:{q1:{answers:["a"]}, q2:{answers:["b","c"]}}}`；缺 q → `{answers:[]}`；dialogResult=null → `{answers:{}}`。
   - `normalizeMcpElicitation`：url 模式 → supported:url；form 简单 string/enum → supported:form；form 含 nested object → supported:false + reason；form 含 array of object → supported:false。
2. **commandExecution approval（manualApproval=false / ask-only / full-review 三态）**：
   - manualApproval=false → response `{decision:"accept"}`，发 0 次 PERMISSION_REQUEST，flat 日志含 auto_accept。
   - ask-only → 同上。
   - full-review + 用户 allow → 发 1 次 PERMISSION_REQUEST（无 dialog_kind），response `{decision:"accept"}`。
   - full-review + deny → response `{decision:"decline"}`。
   - full-review + send 返回 false → response `{decision:"decline"}`（fail-closed）。
   - full-review + 5min 超时 → response `{decision:"decline"}`。
3. **fileChange approval**：同 commandExecution 四态（allow / deny / send-fail / timeout）。
4. **permissions approval（扩权，关键安全测试）**：
   - ask-only → response `{permissions:{fileSystem:null,network:null},scope:"turn"}`，**断言不扩权**。
   - full-review + allow → `{permissions:<requested>,scope:"turn"}`。
   - full-review + deny → 空 profile。
   - full-review + timeout → 空 profile。
5. **request_user_input（D-010 双向归一化）**：
   - 归一化后 PERMISSION_REQUEST 带 `dialog_kind:"codex_request_user_input"` + `dialog_payload` questions。
   - 用户 `dialog_result:{q1:"a"}` → response `{result:{answers:{q1:{answers:["a"]}}}}`。
   - deny / 超时 / send-fail → response `{result:{answers:{}}}`。
   - ask-only 模式下仍阻塞（断言发 PERMISSION_REQUEST，不 allow-through）。
6. **mcp elicitation**：
   - url 模式 → `dialog_kind:"mcp_elicitation"`，用户 accept → `{action:"accept",content:...}`。
   - 简单 form → 同上。
   - 复杂 form（nested）→ 立即 `{action:"decline",content:null}` + 断言上报 flat error 日志含 "unsupported MCP elicitation schema"。
   - 超时 → `{action:"cancel",content:null}`。
7. **interrupt 边界**：handler 进行中 signal.abort → fail-closed response（每类各一个断言：command→decline、user_input→空 answers、elicitation→cancel）。
8. **session 已结束**：`state.status !== "running"` → handler 直接 fail-closed，断言不调 register（pendingCount 不增）。
9. **未知 method**：dispatch 收到 `item/foo/bar` → 写 JSON-RPC error（-32601）+ flat error 日志，turn 不卡。

## 验收标准

| # | 验收项 | 覆盖 | 验证方式 |
| --- | --- | --- | --- |
| AC-05.1 | `manualApproval=false` 时 command/file/permissions approval allow-through，发 0 次 PERMISSION_REQUEST，记 auto_accept 日志 | FR-08 | 单测 + flat 日志断言 |
| AC-05.2 | `ask_user_only=true` 时三类普通 approval allow-through；`request_user_input` / 可归一化 elicitation 仍阻塞弹 dialog | FR-08, D-006 | 单测：普通 approval 发 0 次，user_input/elicitation 发 1 次 PERMISSION_REQUEST |
| AC-05.3 | `ask_user_only=false` 时三类普通 approval 走前端审批卡（发 PERMISSION_REQUEST 无 dialog_kind），用户 allow/deny 后还原 Codex schema | FR-08, D-008 | 单测：allow→accept、deny→decline |
| AC-05.4 | permissions request 任何 fail-closed / ask-only 路径返回空 profile，不扩权；仅 full-review+allow 才回 requested profile（scope=turn） | FR-08, D-006 | 单测断言 `permissions.fileSystem===null && network===null` |
| AC-05.5 | `request_user_input` 归一化为 questions/options，response 还原为 `{answers:{[id]:{answers:string[]}}}` | FR-09, D-010 | 单测：normalize + denormalize 往返一致 |
| AC-05.6 | 复杂 MCP elicitation schema fail-closed decline + flat error 日志，不静默 accept | FR-09, D-010 | 单测断言 response.action==="decline" 且日志含 reason |
| AC-05.7 | backend send 失败 / 5min 超时 / signal abort / session 已结束 → 全部 fail-closed（不本地 allow、不扩权） | FR-08, FR-09 | 单测四态 × 多类 request |
| AC-05.8 | Codex 策略不比 Claude 更宽松：无任何路径无条件 accept 扩权或自动批准危险 request | FR-08, D-006 | code review + 单测覆盖 ask-only/full-review 矩阵 |
| AC-05.9 | `pnpm --dir sillyhub-daemon test` 全绿（含新增 approval 测试 + 既有 Claude permission 测试不回退） | FR-08, FR-09, FR-10 | CI / 本地 test |
| AC-05.10 | `pnpm --dir sillyhub-daemon typecheck` 通过 | — | typecheck |
