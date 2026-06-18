---
author: qinyi
created_at: 2026-06-18T22:41:08
change: 2026-06-18-daemon-interactive-session
id: task-04
title: "daemon ClaudeSdkDriver + SessionManager + input-queue + lease.kind 分流（SDK 同进程多轮，与 TaskRunner 并存）"
wave: W2
priority: P0
estimated_hours: 24
depends_on: [task-01, task-03]
blocks: [task-07, task-08, task-10]
requirement_ids: [FR-01, FR-02, FR-04, FR-09]
decision_ids: [D-002@v3, D-009@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/input-queue.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/ws-client.ts
  - sillyhub-daemon/package.json
  - sillyhub-daemon/.npmrc
  - sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts
  - sillyhub-daemon/tests/interactive/session-manager.test.ts
  - sillyhub-daemon/tests/interactive/input-queue.test.ts
  - sillyhub-daemon/tests/daemon-kind-dispatch.test.ts
  - sillyhub-daemon/tests/ws-client-session-control.test.ts
---

# task-04：daemon ClaudeSdkDriver + SessionManager + input-queue + lease.kind 分流

> v3 重做。依据 `design.md` §5（方案 A 与 TaskRunner 并存）、§7.1 ClaudeSdkDriver、§7.2 SessionManager、§7.6 turn 时序、`spike-02-architecture-validation.md` §3.7 实测（H1/H2/D1/D4/S1）、`decisions.md` D-002@v3 / D-009@v1。
>
> **v2→v3 关键差异**：v2（task-03 旧版）每 turn 独立 spawn + `--resume`，改 `task-runner.ts`；**v3 不改 task-runner**（batch 零改动），交互式执行完全由新增 `src/interactive/`（ClaudeSdkDriver 封装 `@anthropic-ai/claude-agent-sdk` 同进程 `query(AsyncIterable)` 多轮）独立承担。
>
> SDK API 以 spike §3.7 实测为准：`query({ prompt: AsyncIterable<SDKUserMessage>, options: { pathToClaudeCodeExecutable, cwd, env, canUseTool, ... } })` 返回 `Query`（AsyncGenerator），`q.interrupt()` turn 级（result subtype=`error_during_execution`、query 不结束可续轮），每条 `result` 是干净 turn 边界、无孤儿后台事件。

## 1. 目标与硬约束

1. 新增 daemon `src/interactive/` 模块，与现有 `TaskRunner`（batch）**并存非替换**（design §5 方案 A）。
2. `ClaudeSdkDriver` 封装 `@anthropic-ai/claude-agent-sdk` 的 `query({ prompt: AsyncIterable })`：固定 cwd、继承 `process.env`（含 `ANTHROPIC_AUTH_TOKEN`+`ANTHROPIC_BASE_URL`，spike H1）、`pathToClaudeCodeExecutable` 显式传 agent-detector 检测的系统 claude（D-009），`interrupt()` turn 级（spike D1），遍历 `Query` AsyncGenerator、每条 `result` 触发回调创建/关闭 AgentRun（spike D4）。
3. `SessionManager` 管 session 生命周期（create / inject / interrupt / end），持有内存 `SessionStore`（`Map<session_id, SessionState>`），`SessionState` 持有 SDK `Query` 句柄 + `InputQueue` + 当前 `currentRunId` + SDK 返回的 `agent_session_id`。
4. `InputQueue` 提供 per-session `AsyncIterable<SDKUserMessage>`，turn 级串行（spike S1：未 result 的 push 自然排队到下一 turn）。
5. `daemon.ts:_executeTask` 按 `lease.kind` 分流：`batch` → `TaskRunner`（零改动）；`interactive` → `SessionManager.create`（首 turn）+ 后续 `SESSION_INJECT/INTERRUPT/END` 控制消息路由到 SessionManager。
6. `package.json` 加 `@anthropic-ai/claude-agent-sdk` 主包；`.npmrc` 排 `@anthropic-ai/claude-agent-sdk-win32-x64` 平台二进制（224MB，D-009）。

## 覆盖来源

| 来源 | 要求/决策 | 本任务落实 |
|---|---|---|
| `plan.md` task-04 | Wave 2 P0，depends_on=[task-01, task-03]，blocks=[task-07, task-08, task-10]；覆盖 FR-01, FR-02, FR-04, FR-09 / D-002@v3, D-009@v1 | ClaudeSdkDriver + SessionManager + InputQueue + kind 分流 |
| FR-01 | 首 turn 与追问各自对应独立 AgentRun | driver `consume` 每条 `result` 触发 backend 关闭当前 AgentRun、下一条 `SDKUserMessage` 触发新 turn |
| FR-02 | 同进程多轮（非 per-turn spawn） | SDK `query(AsyncIterable)` 同进程，turn 级串行（spike H2/S1） |
| FR-04 | interrupt 只结束当前 turn，end 才结束 session | driver `interrupt(q)` turn 级（spike D1），SessionManager.end 终止 Query + 通知 backend `end_session` |
| FR-09 | batch lease 行为不变 | `_executeTask` kind 缺省/`batch` 走现有 `runLease → completeLease`，不进 SessionManager |
| D-002@v3 | driver 与 TaskRunner 并存；SDK 同进程多轮 | `src/interactive/` 独立模块，不改 task-runner.ts |
| D-009@v1 | 只用系统 claude.CMD，不带平台二进制 | driver 显式 `pathToClaudeCodeExecutable`；`.npmrc` 排 win32-x64 包 |
| design §7.1 / §7.2 / §7.6 | 接口与时序 | §4 接口搬砖级定义 |

## 2. 真实现状与约束

实现前必须用 `rg` 再次核对以下事实，源码变化则先改本任务文档再写代码：

| 事实 | 当前源码锚点 | 本任务使用方式 |
|---|---|---|
| lease 状态机入口 | `sillyhub-daemon/src/daemon.ts:_executeTask → _runLeaseStateMachine` | 在 `_runLeaseStateMachine` 拿到 `claimResp` 后按 `kind` 分流；batch 完全不动 |
| TaskRunner 接口 | `task-runner.ts:186 class TaskRunner` / `runLease(ctx): Promise<TaskRunnerResult>` | 不修改；batch 路径继续用 |
| AgentDetector 接口 | `agent-detector.ts:DetectAgent[] detectAgents()`，`DetectedAgent.provider/path/status` | `_agentPaths.get('claude')` 提供 `pathToClaudeCodeExecutable` |
| 已注入 provider→path 映射 | `daemon.ts:_agentPaths: Map<string,string>`（注册时填入） | driver 直接复用，不再二次探测 |
| WS 消息分发 | `daemon.ts:_handleWsMessage` switch `MSG.TASK_AVAILABLE/HEARTBEAT_ACK` | 新增 `SESSION_*` case，路由到 SessionManager（task-03 已定常量） |
| `_inflightLeases` 去重 | `daemon.ts:_inflightLeases: Set<string>` | interactive 首次 task_available 后必须独立追踪，不能与 batch 共用 inflight（避免 lease 跨 turn 长期占位） |
| 协议常量 | `protocol.ts:MSG`（task-03 已加 `SESSION_INJECT/INTERRUPT/END`） | 直接消费；本任务不重定义 |
| credentials env | 真实部署 `process.env` 含 `ANTHROPIC_AUTH_TOKEN`+`ANTHROPIC_BASE_URL` | driver `env = { ...process.env }`，不读 `credentials.json`（spike H1 验证 SDK 继承 env） |
| TypeScript daemon | `pnpm`/`vitest`；scan/local.yaml 标 Python 已过时 | 实现按 TS / vitest，测试用 mock SDK |

## 3. 修改文件

| 操作 | 文件 | 责任 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/interactive/input-queue.ts` | per-session `AsyncIterable<SDKUserMessage>`，turn 级串行 |
| 新增 | `sillyhub-daemon/src/interactive/claude-sdk-driver.ts` | 封装 SDK `query`/`interrupt`/`consume`；result→AgentRun 边界回调 |
| 新增 | `sillyhub-daemon/src/interactive/session-manager.ts` | session 生命周期 + 内存 `SessionStore` |
| 新增 | `sillyhub-daemon/src/interactive/types.ts` | `SessionState`/`ClaudeSdkDriverOptions`/`SDKUserMessage` 局部类型（避免循环依赖） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `_runLeaseStateMachine` 按 `lease.kind` 分流；`_handleWsMessage` 路由 `SESSION_*` 到 SessionManager |
| 修改 | `sillyhub-daemon/src/ws-client.ts` | `WsClientCallbacks.onControlMessage` 派发（task-03 已定义；本任务在 daemon 侧接住） |
| 修改 | `sillyhub-daemon/src/types.ts` | `LeasePayload` 增加 `kind?: 'batch' \| 'interactive'`、`agentSessionId?: string`（若 task-03 未加则补） |
| 修改 | `sillyhub-daemon/package.json` | `dependencies` 加 `@anthropic-ai/claude-agent-sdk`（pin `0.3.181`，R-SDK0.x） |
| 新增 | `sillyhub-daemon/.npmrc` | `optional=false` 或等价配置排 `@anthropic-ai/claude-agent-sdk-win32-x64` |
| 新增 | `sillyhub-daemon/tests/interactive/input-queue.test.ts` | AsyncIterable 串行 / close / 重复 yield |
| 新增 | `sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts` | mock SDK query；result 边界、interrupt、consume 语义 |
| 新增 | `sillyhub-daemon/tests/interactive/session-manager.test.ts` | create/inject/interrupt/end/边界 |
| 新增 | `sillyhub-daemon/tests/daemon-kind-dispatch.test.ts` | kind=batch 走 TaskRunner，kind=interactive 走 SessionManager；batch 回归 |
| 新增 | `sillyhub-daemon/tests/ws-client-session-control.test.ts` | SESSION_* 路由到 onControlMessage，session/lease 校验 |

不得修改：`task-runner.ts`、backend、frontend、`protocol.ts`（task-03 负责）、AgentSession model/migration（task-02 负责）、`canUseTool` 远程人审实现（task-08）、磁盘持久化（task-10）。

## 4. 实现要求与精确接口（搬砖级）

### 4.1 InputQueue（`interactive/input-queue.ts`）

per-session `AsyncIterable<SDKUserMessage>`，driver `query({ prompt: queue })` 单次订阅，turn 级串行。

```typescript
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * per-session 用户输入队列。
 *
 * 行为（spike H2/S1）：
 *   - async iterator 在 driver 创建 query 时被 SDK 订阅一次，长生命周期跨多 turn；
 *   - push(msg)：resolve 当前 await 后 yield msg；若 SDK 未消费（同 turn 内 push 第二条），
 *     自然排队到下一 turn（spike S1：不支持运行中注入）；
 *   - close()：使 iterator 结束（query 收到 iterator done 后退出，session 进入 ended 语义）；
 *   - 不缓存：未消费的 push 通过 pending Promise 串行；同一时刻最多一条 pending。
 */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  /** 已 push 但尚未 yield 的消息缓冲（FIFO）。 */
  private readonly _buffer: SDKUserMessage[] = [];
  /** 等待下一条消息的 consumer resolver（最多一个，因 driver 单订阅）。 */
  private _pending: ((msg: SDKUserMessage | null) => void) | null = null;
  private _closed = false;

  /** push 一条用户消息。close 后 push 抛 SessionQueueClosedError。 */
  push(msg: SDKUserMessage): void;

  /** 关闭队列。iterator 在 yield 完已 push 消息后结束。幂等。 */
  close(): void;

  /** AsyncIterable 实现：driver `query({ prompt: queue })` 订阅。 */
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage>;
}

