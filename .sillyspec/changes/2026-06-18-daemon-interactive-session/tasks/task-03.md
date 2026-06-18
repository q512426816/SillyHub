---
author: qinyi
created_at: 2026-06-18 15:31:03
change: 2026-06-18-daemon-interactive-session
id: task-03
title: "daemon session 元数据与每 turn spawn + resume 执行链路"
wave: W3
priority: P0
depends_on: [task-02]
blocks: [task-06, task-08, task-09]
requirement_ids: [FR-01, FR-02, FR-04, FR-05, FR-09]
decision_ids: [D-002@v2]
allowed_paths:
  - sillyhub-daemon/src/session-store.ts
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/adapters/protocol-adapter.ts
  - sillyhub-daemon/src/adapters/json-rpc.ts
  - sillyhub-daemon/src/ws-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/session-store.test.ts
  - sillyhub-daemon/tests/task-runner-turn.test.ts
  - sillyhub-daemon/tests/adapters/json-rpc.test.ts
  - sillyhub-daemon/tests/ws-client-control-route.test.ts
  - sillyhub-daemon/tests/daemon-kind-dispatch.test.ts
---

# daemon session 元数据与每 turn spawn + resume 执行链路

## 1. 目标与硬约束

依据 `design.md`、`decisions.md` 的 **D-002@v2** 和 `plan.md` Wave 3，本任务把 daemon 的交互式会话实现为：

- `AgentSession` 与 interactive lease 长生命周期存在；
- 每个 turn 对应一个 `AgentRun`，并调用一次独立的 agent 子进程；
- 首 turn 普通启动；后续 turn 使用首 turn 返回的 agent 内部会话标识恢复上下文；
- Claude 后续 turn 使用现有 `StreamJsonAdapter.buildArgs({ resumeSessionId })` 生成 `--resume <session_id>`；
- Codex 后续 turn 在新 app-server 进程完成 initialize 后调用 `thread/resume { threadId }`，再调用 `turn/start`；
- 每个 turn 收到 Claude `result` 或 Codex `turn/completed` 后沿用现有逻辑关闭 stdin、等待进程退出并释放 child；
- `SessionStore` **只保存会话元数据和当前 turn 标识**，不得保存跨 turn 的 `ChildProcess`、stdin、readline 或 adapter 实例。

本任务明确废弃旧蓝图中的“result 后保持 stdin 开放”“同一 child 注入第二条消息”“SessionStore 持有 child/stdin/adapter”方案。spike-01 未提供该方案的端到端证据，禁止实现或保留兼容分支。

## 覆盖来源

| 来源 | 要求/决策 | 本任务落实 |
|---|---|---|
| `plan.md` task-03 | Wave 3 daemon turn runner，覆盖 FR-01、FR-02、FR-04、FR-05、FR-09 / D-002@v2 | 建立 daemon 内存 session 元数据与每 turn spawn + resume 执行链路 |
| FR-01 / FR-02 | 首 turn 与追问各自对应独立 AgentRun；追问延续同一会话上下文 | `startTurn` 每次接收新 runId；首轮普通启动，后续使用 agentSessionId resume |
| FR-04 / FR-05 | interrupt 只结束当前 turn；end 才结束 session | `interrupt` 仅 cancel 当前 runner，`end` 标记 ended 并删除内存元数据 |
| FR-09 | batch lease 行为不变 | kind 缺省仍走现有 `runLease → completeLease`，不进入 SessionStore |
| D-002@v2 | session/lease 长生命周期，每 turn 独立 spawn + resume，禁止跨 turn child/stdin | SessionStore 仅持有元数据；Claude `--resume`，Codex `thread/resume` |

## 2. 当前源码依据

实现前必须再次用 `rg` 确认以下真实接口仍存在；若源码已变化，先更新本任务文档再写代码，不得按旧行号臆造：

