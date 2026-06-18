---
id: task-03
title: daemon session 侧（sessionStore + task-runner session 模式 + ws-client 控制路由 + kind 分流）
wave: W1
priority: P0
depends_on: [task-02]
covers: [FR-01, FR-02, FR-04, FR-05, FR-09, D-002]
created_at: 2026-06-18 14:11:24
author: qinyi
---

## 1. 目标

在 daemon 侧落地"长驻会话执行器"，让 `lease.kind=interactive` 走与批处理 (`batch`) 完全分离的执行路径：

1. **task-runner session 模式**：spawn 后保持 stdin 开放，`result`/`turn/completed` 事件只标记"当前 turn 完成"（更新 AgentRun、发 SSE turn-done），**不再 end stdin、不再退出 readline**，等待下一次 `session_inject`。
2. **SessionStore**：内存 `Map<sessionId, SessionState>` 持有 childProcess / stdin / adapter / status / currentRunId，提供 `create / get / inject / interrupt / end` 五个 API（design §7.3）。
3. **ws-client 控制消息路由**：`_handleMessage` 新增 `SESSION_INJECT / SESSION_INTERRUPT / SESSION_END` 三类 server→daemon 控制消息的分派点（不内嵌业务，仅转交 SessionStore）。
4. **daemon kind 分流**：`_runLeaseStateMachine` 按 `ctx.kind` 分流 —— `batch` 走原 `TaskRunner.runLease`（零改动），`interactive` 走新 `SessionRunner.runLease`（task-runner 的 session 模式入口）。

**关键差异（vs 批处理模型）**：批处理模型 `result` 后 `child.stdin.end()` + readline 自然结束 + collectDiff + complete（task-runner.ts:929-936, 1047-1058）；session 模式 `result` 后三者都不做，把 stdin 当作"会话输入流"持续开着，等下一轮。

## 2. 前置依赖

- **task-02 协议契约（硬依赖）**：本任务消费 `protocol.ts` 新增的 `MSG.SESSION_INJECT / SESSION_INTERRUPT / SESSION_END` 常量 + 对应 payload 类型（`SessionInjectPayload { session_id, lease_id, run_id, prompt }` / `SessionControlPayload { session_id, lease_id }`）。task-02 必须先合并，daemon / backend 两端契约对齐。
- **task-01 数据模型（软依赖）**：`LeaseCtx.kind` 字段（`'batch' | 'interactive'`，默认 `'batch'`）+ `LeaseCtx.agentSessionId` 字段。如 task-01 未合并，daemon 侧用 `as LeaseCtx & { kind?: string; agentSessionId?: string }` 兜底访问（duck-typing，对齐 daemon.ts 已有 `workspaceId/specRoot` 兜底模式）。
- **spike-01（方案可行性硬门）**：claude/codex stream-json stdin 两轮 result 已端到端验证。本任务的"result 后 stdin 不 end"策略依赖此铁证。若 spike-01 未通过则方案降级（伪多轮 resume 链路），本蓝图需重设计。

## 3. 涉及文件