export class SessionQueueClosedError extends Error {
  readonly code = 'SESSION_QUEUE_CLOSED';
}
```

约束：
- 单订阅：`[Symbol.asyncIterator]` 第二次调用抛 `SessionQueueDoubleSubscribeError`（spike 一次 query 一个 iterator）。
- 不丢消息：close 前已 push 的消息必须全部 yield 完才结束 iterator。
- turn 级串行不靠队列层强制：队列只保证按 push 顺序 yield；"同一 turn 不接受第二条" 由 SessionManager 维护（status=running 时 push 仍入 buffer，但 driver 在收下一条 result 前不会 await 下一 yield，spike S1 自然 turn 级）。

### 4.2 ClaudeSdkDriver（`interactive/claude-sdk-driver.ts`）

封装 `@anthropic-ai/claude-agent-sdk` 的 `query`，turn 级 interrupt，result 边界回调。SDK API 严格按 spike §3.7 实测签名。

```typescript
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
  CanUseTool,
} from '@anthropic-ai/claude-agent-sdk';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

export interface ClaudeSdkDriverOptions {
  /**
   * D-009@v1：agent-detector 检测的系统 claude 可执行路径（必需）。
   * spike H1 验证的是 SDK 默认内置 exe；task-01 R-exe 前置补验显式路径。
   * 缺失/空串时 driver 抛 ClaudeExecutableNotFoundError（拒绝启动 interactive session）。
   */
  pathToClaudeCodeExecutable: string;
  /** 固定 cwd（resume 按 cwd 分目录，spike D3）；driver 不接受 cwd 变更。 */
  cwd: string;
  /**
   * canUseTool 回调。本任务（Wave2 地基）默认 undefined=SDK 内置默认策略；
   * task-08 接远程人审（D-007）。spike D2 已验证回调可 await 远程延迟不超时。
   */
  canUseTool?: CanUseTool;
  /** 模型覆盖；缺省走 ANTHROPIC_DEFAULT_*_MODEL 环境映射（spike H1 model=glm-5.2）。 */
  model?: string;
  /** 允许工具白名单；缺省不传（D-008 错误透传，不预禁工具）。 */
  allowedTools?: string[];
  /**
   * env 继承策略。默认 `{ ...process.env }`（spike H1：SDK spawn 的 claude 继承
   * ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL，daemon 不读 credentials.json）。
   */
  env?: Record<string, string>;
}

