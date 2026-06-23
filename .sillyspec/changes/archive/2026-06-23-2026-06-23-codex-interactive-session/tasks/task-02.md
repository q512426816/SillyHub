---
author: qinyi
created_at: 2026-06-24 00:13:45
id: task-02
title: SessionManager 接入 provider driver registry、provider-neutral hook 与恢复路由
priority: P0
estimated_hours: 6
depends_on: [task-01]
blocks: [task-04, task-05, task-07]
requirement_ids: [FR-01, FR-02, FR-03, FR-06, FR-08, FR-09, FR-10]
decision_ids: [D-001@v1, D-006@v1, D-008@v1, D-009@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/interactive/session-store-persistence.ts
  - sillyhub-daemon/src/interactive/permission-resolver.ts
  - sillyhub-daemon/tests/interactive/session-manager-driver-registry.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-provider-routing.test.ts
---

# task-02: SessionManager 接入 provider driver registry、provider-neutral hook 与恢复路由

## 修改文件

| 文件 | 类型 | 改动要点 |
| --- | --- | --- |
| `sillyhub-daemon/src/interactive/types.ts` | 修改 | `SessionState` 增加 `driver`/`provider` 归属字段；`SessionManagerDeps` 从单 driver 改 `drivers` registry；onTurnMessage/onTurnResult 参数类型从 Claude SDK 类型放宽为 provider-neutral（保留兼容别名）；`CreateSessionInput` 新增 `pathToAgentExecutable` 可选字段。 |
| `sillyhub-daemon/src/interactive/session-manager.ts` | 修改（核心） | 新增 `_getDriver(provider)`；`create()`/`restoreAndReconnect()` 按 provider 路由；`interrupt()`/`_onIdleExpire()`/`_runConsume()` 改用 `state.driver`；抽出 provider-neutral permission/dialog helper（`requestPermission`/`requestUserDialog`）供 Claude 回调与 Codex driver 复用；Claude 回调内部映射为 `canUseTool`/`onUserDialog`。 |
| `sillyhub-daemon/src/interactive/session-store-persistence.ts` | 修改（小） | `PersistedSessionRecord` 注释/校验把 `pathToClaudeCodeExecutable` 语义升级为「provider executable path」；新增可选 `pathToAgentExecutable` 字段读写（codex path 恢复用），保持旧字段向后兼容。 |
| `sillyhub-daemon/src/interactive/permission-resolver.ts` | 不改源码 | 仅作为 helper 依赖（D-008）；task-02 不动其内部逻辑。 |
| `sillyhub-daemon/tests/interactive/session-manager-driver-registry.test.ts` | 新增 | drivers registry 路由 + 兼容旧 `driver` 入参测试。 |
| `sillyhub-daemon/tests/interactive/session-manager-provider-routing.test.ts` | 新增 | create/restore/interrupt 按 provider 选 driver + 无 driver 抛错测试。 |

> **不改 daemon.ts / cli.ts**：executable 按 provider 取（`_agentPaths.get(provider)`）、`_routeSessionResume` 写死 claude、cli 构造 SessionManager 注入 drivers 等属于 task-06 的范围。task-02 只把 SessionManager 变成「provider-ready」，让 task-06 接入时无需再改 session-manager.ts 主体。
> **不改 backend**：backend reopen 放开 codex 属于 task-07。
> **不写 Codex driver 实现**：`CodexAppServerDriver` 属于 task-04/05；task-02 只定义它要消费的 provider-neutral hook 签名。

## 覆盖来源

| FR/Decision | 覆盖点（本任务负责） |
| --- | --- |
| FR-01 | `create({provider:"codex"})` 经 `_getDriver("codex")` 路由到对应 driver，不再硬抛 `UnsupportedProviderError`（前置条件：driver 已注册）。 |
| FR-02 | `inject()` push `{type:"user",text}` 到 provider-neutral InputQueue（task-01 已改队列类型），driver 内部转换；SessionManager 主体不依赖 Claude SDK `SDKUserMessage`。 |
| FR-03 | `interrupt()` 用 `state.driver`（或 `state.provider` 反查 registry）调用 provider interrupt，不再用全局 `deps.driver`。 |
| FR-06 | `restoreAndReconnect()` 按 `record.provider` 选 driver，codex 不再被 `UnsupportedProviderError` 拦截；Codex 缺 thread id 时 fail。 |
| FR-08 | 抽出 provider-neutral `requestPermission` helper，封装「读 manualApproval/askUserOnly 策略 → register → await decision」逻辑，Codex driver 与 Claude `canUseTool` 共用同一套 fail-closed 语义。 |
| FR-09 | 抽出 provider-neutral `requestUserDialog` helper（带 dialogKind/dialogPayload），Claude `onUserDialog` 与 Codex `requestUserInput`/MCP elicitation 共用同一 PERMISSION_REQUEST 通道。 |
| FR-10 | Claude 现有 `_buildCanUseToolCallback`/`_buildOnUserDialogCallback` 行为不改，仅内部改为调用抽出的 helper；现有 Claude interactive 测试全绿。 |
| D-001@v1 | SessionManager.create/restoreAndReconnect/interrupt/end 必须按 session provider 路由；未注册 provider 抛 `UnsupportedProviderError`。 |
| D-006@v1 | provider-neutral hook 尊重 manualApproval + askUserOnly 策略：askUserOnly=true 普通 request allow-through 只阻塞用户输入；askUserOnly=false 普通 request 走前端审批卡。 |
| D-008@v1 | permission/dialog hook 放在 SessionManager 层（provider-neutral），Claude driver 映射为 SDK `canUseTool`/`onUserDialog`，Codex driver 映射为 app-server server request response。 |
| D-009@v1 | `SessionState`/`SessionManagerDeps` 不再直接持有 `ClaudeSdkDriver` 类型（用 `InteractiveDriver`）；Claude SDK 类型只出现在 Claude driver 内部。 |

## 实现要求

### R1. types.ts：driver registry 化（D-001/D-009）

1. `SessionState` 增加字段（不删既有字段，向后兼容）：
   ```ts
   /** D-001@v1：本 session 归属的 provider driver（create/restore 时由 _getDriver 解析后写入）。 */
   driver?: import('./driver.js').InteractiveDriver;
   /** D-001@v1：driver 句柄（Codex 用 InteractiveDriverHandle；Claude 仍用 state.query）。 */
   driverHandle?: import('./driver.js').InteractiveDriverHandle;
   /** D-002/D-006：provider-neutral executable path（codex=codex path / claude=claude exe）。create 时与 pathToClaudeCodeExecutable 二选一填充。 */
   pathToAgentExecutable?: string;
   ```
   - 保留现有 `query?: Query`、`provider`、`pathToClaudeCodeExecutable` 字段不动（Claude 路径继续用 query；旧持久化记录继续读 pathToClaudeCodeExecutable）。

2. `SessionManagerDeps` 改造（兼容旧调用方）：
   ```ts
   export interface SessionManagerDeps {
     /** D-001@v1：provider → driver registry。新入口。 */
     drivers?: Partial<Record<'claude' | 'codex', InteractiveDriver>>;
     /**
      * 兼容旧入口（task-04 既有 cli.ts/tests 用）：传单 driver 时构造函数映射到 drivers.claude。
      * 优先级：drivers.claude > driver。两者都缺则 claude 路径抛 UnsupportedProviderError。
      */
     driver?: ClaudeSdkDriver;
     /**
      * D-008@v1：onTurnResult 参数类型放宽。Claude driver 传 SDKResultMessage；
      * Codex driver 传 InteractiveDriverResult。SessionManager 不读 provider 专属字段，
      * 透传给 daemon.onTurnResult（daemon 按 provider 解释）。
      */
     onTurnResult: (
       sessionId: string, runId: string,
       result: SDKResultMessage | InteractiveDriverResult,
     ) => void | Promise<void>;
     onTurnMessage: (
       sessionId: string, runId: string,
       msg: SDKMessage | InteractiveDriverMessage,
     ) => void | Promise<void>;
     onSessionEnd: (sessionId: string, status: SessionStatus) => void | Promise<void>;
     persistence?: SessionStorePersistence;
   }
   ```
   - `InteractiveDriver` / `InteractiveDriverMessage` / `InteractiveDriverResult` / `InteractiveDriverHandle` / `UserTurnInput` 由 **task-01** 在 `sillyhub-daemon/src/interactive/driver.ts` 提供（task-02 仅 import + 使用契约，不定义）。
   - import 用 `import type` 避免运行时耦合。

3. `CreateSessionInput` 增加可选 `pathToAgentExecutable?: string`（与现有 `pathToClaudeCodeExecutable` 并存；create 时优先用 `pathToAgentExecutable`，缺省回退 `pathToClaudeCodeExecutable`）。

4. **import `driver.js` 必须容忍 task-01 未合入的情况**：task-02 实现阶段时 task-01 应已完成（depends_on=task-01）。若 execute 阶段发现 `driver.ts` 不存在，停止并报错——不自行创建（属 task-01 范围）。

### R2. session-manager.ts：构造函数兼容 driver + drivers

构造函数内新增（不删既有 `_manualApproval` 等字段初始化）：
```ts
// D-001@v1：构造 drivers registry，兼容旧单 driver 入参。
private readonly _drivers: Partial<Record<'claude' | 'codex', InteractiveDriver>>;
constructor(deps, opts) {
  // ...既有初始化不变...
  this._drivers = deps.drivers ?? {};
  // 兼容：旧调用方传 deps.driver（ClaudeSdkDriver）→ 映射到 _drivers.claude。
  if (deps.driver && !this._drivers.claude) {
    this._drivers.claude = deps.driver as unknown as InteractiveDriver;
  }
}
```
- 既有 cli.ts（`new SessionManager({ driver, ... })`）零改动即可继续工作（D-009 向后兼容）。
- task-06 后续把 cli.ts 改为传 `drivers: { claude, codex }`，本任务不需要。

### R3. `_getDriver(provider)` 路由（D-001 核心）

新增私有方法：
```ts
/**
 * D-001@v1：按 provider 取已注册 driver。未注册 → 抛 UnsupportedProviderError。
 * ClaudeSdkDriver 实例（兼容入口）经构造函数已映射到 _drivers.claude。
 */
private _getDriver(provider: 'claude' | 'codex'): InteractiveDriver {
  const driver = this._drivers[provider];
  if (!driver) {
    throw new UnsupportedProviderError(provider);
  }
  return driver;
}
```
- `UnsupportedProviderError` 文案保留现有 `only 'claude' supported in Wave1/2` 模板（task-02 不改文案；codex 未注册时仍抛此错，符合「driver 未注册即不支持」语义）。

### R4. `create()` provider 化（FR-01/FR-02/D-001）

改动点（保留现有 SessionAlreadyExistsError / state 写入 / resolver 注入 / fire consume 逻辑）：
```ts
async create(input: CreateSessionInput): Promise<void> {
  // 删除：if (input.provider !== 'claude') throw new UnsupportedProviderError(...)
  // 改为：
  const driver = this._getDriver(input.provider); // 未注册 → 抛 UnsupportedProviderError
  if (this._store.has(input.sessionId)) throw new SessionAlreadyExistsError(input.sessionId);

  // InputQueue（task-01 已改为 AsyncIterable<UserTurnInput>）：
  const inputQueue = new InputQueue();
  inputQueue.push({ type: 'user', text: input.firstPrompt }); // D-009：不再构造 SDKUserMessage

  const exePath = input.pathToAgentExecutable ?? input.pathToClaudeCodeExecutable;
  const state: SessionState = {
    ...既有字段...,
    provider: input.provider,
    driver,                         // D-001：写入归属 driver
    pathToAgentExecutable: exePath, // D-002
    pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable, // 保留（Claude resume 用）
    manualApproval: enableApproval,
    askUserOnly: effectiveAskUserOnly,
  };
  this._store.set(input.sessionId, state);

  try {
    const driverOpts = this._buildDriverOptions(state, input); // 见 R7（抽 provider-neutral + Claude 分支）
    // Claude 分支：driver.start 返回 Query → state.query
    // Codex 分支：driver.start 返回 InteractiveDriverHandle → state.driverHandle
    const handleOrQuery = driver.start(inputQueue, driverOpts);
    if (input.provider === 'claude') {
      state.query = handleOrQuery as Query;
    } else {
      state.driverHandle = handleOrQuery as InteractiveDriverHandle;
    }
    void this._runConsume(state); // 内部按 provider 选 consume 入参（见 R6）
    this._scheduleFlush();
  } catch (e) {
    // 既有 catch 逻辑（delete store + abortAll resolver + rethrow）保留。
  }
}
```
- **Claude 行为不变**：driverOpts 里 `canUseTool`/`onUserDialog`/`supportedDialogKinds` 注入逻辑完全保留（R7 抽 helper 后内部调用）。
- `inputQueue.push({type:'user',text})` 是 D-009 的关键改动——SessionManager 不再构造 Claude `SDKUserMessage`，转换由 ClaudeSdkDriver 内部完成（task-03）。

### R5. `restoreAndReconnect()` provider 化（FR-06/D-001/D-007）

改动点：
```ts
async restoreAndReconnect(record: PersistedSessionRecord): Promise<void> {
  // 删除：if (record.provider !== 'claude') throw new UnsupportedProviderError(...)
  // 改为（D-007：Codex 缺 thread id 不伪造恢复）：
  if (!record.agentSessionId) {
    throw new Error(`restoreAndReconnect: missing agentSessionId (thread id) for session ${record.sessionId}`);
  }
  const driver = this._getDriver(record.provider); // 未注册 → 抛 UnsupportedProviderError
  if (this._store.has(record.sessionId)) throw new SessionAlreadyExistsError(record.sessionId);

  const inputQueue = new InputQueue();
  const state: SessionState = {
    ...既有字段...,
    provider: record.provider,
    driver,
    pathToAgentExecutable: record.pathToAgentExecutable ?? record.pathToClaudeCodeExecutable ?? '',
    claimToken: '', // 既有占位逻辑保留（gap-2）
    status: 'reconnecting',
  };
  this._store.set(state.sessionId, state);

  try {
    const exe = record.pathToAgentExecutable ?? record.pathToClaudeCodeExecutable ?? '';
    const driverOpts = this._buildDriverOptions(state, {
      cwd: record.cwd, resume: record.agentSessionId, exePath: exe, model: record.model,
    } /* restore 模式 */);
    const handleOrQuery = driver.start(inputQueue, driverOpts);
    if (record.provider === 'claude') state.query = handleOrQuery as Query;
    else state.driverHandle = handleOrQuery as InteractiveDriverHandle;
    void this._runConsume(state);
  } catch {
    // 既有 catch（delete store + abortAll + onSessionEnd(failed)）保留。
  }
}
```
- **Codex thread id 校验**（D-007）：`record.agentSessionId` 是 Codex thread id；空则抛错，不伪造新 thread。Claude 路径既有 `record.agentSessionId` 非空校验由 persistence validateRecord 保证，这里统一加显式守卫。
- 恢复路径的 `canUseTool`/`onUserDialog` 注入（既有 generic-wibbling-whisper 改造点 C/D 逻辑）继续走 `_buildDriverOptions`（R7）。

### R6. `interrupt()` / `_onIdleExpire()` / `_runConsume()` 用 state.driver

1. `interrupt(sessionId)`：
   ```ts
   async interrupt(sessionId: string): Promise<boolean> {
     const state = this._store.get(sessionId);
     if (!state || state.status !== 'running') return false;
     // D-001：按 session 归属 driver interrupt，不用全局 deps.driver。
     const driver = state.driver ?? this._drivers.claude; // 兼容旧 state（无 driver 字段）
     if (!driver) return false;
     // Claude 传 state.query；Codex 传 state.driverHandle（task-04 定义 interrupt 签名接收 handle|null）
     const target = state.provider === 'claude' ? (state.query ?? null) : (state.driverHandle ?? null);
     const interrupted = await driver.interrupt(target);
     // ...既有 lastActiveAt / abortAll / scheduleFlush 逻辑保留...
     return interrupted;
   }
   ```
   - **关键兼容**：`state.driver` 是新字段，旧内存 state（task-02 前创建的）无此字段 → fallback `this._drivers.claude`，保证 Claude session 不因字段缺失而 interrupt 失效（FR-10 不回退）。

2. `_onIdleExpire(state)`：把 `this.deps.driver.interrupt(state.query)` 改为同 interrupt 的 provider 路由（复用一段私有 `_interruptInternal(state)` 避免重复）。

3. `_runConsume(state)`：
   ```ts
   const driver = state.driver ?? this._drivers.claude;
   // Claude：driver.consume(query, cb)；Codex：driver.consume(handle, cb)（task-04 契约）
   const target = state.provider === 'claude' ? state.query : state.driverHandle;
   await driver.consume(target, { onResult, onMessage, onError });
   ```
   - `onMessage`/`onResult` 回调签名不变（已通过 types.ts 放宽类型）。`_onMessage` 内 Claude partial buffer 节流逻辑（ql-20260621-partial）保留——Codex flat message 不触发 stream_event 分支，自然走末尾 `onTurnMessage` 转发。

### R7. provider-neutral permission/dialog helper（D-006/D-008 核心）

抽出两个 helper（供 Claude canUseTool/onUserDialog 与 Codex driver 共用）：
```ts
/**
 * D-008@v1：provider-neutral 普通审批。Claude canUseTool 与 Codex server request 共用。
 *
 * 策略（D-006）：
 *   - state 非 running / 无 currentRunId → fail-closed deny
 *   - askUserOnly=true 且非用户输入类 → allow-through（不弹卡，记 metadata）
 *   - 否则 → resolver.register → await decision（fail-closed）
 * 返回 CanUseToolDecision（Claude 直接用）；Codex driver 据此映射 accept/decline。
 */
private async _requestPermission(input: {
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  signal?: AbortSignal;
  toolUseId?: string;
  isUserInputKind?: boolean; // Codex request_user_input / Claude AskUserQuestion 标记
}): Promise<CanUseToolDecision> {
  // ...抽取现有 _buildCanUseToolCallback 的核心逻辑...
}

/**
 * D-008@v1：provider-neutral 用户对话请求。Claude onUserDialog 与 Codex requestUserInput/MCP elicitation 共用。
 * 返回 { behavior:'completed', result } | { behavior:'cancelled' }。
 */
private async _requestUserDialog(input: {
  sessionId: string;
  dialogKind: string;
  dialogPayload: Record<string, unknown>;
  toolUseId?: string;
  signal?: AbortSignal;
}): Promise<{ behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }> {
  // ...抽取现有 _buildOnUserDialogCallback 的核心逻辑...
}
```
- **`_buildCanUseToolCallback`/`_buildOnUserDialogCallback` 改为 thin wrapper**：内部调 `_requestPermission`/`_requestUserDialog`，外层签名（SDK CanUseTool/OnUserDialog）不变。Claude 现有测试断言行为不变（FR-10）。
- **AskUserQuestion 拦截保留**：现有「AskUserQuestion 走 canUseTool 拦截 → register → 答案经 deny.message 回喂」逻辑不变，只是在 helper 内复用 `_requestPermission({ isUserInputKind:true })` 路径。
- **Codex driver 消费方式**（task-04/05 实现）：Codex driver 收到 server request 时调 `sessionManager` 暴露的 public 方法。task-02 在 SessionManager 上新增 public 入口：
  ```ts
  /** D-008@v1：Codex driver 收到 server request 时调用（provider-neutral hook 公开入口）。 */
  async requestPermission(sessionId: string, input: {...}): Promise<CanUseToolDecision> {
    return this._requestPermission({ sessionId, ...input });
  }
  async requestUserDialog(sessionId: string, input: {...}): Promise<{...}> {
    return this._requestUserDialog({ sessionId, ...input });
  }
  ```
  这两个 public 方法是 task-04/05 Codex driver 的调用契约，task-02 必须定义签名（task-04 据此实现 driver 内部 server request 处理）。

### R8. session-store-persistence.ts：executable path 语义升级（D-007）

1. `PersistedSessionRecord` 增加可选字段（types.ts 已在 R1 提及，这里 persistence 侧补读写）：
   ```ts
   /** D-002：provider-neutral executable path（codex path 恢复用）。与 pathToClaudeCodeExecutable 并存。 */
   pathToAgentExecutable?: string;
   ```
2. `validateRecord(raw)`：在现有 `pathToClaudeCodeExecutable` 校验后增加 `pathToAgentExecutable` 可选字符串校验（同模式：`typeof === 'string' && 非空` 才写入 out）。
3. 注释更新：把「pathToClaudeCodeExecutable」字段注释从「Claude exe」升级为「provider executable path（Claude 优先用此字段；Codex 用 pathToAgentExecutable）」。**不删旧字段**（向后兼容已落盘的 sessions.json）。
4. `snapshotPersistable()`（session-manager.ts 内）：codex session 落盘时写 `pathToAgentExecutable`，claude session 继续写 `pathToClaudeCodeExecutable`（两者都可能在，按 provider 决定主字段）。

### R9. 不改动的 Claude 行为清单（FR-10 不回退，逐项核对）

| 现有行为 | 位置 | task-02 处理 |
| --- | --- | --- |
| Claude `canUseTool` AskUserQuestion 拦截 + deny.message 回喂 | `_buildCanUseToolCallback` L485-542 | 抽进 `_requestPermission`，行为不变 |
| Claude `askUserOnly=true` 其他工具 allow-through | `_buildCanUseToolCallback` L547-551 | 抽进 `_requestPermission`，行为不变 |
| Claude `onUserDialog` cancelled/completed 语义 | `_buildOnUserDialogCallback` L623-684 | 抽进 `_requestUserDialog`，行为不变 |
| partial buffer 节流（stream_event/thinking_tokens） | `_onMessage`/`_bufferPartial` | 不动（Codex 不触发 stream_event） |
| turn result 边界 status→active + currentRunId 清空 | `_onResult` L1242-1284 | 不动 |
| interrupt 后 abortAll pending resolver | `interrupt` L825 | 不动（改 driver 路由但不改 abortAll） |
| end/fail abortAll + destroyPartialBuffer | `end`/`fail` L954/975 | 不动 |
| restoreAndReconnect Claude resume（resume: agentSessionId） | L1110 | 不动（codex 分支 task-04 填 resume 语义） |
| create 失败 delete store + abortAll resolver | L413-420 | 不动 |
| idle scan / `_onIdleExpire` / `scanOnce` | L855-941 | 仅 interrupt 调用改 provider 路由，其余不动 |

## 接口定义

### `_getDriver(provider)` 签名

```ts
private _getDriver(provider: 'claude' | 'codex'): InteractiveDriver;
// 未注册 → throw UnsupportedProviderError(provider)
```

### provider-neutral hook public 入口（task-04/05 Codex driver 调用契约）

```ts
// 普通审批（command/file/permission request）
async requestPermission(
  sessionId: string,
  input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    signal?: AbortSignal;
    toolUseId?: string;
    isUserInputKind?: boolean;
  },
): Promise<CanUseToolDecision>;
// CanUseToolDecision = { behavior:'allow'; dialogResult?: unknown } | { behavior:'deny'; message?: string }

// 用户对话（requestUserInput / MCP elicitation）
async requestUserDialog(
  sessionId: string,
  input: {
    dialogKind: string;
    dialogPayload: Record<string, unknown>;
    toolUseId?: string;
    signal?: AbortSignal;
  },
): Promise<{ behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }>;
```

### create/restore/interrupt 改动伪代码（见 R4/R5/R6）

- `create`：`const driver = this._getDriver(input.provider)` → push `{type:'user',text}` → `driver.start(queue, opts)` → 按 provider 写 `state.query`/`state.driverHandle`。
- `restoreAndReconnect`：校验 `record.agentSessionId` 非空 → `this._getDriver(record.provider)` → `driver.start(queue, {resume})`。
- `interrupt`：`const driver = state.driver ?? this._drivers.claude` → `driver.interrupt(state.provider==='claude' ? state.query : state.driverHandle)`。

### Claude canUseTool/onUserDialog 与 helper 的映射

| Claude SDK 回调 | 调用 helper | 返回值映射 |
| --- | --- | --- |
| `canUseTool(toolName, toolInput, {signal})` 普通工具 | `_requestPermission({toolName, toolInput, signal, isUserInputKind:false})` | decision 直接返回（allow 带 updatedInput） |
| `canUseTool` 且 `toolName==='AskUserQuestion'` | `_requestPermission({..., isUserInputKind:true, dialogKind:'AskUserQuestion', dialogPayload:toolInput})` | allow → `{behavior:'deny', message:'User answered: ...'}`（现有回喂语义） |
| `onUserDialog({dialogKind, payload, toolUseID}, {signal})` | `_requestUserDialog({dialogKind, dialogPayload:payload, toolUseId, signal})` | completed → `{behavior:'completed', result}`；cancelled → `{behavior:'cancelled'}` |

## 边界处理

1. **无 driver 抛 UnsupportedProviderError（D-001）**：`_getDriver('codex')` 但 `this._drivers.codex` 未注册（如 task-06 未完成、仅注入 claude driver）→ `create({provider:'codex'})` 抛 `UnsupportedProviderError('codex')`，与现有 Wave1/2 行为一致。不静默降级到 claude。
2. **Claude 行为不回退（FR-10/D-006/D-008）**：所有 Claude 既有测试（`tests/interactive/session-manager-*.test.ts` 既有用例）必须零改动通过。抽 helper 后若任一 Claude 测试红，优先修 helper 而非改测试。`state.driver` 字段缺失时 fallback `this._drivers.claude`，保证旧内存 state 不 break。
3. **driver 路由错（D-001）**：`interrupt`/`_runConsume` 必须用 `state.driver`（或 `state.provider` 反查），**禁止**继续用 `this.deps.driver`（单 driver）。若误用全局 driver，codex session 会调到 ClaudeSdkDriver.interrupt(query=null) → 返回 false，interrupt 静默失效。测试用例显式断言「codex session interrupt 调用 codex driver.interrupt，不调用 claude driver」。
4. **interrupt 无 session / 非 running**：`state` 不存在或 `status !== 'running'` → 返回 false（既有行为，不改）。无 `state.driver` 且 fallback 也无 claude driver → 返回 false（不抛）。
5. **recovery 缺 thread id（D-007）**：`restoreAndReconnect({provider:'codex', agentSessionId:''})` → 抛 `Error: missing agentSessionId`，不伪造新 thread、不写 store、不调 driver.start。daemon `_routeSessionResume` 已在进入前校验（daemon.ts:1672），这里是第二道守卫。
6. **兼容旧 `deps.driver` 入参（D-009 向后兼容）**：cli.ts 既有 `new SessionManager({ driver: new ClaudeSdkDriver(), ... })` 必须零改动继续工作。构造函数把 `deps.driver` 映射到 `_drivers.claude`。若同时传 `deps.driver` 和 `deps.drivers.claude`，`deps.drivers.claude` 优先（显式 registry 胜过兼容入口）。
7. **Codex driver 缺失但 state 已写 store**：`create({provider:'codex'})` 在 `_getDriver` 抛错发生在写 store **之前**（R4 伪代码顺序：先 `_getDriver` 再 `_store.set`），故不会留下孤儿 state。若 `driver.start` 抛错（codex executable 缺失等），走既有 catch（delete store + abortAll + rethrow）。
8. **onTurnMessage/onTurnResult 类型放宽不破坏 Claude**：types.ts 把参数类型从 `SDKMessage` 改为 `SDKResultMessage | InteractiveDriverResult`（联合类型）。Claude driver 传 SDK 类型是联合的子集，daemon.onTurnResult 现有 `result as SDKResultMessage` 断言仍成立。Codex flat message 由 daemon 按 provider 解释（task-06）。

## 非目标

- **不写 CodexAppServerDriver 内部实现**（spawn app-server、JSON-RPC 解析、turn/start、turn/interrupt、flat message 映射）——属 task-04/05。task-02 只定义 driver 要消费的 hook 签名（`requestPermission`/`requestUserDialog`）和 `InteractiveDriver` 契约（task-01 提供）。
- **不改 daemon.ts**（`_startInteractiveSession` 按 provider 取 executable、`_routeSessionResume` 不写死 claude、onTurnMessage 按 provider 解释 flat message）——属 task-06。
- **不改 cli.ts**（构造 `drivers: { claude, codex }` 并注册 CodexAppServerDriver）——属 task-06。
- **不改 backend**（`SessionService.reopen_session` 放开 codex）——属 task-07。
- **不改 frontend**——属 task-08/09。
- **不定义 `InteractiveDriver`/`UserTurnInput`/`InteractiveDriverResult` 等类型本身**——属 task-01（driver.ts）。task-02 只 import 使用。
- **不改 `UnsupportedProviderError` 文案**——保持现有模板，避免破坏既有测试断言。
- **不删除 `pathToClaudeCodeExecutable` 字段**——向后兼容已落盘 sessions.json + Claude resume 路径。

## 参考

- `design.md` §4.1（文件变更清单 line 99-106）、§5.1（driver 契约）、§5.2（SessionManager provider 化）、§5.5（一致性矩阵）、§6（生命周期契约表 + 事件×状态矩阵 line 356-369）
- `decisions.md` D-001@v1（provider driver registry）、D-006@v1（permission/dialog 策略）、D-007@v1（reopen 要求 thread id）、D-008@v1（hook 放 SessionManager 层）、D-009@v1（输入队列 provider-neutral）
- `requirements.md` FR-01/02/03/06/08/09/10
- `plan.md` task-02 行（Wave2，depends_on=task-01，blocks=task-04/05/07）
- 现有代码：
  - `sillyhub-daemon/src/interactive/session-manager.ts` L311-423（create）、L449-595（_buildCanUseToolCallback）、L623-684（_buildOnUserDialogCallback）、L687-721（_runConsume）、L811-830（interrupt）、L947-986（end/fail）、L1065-1165（restoreAndReconnect）、L1242-1361（_onResult/_onMessage）
  - `sillyhub-daemon/src/interactive/types.ts` L27-154（SessionState/SessionManagerDeps/CreateSessionInput）
  - `sillyhub-daemon/src/interactive/permission-resolver.ts`（register/resolve/abortAll 契约）
  - `sillyhub-daemon/src/interactive/session-store-persistence.ts` L81-130（validateRecord）
  - `sillyhub-daemon/src/cli.ts` L408-441（SessionManager 构造，task-02 不改但须保持兼容）
  - `sillyhub-daemon/src/daemon.ts` L1656-1700（_routeSessionResume，task-06 改）、L1800-1990（_startInteractiveSession，task-06 改）
- task-01 产出（依赖）：`sillyhub-daemon/src/interactive/driver.ts` 提供 `InteractiveDriver`/`UserTurnInput`/`InteractiveDriverMessage`/`InteractiveDriverResult`/`InteractiveDriverHandle`/`InteractiveDriverStartOptions`/`InteractiveDriverCallbacks`

## TDD 步骤

### 步骤 1：先写测试（types + registry）

新建 `tests/interactive/session-manager-driver-registry.test.ts`：
- 用例 1.1：`new SessionManager({ drivers: { claude: fakeClaudeDriver } })` 构造不抛；`create({provider:'claude'})` 调 fakeClaudeDriver.start。
- 用例 1.2：兼容旧入参 `new SessionManager({ driver: fakeClaudeDriver })` → create claude session 成功（D-009 向后兼容）。
- 用例 1.3：`new SessionManager({ drivers: { codex: fakeCodexDriver } })` + `create({provider:'codex'})` 调 fakeCodexDriver.start，不抛 UnsupportedProviderError（FR-01）。
- 用例 1.4：`new SessionManager({ drivers: { claude: fakeClaudeDriver } })` + `create({provider:'codex'})` → 抛 UnsupportedProviderError（driver 未注册，D-001）。
- 用例 1.5：同时传 `deps.driver` 和 `deps.drivers.claude` → drivers.claude 优先（边界 6）。

新建 `tests/interactive/session-manager-provider-routing.test.ts`：
- 用例 2.1：codex session 的 `interrupt()` 调 `fakeCodexDriver.interrupt(handle)`，**不**调 `fakeClaudeDriver.interrupt`（用 spy 断言调用次数，边界 3）。
- 用例 2.2：`restoreAndReconnect({provider:'codex', agentSessionId:'thread-1'})` 调 fakeCodexDriver.start（FR-06）。
- 用例 2.3：`restoreAndReconnect({provider:'codex', agentSessionId:''})` 抛错且不调 driver.start（边界 5，D-007）。
- 用例 2.4：codex session 的 `_runConsume` 调 fakeCodexDriver.consume(handle)（通过注入 fake driver + 触发 create 后断言 consume 被调）。
- 用例 2.5（FR-10 回归）：既有 Claude 测试套件全绿（`pnpm --dir sillyhub-daemon test` 无新增失败）。

### 步骤 2：写实现

按 R1-R8 顺序改 types.ts → session-manager.ts（构造函数 → `_getDriver` → create → restoreAndReconnect → interrupt/_onIdleExpire/_runConsume → 抽 helper → public requestPermission/requestUserDialog）→ session-store-persistence.ts。

### 步骤 3：跑测试 + 类型检查

```bash
pnpm --dir sillyhub-daemon typecheck
pnpm --dir sillyhub-daemon test interactive/session-manager
```
- 新增 2 个测试文件全绿。
- 既有 `tests/interactive/**` 全绿（FR-10 不回退）。

## 验收标准

| AC | 标准 | 验证方式 |
| --- | --- | --- |
| AC-02.1 | `SessionManager` 支持 `deps.drivers: { claude?, codex? }` registry 构造 | session-manager-driver-registry.test 用例 1.1/1.3 通过 |
| AC-02.2 | `deps.driver`（旧单 driver 入参）仍可工作，映射到 `drivers.claude` | 用例 1.2 通过；cli.ts 零改动 |
| AC-02.3 | `create({provider:'codex'})` 在 codex driver 已注册时不抛 UnsupportedProviderError，调用 codex driver.start | 用例 1.3 通过 |
| AC-02.4 | `create({provider:'codex'})` 在 codex driver 未注册时抛 UnsupportedProviderError | 用例 1.4 通过 |
| AC-02.5 | `interrupt(sessionId)` 按 `state.driver`/`state.provider` 路由，codex session 不调 claude driver | 用例 2.1 通过（spy 断言） |
| AC-02.6 | `restoreAndReconnect({provider:'codex', agentSessionId})` 调 codex driver，不抛 UnsupportedProviderError | 用例 2.2 通过 |
| AC-02.7 | `restoreAndReconnect` 缺 agentSessionId（thread id）时抛错，不伪造恢复、不调 driver.start | 用例 2.3 通过（D-007） |
| AC-02.8 | `_runConsume` 按 provider 调对应 driver.consume | 用例 2.4 通过 |
| AC-02.9 | SessionManager 暴露 public `requestPermission`/`requestUserDialog`（D-008，task-04/05 契约） | 类型检查通过 + 签名与本蓝图「接口定义」一致 |
| AC-02.10 | Claude 既有 interactive 测试全部通过（FR-10 不回退） | `pnpm --dir sillyhub-daemon test interactive` 无新增失败 |
| AC-02.11 | `SessionState` 含 `driver`/`driverHandle`/`pathToAgentExecutable` 字段；`SessionManagerDeps.onTurnResult/onTurnMessage` 类型放宽为 provider-neutral 联合类型 | typecheck 通过 |
| AC-02.12 | `PersistedSessionRecord` 含可选 `pathToAgentExecutable`，validateRecord 正确读写；旧 `pathToClaudeCodeExecutable` 字段保留 | persistence 相关既有测试通过 + 新增 codex path 字段测试（若有） |
| AC-02.13 | `_buildCanUseToolCallback`/`_buildOnUserDialogCallback` 行为不变（Claude AskUserQuestion 拦截、askUserOnly allow-through、deny message 模板） | 既有 `tests/interactive/session-manager-permission*.test.ts` 全绿 |
| AC-02.14 | SessionManager 主体不再 `import` Claude SDK 的 `SDKUserMessage` 用于构造输入（D-009）；Claude SDK 类型只在 helper/driver 边界出现 | `grep -n "SDKUserMessage" sillyhub-daemon/src/interactive/session-manager.ts` 无构造点（type import 允许） |
| AC-02.15 | 不修改 daemon.ts / cli.ts / backend / frontend / driver.ts（task-01）/ codex driver（task-04） | `git diff --stat` 仅命中 allowed_paths 内文件 |
