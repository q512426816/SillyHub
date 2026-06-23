---
author: qinyi
created_at: 2026-06-24 00:13:45
id: task-03
title: ClaudeSdkDriver 兼容 provider-neutral 输入并保留现有 Claude Code 行为
priority: P0
estimated_hours: 6
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-02, FR-08, FR-09, FR-10]
decision_ids: [D-001@v1, D-006@v1, D-008@v1, D-009@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
---

# task-03: ClaudeSdkDriver 兼容 provider-neutral 输入并保留现有 Claude Code 行为

## 修改文件

| 文件 | 改动类型 | 说明 |
| --- | --- | --- |
| `sillyhub-daemon/src/interactive/claude-sdk-driver.ts` | 修改 | `ClaudeSdkDriver` 实现 task-01 定义的 `InteractiveDriver` 接口；`start` 入参从 `AsyncIterable<SDKUserMessage>` 改为 provider-neutral `AsyncIterable<UserTurnInput>`，driver 内部包一层 `UserTurnInput → SDKUserMessage` 的 AsyncIterable 转换；`consume`/`interrupt` 契约不变；保留 `canUseTool`/`onUserDialog`/`supportedDialogKinds`/`AskUserQuestion` 全部现有审批与对话行为（D-006@v1 / D-008@v1）。保留 `resolveClaudeExecutable` 与 `ClaudeExecutableNotFoundError`（D-009@v1）。 |
| `sillyhub-daemon/src/interactive/session-manager.ts` | 修改 | Claude 调用点改走 `deps.drivers.claude`（task-02 引入），但保留兼容入口 `deps.driver`（映射到 `drivers.claude`）；Claude 现有交互行为、审批、AskUserQuestion 路由、partial flush、idle scan 全部不变。Claude driver `start/consume/interrupt` 调用签名适配 provider-neutral `UserTurnInput` 与泛化 message/result 回调。 |

> 本蓝图假定 task-01 已在 `sillyhub-daemon/src/interactive/driver.ts` 定义：`InteractiveDriver`、`UserTurnInput`、`InteractiveDriverMessage`、`InteractiveDriverResult`、`InteractiveDriverHandle`、`InteractiveDriverCallbacks`、`InteractiveDriverStartOptions`（见 design §5.1）。task-03 只消费这些类型，不重新定义。

## 覆盖来源

| FR / D | 在本任务的落点 |
| --- | --- |
| FR-02（Codex 同会话多轮 inject；Claude 不回退） | `ClaudeSdkDriver.start` 改 provider-neutral 输入后，Claude 仍能在同一 InputQueue 上 push 多条 `UserTurnInput`、SDK 跨 turn 串行消费（spike H2/S1 行为不变）。 |
| FR-08（Codex 审批与 Claude 一致） | Claude driver 仍接受并透传 `canUseTool`/`onUserDialog`/`supportedDialogKinds`（D-006@v1），SessionManager 对 Claude 的远程人审/AskUserQuestion 注入路径完全不变，作为 Codex 审批 parity 的基线参照。 |
| FR-09（Codex 用户输入/对话归一化） | Claude 的 AskUserQuestion 经 `canUseTool` 拦截 → resolver → dialog 卡路径与 `onUserDialog` 路径保持原样（D-008@v1），为 Codex `request_user_input` 映射提供同构对照。 |
| FR-10（Claude 现有 interactive 不回退） | 本任务第一优先级。所有现有 Claude interactive 测试（`claude-sdk-driver*.test.ts`、`session-manager*.test.ts`、`session-interrupt`、`session-concurrent-inject`、`session-manager-permission`、`session-manager.partial-dedup` 等）必须全通过。 |
| D-001@v1（provider driver 抽象） | `ClaudeSdkDriver implements InteractiveDriver`，`start` 改 provider-neutral 签名。 |
| D-006@v1（provider-neutral permission hook） | Claude driver 仍透传 `canUseTool`；SessionManager 对 Claude 的 `_buildCanUseToolCallback` 不变，作为 Codex 复用 `PermissionResolver` 的基线。 |
| D-008@v1（Codex approval 归一化） | Claude `AskUserQuestion` / `onUserDialog` 对话路径不变，为 Codex `request_user_input` 的 `dialog_kind` 归一化提供同构模板。 |
| D-009@v1（输入队列 provider-neutral） | `ClaudeSdkDriver.start` 入参从 `AsyncIterable<SDKUserMessage>` 改为 `AsyncIterable<UserTurnInput>`，driver 内部转换；SessionManager `create`/`inject` 只 push `{type:'user', text}`。 |

## 实现要求

1. `ClaudeSdkDriver` 声明 `implements InteractiveDriver`（task-01 定义的接口），`provider` 固定为 `'claude'`。
2. `start(input, options)`：
   - 入参 `input: AsyncIterable<UserTurnInput>`（不再是 `AsyncIterable<SDKUserMessage>`）。
   - `options: InteractiveDriverStartOptions`（task-01 定义，含 `pathToClaudeCodeExecutable`、`cwd`、`env`、`canUseTool`、`onUserDialog`、`supportedDialogKinds`、`model`、`allowedTools`、`resume`）。
   - driver 内部用 `mapUserTurnInputToSdk(input)` 构造一个 `AsyncIterable<SDKUserMessage>`（for-await 逐条把 `{type:'user', text}` 转成 `{type:'user', message:{role:'user',content:text}, parent_tool_use_id:null}`），传给 `sdkQuery({ prompt: sdkInput, options })`。
   - 返回 `InteractiveDriverHandle`（`provider:'claude'`，持有底层 SDK `Query` 供 `consume`/`interrupt` 用）。
3. `consume(handle, callbacks)`：for-await 遍历底层 Query；result 走 `callbacks.onResult`（`SDKResultMessage` 当作 `InteractiveDriverResult` 透传），普通 message 走 `callbacks.onMessage`，generator 抛错走 `callbacks.onError`。逻辑与现有实现完全一致，仅签名泛化。
4. `interrupt(handle)`：调底层 `Query.interrupt()`；handle 为 null / 无 interrupt 方法 / 抛错 → 返回 `false`（spike D1 行为不变）。
5. **不新增任何 Codex 行为**：driver 内部不 import `codex`、不 spawn 子进程、不识别 app-server JSON-RPC。
6. 保留 `resolveClaudeExecutable`（wrapper→exe 解析）、`ClaudeExecutableNotFoundError`、`ClaudeSdkDriverOptions`/`StartOptions`/`ConsumeCallbacks`（task-01 若改了命名则 alias 保留以兼容现有测试 import）。
7. `includePartialMessages = true`（ql-20260621-partial）保留，Claude streaming partial 行为不变。
8. SessionManager 改动点（最小化，仅为适配 task-01/task-02 的 provider-neutral 化）：
   - `deps.drivers?.claude` 优先；`deps.driver`（旧单 driver 字段）作为兼容入口，构造函数内 `drivers = drivers ?? (driver ? {claude: driver} : undefined)`。
   - `create()`/`restoreAndReconnect()` 调 Claude driver 的 `start` 时，把现有 driverOpts 构造（含 `canUseTool`/`onUserDialog`/`supportedDialogKinds`/`env`/`model`/`allowedTools`/`resume`）原样透传——**审批注入逻辑、AskUserQuestion 拦截、partial flush、idle scan 一行不改**。
   - `_runConsume` / `interrupt` / `_onIdleExpire` 调 Claude driver 的 `consume`/`interrupt`，回调签名（onResult 拿 `SDKResultMessage`、onMessage 拿 `SDKMessage`）在 SessionManager 侧继续按 SDK 类型消费（task-01 把 `InteractiveDriverMessage/Result` 定义为 `Record<string,unknown>` 兼容超集，Claude 的 SDK 类型是其子集，无需转换）。

## 接口定义

### driver.ts 契约（task-01 已定义，本任务消费）

```ts
// task-01 定义（本蓝图引用，不重复声明）
export interface UserTurnInput { type: 'user'; text: string }
export type InteractiveDriverMessage = Record<string, unknown>
export interface InteractiveDriverResult { subtype?: string; is_error?: boolean; result?: unknown; /* ...usage/cost 字段 */ }
export interface InteractiveDriverHandle { readonly provider: 'claude' | 'codex'; readonly processId?: number; close?(): Promise<void>|void }
export interface InteractiveDriverCallbacks {
  onResult: (r: InteractiveDriverResult) => void | Promise<void>
  onMessage?: (m: InteractiveDriverMessage) => void | Promise<void>
  onError?: (e: unknown) => void | Promise<void>
}
export interface InteractiveDriverStartOptions {
  pathToClaudeCodeExecutable: string
  cwd: string
  env?: Record<string, string>
  canUseTool?: CanUseTool
  onUserDialog?: OnUserDialog
  supportedDialogKinds?: string[]
  model?: string
  allowedTools?: string[]
  resume?: string
}
export interface InteractiveDriver {
  start(input: AsyncIterable<UserTurnInput>, options: InteractiveDriverStartOptions): Promise<InteractiveDriverHandle>
  consume(handle: InteractiveDriverHandle, callbacks: InteractiveDriverCallbacks): Promise<void>
  interrupt(handle: InteractiveDriverHandle | null): Promise<boolean>
}
```

### ClaudeSdkDriver 实现伪代码

```ts
// claude-sdk-driver.ts

import type { InteractiveDriver, InteractiveDriverHandle, InteractiveDriverStartOptions,
  InteractiveDriverCallbacks, InteractiveDriverResult, InteractiveDriverMessage, UserTurnInput } from './driver.js'
import type { Query, SDKUserMessage, SDKResultMessage, SDKMessage, CanUseTool, OnUserDialog } from '@anthropic-ai/claude-agent-sdk'
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'

/** Claude 专属 handle：携带底层 SDK Query 句柄。 */
export interface ClaudeDriverHandle extends InteractiveDriverHandle {
  readonly provider: 'claude'
  readonly query: Query   // 底层 SDK Query（interrupt/consume 用）
}

/**
 * UserTurnInput → SDKUserMessage 的 AsyncIterable 转换（D-009@v1）。
 * 纯转换层，不缓冲、不丢消息：for-await 上游 input，逐条映射后 yield。
 * 上游 close（InputQueue.close）→ 本 generator 自然结束 → SDK query 退出。
 */
async function* mapUserTurnInputToSdk(input: AsyncIterable<UserTurnInput>): AsyncGenerator<SDKUserMessage, void> {
  for await (const turn of input) {
    yield {
      type: 'user',
      message: { role: 'user', content: turn.text },
      parent_tool_use_id: null,
    }
  }
}

export class ClaudeSdkDriver implements InteractiveDriver {
  readonly provider = 'claude' as const

  async start(input: AsyncIterable<UserTurnInput>, opts: InteractiveDriverStartOptions): Promise<ClaudeDriverHandle> {
    // 1. wrapper→exe 解析（D-009@v1，task-01 R-exe，行为不变）
    const realExe = resolveClaudeExecutable(opts.pathToClaudeCodeExecutable)

    // 2. 构造 SDK options（仅写非 undefined 字段，让 SDK 对缺失字段走默认）。
    //    canUseTool / onUserDialog / supportedDialogKinds 透传——审批与 AskUserQuestion
    //    行为由 SessionManager 注入，driver 不决策（D-006@v1 / D-008@v1）。
    const options: Record<string, unknown> = {
      pathToClaudeCodeExecutable: realExe,
      cwd: opts.cwd,
      env: opts.env ?? { ...process.env },
      includePartialMessages: true,   // ql-20260621-partial，行为不变
    }
    if (opts.canUseTool !== undefined) options.canUseTool = opts.canUseTool
    if (opts.onUserDialog !== undefined) options.onUserDialog = opts.onUserDialog
    if (opts.supportedDialogKinds !== undefined) options.supportedDialogKinds = opts.supportedDialogKinds
    if (opts.model !== undefined) options.model = opts.model
    if (opts.allowedTools !== undefined) options.allowedTools = opts.allowedTools
    if (opts.resume !== undefined) options.resume = opts.resume

    // 3. UserTurnInput → SDKUserMessage 后交给 SDK（D-009@v1）
    const sdkInput = mapUserTurnInputToSdk(input)
    const query = sdkQuery({ prompt: sdkInput, options })
    return { provider: 'claude', query }
  }

  async consume(handle: InteractiveDriverHandle, cb: InteractiveDriverCallbacks): Promise<void> {
    const q = (handle as ClaudeDriverHandle).query
    try {
      for await (const msg of q) {
        if (msg !== null && typeof msg === 'object' && (msg as {type?:string}).type === 'result') {
          // SDKResultMessage 是 InteractiveDriverResult 的超集，直接透传
          await cb.onResult(msg as unknown as InteractiveDriverResult)
        } else if (cb.onMessage) {
          // SDKMessage 是 InteractiveDriverMessage (Record<string,unknown>) 的子集
          await cb.onMessage(msg as unknown as InteractiveDriverMessage)
        }
      }
    } catch (err) {
      if (cb.onError) await cb.onError(err)
    }
  }

  async interrupt(handle: InteractiveDriverHandle | null): Promise<boolean> {
    if (!handle) return false
    const q = (handle as ClaudeDriverHandle).query
    if (typeof q.interrupt !== 'function') return false
    try { await q.interrupt(); return true } catch { return false }
  }
}
```

### SessionManager Claude 调用点改动（最小化）

```ts
// session-manager.ts 构造函数内（兼容入口）：
constructor(deps: SessionManagerDeps, opts: SessionManagerOptions = {}) {
  // task-02 引入 deps.drivers；本任务保留 deps.driver 兼容入口。
  // Claude driver 取法：drivers.claude 优先，否则回退旧 deps.driver。
  const claudeDriver = deps.drivers?.claude ?? deps.driver
  // ...其余构造逻辑（idleTimeout / manualApproval / resolver 工厂）完全不变
}

// create() / restoreAndReconnect() 内：
// 原先：const query = this.deps.driver.start(inputQueue, driverOpts)
// 改后：const handle = await claudeDriver.start(inputQueue, driverOpts)
//       state.driverHandle = handle   // task-02 在 SessionState 增加 provider handle 字段
// _runConsume / interrupt / _onIdleExpire 调 claudeDriver.consume(handle, cb) / .interrupt(handle)
//
// ⚠️ driverOpts 构造逻辑（canUseTool/onUserDialog/supportedDialogKinds 注入、env/model/allowedTools/resume
//    透传）一行不改 —— 这是 FR-10 不回退的核心。
```

## 边界处理

1. **UserTurnInput 为空串 `text: ''`**：`mapUserTurnInputToSdk` 仍 yield 一条 `{type:'user', message:{role:'user', content:''}, parent_tool_use_id:null}`（与现有 SessionManager `inject` push 空 prompt 行为一致，不额外校验/拒绝——空 prompt 校验在 backend/daemon 层，driver 层不越权）。
2. **Claude 审批策略不变（D-006@v1 / D-008@v1）**：`canUseTool` 注入与否、AskUserQuestion 拦截、`askUserOnly` allow-through、`onUserDialog` 路由全部由 SessionManager `_buildCanUseToolCallback`/`_buildOnUserDialogCallback` 控制，driver 只透传不决策。task-03 不动这两个回调方法、不动 `manualApproval`/`askUserOnly`/`supportedDialogKinds` 求值逻辑。
3. **interrupt 行为不变（spike D1）**：handle 为 null / query 无 interrupt 方法 / interrupt 抛错 → 返回 `false`，不向上冒泡；session 终态由 `_onResult` 按 SDK 实际 result subtype=error_during_execution 收尾（SessionManager 既有逻辑不动）。
4. **AskUserQuestion 仍走 canUseTool 拦截路径**：Claude SDK headless 模式下 AskUserQuestion 不触发 `onUserDialog`，而是经 `canUseTool` 拦截 → resolver → PERMISSION_REQUEST 带 `dialog_kind:'AskUserQuestion'`。task-03 不改此路由，`onUserDialog` 仅对 SDK 真正发出 `request_user_dialog` 的其他 kind 生效（保留能力，不影响现有行为）。
5. **driver 复用兼容入口**：`deps.driver`（旧单 Claude driver 字段）保留，构造函数内映射到 `drivers.claude`；现有测试 `makeMockDriver()` 注入的鸭子类型 driver（`start/consume/interrupt`）无需改签名即可继续工作——前提是 task-01 已把 mock 的 `start` 第一参类型放宽为 `AsyncIterable<UserTurnInput>`（本任务在验收标准里验证现有测试不破）。
6. **InputQueue 类型变化兼容**：task-01 将 `InputQueue implements AsyncIterable<UserTurnInput>`。Claude driver 的 `mapUserTurnInputToSdk` 接收任意 `AsyncIterable<UserTurnInput>`，对 InputQueue 透明。现有 `InputQueue` 单订阅 / close 后 push 抛错 / FIFO 行为不变。
7. **partial flush（ql-20260621-partial）不回退**：`includePartialMessages=true` 保留；SessionManager 的 `_bufferPartial`/`_flushPartial`/`_emitOverrideSignals` 一行不改，对 Claude streaming delta 的 500ms 节流、thinking override、late partial 守卫全部保留。
8. **恢复路径（restoreAndReconnect）不改**：resume 用 `record.agentSessionId` + `record.cwd`，driverOpts 注入 `canUseTool`/`onUserDialog` 逻辑与 create 对齐；`claimToken` 占位空串等既有兜底不动。

## 非目标

- 不新增 Codex 行为（不 import codex、不 spawn app-server、不识别 JSON-RPC）——留给 task-04/task-05。
- 不改 backend（`reopen_session`、`submit_messages`、permission 通道）——留给 task-07。
- 不改 frontend（runtime-session-dialog、AskUserDialogCard、interactive-session-panel）——留给 task-08/task-09。
- 不改 `daemon.ts` 的 `_startInteractiveSession` provider executable 路由——留给 task-06。
- 不改 `cli.ts` 的 driver 注册（`drivers.claude = new ClaudeSdkDriver()`）——留给 task-06（本任务只保证 `new ClaudeSdkDriver()` 单独构造仍可用，即生产路径不破）。
- 不改 `PermissionResolver` 实现、不改 `JsonSessionPersistence` schema。
- 不为历史 sessions.json 做迁移（项目未上线，D-003 内存态 + 现有 schema 足够）。

## 参考（现有 claude-sdk-driver 实现）

- `sillyhub-daemon/src/interactive/claude-sdk-driver.ts`（全文已读）：`resolveClaudeExecutable`（wrapper→exe，D-009）、`ClaudeSdkDriverOptions`/`StartOptions`/`ConsumeCallbacks`、`start` 构造 options 仅写非 undefined 字段、`includePartialMessages=true`、`consume` 用 `type==='result'` 区分 result/message、`interrupt` null/无方法/抛错 → false。
- `sillyhub-daemon/src/interactive/session-manager.ts`（全文已读）：`create()` driverOpts 构造（lines 354-403）、`_buildCanUseToolCallback`（lines 449-595，AskUserQuestion 拦截 + askUserOnly allow-through + 远程人审）、`_buildOnUserDialogCallback`（lines 623-684）、`_runConsume`/`interrupt`/`_onIdleExpire` 调 `deps.driver.*`、partial flush（lines 1434-1688）、`restoreAndReconnect`（lines 1065-1165）。
- `sillyhub-daemon/src/interactive/types.ts`：`SessionManagerDeps.driver: ClaudeSdkDriver`（task-02 将加 `drivers?: Partial<Record<'claude'|'codex', InteractiveDriver>>`）。
- `sillyhub-daemon/src/interactive/input-queue.ts`：`InputQueue implements AsyncIterable<SDKUserMessage>`（task-01 将改为 `AsyncIterable<UserTurnInput>`）。
- `sillyhub-daemon/src/cli.ts:408-422`：`new ClaudeSdkDriver()` → `new SessionManager({ driver, ... })`。
- `sillyhub-daemon/tests/interactive/session-manager.test.ts:97-116`：`makeMockDriver()` 鸭子类型 driver（start/consume/interrupt），FR-10 验收基准。
- `sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts`：start/consume/interrupt/wrapper→exe 端到端断言。
- design.md §4.1 文件清单 / §5.1 driver 契约 / §5.2 第 6/7 点（Claude 审批 provider-neutral 化但行为不变）/ §10 风险表「SessionManager 改 driver 抽象影响 Claude → 保留 Claude driver 包装测试，先让现有 Claude 测试通过」。

## TDD 步骤

1. **先看现有测试**（已读）：确认 `claude-sdk-driver.test.ts`、`session-manager.test.ts`、`session-manager-permission.test.ts`、`session-interrupt.test.ts`、`session-concurrent-inject.test.ts`、`session-manager.partial-dedup.test.ts`、`claude-sdk-driver-canuse.test.ts`、`claude-sdk-driver-permission.test.ts`、`session-recovery.test.ts` 的断言点。
2. **调整现有 Claude driver 测试签名**（红）：把 `claude-sdk-driver.test.ts` 中 `driver.start(input, opts)` 的 `input` 从 `AsyncIterable<SDKUserMessage>` 改为 `AsyncIterable<UserTurnInput>`（`{type:'user', text}`），断言 SDK 收到的 prompt 是 `mapUserTurnInputToSdk` 包装后的 AsyncIterable（可断言 for-await 第一条是 `{type:'user', message:{role:'user',content:'hi'}, parent_tool_use_id:null}`）。run → 预期失败（实现还是旧签名）。
3. **实现 provider-neutral start**（绿）：按「接口定义」伪代码改 `ClaudeSdkDriver`，`implements InteractiveDriver`，加 `mapUserTurnInputToSdk`。run → driver 测试通过。
4. **调整 SessionManager 测试 mock driver 签名**（红）：`makeMockDriver()` 的 `start` 第一参改 `AsyncIterable<UserTurnInput>`，返回从 `Query` 改为 `InteractiveDriverHandle`（或 `ClaudeDriverHandle` 带 query）；`consume` 第一参从 `Query` 改 handle；`interrupt` 第一参从 `Query|null` 改 `InteractiveDriverHandle|null`。run → 预期失败（SessionManager 还调 `deps.driver.start` 返回 Query 直接存 `state.query`）。
5. **SessionManager 适配 handle**（绿）：`SessionState` 增加 `driverHandle?: InteractiveDriverHandle`（task-02 范围，本任务先用 Claude 专属字段过渡）；`create`/`restoreAndReconnect` 调 `claudeDriver.start` 拿 handle 存 state；`_runConsume`/`interrupt`/`_onIdleExpire` 调 `claudeDriver.consume(handle, cb)`/`.interrupt(handle)`。run → 全部 session-manager 测试通过。
6. **回归**：跑 `pnpm --dir sillyhub-daemon test` + `pnpm --dir sillyhub-daemon typecheck`，确认现有 Claude interactive 测试零回退。
7. **审批/对话路径回归**：单独跑 `claude-sdk-driver-canuse.test.ts`、`claude-sdk-driver-permission.test.ts`、`session-manager-permission.test.ts`，确认 canUseTool/onUserDialog/AskUserQuestion 路径行为不变。

## 验收标准

| AC | 标准 | 验证方式 | 覆盖 |
| --- | --- | --- | --- |
| AC-03.1 | `ClaudeSdkDriver implements InteractiveDriver`，`provider==='claude'` | `tsc` 类型检查通过；`new ClaudeSdkDriver() instanceof` 鸭子类型断言 | FR-02, D-001@v1 |
| AC-03.2 | `start` 入参为 `AsyncIterable<UserTurnInput>`，内部转 `SDKUserMessage` 后传 SDK；SDK 收到的 prompt 是转换后的 AsyncIterable | 单测：push `{type:'user',text:'hi'}`，断言 `sdkQuery` 收到 prompt for-await 首条为 `{type:'user',message:{role:'user',content:'hi'},parent_tool_use_id:null}` | FR-02, D-001@v1, D-009@v1 |
| AC-03.3 | `start` 仍透传 `canUseTool`/`onUserDialog`/`supportedDialogKinds`（注入时写进 options，未注入不写） | `claude-sdk-driver-canuse.test.ts` + `claude-sdk-driver-permission.test.ts` 全通过 | FR-08, FR-09, D-006@v1, D-008@v1 |
| AC-03.4 | `resolveClaudeExecutable` wrapper→exe 解析行为不变（.exe 直传 / .cmd 解 wrapper / 空 throw） | `claude-sdk-driver.test.ts` 的 `resolveClaudeExecutable` describe block 全通过 | D-009@v1 |
| AC-03.5 | `consume` 用 `type==='result'` 区分 result/message，result 走 onResult、其余走 onMessage、generator 抛错走 onError | `claude-sdk-driver.test.ts` consume describe block 全通过 | FR-02, FR-10 |
| AC-03.6 | `interrupt(null)`→false；`interrupt(handle)` 调底层 query.interrupt()；底层抛错→false 不冒泡 | `claude-sdk-driver.test.ts` interrupt describe block 全通过 | FR-10 |
| AC-03.7 | SessionManager 保留 `deps.driver` 兼容入口，现有 `makeMockDriver()` 注入的鸭子类型 driver 仍可用 | `session-manager.test.ts` 全通过（零修改或仅 mock 签名跟随 task-01 改） | FR-10, D-001@v1 |
| AC-03.8 | SessionManager `create`/`restoreAndReconnect` 的 driverOpts 构造（canUseTool/onUserDialog/env/model/resume 注入）逻辑不变 | `session-manager-permission.test.ts`、`session-recovery.test.ts` 全通过 | FR-08, FR-09, FR-10, D-006@v1, D-008@v1 |
| AC-03.9 | **现有 Claude interactive 测试全通过**（FR-10 第一优先级） | `pnpm --dir sillyhub-daemon test` 全绿，含 `claude-sdk-driver*`、`session-manager*`、`session-interrupt`、`session-concurrent-inject`、`session-manager.partial-dedup`、`input-queue`、`permission-resolver`、`session-idle-scanner`、`session-manager-pending-cleanup`、`daemon-recovery-boot`、`session-store-persistence` | FR-10, D-001@v1, D-009@v1 |
| AC-03.10 | `pnpm --dir sillyhub-daemon typecheck` 通过（provider-neutral 类型与 SDK 类型兼容，无 `any` 泄漏到公共 API） | tsc 退出码 0 | FR-02, FR-10, D-001@v1 |
| AC-03.11 | partial flush / thinking override / late partial 守卫行为不变 | `session-manager.partial-dedup.test.ts` 全通过 | FR-10 |
| AC-03.12 | Claude driver 不 import codex 相关符号、不 spawn 子进程 | `rg -n "codex\|spawn\|app-server" sillyhub-daemon/src/interactive/claude-sdk-driver.ts` 无命中 | FR-10（非目标边界） |

> AC-03.9 是本任务硬性验收门槛：现有 Claude interactive 测试任何一条红即视为 FR-10 回退，本任务不通过。