export interface StartOptions extends ClaudeSdkDriverOptions {
  /** resume 用（task-10）；Wave1/2 不传，首 turn 由 backend 创建新 session。 */
  resume?: string;
}

export interface ConsumeCallbacks {
  /**
   * spike D4：result 是干净 turn 边界。每条 result 触发一次 onResult，
   * SessionManager 据此通知 backend 关闭当前 AgentRun（completed/failed）。
   * subtype=success → completed；subtype=error_* / is_error=true → failed；
   * interrupt 触发的 result subtype=error_during_execution → failed(interrupted)（spike D1）。
   */
  onResult: (result: SDKResultMessage) => void | Promise<void>;
  /** 中间消息（assistant text/tool_use/tool_result/system/init）→ submit AgentRunLog。可选。 */
  onMessage?: (msg: SDKMessage) => void | Promise<void>;
  /** query 异常（spawn 失败 / 网络）→ session failed。 */
  onError?: (err: unknown) => void | Promise<void>;
}

export class ClaudeSdkDriver {
  /**
   * 启动 SDK query，订阅 input AsyncIterable（长生命周期，跨 turn）。
   * 返回 Query 句柄供 interrupt/状态查询。
   *
   * Spike H2 实测签名：`query({ prompt: AsyncIterable, options: {...} })`。
   * options 透传 pathToClaudeCodeExecutable / cwd / env / canUseTool / model / allowedTools / resume。
   */
  start(input: AsyncIterable<SDKUserMessage>, opts: StartOptions): Query;

  /**
   * Spike D1：interrupt 是 turn 级。调用 q.interrupt() 后当前 turn 产出 result
   * subtype=error_during_execution，但 query 不结束、可续轮（下一条 input yield 跑新 turn）。
   * SessionManager 据此把 currentRun 标 failed(interrupted)，session 仍 active。
   *
   * q 为 null / 已结束 → no-op + 返回 false。
   */
  interrupt(q: Query | null): Promise<boolean>;

  /**
   * 遍历 Query AsyncGenerator（spike D4：result 后无孤儿后台事件）。
   * 对每条 message：onMessage（如有）；对每条 result：onResult。
   * for-await 正常结束或抛错时按需调 onError，然后 return（query 已结束）。
   *
   * consume 在 SessionManager 内一个 session 启动一次，作为 driver 协程，
   * 跨多 turn 持续直到 InputQueue close 或 query 自然结束。
   */
  consume(q: Query, cb: ConsumeCallbacks): Promise<void>;
}