| 事实 | 当前源码锚点 | 本任务使用方式 |
|---|---|---|
| 单次执行入口 | `sillyhub-daemon/src/task-runner.ts`：`TaskRunner.runLease(ctx)` | 抽取可复用的 turn 执行核心，新增 `runTurn`；不建立长驻模式 |
| 子进程终结 | `_handleLine` 对 `_looksLikeResult` / `_looksLikeTurnCompleted` 调 `child.stdin.end()` | 保持不变；它是每 turn 释放进程的必要条件 |
| Claude resume | `src/adapters/stream-json.ts`：`buildArgs` 已支持 `resumeSessionId` → `--resume` | 后续 Claude turn 直接复用 |
| Codex 首次启动 | `src/adapters/json-rpc.ts`：`buildHandshake` 发 initialize、initialized、`thread/start` | 首 turn 保持该序列 |
| Codex turn 启动 | `JsonRpcAdapter.buildTurnStart({ threadId, prompt, model })` | `thread/start` 或 `thread/resume` 的 id=2 response 后均调用 |
| Codex 恢复协议 | 当前 Codex app-server schema：`thread/resume` 参数至少含 `{ threadId }`，response 含 `thread.id` | 后续 turn 将握手第三条由 `thread/start` 切为 `thread/resume` |
| turn 取消 | `TaskRunner.cancel(leaseId)` → AbortController → 当前 child SIGTERM/SIGKILL | SessionStore interrupt 仅调用当前 turn 的 cancel |
| WS 分发 | `src/ws-client.ts`：`WsClientCallbacks.onMessage` + `_handleMessage` | 新增独立 `onControlMessage`，只识别 SESSION_* |
| lease 状态机 | `src/daemon.ts`：`_runLeaseStateMachine` 构造 `LeaseCtx` 后调用 `runLease` 并 complete | interactive 分支注册 session + 启动首 turn，但不在 turn 完成时 complete lease |

扫描文档仍描述旧 Python daemon，执行时以当前 TypeScript 源码和模块卡为准。

## 3. 修改文件（必填）

| 操作 | 文件 | 责任 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/session-store.ts` | 会话元数据、单 turn 并发门、turn 调度、interrupt/end |
| 修改 | `sillyhub-daemon/src/types.ts` | `LeaseCtx` 增加 `kind`、`agentSessionId`；声明 session/turn 类型（若 task-01/02 已加则复用） |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | 新增每次必定 spawn/exit 的 `runTurn`；透传 Codex resume 参数 |
| 修改 | `sillyhub-daemon/src/adapters/protocol-adapter.ts` | `buildHandshake` opts 增加 `resumeSessionId?: string` |
| 修改 | `sillyhub-daemon/src/adapters/json-rpc.ts` | 首 turn `thread/start`、后续 turn `thread/resume` |
| 修改 | `sillyhub-daemon/src/ws-client.ts` | SESSION_INJECT/INTERRUPT/END 独立控制回调 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | interactive kind 分流、SessionStore 注入、控制消息路由 |
| 新增 | `sillyhub-daemon/tests/session-store.test.ts` | 元数据、串行化、interrupt/end 单测 |
| 新增 | `sillyhub-daemon/tests/task-runner-turn.test.ts` | 每 turn 新 spawn、Claude/Codex resume 单测 |
| 修改 | `sillyhub-daemon/tests/adapters/json-rpc.test.ts` | `thread/resume` 握手契约测试 |
| 修改/新增 | `sillyhub-daemon/tests/ws-client-control-route.test.ts`、`daemon-kind-dispatch.test.ts` | 控制消息与 kind 分流测试 |

不修改 backend、frontend、SSE、permission 业务；分别由 task-04、task-05、task-07/08、task-10/11 负责。

## 4. 实现要求与精确接口

### 4.1 SessionStore：只持有元数据

```typescript
export type SessionStatus =
  | 'active'
  | 'running'
  | 'interrupting'
  | 'ended'
  | 'failed';