| 操作 | 文件路径 | 改动概要 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/session-store.ts` | SessionStore 类 + SessionState 类型；create/get/inject/interrupt/end API |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | 抽出 session 模式入口 `runLeaseSession(ctx)`；`_handleLine` 的 result/turn_completed 收尾点按模式分流（batch=end stdin，session=标记 turn 完成）；新增 `injectPrompt / interrupt / end` 方法（操作 sessionStore 内 child.stdin） |
| 修改 | `sillyhub-daemon/src/ws-client.ts` | `_handleMessage` 新增 SESSION_INJECT/INTERRUPT/END 分派到 `onControlMessage` 回调（不内嵌业务，仅转发） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `_runLeaseStateMachine` 按 `ctx.kind` 分流；`_handleWsMessage` 新增 session 控制消息路由到 SessionStore；构造 WsClient 时注入 onControlMessage 回调 |
| 不改 | `sillyhub-daemon/src/adapters/stream-json.ts` | `buildInput(prompt)` 已存在，session inject 直接复用（写第二条 user message JSON） |
| 不改 | `sillyhub-daemon/src/adapters/json-rpc.ts` | `buildTurnStart({threadId, prompt, model})` 已存在，session inject 复用（threadId 从 sessionStore 取） |
| 不改 | `sillyhub-daemon/src/protocol.ts` | SESSION_* 常量由 task-02 添加，本任务仅 import 消费 |
| 新增 | `sillyhub-daemon/tests/session-store.test.ts` | SessionStore 单测 |
| 新增 | `sillyhub-daemon/tests/task-runner-session.test.ts` | session 模式 + inject/interrupt/end 单测 |
| 新增 | `sillyhub-daemon/tests/daemon-kind-dispatch.test.ts` | kind 分流单测 |
| 新增 | `sillyhub-daemon/tests/ws-client-control-route.test.ts` | 控制消息路由单测 |

## 4. 实现步骤

### 4.1 新增 SessionStore（design §7.3）

新建 `src/session-store.ts`：

```typescript
export interface SessionState {
  sessionId: string;
  leaseId: string;
  agentSessionId?: string;     // claude session_id / codex thread_id（首次 turn 后填入，跨 turn 复用）
  child: ChildProcess;
  stdin: NodeJS.WritableStream;
  adapter: ProtocolAdapter;
  status: 'active' | 'interrupted' | 'ended' | 'failed';
  currentRunId?: string;       // 当前 turn 的 AgentRun id（每个 inject 更新）
  provider: string;            // claude / codex，决定 inject 走 buildInput 还是 buildTurnStart
  model?: string;
  turnCount: number;
  lastActiveAt: number;        // ms epoch，空闲 30min 回收用（task-06）
}