export class ClaudeExecutableNotFoundError extends Error {
  readonly code = 'CLAUDE_EXECUTABLE_NOT_FOUND';
}
```

实现要点：
- `start` 内调用 `sdkQuery({ prompt: input, options: { pathToClaudeCodeExecutable: opts.pathToClaudeCodeExecutable, cwd: opts.cwd, env: opts.env ?? { ...process.env }, model: opts.model, allowedTools: opts.allowedTools, canUseTool: opts.canUseTool, resume: opts.resume } })`（字段缺失不写进 options，让 SDK 走默认）。
- 首条 `system/init` 消息含 `session_id`，driver 不直接消费；SessionManager 在 `onMessage` 回调里识别 `msg.type==='system' && msg.subtype==='init'` 写入 `state.agentSessionId`（spike H2 session_id = `5b31bbdf-…`）。
- `consume` 必须 `for await (const msg of q)`，不要把 generator 转数组；spike D4 证明 result 后无孤儿事件，所以 onResult 内可以直接收敛 AgentRun。
- 异常透传：spawn 失败、env 鉴权失败抛给 `onError`，SessionManager 据此标 session failed。

### 4.3 SessionManager + SessionStore（`interactive/session-manager.ts`）

```typescript
import type { Query, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeSdkDriver } from './claude-sdk-driver.js';
import type { InputQueue } from './input-queue.js';

export type SessionStatus = 'active' | 'running' | 'reconnecting' | 'ended' | 'failed';

export interface SessionState {
  /** agent_sessions.id（backend 实体，create 时下发）。 */
  sessionId: string;
  /** 长生命周期 interactive lease.id（create 时下发）。 */
  leaseId: string;
  /** SDK 返回的 session_id（首 turn system/init 写入；resume 用，spike D3）。Wave1/2 内存态。 */
  agentSessionId?: string;
  /** SDK Query 句柄，长生命周期跨多 turn（spike H2）。 */
  query?: Query;
  /** per-session 输入队列。 */
  inputQueue: InputQueue;
  /** 当前 turn 的 AgentRun.id（backend 在 inject 时创建并下发）。 */
  currentRunId?: string;
  /** 当前 turn 状态：active=空闲可接 inject，running=turn 执行中。 */
  status: SessionStatus;
  /** 最后活动时间（D-004 空闲 30min 回收，task-07 实现）。 */
  lastActiveAt: number;
  /** 固定 cwd（resume 还原用，spike D3）。 */
  cwd: string;
  /** provider（claude；codex 后续 CodexAppServerDriver 单独）。 */
  provider: 'claude' | 'codex';
}

export interface CreateSessionInput {
  sessionId: string;
  leaseId: string;
  firstPrompt: string;
  firstRunId: string;
  cwd: string;
  provider: 'claude' | 'codex';
  /** pathToClaudeCodeExecutable（来自 daemon._agentPaths.get('claude')）。 */
  pathToClaudeCodeExecutable: string;
  model?: string;
  allowedTools?: string[];
}

export interface InjectResult {
  runId: string;
}

/** SessionManager 持有的依赖（便于注入 mock 与 backend 通知回调）。 */
export interface SessionManagerDeps {
  driver: ClaudeSdkDriver;
  /** backend 通知回调：result 触发关闭 AgentRun（task-05 真正实现，本任务用 mock）。 */
  onTurnResult: (sessionId: string, runId: string, result: SDKResultMessage) => void | Promise<void>;
  /** 中间消息 → submit AgentRunLog（task-06 SSE，本任务用 mock）。 */
  onTurnMessage: (sessionId: string, runId: string, msg: SDKMessage) => void | Promise<void>;
  /** session 终态通知 backend（end/failed → backend end_session，task-05 实现）。 */
  onSessionEnd: (sessionId: string, status: SessionStatus) => void | Promise<void>;
}

export class SessionManager {
  /** 内存 SessionStore。Wave1/2 内存态，daemon 重启丢失（D-003，task-10 持久化）。 */
  private readonly _store = new Map<string, SessionState>();

  constructor(private readonly deps: SessionManagerDeps) {}

  /**
   * 创建 session 并启动 driver 协程。
   *
   * 流程（design §7.6）：
   *   1. 建 InputQueue，push 首 SDKUserMessage（type='user', message.role='user',
   *      message.content=firstPrompt, parent_tool_use_id=null —— spike H2 实测形态）。
   *   2. state = { sessionId, leaseId, status:'running', currentRunId:firstRunId,
   *      inputQueue, cwd, provider, lastActiveAt:Date.now() }，写入 _store。
   *   3. query = driver.start(inputQueue, opts)，state.query=query。
   *   4. 异步 fire driver.consume(query, { onResult, onMessage, onError })，
   *      不阻塞 create 返回。
   *   5. 重复 sessionId 抛 SessionAlreadyExistsError；executable 缺失抛
   *      ClaudeExecutableNotFoundError（driver.start 内）。
   */
  create(input: CreateSessionInput): Promise<void>;

  /**
   * 追问：push 新 SDKUserMessage，driver 在当前 turn result 后自然消费（spike H2/S1）。
   *
   *   - session 不存在 → SessionNotFoundError；
   *   - status ∈ {ended, failed} → SessionNotActiveError；
   *   - status === running（上一 turn 未 result）→ push 仍入 InputQueue 缓冲，
   *     SDK 在当前 turn result 后 yield 下一条 → 新 turn 开始（spike S1 排队语义），
   *     SessionManager 在 onResult 收尾旧 run 后由 backend 下发新 run_id（见 _setCurrentRun）。
   *   - 返回的 runId 是入参 runId（backend 在 inject 时已创建 AgentRun）。
   *
   * 注意：runId 由 backend 创建并随 SESSION_INJECT payload 下发；SessionManager
   * 在收到该 turn 的 result 前不切换 currentRunId，避免双 run 串扰。
   */
  inject(sessionId: string, prompt: string, runId: string): Promise<InjectResult>;