export interface SessionState {
  sessionId: string;                 // AgentSession.id
  leaseId: string;                   // 长生命周期 interactive lease.id
  provider: 'claude' | 'codex';
  agentSessionId?: string;           // Claude session_id / Codex thread_id
  status: SessionStatus;
  currentRunId?: string;
  turnCount: number;
  lastActiveAt: number;
  config: Record<string, unknown>;
  baseCtx: LeaseCtx;                 // claimToken/cmd/workspace/model 等不可变执行上下文
}

export interface StartTurnInput {
  runId: string;
  prompt: string;
}

export interface TurnRunner {
  runTurn(ctx: LeaseCtx): Promise<TaskRunnerResult>;
  cancel(leaseId: string): Promise<boolean>;
}

export class SessionStore {
  constructor(private readonly runner: TurnRunner) {}

  create(input: {
    sessionId: string;
    leaseId: string;
    provider: 'claude' | 'codex';
    baseCtx: LeaseCtx;
    config?: Record<string, unknown>;
  }): SessionState;

  get(sessionId: string): Readonly<SessionState> | undefined;
  startTurn(sessionId: string, input: StartTurnInput): Promise<TaskRunnerResult>;
  interrupt(sessionId: string): Promise<boolean>;
  end(sessionId: string): Promise<boolean>;
  fail(sessionId: string): void;
}
```

实现语义：

1. `create` 要求 sessionId、leaseId 唯一；重复注册抛明确错误，初始状态 `active`。
2. `startTurn` 仅允许 `active` 状态；原子地写入 `running/currentRunId` 后再启动异步执行，阻止两个 inject 同时通过检查。
3. turn ctx 必须由 `baseCtx` 派生，并覆盖：
   ```typescript
   {
     ...state.baseCtx,
     agentRunId: input.runId,
     prompt: input.prompt,
     resumeSessionId: state.turnCount === 0 ? undefined : state.agentSessionId,
   }
   ```
4. `runner.runTurn` resolve 后，从 `result.sessionId`（或已存在的规范化 metadata session_id）更新 `agentSessionId`。首 turn 若成功但没有得到 agentSessionId，session 标 `failed`，禁止静默启动无上下文的第二 turn。
5. 正常完成后清空 `currentRunId`、`turnCount += 1`、状态回 `active`；若 `end` 已把状态置 `ended`，finally 不得把它改回 active。
6. `interrupt` 仅在 `running` 时置 `interrupting` 并调用 `runner.cancel(leaseId)`；当前 turn 收敛后状态回 `active`，保留 `agentSessionId`，后续可 resume 新 spawn。
7. `end` 先置 `ended`；若当前 turn 在跑则调用 `cancel`，但不等待或复用旧 child；最终从 Map 删除。interactive lease 与 backend session 的数据库收尾由 task-04 的 `end_session` 统一负责。
8. state 中禁止出现 `child`、`stdin`、`adapter`、`readline`、`WritableStream` 字段。

### 4.2 TaskRunner.runTurn：进程边界就是 turn 边界

```typescript
interface InteractiveTurnOptions {
  /** interactive lease 已由 daemon claim/start；turn 不重复 start/complete lease。 */
  manageLeaseLifecycle: false;
  /** resume turn 禁止清空 resumeSessionId 后降级为新会话。 */
  retrySpawn: false;
}