export class SessionStore {
  private readonly _sessions = new Map<string, SessionState>();
  create(state: Omit<SessionState, 'status' | 'turnCount' | 'lastActiveAt'>): void;
  get(sessionId: string): SessionState | undefined;
  /** inject 写 stdin：claude=buildInput 第二条 user msg JSON；codex=buildTurnStart 复用 thread */
  inject(sessionId: string, prompt: string, runId: string): void;
  /** interrupt 本轮：claude=child.kill('SIGINT')，codex=write turn/interrupt JSON-RPC request */
  interrupt(sessionId: string): void;
  /** end 会话：child.kill() + 标 ended + 从 map 移除（不 await exit） */
  end(sessionId: string): void;
  get activeCount(): number;
}
```

**API 语义要点**：

- `create`：由 SessionRunner 在 spawn 成功后调用。幂等：同一 sessionId 重复 create 抛错（防双开）。
- `inject`：先校验 `status === 'active'`，否则抛 `SessionNotActiveError`（design R-02：inject 到已结束 session 返回错误）。写 stdin 用 task-runner 抽出的 `_writeStdinLine(stdin, buf)` 辅助函数（复用 drain + write callback 模式，task-runner.ts:776-790）。
  - **claude**（adapter.buildInput 实现）：`stdin.write(adapter.buildInput(prompt))` —— 复用现有 buildInput 产出的 `{type:'user', message:{...}}` NDJSON。
  - **codex**（adapter.buildTurnStart 实现）：`stdin.write(adapter.buildTurnStart({threadId: state.agentSessionId!, prompt, model}) + '\n')` —— threadId 跨 turn 复用（首次 turn 由 _handleLine 检测 thread/start response 提取并写回 sessionStore.agentSessionId）。
- `interrupt`：
  - **claude**：`state.child.kill('SIGINT')` —— Claude CLI 收到 SIGINT 停止当前 turn 但保留会话。
  - **codex**：`stdin.write(JSON.stringify({jsonrpc:'2.0', id:<auto>, method:'turn/interrupt', params:{threadId: state.agentSessionId!}}) + '\n')` —— codex 主动 turn/interrupt，child 不 kill。
  - 标 `status='interrupted'`，下次 inject 自动回到 `active`（design G2：打断本轮保留会话）。
- `end`：`child.kill()`（SIGTERM，2s 后 SIGKILL 升级由 task-runner 的 killTimer 复用）+ `status='ended'` + `map.delete(sessionId)`。**不阻塞等 exit**（end 是控制消息路径，不等 agent 自然退出）。

### 4.2 task-runner 引入 session 模式（核心改造点）

**改造点 1 — 新增 `runLeaseSession(ctx)` 入口**：

`runLeaseSession` 与 `runLease` 共享 1-5 步（workspace / claudeMd / env / adapter / startLease）+ 6 步 spawn，但**不走重试循环、不收 collectDiff、不 completeLease**。spawn 成功后：
- 把 `{child, stdin, adapter, provider, model, sessionId: ctx.agentSessionId}` 注入 sessionStore.create()；
- 把 `_spawnAndStream` 的 `mode` 标记为 `'session'`；
- 让 readline 循环跑着**不返回**（等 sessionStore.end 由外部触发 kill）。
- 返回的 TaskRunnerResult 仅作"首轮 turn 完成"标记用（status='completed' + sessionId）。

**改造点 2 — `_spawnAndStream` / `_handleLine` 模式分流（最关键）**：

在 `_spawnAndStream` params 增加 `mode: 'batch' | 'session'`（默认 batch，保持现有测试零改动）。`_handleLine` 接收 mode，对 result/turn_completed 收尾点分流：

- **`batch` 模式（现状，零改动）**：
  - task-runner.ts:1047-1058 `_looksLikeResult` 命中 → `child.stdin.end()`（现状）
  - task-runner.ts:1061-1073 `_looksLikeTurnCompleted` 命中 → `child.stdin.end()`（现状）
  - `_spawnAndStream` 末尾 task-runner.ts:929-936 `child.stdin.end()`（现状）
- **`session` 模式（新）**：
  - `_looksLikeResult` 命中 → **不 end stdin**，改为调 `onTurnComplete(sessionId, runId)` 回调（session 模式专用，触发 backend 把 AgentRun 标 running→completed + 发 SSE turn-done）；
  - `_looksLikeTurnCompleted` 命中 → 同上 onTurnComplete；
  - `_spawnAndStream` 末尾 **不 end stdin、不 collectDiff**；
  - readline 循环 **不 break**（stdin 不 end → child.stdout 不 close → for-await 自然挂着等下一轮）；
  - 进程退出（child exit）才跳出 readline → session 模式视为异常（agent 不该自己 exit），标 `status='failed'`。

**改造点 3 — 新增 inject/interrupt/end 公开方法**：

TaskRunner 持有 SessionStore 引用后，暴露 thin wrapper：

```typescript
injectPrompt(sessionId: string, prompt: string, runId: string): void {
  this._sessionStore.inject(sessionId, prompt, runId);
}
interruptSession(sessionId: string): void {
  this._sessionStore.interrupt(sessionId);
}
endSession(sessionId: string): void {
  this._sessionStore.end(sessionId);
}
```

SessionStore 是逻辑持有方，TaskRunner 仅作 daemon → SessionStore 的桥（保持 task-runner 单测可独立 mock SessionStore）。

### 4.3 task-runner 现有结构复用清单（最小改动）

| 现有函数/位置 | session 模式如何复用 |
|---|---|
| `runLease` 步骤 1-5（workspace/claudeMd/env/adapter/startLease） | 抽成 `_prepareRun(ctx)` 内部方法，`runLease` 和 `runLeaseSession` 共用 |
| `_spawnAndStream` 全部 spawn + readline + handshake 逻辑 | 加 `mode` 参数；session 模式仅跳过末尾 stdin.end + 不触发完整 TaskResult 汇总 |
| `_handleLine` 的 buildTurnStart 检测（task-runner.ts:1009-1045） | session 模式额外触发：首次拿到 threadId 后写回 sessionStore.agentSessionId（codex 跨 turn 复用） |
| `_handleLine` 的 sessionId 提取（task-runner.ts:1100-1104） | session 模式额外触发：拿到 sessionId 后写回 sessionStore.agentSessionId（claude） |
| `getBackend` 工厂（adapters/index.js） | 零改动，sessionStore 直接持有 adapter 实例跨 turn 复用（不复用工厂 new，design R-06） |
| `buildSpawnEnv`（spawn-env.ts） | 零改动，session 模式首次 spawn 用同一份 env（后续 turn 不重 spawn，无 env 变化） |

### 4.4 ws-client 控制消息路由

**`WsClientCallbacks` 增加可选回调**（不破坏现有测试）：

```typescript
export interface WsClientCallbacks {
  onMessage?: (msg: DaemonMessage) => void;       // 现有
  onConnected?: () => void;                        // 现有
  onDisconnected?: (code: number, reason: string) => void;  // 现有
  onError?: (err: Error) => void;                  // 现有
  /** task-03：session 控制消息（server→daemon）。与 RPC 路径同级独立分支。 */
  onControlMessage?: (msg: DaemonMessage) => void;
}
```

**`_handleMessage` 分派扩展**（在现有 RPC 分支后、onMessage 前加）：

```typescript
// task-03：session 控制消息走独立分支，不进 onMessage（不污染 lease 消息分发）。
if (
  msg.type === MSG.SESSION_INJECT ||
  msg.type === MSG.SESSION_INTERRUPT ||
  msg.type === MSG.SESSION_END
) {
  this._callbacks.onControlMessage?.(msg);
  return;
}
this._callbacks.onMessage?.(msg);
```

**设计理由**：与 RPC（task-05）同模式 —— 控制消息走独立回调，业务实现由 daemon.ts 消费（转交 SessionStore），ws-client 仅做"识别 type + 转发"，保持单一职责。

### 4.5 daemon.ts kind 分流

**改造点 1 — `_runLeaseStateMachine` 按 kind 分流**：

在构造 `ctx: LeaseCtx` 后（daemon.ts:789-814 之后），增加 kind 判断：

```typescript
const kind = (ctx as LeaseCtx & { kind?: string }).kind ?? 'batch';
if (kind === 'interactive') {
  // session 模式：spawn 后不 await 完成（runLeaseSession 返回首轮 turn 完成信号即返回），
  // 后续 turn 由 ws 控制消息驱动。completeLease 由 sessionStore.end 触发，不在此调用。
  const firstTurnResult = await this._taskRunner!.runLeaseSession(ctx);
  // 首轮完成即上报（让 backend 把 AgentRun 标 completed），不走 completeLease
  //（interactive lease 在 sessionStore.end 时才 complete，见 §4.6）
  this._logger.info('session_first_turn_done', {
    lease_id: leaseId,
    session_id: firstTurnResult.sessionId,
  });
  return;
}
// batch 模式：原路径（runLease → collectDiff → completeLease）
const taskResult: TaskRunnerResult = await this._taskRunner!.runLease(ctx);
// ... 现有 completeLease 逻辑不变
```

**改造点 2 — WsClient 构造时注入 onControlMessage**（daemon.ts:513-537 `_wsLoop`）：

```typescript
this._wsClient = this._wsClientFactory({
  serverUrl: baseOrigin,
  runtimeId: this._config.runtime_id,
  callbacks: {
    onMessage: (msg) => { void this._handleWsMessage(msg); },
    onControlMessage: (msg) => { void this._handleSessionControl(msg); },  // 新增
  },
});
```

**改造点 3 — `_handleSessionControl` 路由到 SessionStore**：

```typescript
private async _handleSessionControl(msg: DaemonMessage): Promise<void> {
  const payload = (msg.payload ?? {}) as Record<string, unknown>;
  const sessionId = (payload.session_id ?? payload.sessionId) as string | undefined;
  if (!sessionId) {
    this._logger.warn('session_control_no_session_id', { type: msg.type });
    return;
  }
  switch (msg.type) {
    case MSG.SESSION_INJECT: {
      const prompt = (payload.prompt as string | undefined) ?? '';
      const runId = (payload.run_id ?? payload.runId) as string | undefined ?? '';
      this._taskRunner!.injectPrompt(sessionId, prompt, runId);
      break;
    }
    case MSG.SESSION_INTERRUPT: {
      this._taskRunner!.interruptSession(sessionId);
      break;
    }
    case MSG.SESSION_END: {
      this._taskRunner!.endSession(sessionId);
      // 同步触发 completeLease（status=ended，patch=collectDiff），见 §4.6
      await this._completeInteractiveLease(sessionId);
      break;
    }
    default:
      this._logger.warn('unknown_control_message', { type: msg.type });
  }
}
```

### 4.6 interactive lease 的 complete 时机

**不能在首轮 turn 完成时 completeLease**（否则 lease 立即变 completed，后续 inject 找不到 lease）。三条结束路径合一：

1. **手动 end**（`_handleSessionControl` 收到 SESSION_END）：sessionStore.end → completeLease(status=ended, patch=collectDiff from workDir)。
2. **空闲 30min 回收**（task-06 范围，本任务预留 SessionStore.lastActiveAt 字段 + daemon 定时扫描 hook）。
3. **agent 异常 exit**（session 模式 child exit）：sessionStore 标 failed → completeLease(status=failed, error='agent exited unexpectedly')。

本任务实现路径 1 + 3（路径 2 在 task-06）。`_completeInteractiveLease(sessionId)` 统一入口（design §8.5 R-04 修正），避免 lease expiry 与 sessionStore 双重回收。

## 5. 完成标准（AC）

- **AC-1 [sessionStore API]**：`SessionStore.create/inject/interrupt/end` 五方法按 §4.1 语义实现；重复 create 抛错；inject 到非 active session 抛 `SessionNotActiveError`；end 后 `get` 返回 undefined。
- **AC-2 [task-runner session 模式]**：`runLeaseSession(ctx)` 启动 spawn + 注入 sessionStore 后，第一轮 result 事件触发后 **child.stdin 未 end**（断言 `child.stdin.destroyed === false`），readline 未退出（断言后续注入 prompt 能写入 stdin 并触发第二轮 result）。
- **AC-3 [claude inject]**：session 模式跑完第一轮 result 后，调 `sessionStore.inject(sessionId, 'second prompt', runId2)` → 第二条 user message JSON 写入 stdin → claude 输出第二轮 result（spike-01 已证可行）。
- **AC-4 [codex inject]**：codex 首次 turn 跑通后 sessionStore.agentSessionId 填入 threadId；调 inject → `buildTurnStart({threadId, prompt})` 复用同 thread → codex 输出第二轮 turn/completed（threadId 跨 turn 持有，design R-06）。
- **AC-5 [claude interrupt]**：跑第一轮中调 `interrupt` → `child.kill('SIGINT')` → claude 停当前 turn + sessionStore.status='interrupted' + child 仍存活；后续 inject 仍可触发新 turn（会话保留）。
- **AC-6 [codex interrupt]**：调 interrupt → stdin 写 `turn/interrupt` JSON-RPC → codex 停当前 turn + thread 仍可用。
- **AC-7 [end]**：调 `end` → `child.kill()` + status='ended' + map 移除；后续 inject 抛 SessionNotActiveError。
- **AC-8 [kind 分流 batch 零变化]**：`ctx.kind='batch'`（默认）走原 `runLease` 路径，task-runner.ts / daemon.ts 现有所有测试零改动通过（兼容硬约束，design §9）。
- **AC-9 [kind 分流 interactive]**：`ctx.kind='interactive'` 走 `runLeaseSession`，首轮完成后不 completeLease，等 SESSION_END 才 complete。
- **AC-10 [ws-client 路由]**：注入 SESSION_INJECT/INTERRUPT/END 三类消息到 WsClient，`onControlMessage` 被调用且不触发 `onMessage`（不污染 lease 分发）。

## 6. 测试要点（vitest，**daemon 用 pnpm test 非 pytest**）

### 6.1 SessionStore 单测（`tests/session-store.test.ts`）

- `create` 后 `get` 返回完整 state；重复 create 抛错。
- `inject` 到 active session → mock stdin.write 被调用，内容含 prompt（claude）/ threadId（codex）。
- `inject` 到 ended/failed session → 抛 SessionNotActiveError。
- `interrupt` claude → mock child.kill 被调用，signal='SIGINT'，status='interrupted'。
- `interrupt` codex → mock stdin.write 含 `"method":"turn/interrupt"` + threadId。
- `end` → mock child.kill + status='ended' + get 返回 undefined。
- `activeCount` 随 create/end 正确变化。

**Mock 模式**：复用 `tests/helpers/fake-child.ts` 的 FakeChild（task-runner.test.ts:38 已在用）；adapter 用真实 StreamJsonAdapter / JsonRpcAdapter 实例（不 mock，验证真实 buildInput/buildTurnStart 输出）。

### 6.2 task-runner session 模式单测（`tests/task-runner-session.test.ts`）

- `runLeaseSession` 启动 → spawn 被调（cmdPath+args 含 `-p --input-format stream-json`）→ FakeChild 推第一轮 result 行 → onTurnComplete 回调被调（断言 sessionId + runId）→ **child.stdin.destroyed === false**（核心 AC-2）。
- 推第二轮：调 `taskRunner.injectPrompt` → FakeChild stdin 收到第二条 user msg JSON → 推第二轮 result 行 → onTurnComplete 再次被调（turnCount=2）。
- child 自然 exit（模拟 agent 异常退出）→ runLeaseSession 返回 status='failed' + sessionStore 标 failed。
- `_handleLine` 检测 thread/start response（id=2 含 thread.id）→ sessionStore.agentSessionId 被填入（codex 跨 turn 复用 R-06）。

**Mock 模式**：`vi.mock('node:child_process')` 同 task-runner.test.ts:21；client/workspace/credential 用现有 helpers（mock HubClient + 内存 workspace）。

### 6.3 kind 分流单测（`tests/daemon-kind-dispatch.test.ts`）

- `ctx.kind='batch'`（默认 / undefined）→ daemon 调 `taskRunner.runLease`（mock taskRunner，断言 runLease 被调，runLeaseSession 未被调）→ completeLease 被调。
- `ctx.kind='interactive'` → daemon 调 `taskRunner.runLeaseSession`（断言 runLeaseSession 被调，runLease 未被调）→ completeLease **不**被首轮触发。
- `_handleSessionControl` 收到 SESSION_END → completeInteractiveLease → completeLease 被调（status=ended）。

**Mock 模式**：mock TaskRunnerLike（注入 runLease/runLeaseSession 的 mock）+ mock WsClientFactory（手动触发 onControlMessage）。

### 6.4 ws-client 控制路由单测（`tests/ws-client-control-route.test.ts`）

- 构造 WsClient + 注入 mock WebSocket，触发 'message' 事件传 SESSION_INJECT payload → `onControlMessage` 被调 + `onMessage` **不**被调。
- SESSION_INTERRUPT / SESSION_END 同上各一条。
- TASK_AVAILABLE / HEARTBEAT_ACK / RPC 仍走原路径（不进 onControlMessage）。

## 7. 风险 / 注意

- **R-01（已降级）**：spike-01 已端到端验证 claude/codex 两轮 result 可行（design §1.2 / §10）。本任务基于此铁证设计"result 后 stdin 不 end"路径。如生产环境复现"第一轮后 agent exit"，回退到伪多轮 resume（design §3 / plan spike-01 不通过后果）。
- **R-06（codex adapter 跨 turn 持有）**：JsonRpcAdapter 是有状态 adapter（pendingMap / streamedAgentMessageIds / agentMessageBuf），**sessionStore 持有同一 adapter 实例跨 turn**，不复用工厂 `getBackend(provider)` new（task-runner.ts:350 每次 runLease 都 new 一个新实例，session 模式必须打破此模式）。resetAccumulator 不在 turn 间调（保留跨 turn 状态），仅在 create 时调一次。
- **R-07（并发）**：复用现有 `_inflightLeases` 并发池上限（daemon.ts:649 `max_concurrent_tasks`）。interactive lease 在 sessionStore.end 前不从 `_inflightLeases` 移除（保持占用配额，防止单 daemon 开无限会话）。需在 daemon.ts:657-662 `_executeTask` 调整：interactive lease 在 end 后才 delete（batch lease 在 runLease 完成后 delete，现状）。
- **测试用 vitest 非 pytest**：daemon 是 TypeScript 项目（package.json scripts.test='vitest run'）。CONVENTIONS.md / local.yaml / scan 文档标的 Python（pip/pytest）已过时，本任务测试全部走 `cd sillyhub-daemon && pnpm test`，全局验收标准 AC-8 同此。
- **stdin 写入失败处理**：session 模式 stdin 长时间保持开放，agent 可能已退出但 stdin 未 destroyed（race）。inject 前 sessionStore 先校验 `!child.killed && !child.stdin.destroyed`，否则抛 SessionNotActiveError（对齐 ws-client R-02 对策）。
- **不实现的边界（推后到 task-06+）**：
  - 空闲 30min 自动回收（task-06，本任务仅留 lastActiveAt 字段）。
  - 崩溃恢复 resume（Wave 3 task-09）。
  - 权限暂停往返（Wave 2 task-07/08）。
  - session 级 SSE 聚合（task-05）。

## 8. 验收对照

| AC | 验证手段 | 对应 design 章节 |
|---|---|---|
| AC-1 ~ AC-7 | vitest 单测 + spike-01 端到端 | §5 Wave1 / §7.3 SessionStore API |
| AC-8 | 现有 task-runner.test.ts / daemon.test.ts 零改动通过 | §9 兼容策略 |
| AC-9 | daemon-kind-dispatch.test.ts | §5 Wave1 / D-002 |
| AC-10 | ws-client-control-route.test.ts | §7.1 WS 控制消息 |

全局验收：`cd sillyhub-daemon && pnpm test` 通过（vitest），`pnpm typecheck` 通过（tsc --noEmit）。