  /**
   * spike D1：turn 级 interrupt。driver.interrupt(state.query) 后当前 turn 产出
   * result subtype=error_during_execution，onResult 把 currentRun 收敛为 failed(interrupted)，
   * status 回 active，session 仍可续轮。
   *
   *   - session 不存在/无 query → no-op 返回 false；
   *   - status=active（无 running turn）→ no-op 返回 false（不改变 active）。
   */
  interrupt(sessionId: string): Promise<boolean>;

  /**
   * 结束 session：close InputQueue（让 query 自然结束），status=ended，
   * 调 onSessionEnd 通知 backend end_session（统一收口，design §8.5）。
   * 幂等：已 ended/failed 直接返回。
   */
  end(sessionId: string): Promise<void>;

  /** 标 failed（driver onError 或不可恢复异常）。 */
  fail(sessionId: string): Promise<void>;

  /** 查询（测试用）。 */
  get(sessionId: string): Readonly<SessionState> | undefined;

  /**
   * 内部：driver.consume 的 onResult 回调。
   *   - result.subtype==='success' → onTurnResult(sessionId, currentRunId, result)；
   *   - is_error / subtype=error_* → onTurnResult(..., result)，backend 据 is_error 标 failed/interrupted；
   *   - status: running → active（currentRunId 清空，待下个 inject 下发新 runId）；
   *   - lastActiveAt 更新。
   */
  private _onResult(state: SessionState, result: SDKResultMessage): Promise<void>;

  /** 内部：driver.consume 的 onMessage 回调；system/init 写 agentSessionId；其余转发 onTurnMessage。 */
  private _onMessage(state: SessionState, msg: SDKMessage): Promise<void>;
}

export class SessionNotFoundError extends Error { readonly code = 'SESSION_NOT_FOUND'; }
export class SessionAlreadyExistsError extends Error { readonly code = 'SESSION_ALREADY_EXISTS'; }
export class SessionNotActiveError extends Error { readonly code = 'SESSION_NOT_ACTIVE'; }
```

约束：
- `_store` 是 `Map<string, SessionState>`，单例；不同 session 并发跑（spike H2 跨 session 无关）；同 session 内 turn 级串行（spike S1）。
- state 持有的 `query` 是 SDK 长生命周期句柄；Wave1/2 不持有跨 turn 的 stdin/child（SDK 内部管理），符合 D-002@v3 转移 stdin/stdout 管理权的定位。
- `agentSessionId` 由 driver `onMessage` 识别 `system/init` 写入，写入后不变（resume 时 backend 拿它构造 `query({ options: { resume } })`，task-10）。

### 4.4 daemon.ts kind 分流

在 `_runLeaseStateMachine` 拿到 `claimResp`、归一化 `execPayload` 后（现有代码 L674-L758 不动），在 `getExecutionContext` 之前插入分流：

```typescript
// 现有 _runLeaseStateMachine 拿到 claimResp + execPayload 后：
const kind =
  (execPayload.kind as 'batch' | 'interactive' | undefined) ??
  (execPayload as Record<string, unknown>).kind as string | undefined ??
  'batch';

if (kind === 'interactive') {
  // interactive：不走 TaskRunner。首 turn = SessionManager.create（backend 已创建
  // AgentSession + 首 AgentRun + interactive lease + 已 startLease）。
  // daemon 不调 startLease/completeLease（backend claim/start 时已处理）。
  await this._startInteractiveSession(leaseId, execPayload);
  return;
}