class TaskRunner {
  runLease(ctx: LeaseCtx): Promise<TaskRunnerResult>; // batch 行为不变
  runTurn(ctx: LeaseCtx): Promise<TaskRunnerResult>;  // 新增
}
```

`runTurn` 与 `runLease` 共享 workspace、CLAUDE.md、env、adapter、spawn/parse/submit、diff/spec-sync 和 `_finish` 逻辑，但必须满足：

- 不调用 `client.startLease`、不 complete lease；daemon 已在创建 interactive session 时 claim/start，lease 跨 turn 存活；
- 不启动现有 lease heartbeat（interactive lease `lease_expires_at=NULL`）；
- 每次调用都 `getBackend(provider)` 创建全新 adapter，并 `spawn` 全新子进程；
- 保留 `_handleLine` 的 `result` / `turn/completed` → `stdin.end()` 逻辑；不得增加 session mode；
- 等待 child exit 后才 resolve，确保下一 turn 启动前旧进程已释放；
- resumed turn 禁用现有“重试时清空 resumeSessionId”的降级行为。第一版直接令 `runTurn` 的 spawn retry 为 0；否则必须能证明重试仍携带相同 resume id 且不会重复业务副作用；
- `cancel(leaseId)` 只命中当前 runTurn 的 AbortController；顺序 turn 复用 leaseId 是安全的，因为 SessionStore 保证同一 session 同时最多一个 turn。

建议把 `runLease` 主体抽为私有 `_run(ctx, { manageLeaseLifecycle, retrySpawn })`，避免复制 9 步流程。batch 调 `_run(..., {true,true})`，interactive turn 调 `_run(..., {false,false})`。

### 4.3 Claude resume

无需新增协议：

- 首 turn：`ctx.resumeSessionId === undefined`，spawn args 不含 `--resume`；
- 首 turn 的 `system/result.session_id` 经现有 `onSessionId` 进入 `TaskRunnerResult.sessionId`；
- 后续 turn：SessionStore 把该值写到 `ctx.resumeSessionId`；
- `StreamJsonAdapter.buildArgs` 生成 `--resume <id>`；仍由 `buildInput(prompt)` 写本 turn prompt；
- 每轮 result 后 stdin.end，child exit，不能把 stdin 留到下一轮。

### 4.4 Codex thread resume

扩展真实接口：

```typescript
// protocol-adapter.ts
buildHandshake?(opts: {
  cwd: string;
  prompt: string;
  model?: string;
  resumeSessionId?: string;
}): string[];
```

`JsonRpcAdapter.buildHandshake` 的前两条始终为 initialize request 和 `notifications/initialized`；第三条按是否有 resume id 分支：

```typescript
const threadRequest = opts.resumeSessionId
  ? {
      jsonrpc: '2.0', id: 2,
      method: 'thread/resume',
      params: { threadId: opts.resumeSessionId },
    }
  : {
      jsonrpc: '2.0', id: 2,
      method: 'thread/start',
      params: { cwd: opts.cwd },
    };
```

TaskRunner 调 `buildHandshake` 时必须透传 `ctx.resumeSessionId`。现有 `_handleLine` 已按 `id === 2 && result.thread.id` 触发 `buildTurnStart`，应把注释和测试改成“thread/start 或 thread/resume response”，不要写死仅 thread/start。resume response 返回的 thread id 必须写入 `TaskRunnerResult.sessionId`，并继续用该 id 发 `turn/start({ threadId, input:[...] })`。

严禁把 Codex 后续 turn 简化为“新进程直接发 turn/start”：新 app-server 进程必须先 initialize + thread/resume，才能在恢复的 thread 上开始 turn。

### 4.5 daemon / ws-client 路由

`WsClientCallbacks` 增加可选回调：

```typescript
onControlMessage?: (msg: DaemonMessage) => void;
```

`_handleMessage` 在 RPC 分支之后识别 `MSG.SESSION_INJECT`、`MSG.SESSION_INTERRUPT`、`MSG.SESSION_END`，调用 `onControlMessage` 并 return；其它消息继续走 `onMessage`，不得破坏 TASK_AVAILABLE/RPC。

daemon 处理规则：

- claim payload 的 `kind`、`agent_session_id`（兼容 camel/snake case）必须进入 `LeaseCtx`；默认 kind=`batch`；
- batch：保持 `runLease → completeLease` 原路径；
- interactive 首次 task_available：claim/start 后 `sessionStore.create(...)`，再 `startTurn(sessionId, {runId:firstRunId,prompt})`；turn 完成不 complete lease；
- SESSION_INJECT：校验 payload 的 session_id/lease_id 与 store 一致，再 `startTurn`；不得向旧 stdin 写入；
- SESSION_INTERRUPT：校验 session/lease 后调用 `interrupt`；
- SESSION_END：校验 session/lease 后调用 `end`；不在 daemon 另写数据库状态机；
- interactive session 注册需独立于 `_inflightLeases` 的“当前异步任务”集合，避免首 turn resolve 后重复 task_available 再次 create；可新增 `_interactiveSessionsByLease` 索引，end/fail 时清理。

## 5. 边界条件（至少全部覆盖）

1. **并发 inject**：状态从 active 原子切 running；第二个请求在第一个 turn resolve 前返回 `SessionTurnConflictError`，spawn 只发生一次。
2. **首 turn 无 resume id**：成功结果未提供 Claude session_id/Codex thread_id 时 session 标 failed，第二 turn 不得退化为新上下文。
3. **resume id 不存在**：后续 turn 在 `agentSessionId` 为空时拒绝执行，不能启动普通 spawn。
4. **interrupt 空闲 session**：无 currentRun 时返回 false/no-op，不改变 active，不误杀后续进程。
5. **interrupt 与 turn 完成竞态**：cancel 返回 false 或 turn 已 resolve 均视为幂等；finally 只能在非 ended/failed 时回 active。
6. **end 与 turn 完成竞态**：end 先置 ended；迟到的 runTurn resolve/reject 不能复活 session；Map 最终删除。
7. **WS lease_id 不匹配**：控制消息 session_id 存在但 lease_id 不同必须拒绝并记录结构化 warn，不能操作该 session。
8. **Codex resume 失败**：`thread/resume` 返回 JSON-RPC error 或无 `result.thread.id`，turn 失败且 session 保留明确 failed 状态，不得自动 `thread/start` 新 thread。
9. **Claude `--resume` spawn 失败**：不得清除 resumeSessionId 后重试为新会话；本 turn failed，旧 agentSessionId 保留供显式重试策略后续处理。
10. **batch 兼容**：kind 缺失/未知一律按 batch 或明确拒绝未知值；不得让现有 workspace AgentRun 进入 SessionStore。
11. **不同 session 并发**：可并行 spawn；同一 session 严格串行，不能用全局锁把所有 session 串行化。
12. **进程资源释放**：每轮测试都断言 child exit 后 stdin destroyed/ended，SessionStore state 不包含 child/stdin 引用。

## 6. TDD 实施顺序

严格按“测试先失败 → 最小实现 → 重构 → 全量回归”执行：

### Step 1：JsonRpcAdapter resume 契约测试

先在 `tests/adapters/json-rpc.test.ts` 增加：

- 无 resumeSessionId：第三条仍为 `thread/start`，params.cwd 正确；
- 有 resumeSessionId：第三条为 `thread/resume`，params 严格为 `{threadId}`；
- 两种 response 的 id=2 都能触发后续 `turn/start`；
- `turn/start.params.threadId` 与 resume response 的 `result.thread.id` 相同。

测试红后修改 `protocol-adapter.ts`、`json-rpc.ts` 和 TaskRunner handshake 透传。

### Step 2：TaskRunner 每 turn 新进程测试

用现有 `tests/helpers/fake-child.ts` 和 spawn mock：

- 连续调用两次 `runTurn`，spawn 调用次数为 2，两个 FakeChild 对象不同；
- Claude 首 turn args 不含 `--resume`，第二 turn args 含 `--resume sess-1`；
- Codex 首 turn handshake 为 thread/start，第二 turn为 thread/resume，且两轮各自收到完成事件后 stdin.end、进程 exit；
- `runTurn` 不调用 startLease/completeLease/leaseHeartbeat；
- resumed turn 的 spawn failure 不触发无 resume id 的第二次 spawn。

测试红后抽取 `_run` 实现 `runTurn`，不改 `_handleLine` 的终结语义。

### Step 3：SessionStore 单测

注入 fake `TurnRunner`，覆盖：create/get、首 turn、resume ctx 派生、agentSessionId 更新、并发冲突、interrupt、end 竞态、failed、跨 session 并发，并用对象 key 断言 state 不含进程/流字段。

### Step 4：ws-client 与 daemon 分流测试

- SESSION_* 只触发 onControlMessage，不触发 onMessage；TASK_AVAILABLE/RPC 原路不变；
- kind=batch 调 runLease + completeLease；
- kind=interactive 调 create/startTurn，首 turn完成不 completeLease；
- inject 创建新 runTurn，prompt/runId 准确，lease 不匹配被拒绝；
- interrupt/end 分别只调用 SessionStore 对应方法；
- 同一 interactive task_available 重放不重复 create/spawn。

### Step 5：回归

```powershell
Set-Location sillyhub-daemon
pnpm test -- json-rpc
pnpm test -- task-runner-turn
pnpm test -- session-store
pnpm test -- ws-client-control-route daemon-kind-dispatch
pnpm typecheck
pnpm test
```

## 7. 表格验收标准

| AC | 验收场景 | 可观察证据 | 状态 |
|---|---|---|---|
| AC-01 | Claude 首 turn 普通 spawn，第二 turn resume | 首轮结果 session_id 写入 SessionStore；第二轮 args 含同一 id 的 `--resume`；两轮 FakeChild/PID 不同 | [ ] |
| AC-02 | Codex 首 turn 与后续 turn | 首轮握手为 `thread/start`；第二轮新进程为 `thread/resume {threadId}` 后 `turn/start`；thread id 不变 | [ ] |
| AC-03 | turn 结束释放进程 | 每个 `result`/`turn/completed` 均关闭 stdin 并等待 child exit；SessionStore 无 child/stdin/adapter 字段 | [ ] |
| AC-04 | 同 session 并发 inject | 同一 session 最多一个 running turn；两个并发请求只 spawn 一次，另一个得到明确 conflict | [ ] |
| AC-05 | interrupt 当前 turn | 只取消 currentRun；完成收敛后 session 回 active、agentSessionId 保留，后续可 resume 新 spawn | [ ] |
| AC-06 | end 与完成竞态 | end 可取消 currentRun 并删除内存 session；迟到的 turn resolve/reject 不复活 session | [ ] |
| AC-07 | interactive lease 生命周期 | 首 turn和后续 turn完成均不调用 completeLease；数据库结束留给 backend `end_session` | [ ] |
| AC-08 | WS 控制消息鉴权路由 | inject/interrupt/end 路由正确；session_id/lease_id 不匹配时无任何 session 操作 | [ ] |
| AC-09 | batch 回归 | kind=batch/缺省仍执行现有 runLease、retry、heartbeat、completeLease；原测试通过 | [ ] |
| AC-10 | resume 失败闭合 | Claude/Codex resume 失败不会降级为无 resume 新会话；错误可观察，session 状态为 failed | [ ] |
| AC-11 | daemon 验证 | `pnpm typecheck` 与 daemon 全量 `pnpm test` 退出码为 0 | [ ] |

## 8. 非目标与后续接口

- 不做 session 级 Redis/SSE 聚合（task-05）。
- 不做 30 分钟 idle 回收和跨 daemon 生命周期联调（task-06；本任务只保留 `lastActiveAt`）。
- 不做 permission 暂停/批准（task-07、task-08）。
- 不做磁盘持久化或 daemon 重启恢复（task-09）；本任务内存 state 丢失时不得尝试恢复旧进程。
- 不做前端（task-10、task-11）。
- 不扩展 Claude/Codex 以外 provider；interactive session 收到其它 provider 应明确拒绝，batch 仍支持原 provider 集。

## 9. 实现检查清单

- [ ] 写代码前确认 `.claude/CLAUDE.md` 未变化，并重新读取 daemon CONVENTIONS/ARCHITECTURE；扫描文档与 TS 源码冲突时以源码为准并记录。
- [ ] 用 `rg` 确认所有调用的方法真实存在，尤其 `runLease`、`cancel`、`buildHandshake`、`buildTurnStart`。
- [ ] 测试先行，至少观察一次目标测试按预期失败。
- [ ] 未引入跨 turn child/stdin/session mode。
- [ ] 未复制一份完整 runLease；共享核心由私有方法承载。
- [ ] batch 测试无语义修改。
- [ ] 对照 AC-01～AC-11 验收并记录命令结果。