// batch：现有 runLease → completeLease 完全不动（L760-L851）。
```

新增 `_startInteractiveSession(leaseId, execPayload)`：
- 校验 `execPayload.agentSessionId`、`execPayload.agentRunId`、`execPayload.prompt`、`execPayload.rootPath`/`cwd` 必须存在；缺则记 error 并跳过（interactive lease 由 backend 收口 failed）。
- 解析 `pathToClaudeCodeExecutable`：`this._agentPaths.get('claude')`；缺失 → SessionManager.create 抛 `ClaudeExecutableNotFoundError`（D-009），backend 据 onSessionEnd 收 failed。
- 调 `this._sessionManager.create({ sessionId, leaseId, firstPrompt, firstRunId, cwd, provider:'claude', pathToClaudeCodeExecutable, model })`。
- 独立追踪：新增 `this._interactiveSessionsByLease: Map<string, string>`（leaseId→sessionId），避免首 turn 后 WS 重放 task_available 再次 create。

`_handleWsMessage` 增 case（task-03 已定义 MSG.SESSION_*）：
- `MSG.SESSION_INJECT`：payload `{ session_id, lease_id, run_id, prompt }`，校验 session 存在 + lease 匹配 → `sessionManager.inject(session_id, prompt, run_id)`。
- `MSG.SESSION_INTERRUPT`：`{ session_id, lease_id }`，校验 → `sessionManager.interrupt(session_id)`。
- `MSG.SESSION_END`：`{ session_id, lease_id }`，校验 → `sessionManager.end(session_id)`，清理 `_interactiveSessionsByLease`。
- payload `lease_id` 与 store 中 `state.leaseId` 不一致 → 记结构化 warn 并丢弃（不操作 session）。
- 字段名兼容 camelCase/snake_case（同现有 `_handleWsMessage` 归一化风格）。

daemon 构造函数新增可选 `sessionManager?: SessionManager`（依赖注入便于测试 mock）。生产路径在 `main.ts`（task 链外）实例化时传入；本任务范围内 daemon 默认 `sessionManager=null`，`kind=interactive` 时若 null 则记 error 并由 backend 端 failed（不崩 daemon）。

### 4.5 package.json + .npmrc（D-009）

`package.json`：
```json
"dependencies": {
  "@anthropic-ai/claude-agent-sdk": "0.3.181",
  ...
}
```
（pin 版本，R-SDK0.x；升级前用 spike 脚本回归。）

`.npmrc`（新增，排平台二进制 224MB）：
```
# D-009@v1：只用系统 claude.CMD（pathToClaudeCodeExecutable），不带 SDK 内置 win32-x64 exe。
# optional=false 让 pnpm 跳过 optionalDependencies（平台二进制在 optionalDependencies 里）。
optional=false
```

> 实现时验证：pnpm install 后 `node_modules/.pnpm/` 下不应出现 `@anthropic-ai+claude-agent-sdk-win32-x64`；主包 `@anthropic-ai/claude-agent-sdk` 仍可 import `query`。若 `optional=false` 影响其他正当 optional 依赖，改用 pnpm 的 `--omit=optional` 或 package.json `pnpm.overrides` 精确排除该子包，必须保留主包可运行。

## 5. 边界处理（至少覆盖以下，全部上单测）

| # | 场景 | 必须行为 |
|---|---|---|
| 1 | agent-detector 未检测 claude / `_agentPaths.get('claude')` 空 | `_startInteractiveSession` 不调用 SessionManager.create；driver.start 不会触发；backend 经 onSessionEnd 收 failed（D-009 R-exe 兜底；task-01 已补验显式路径）。daemon 日志含 `CLAUDE_EXECUTABLE_NOT_FOUND` |
| 2 | SDK `query()` 抛错（spawn 失败 / env 鉴权失败 / 网络断） | driver.consume 的 try/catch 捕获 → onError → SessionManager.fail(sessionId)；status=failed；onSessionEnd 通知 backend，不崩 daemon 主循环 |
| 3 | SESSION_INJECT 到 ended/failed session | SessionManager.inject 抛 `SessionNotActiveError`；daemon 记 warn，不发新 run；backend 已在 inject 时行锁拒绝（task-05），本任务只防 daemon 侧漏 |
| 4 | SESSION_INTERRUPT 无 running turn（status=active） | `interrupt` no-op 返回 false；status 保持 active；不误杀后续进程；不调用 SDK interrupt（q.interrupt 在无活动 turn 时 SDK 行为未验证，保守 no-op） |
| 5 | resume 时 cwd 不一致（task-10 真正触发；本任务仅声明契约） | SessionState 固定 cwd；driver.start 必须用 state.cwd，不接受运行时变更；spike D3 resume 按 cwd 分目录，cwd 不一致 → SDK 找不到 session jsonl → onError → failed。本任务在 SessionManager.create 强制把 input.cwd 写入 state.cwd 并传给 driver |
| 6 | WS payload `lease_id` 与 store `state.leaseId` 不匹配 | 记结构化 warn（含 session_id/期望 lease_id/收到 lease_id），不操作 session，不调 inject/interrupt/end |
| 7 | 同一 session 并发 SESSION_INJECT（前 turn 未 result） | 第二条 push 进 InputQueue 缓冲，SDK 在当前 turn result 后按 FIFO 消费（spike S1）；currentRunId 在前 turn result 收尾前不切换；backend 行锁已防重复创建 AgentRun（task-05），daemon 不重复回 create |
| 8 | SESSION_END 与 turn 完成竞态 | end 先置 status=ended + InputQueue.close；迟到的 onResult 在 status=ended 时只记日志不再调 onTurnResult（幂等），避免对已 ended session 发双终态 |
| 9 | 重复 task_available 重放（WS 重连/重复投递） | `_interactiveSessionsByLease` 命中已注册 leaseId → 跳过 create，不重复启动 driver |
| 10 | InputQueue close 后再 push | `push` 抛 `SessionQueueClosedError`；SessionManager 在 ended 状态下拦截 inject（边界 3 先触发） |
| 11 | InputQueue 第二次 `[Symbol.asyncIterator]` | 抛 `SessionQueueDoubleSubscribeError`；driver.start 在 session 生命周期内只调用一次，正常路径不触发，仅防御性 |
| 12 | kind 缺省/未知 | 一律按 `batch`（D-002@v3 §9 兼容策略），走 TaskRunner；不进 SessionManager；现有 workspace AgentRun 零变化 |
| 13 | driver.consume 收到 `result.subtype=error_during_execution`（interrupt 触发，spike D1） | onResult 把该 run 标 failed(interrupted)；status 回 active；agentSessionId 保留；下个 inject 可续轮 |
| 14 | daemon 构造时未注入 sessionManager（生产部署前的过渡期） | kind=interactive 时记 error 日志并直接 return（不崩），由 backend end_session 收 failed；batch 路径完全不受影响 |

## 6. 非目标（本任务不做的事）

- **不实现 canUseTool 远程人审**：driver 默认不传 `canUseTool`（SDK 内置策略）；D-007 远程人审由 task-08 在 driver 回调里接入 WS permission_request/response。
- **不实现 resume 持久化**：SessionStore 内存态；daemon 重启 session 丢失（D-003 Wave1/2=failed，Wave3=task-10 持久化 + `query({resume})`）。
- **不修改 task-runner.ts**：batch 路径完全不动；现有 `runLease` / `cancel` / adapter / spawn 零改动。
- **不实现 session 级 SSE 聚合**：`onTurnMessage`/`onTurnResult` 是回调入口（mock 即可），真正 Redis publish + `stream_session_logs` 由 task-06。
- **不实现 30min 空闲回收**：SessionState 记 `lastActiveAt`，scanner 由 task-07。
- **不修改 protocol.ts 常量**：task-03 已定义 `MSG.SESSION_*`；本任务只消费。
- **不修改 AgentSession model / alembic / backend service**：task-02 / task-05 负责。
- **不实现 CodexAppServerDriver**：D-002@v3 提到 codex 后续独立；本任务 provider 收到非 claude → 抛 UnsupportedProviderError（claude only）。
- **不带 SDK 平台二进制包**：D-009 用系统 claude；`.npmrc` 排 win32-x64。
- **不读 credentials.json**：env 继承 `process.env`（spike H1）。

## 7. 参考

- `design.md` §5（方案 A 与 TaskRunner 并存）、§7.1 ClaudeSdkDriver、§7.2 SessionManager、§7.6 turn 时序、§9 兼容、§10 R-exe/R-SDK0.x/R-cwd。
- `spike-02-architecture-validation.md` §3.7：H1（env 继承 + 默认内置 exe；本任务 task-01 改显式 pathToClaudeCodeExecutable）、H2（AsyncIterable 同进程两轮，同 session_id）、D1（interrupt turn 级，result subtype=error_during_execution，query 不结束可续轮）、D4（result 干净边界，无孤儿后台事件）、S1（不支持运行中注入，turn 级串行）。
- spike sandbox 脚本（仓库外）：`%TEMP%\claude-sdk-spike\h1.mjs`（query 最小 + 探 claude.exe 路径）、`h2.mjs`（AsyncIterable 两轮 + ZEBRA-742 上下文连续）、`d1.mjs`（interrupt 续轮）、`d2.mjs`（canUseTool await 远程，caveat GLM Write 失败）、`d3.mjs`（resume）、`d4.mjs`（result 边界）、`s1.mjs`（priority:'now' 仍排队下一 turn）。
- `decisions.md` D-002@v3（driver 并存）/ D-009@v1（系统 claude.CMD）。
- `sillyhub-daemon/src/daemon.ts:_runLeaseStateMachine`（L674-L851 现有 batch 路径，本任务在其前插入分流）。
- `sillyhub-daemon/src/task-runner.ts:186 TaskRunner`（不动）。
- `sillyhub-daemon/src/agent-detector.ts`（`DetectedAgent.provider/path/status`）。
- `sillyhub-daemon/src/protocol.ts:MSG`（task-03 SESSION_* 常量）。

## 8. TDD 实施顺序

严格"测试先失败 → 最小实现 → 重构 → 全量回归"。SDK 调用一律 mock（不连真实 bigmodel，避免 CI 依赖网络/鉴权）。

### Step 1：InputQueue 单测（红）
- push 后 async iterator 按序 yield；close 后已 push 消息仍 yield 完再结束。
- close 后 push 抛 `SessionQueueClosedError`；二次 `[Symbol.asyncIterator]` 抛 `SessionQueueDoubleSubscribeError`。
- turn 级串行：连续 push 两条，consumer await 慢消费，第二条不丢、按序。
- 红后实现 input-queue.ts。

### Step 2：ClaudeSdkDriver 单测（红，mock SDK）
- 用 vitest mock `@anthropic-ai/claude-agent-sdk` 的 `query`：返回伪造 AsyncGenerator，按序吐 `system/init`(session_id) → `assistant` → `result(success)` → `assistant` → `result(success)`（spike H2 两轮形态）。
- `start(input, opts)`：断言传给 `query` 的 `options.pathToClaudeCodeExecutable/cwd/env` 正确；缺 executable 抛 `ClaudeExecutableNotFoundError`。
- `consume`：两条 result 各触发一次 `onResult`；中间消息触发 `onMessage`；`onMessage` 收到 `system/init` 时回调内可拿 `session_id`（由 SessionManager 写 state，driver 只透传）。
- `interrupt(null)` → false；`interrupt(q)` 调用 `q.interrupt()`（mock 验证调用次数）。
- generator 抛错 → `onError` 触发。
- 红后实现 claude-sdk-driver.ts。

### Step 3：SessionManager 单测（红）
注入 mock ClaudeSdkDriver + mock deps（onTurnResult/onTurnMessage/onSessionEnd 记录调用）：
- `create`：建 InputQueue、push 首 msg、status=running、currentRunId=firstRunId、fire consume；重复 sessionId 抛 `SessionAlreadyExistsError`。
- `inject`：status=active 时 push 新 msg，返回 runId；status=ended/failed 抛 `SessionNotActiveError`。
- 模拟 driver onResult(success)：调 onTurnResult(sessionId, runId, result)，status: running→active，currentRunId 清空，lastActiveAt 更新。
- 模拟 onResult(is_error/interrupt)：调 onTurnResult，status→active（session 仍可续轮，spike D1）。
- `interrupt`：status=active → no-op false；status=running → 调 driver.interrupt（mock 验证）。
- `end`：InputQueue.close、status=ended、onSessionEnd 调用一次；重复 end 幂等。
- `fail`：status=failed、onSessionEnd(failed)。
- onMessage 的 system/init → 写 state.agentSessionId（只写一次）。
- 红后实现 session-manager.ts。

### Step 4：daemon kind 分流单测（红）
mock TaskRunner + mock SessionManager：
- kind=batch / 缺省：调 `taskRunner.runLease` + `completeLease`（现有路径）；SessionManager.create 不调用。
- kind=interactive：调 `sessionManager.create`，不调 runLease / startLease / completeLease。
- agent-detector 无 claude（`_agentPaths.get('claude')` 空）：interactive create 不调，backend 收 failed（onSessionEnd）。
- 重复 task_available 同 leaseId：第二次不重复 create（`_interactiveSessionsByLease` 命中）。
- SESSION_INJECT/INTERRUPT/END 路由：session 存在 + lease 匹配 → 调对应方法；lease 不匹配 → warn + 不操作。
- 红后修改 daemon.ts。

### Step 5：ws-client 控制消息路由单测（红）
- SESSION_* 触发 `onControlMessage`，TASK_AVAILABLE/RPC 不变（若 task-03 已实现则只回归）。
- 红后确认 ws-client.ts 派发。

### Step 6：回归
```bash
cd sillyhub-daemon
pnpm install   # 验证 .npmrc 排除 win32-x64 平台包
pnpm test -- input-queue claude-sdk-driver session-manager daemon-kind-dispatch ws-client-session-control
pnpm typecheck
pnpm test      # 全量回归，batch 测试零失败
```

## 9. 验收标准

| AC | 验收场景 | 可观察证据 | 状态 |
|---|---|---|---|
| AC-01 | SDK 同进程两轮（spike H2 复现） | mock SDK 吐两条 result；driver.consume 两条 result 各触发 onResult；agentSessionId 来自首条 system/init 且两轮不变；InputQueue 顺序 yield 两条 SDKUserMessage | [ ] |
| AC-02 | result→AgentRun 边界（spike D4） | 每条 result 触发一次 onTurnResult(sessionId, runId, result)；result 之间的 assistant/tool 消息走 onMessage；status 在 result 时 running→active 切换；无孤儿后台事件触发额外 onResult | [ ] |
| AC-03 | interrupt turn 级（spike D1） | status=running 时 interrupt → driver.interrupt(q) 调用一次；模拟 SDK 吐 result subtype=error_during_execution → onTurnResult 标 failed(interrupted)，status 回 active，agentSessionId 保留；下个 inject 可续轮 | [ ] |
| AC-04 | end 收口 | end → InputQueue.close、status=ended、onSessionEnd(ended) 调一次；重复 end 幂等；迟到的 onResult 在 ended 时不重复调 onTurnResult | [ ] |
| AC-05 | kind=batch 分流回归 | kind=batch/缺省 → runLease + completeLease 现有路径；sessionManager.create 零调用；现有 batch 测试全绿；workspace AgentRun 行为零变化（FR-09） | [ ] |
| AC-06 | kind=interactive 分流 | kind=interactive → sessionManager.create 调用，不调 runLease/startLease/completeLease；首 turn 由 backend AgentRun（firstRunId）传入 | [ ] |
| AC-07 | D-009 executable 缺失拒绝 | `_agentPaths.get('claude')` 空 → 不调 create；onSessionEnd(failed)；日志含 CLAUDE_EXECUTABLE_NOT_FOUND；daemon 主循环不崩 | [ ] |
| AC-08 | WS 控制消息路由 | SESSION_INJECT/INTERRUPT/END 正确路由到 SessionManager 对应方法；lease_id 不匹配时 warn 且无副作用 | [ ] |
| AC-09 | 重复 task_available 不重 create | `_interactiveSessionsByLease` 命中已注册 lease → 跳过；driver 只启动一次 | [ ] |
| AC-10 | .npmrc 排平台二进制 | `pnpm install` 后 `node_modules/.pnpm/` 无 `@anthropic-ai+claude-agent-sdk-win32-x64*`；主包 `import { query }` 可用；package.json pin `0.3.181` | [ ] |
| AC-11 | resume cwd 固定契约 | SessionManager.create 把 input.cwd 写入 state.cwd 并传 driver；driver.start 不接受运行时 cwd 变更；spike D3 resume 契约落位（task-10 真验） | [ ] |
| AC-12 | driver 异常不崩 daemon | mock SDK query 抛错 → onError → SessionManager.fail → onSessionEnd(failed)；daemon 三循环（heartbeat/poll/ws）继续运行 | [ ] |
| AC-13 | provider 非 claude | SessionManager.create provider≠'claude' → 抛 UnsupportedProviderError（codex 后续，D-002@v3 不 Big Bang） | [ ] |
| AC-14 | 验证命令 | `pnpm typecheck` + `pnpm test`（含定向 + 全量）退出码 0；diff 只在 allowed_paths 内 | [ ] |

## 10. 完成定义

- D-002@v3（driver 与 TaskRunner 并存、SDK 同进程多轮）在代码与测试中有直接证据：`src/interactive/` 独立模块，task-runner.ts 零改动，batch 测试全绿。
- D-009@v1（系统 claude.CMD）：driver 显式 `pathToClaudeCodeExecutable`，`.npmrc` 排平台二进制，executable 缺失明确拒绝。
- spike §3.7 的 H1/H2/D1/D4/S1 实测结论均有对应实现落点（同进程两轮、result 边界、interrupt 续轮、turn 级串行）。
- AC-01~AC-14 全部通过；所有异常路径有明确错误码，禁止裸 `try/catch` 吞错。
- 未越过 allowed_paths：未改 task-runner.ts / protocol.ts / backend / frontend / model / migration / SSE / canUseTool 人审实现。
