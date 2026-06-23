---
author: qinyi
created_at: 2026-06-24 00:13:45
id: task-04
title: 实现 CodexAppServerDriver 核心生命周期、flat message 日志与 interrupt
priority: P0
estimated_hours: 14
depends_on: [task-02, task-03]
blocks: [task-05, task-06]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/src/adapters/json-rpc.ts
  - sillyhub-daemon/tests/**
---

# task-04: 实现 CodexAppServerDriver 核心生命周期、flat message 日志与 interrupt

本任务实现 Codex provider 的 `InteractiveDriver`（design §5.3 八点职责），把 Codex app-server
stdio JSON-RPC 长驻进程接入 `SessionManager` 的 provider-neutral driver 抽象（task-01/02 已提供契约
与 `SessionManager` 路由）。本任务**只做核心生命周期 + flat message 日志 + interrupt**，不做审批与
`requestUserInput` 映射（留 task-05），不改 daemon 接入（留 task-06）。

依据文档：
- design.md §4.1（文件清单）、§5.1（driver 契约）、§5.3（八点职责）、§6（生命周期契约表）、§7（错误处理）
- requirements.md FR-01~FR-05
- plan.md task-04（Wave3，blocks task-05/task-06）
- decisions D-001@v1（provider driver registry）、D-002@v1（Codex app-server protocol）、
  D-003@v1（复用 backend session 控制面）、D-004@v1（flat message 日志契约）

## 修改文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `sillyhub-daemon/src/interactive/codex-app-server-driver.ts` | 新增 | `CodexAppServerDriver` 实现 `InteractiveDriver`；spawn app-server、握手、多轮串行、turn/started 捕获 turnId、interrupt、flat message 映射、turn result、close |
| `sillyhub-daemon/src/adapters/json-rpc.ts` | 修改（抽取复用函数） | 把 `buildHandshake` / `buildTurnStart` / `parse` 的纯解析能力抽成可被 driver 复用的纯函数或 exported 方法（保持 batch TaskRunner 行为不变，仅扩大可复用面）。若 `JsonRpcAdapter` 已可直接复用则不改源码，driver 内 `new JsonRpcAdapter('codex')` 复用 |
| `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts` | 新增 | fake child/stdin/stdout 覆盖握手、thread/start、turn/start、turn/started→turnId、turn/completed、turn/interrupt、close、stderr 上报 |

> json-rpc.ts 改动必须保证 batch `TaskRunner` 既有测试（`tests/adapters/json-rpc.*`、`tests/task-runner.*`）不回归——优先"driver 内组合调用 JsonRpcAdapter 现有方法"，源码改动仅限把 private 方法/常量 export 或抽纯函数。

## 覆盖来源

| FR/决策 | 本任务实现点 |
| --- | --- |
| FR-01 Codex 创建 interactive session | spawn `codex app-server --listen stdio://` + `initialize`→`notifications/initialized`→`thread/start` 握手；threadId 写入 `session_id` |
| FR-02 同 session 多轮 | 按 input queue 串行消费，每条 `UserTurnInput` → `turn/start`，收到 `turn/completed` 后才取下一条，禁止并发 turn |
| FR-03 运行中 interrupt | 监听 `turn/started` 保存当前 turnId；`interrupt()` 发 `turn/interrupt({threadId, turnId})`；无 turn 返回 false |
| FR-04 输出进日志与 SSE | app-server notification → flat message（`event_type`+`content`+`metadata`+`session_id=threadId`）→ `onTurnMessage` |
| FR-05 end 与历史回看 | `close()` 关 stdin + kill child；input queue 关闭/end 触发收敛 |
| D-001@v1 | 实现并注册 `InteractiveDriver`（`provider: 'codex'`） |
| D-002@v1 | 复用已验证的 Codex app-server JSON-RPC 解析（json-rpc.ts），不重发明协议 |
| D-003@v1 | driver 只产 flat message，不把 app-server schema 泄漏给 backend；backend 用同一 `AgentSession`/`AgentRun`/lease 控制面 |
| D-004@v1 | flat message 契约精确：`{event_type, content, metadata, session_id=threadId}`，4 类事件 `{text, tool_use, tool_result, error}` |

## 实现要求（design §5.3 八点职责）

本任务覆盖第 1、2、3、4、6、7、8 点；**第 5 点（审批与 requestUserInput）整体留 task-05**，但
driver 需为 task-05 预留 server request 处理钩子（见"非目标"）。

### 1. spawn Codex（D-001 / D-002）

- executable path 来自 `InteractiveDriverStartOptions`（由 daemon `_startInteractiveSession` 注入
  `this._agentPaths.get("codex")`，task-06 负责；本任务从 options 读取，不自己查 path）。
- args 固定 `['app-server', '--listen', 'stdio://']`（直接复用 `JsonRpcAdapter('codex').buildArgs()`）。
- env 复用 `InteractiveDriverStartOptions.env`（daemon 用 `buildSpawnEnv(ctx, {credential})` 构造，
  与 batch 路径一致；本任务不自己构造 env，缺省回退 `{...process.env}`）。
- spawn 选项：`{ cwd: opts.cwd, env, stdio: ['pipe','pipe','pipe'] }`；Windows `.cmd` wrapper 参考
  task-runner.ts `resolveWindowsCmdShim`（若已 export 则复用，否则 driver 内做等价解析；codex 多为
  npm wrapper，不处理会 EINVAL）。
- spawn 失败（`'error'` 事件 ENOENT/EINVAL）→ 抛 `CodexExecutableNotFoundError`（code =
  `CODEX_EXECUTABLE_NOT_FOUND`），或经 `onError` 回调上报 error flat message + `onTurnResult` 以
  `is_error=true` 收敛，不吞错。

### 2. 建立 app-server 会话（新建 / 恢复）

- **新建**（`options.resume` 缺省）：按序写 stdin
  `initialize`(id=1) → `notifications/initialized` → `thread/start`(id=2)；
  收到 id=2 response 提取 `result.thread.id` 存为 threadId；
  首轮 prompt 立即 `turn/start`(id=3)。
- **恢复**（`options.resume` 非空，由 SessionManager `restoreAndReconnect` 传入，task-02/06 负责）：
  `initialize` → `notifications/initialized` → `thread/resume`(id=2, params=`{threadId: options.resume}`)；
  收到 id=2 response（确认 resumed）后**不发首轮 turn/start**，等 input queue 下一条 `inject` 再 turn。
- 握手每条之间 `await new Promise(r=>setTimeout(r,300))`（对齐 task-runner.ts:835 实测稳定值，codex.cmd
  包装层 100ms 间隔会丢 stdin）。
- `initialize.params.clientInfo = {name:'sillyhub-daemon', version: DAEMON_VERSION}`（不是 `client`，
  否则 -32600）；`thread/start.params.cwd = opts.cwd`（字段名严格按 schema）。

### 3. 多轮串行（FR-02）

- `consume()` 内 `for await (const turn of input)` 串行消费 `UserTurnInput`。
- 每次**只允许一个 running turn**：发 `turn/start` 后阻塞，直到收到本轮 `turn/completed` 才 `await`
  取下一条 `UserTurnInput`；禁止在 app-server 内并发 turn（design §5.3.3）。
- 每条 `UserTurnInput.text` → `turn/start.params.input = [{type:'text', text}]`（codex 0.131+ 实测，
  旧 `instructions` 字段被拒 -32600，见 json-rpc.ts:205 注释）。

### 4. interrupt（FR-03）

- 监听 `turn/started` notification，保存 `params.turnId` 与 `params.threadId` 到当前 handle state
  （`currentTurnId` / `currentThreadId`）。
- `interrupt(handle)`：
  - 若 `currentTurnId == null`（无 running turn）→ 返回 `false`，不发 JSON-RPC。
  - 否则写 stdin `turn/interrupt` request：`{jsonrpc:'2.0', id:<nextId>, method:'turn/interrupt',
    params:{threadId: currentThreadId, turnId: currentTurnId}}`，返回 `true`。
  - interrupt 后不主动 close；等 `turn/completed`(status=cancelled/failed/interrupted) 自然收敛本轮，
    清空 `currentTurnId`，session 保持可继续 inject。
- `interrupt(handle=null)` 或 turnId 缺失 → `false`（no-op，不向上冒泡）。

### 6. 消息映射 → flat message（FR-04 / D-004，本任务核心）

- 用 `JsonRpcAdapter('codex')` 的 `parse(line)` 把每行 stdout JSON-RPC 解析为 `AgentEvent[]`
  （已实现 text/tool_use/tool_result/error/complete 五类收敛，见 json-rpc.ts）。
- 每个 `AgentEvent` 转成 flat message 交给 `callbacks.onTurnMessage`：

```ts
// D-004 flat message 契约（精确，禁止改字段名）
{
  event_type: ev.type,                    // 'text' | 'tool_use' | 'tool_result' | 'error'
  content: ev.content,                    // string，空串表示无文本
  metadata: ev.metadata ?? {},            // 透传 tool_name/call_id/status/usage/source...
  session_id: threadId,                   // = Codex thread id，始终带上
}
```

- `event_type='complete'` 不作为日志 message 上报（它是 turn 边界信号，由第 7 点 turn result 处理）。
- `turn/started` notification（json-rpc.ts 收敛为 `text+metadata.status:'running'`）照常作为 flat
  message 上报，让前端看到"思考中"状态（与 Claude Code streaming 体验一致）。
- `thread/start` response 的 `result.thread.id`：除了存为 threadId，**额外发一条**
  `event_type:'text'` / `metadata.subtype:'thread_started'` / `session_id:threadId` 的 flat message，
  让 backend 把 `AgentSession.agent_session_id` 对齐到 thread id（design §5.3.6 末段）。

### 7. turn result（FR-02 / FR-03 收敛）

- `turn/completed` notification：
  - `turn.status === 'completed'` → `callbacks.onTurnResult({ subtype:'success', is_error:false })`，
    可解析 `turn.usage` 时透传 `usage:{input_tokens,output_tokens}` + `total_cost_usd`（不强依赖）。
  - `turn.status === 'failed'` → `onTurnResult({ subtype:'error_during_execution', is_error:true,
    result: turn.error?.message })`。
  - `turn.status === 'cancelled'` / interrupted → `onTurnResult({ subtype:'error_during_execution',
    is_error:true, result:'interrupted' })`（与 Claude interrupt 后 result 同语义，见
    claude-sdk-driver.ts:263 spike D1）。
- 进程异常退出（child `exit` code≠0 且未正常 close）→ `onTurnResult({ subtype:
  'error_during_execution', is_error:true, result:\`codex exited code=${code}\` })`。
- 清空 `currentTurnId`，让下一轮 inject 可消费。

### 8. 生命周期 close（FR-05）

- `handle.close()`：
  1. 设 `closing=true` 标志，拒绝后续 turn/start 写入。
  2. 关闭 stdin（`child.stdin.end()`），让 codex app-server 优雅退出。
  3. 设 kill 定时器（2s SIGTERM→SIGKILL 升级，对齐 task-runner.ts KILL_GRACE_MS）。
  4. `child.kill()` 兜底；移除所有 listener 防内存泄漏。
- input queue 关闭（`for await` 自然结束）→ 等价触发 close 收敛。
- stderr：累积按行作为 `event_type:'error'` flat message 上报（`metadata.level:'stderr'`），避免静默
  失败（design §5.3.8 / §7.3）。

### 预留：server request（为 task-05）

- 收到 server request（json-rpc.ts `parseServerRequest` 产出 `tool_use`+`metadata.kind:'approval'` 或
  `error`+`kind:'unhandled_server_request'`）时，本任务**先记录到 handle 的 `pendingServerRequests`
  队列并上报一条 flat message（让前端能看到）**，但**不实现审批/用户输入应答逻辑**——task-05 接入
  `PermissionResolver` / backend dialog。
- 为防 task-04 阶段 Codex turn 卡死：对已知 approval method（`APPROVAL_RESPONSES` 的 5 项）本任务**不**
  自动 accept（违反 D-006 parity，design §10 风险表"自动接受权限破坏 Claude parity"）。临时策略：
  上报 error flat message `codex approval handling pending (task-05)` 并按 fail-closed 写回
  `{decision:'decline'}`/`{action:'cancel'}` 让 turn 失败收敛（不挂死）。**此临时 fail-closed 必须在
  task-05 移除**，task-05 实现真实审批映射。

## 接口定义

### InteractiveDriver 契约（task-01 已建，driver.ts；本任务实现该接口）

```ts
// 来自 task-01 driver.ts（driver 实现方照此签名）
export interface UserTurnInput { type: 'user'; text: string }
export type InteractiveDriverMessage = Record<string, unknown>;
export interface InteractiveDriverResult {
  subtype?: string; is_error?: boolean; result?: unknown;
  total_cost_usd?: number; num_turns?: number;
  duration_ms?: number; duration_api_ms?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}
export interface InteractiveDriverHandle {
  readonly provider: 'claude' | 'codex';
  readonly processId?: number;
  close?(): Promise<void> | void;
}
export interface InteractiveDriverCallbacks {
  onTurnMessage(msg: InteractiveDriverMessage): void | Promise<void>;
  onTurnResult(result: InteractiveDriverResult): void | Promise<void>;
  onSessionId?(threadId: string): void | Promise<void>;  // thread/start 后回传
  onError?(err: unknown): void | Promise<void>;
}
export interface InteractiveDriverStartOptions {
  provider: 'codex';
  cwd: string;
  env?: Record<string, string> | NodeJS.ProcessEnv;
  pathToAgentExecutable: string;   // daemon 注入 _agentPaths.get('codex')
  model?: string;
  resume?: string;                  // 非空 → thread/resume 路径
}
export interface InteractiveDriver {
  start(input: AsyncIterable<UserTurnInput>, options: InteractiveDriverStartOptions): Promise<InteractiveDriverHandle>;
  consume(handle: InteractiveDriverHandle, callbacks: InteractiveDriverCallbacks): Promise<void>;
  interrupt(handle: InteractiveDriverHandle | null): Promise<boolean>;
}
```

### JSON-RPC 方法请求/响应结构（精确，字段名严格按 schema）

| 方法 | 方向 | params（请求） | result（响应） |
| --- | --- | --- | --- |
| `initialize` (id=1) | daemon→server | `{clientInfo:{name:'sillyhub-daemon', version:DAEMON_VERSION}}` | `{capabilities, ...}`（driver 不消费） |
| `notifications/initialized` | daemon→server（notification，无 id） | `{}` | — |
| `thread/start` (id=2) | daemon→server | `{cwd}` | `{thread:{id:<threadId>}}` ← 提取 threadId |
| `thread/resume` (id=2) | daemon→server（恢复路径） | `{threadId:<resume>}` | `{thread:{id:<threadId>}}` 或 resumed 确认 |
| `turn/start` (id=3,4,5...) | daemon→server | `{threadId, input:[{type:'text',text}], model?}` | `{turn:{id,status}}` 或直接由 `turn/started` 推 |
| `turn/started` (notification) | server→daemon | `{threadId, turnId, ...}` | — ← 捕获 turnId |
| `turn/completed` (notification) | server→daemon | `{turn:{status:'completed'|'failed'|'cancelled', usage?, error?}}` | — |
| `turn/interrupt` | daemon→server | `{threadId, turnId}` | `{}` 或空 result |
| server request（审批类） | server→daemon | `{...approval payload}`，需 daemon 写回 `{jsonrpc,id, result:{decision/action}}` | 见 task-05 |

> id 分配策略：handshake 用固定 1/2；turn/start 与 turn/interrupt 用递增计数器（从 3 起），避免 id
> 碰撞。response 按 id 匹配（json-rpc.ts 已按 id 区分）。

### flat message 映射表（D-004，穷举）

| JSON-RPC 事件 | event_type | content | metadata 关键字段 |
| --- | --- | --- | --- |
| `thread/start` response | `text` | `''` | `subtype:'thread_started'`, `session_id:threadId` |
| `turn/started` notification | `text` | `''` | `status:'running'`, `source:'turn_started'`, `session_id:threadId` |
| `item/agentMessage/delta`（流式） | `text` | 增量文本 | `call_id:itemId`, `streaming:true`, `session_id` |
| `item/completed(agentMessage)` | `text` | 完整文本 | `call_id:itemId`, `session_id` |
| `item/started(commandExecution)` | `tool_use` | command | `tool_name:'exec_command'`, `call_id`, `session_id` |
| `item/completed(commandExecution)` | `tool_result` | aggregatedOutput | `tool_name:'exec_command'`, `call_id`, `session_id` |
| `item/started(fileChange)` | `tool_use` | `''` | `tool_name:'patch_apply'`, `call_id`, `session_id` |
| `item/completed(fileChange)` | `tool_result` | `''` | `tool_name:'patch_apply'`, `call_id`, `session_id` |
| `item/started(reasoning)` | `text` | summary | `thinking:true`, `call_id`, `session_id` |
| `turn/completed` failed | `error` | err message | `turn_status:'failed'`, `session_id` |
| response error | `error` | err message | `rpc_error_code`, `rpc_id`, `session_id` |
| stderr 行 | `error` | stderr text | `level:'stderr'`, `session_id` |
| server request（已知 approval） | `tool_use` | `''` | `kind:'approval'`, `rpc_id`, `rpc_method`, `session_id`（task-04 上报不自动应答） |

> 所有 flat message 都带 `session_id = threadId`（D-004 核心约束）。`event_type='complete'` 不上报，
> 它是 turn result 信号。

### CodexAppServerDriver 伪代码

```ts
export class CodexExecutableNotFoundError extends Error {
  readonly code = 'CODEX_EXECUTABLE_NOT_FOUND' as const;
}

interface CodexHandle extends InteractiveDriverHandle {
  readonly provider: 'codex';
  readonly processId: number;
  child: ChildProcess;
  adapter: JsonRpcAdapter;              // 复用解析
  threadId: string | null;
  currentTurnId: string | null;
  nextRpcId: number;                    // 从 3 起
  closing: boolean;
  close(): Promise<void>;
}

export class CodexAppServerDriver implements InteractiveDriver {
  async start(input, options): Promise<CodexHandle> {
    // 1. 校验 executable 非空，否则 throw CodexExecutableNotFoundError
    // 2. spawn(executable, adapter.buildArgs(), {cwd, env, stdio:['pipe','pipe','pipe']})
    //    + Windows wrapper 解析（复用 resolveWindowsCmdShim 若已 export）
    // 3. handle = {provider:'codex', processId: child.pid, child, adapter, threadId:null,
    //              currentTurnId:null, nextRpcId:3, closing:false, close:...}
    // 4. 注册 stderr 累积、'error'/'exit' 监听（不在此 await，consume 内消费）
    // 5. 返回 handle（spawn 同步完成；握手在 consume 内做，与 task-runner 不同：
    //    interactive 需要把 threadId 通过 onSessionId 回传 SessionManager 持久化）
    return handle;
  }

  async consume(handle, cb): Promise<void> {
    // A. 握手：写 initialize(1) → initialized → thread/start(2) 或 thread/resume(2)
    //    每条间隔 300ms。监听 stdout 行：id=2 response 提取 threadId，
    //    cb.onSessionId(threadId)。
    // B. 首轮（新建路径，非 resume）：取 input queue 第一条 → turn/start(3)。
    // C. readline for-await stdout：
    //    - 解析每行 → adapter.parse(line) → AgentEvent[]
    //    - turn/started（status:'running' 或显式 turnId）→ 存 currentTurnId/threadId
    //    - 每个 event（除 complete）→ cb.onTurnMessage(flatMessage(event, threadId))
    //    - turn/completed → cb.onTurnResult(...)，清空 currentTurnId，标记本轮完成
    //    - server request → 入 pendingServerRequests + 上报 flat message（task-04 fail-closed，
    //      见"预留"）
    // D. 多轮串行：for await (const turn of input) {
    //      if (handle.closing) break;
    //      await writeTurnStart(handle, turn.text);   // nextRpcId++
    //      await waitForTurnCompleted();              // 阻塞至 turn/completed
    //    }
    // E. input queue 结束 / catch → cb.onError；finally → handle.close()
  }

  async interrupt(handle): Promise<boolean> {
    if (!handle || handle.currentTurnId == null) return false;
    await writeJsonRpc(handle, {id: handle.nextRpcId++, method:'turn/interrupt',
      params:{threadId: handle.threadId, turnId: handle.currentTurnId}});
    return true;   // 不等 turn/completed，由 consume 的 waitForTurnCompleted 收敛
  }
}

// flatMessage 构造（D-004 精确契约）
function toFlatMessage(ev: AgentEvent, threadId: string): InteractiveDriverMessage {
  return { event_type: ev.type, content: ev.content, metadata: ev.metadata ?? {}, session_id: threadId };
}
```

### handle 字段

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `provider` | `'codex'` | driver 注册标识 |
| `processId` | `number` | child.pid，日志/诊断 |
| `child` | `ChildProcess` | spawn 句柄，close/interrupt 操作 stdin |
| `adapter` | `JsonRpcAdapter` | 复用 parse/buildHandshake/buildTurnStart |
| `threadId` | `string\|null` | thread/start 后填充，所有 flat message 的 session_id |
| `currentTurnId` | `string\|null` | turn/started 后填充，interrupt 用；turn/completed 后清空 |
| `nextRpcId` | `number` | turn/start / turn/interrupt 递增 id（≥3） |
| `closing` | `boolean` | close 后置 true，拒绝新 turn/start |
| `pendingServerRequests` | `PendingServerRequest[]` | task-05 消费；task-04 仅登记+fail-closed 应答 |

## 边界处理

1. **executable 缺失**：`options.pathToAgentExecutable` 空/不存在 → `start()` 抛
   `CodexExecutableNotFoundError`（code=`CODEX_EXECUTABLE_NOT_FOUND`），不 spawn。daemon（task-06）
   据此记 `interactive_codex_executable_not_found` + fail lease。
2. **app-server 启动失败**：spawn 后 `'error'` 事件（ENOENT/EINVAL）或非零 exit 在握手完成前 →
   `cb.onError(err)` + `cb.onTurnResult({subtype:'error_during_execution', is_error:true,
   result:'codex app-server failed to start'})`，close child，不重试（interactive 路径不自动重试，
   与 batch 不同；由 backend session failed 路径收口）。
3. **turn/completed 异常 status**：status 既非 completed/failed/cancelled（未知值）→ 按 failed 语义
   处理（`is_error:true`），并在 metadata 保留 `turn_status:<raw>` 便于诊断（design §7.3 未知事件降级）。
4. **turn/interrupt 无 turnId**：`interrupt(handle)` 且 `currentTurnId==null`（turn/started 未到或已
   收敛）→ 返回 `false`，不发 JSON-RPC；backend/API 沿用现有 interrupt false 分支（design §7.4）。
5. **未知 JSON-RPC event**：`adapter.parse` 返回 null 或未识别 method → 不崩、不上报、不阻断已识别的
   text/tool/error 事件；可选记 debug log（design §7.3）。坏 JSON 行（`JSON.parse` 抛）→ json-rpc.ts
   已 try/catch 返回 null，driver 不重复处理。
6. **child 未释放**：`handle.close()` 必须 idempotent（多次调用安全）；close 内
   `stdin.end()` → 2s SIGTERM → SIGKILL 升级；input queue 关闭、session end、daemon stop 三条路径
   都最终调 `close()`；`finally` 块兜底。close 后所有后续 stdout 行丢弃（`closing=true` 守卫）。
7. **input queue 关闭收敛**：`for await (const turn of input)` 自然结束 → 触发 close，不发多余
   turn/start；若恰在 turn 运行中关闭，先等 turn/completed 或超时 kill 后再 close（避免半态）。
8. **stdin 写入失败**（child 已退出 / EPIPE）：`writeJsonRpc` 的 `write` callback err → warn 不抛，
   由 consume 的 turn 超时或 exit 检测收敛（对齐 task-runner.ts:793 `stdin_write_failed` 语义）。
9. **stderr 上报限流**：stderr 累积上限保护（对齐 task-runner.ts `MAX_ERROR*4`），超出截断，防内存
   膨胀；按行作为 error flat message 上报。
10. **resume 无 threadId**：`options.resume` 非空但 `thread/resume` response 不含 thread.id →
    `cb.onError` + 收敛为 failed，**不伪造新 thread**（design §7.5 / FR-06 反向约束）。

## 非目标

- **不做审批与 requestUserInput 映射**（`item/commandExecution/requestApproval`、
  `item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput`、
  `mcpServer/elicitation/request` 的真实用户交互应答）——留 task-05。task-04 只登记
  `pendingServerRequests` + 临时 fail-closed 应答（decline/cancel）防卡死。
- **不改 daemon 接入**（`_startInteractiveSession` 按 provider 取 executable、recovery 路由、
  `onTurnMessage`/`onTurnResult` 类型放宽）——留 task-06。本任务 driver 从 options 读 executable/env。
- **不实现 frontend / backend 改动**（reopen 放开、UI panel）——留 task-07/08。
- **不改 `AgentSession`/`AgentRun`/lease 控制面模型**（D-003：复用现有）。
- **不删除/改动 batch `TaskRunner` 的 Codex 解析行为**——json-rpc.ts 改动必须保证 batch 测试不回归。

## 参考

- `sillyhub-daemon/src/task-runner.ts`：batch Codex spawn（L689-843）、handshake 写入（L814-843，300ms
  间隔）、thread/start response 监听触发 turn/start（L1018-1058）、turn/completed 关 stdin
  （L1074-1086）、stderr 累积（L741-755）、kill 升级（L848-876）。
- `sillyhub-daemon/src/adapters/json-rpc.ts`：`buildArgs`/`buildHandshake`/`buildTurnStart`/`parse`
  全套（codex 协议已验证，本任务复用）、`APPROVAL_RESPONSES`（task-05 接）、`parseTurnCompleted`
  status 分支、`parseAgentMessageDelta` 流式节流。
- `sillyhub-daemon/src/interactive/claude-sdk-driver.ts`：driver 结构参考（executable 解析、
  start/consume/interrupt 三方法、interrupt 续轮语义、consume 内 try/catch onError）。
- `sillyhub-daemon/src/daemon.ts:1800-1990`：`_startInteractiveSession` 的 env 注入
  （`buildSpawnEnv(ctx,{credential})`）、provider/executable 提取、cwd mkdir —— task-06 会按 provider
  分流，本任务只确认 options 契约与之对齐。
- `sillyhub-daemon/src/types.ts:36-68`：`AgentEvent` IR（5 类 type + content + metadata）。
- design.md §5.3（八点职责）、§6（生命周期契约表）、§7（错误处理）、§5.5（一致性矩阵）。

## TDD 步骤

测试文件：`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`

用 `FakeChild`（可注入 stdin/stdout EventEmitter 的桩，参考 `tests/task-runner.*` 既有 fake child
模式）驱动 driver，不依赖真实 codex 二进制。

1. **executable 缺失**：`start(input, {pathToAgentExecutable:''})` → 抛
   `CodexExecutableNotFoundError(code='CODEX_EXECUTABLE_NOT_FOUND')`，不 spawn。
2. **新建握手 + thread/start**：fake child 接收 stdin，断言按序收到 `initialize`(id=1) →
   `notifications/initialized` → `thread/start`(id=2)；driver 喂回 id=2 response
   `{result:{thread:{id:'thr_123'}}}`；断言 `onSessionId('thr_123')` 被调用 + 收到
   `{event_type:'text', metadata:{subtype:'thread_started'}, session_id:'thr_123'}` flat message。
3. **首轮 turn/start + turn/started + turn/completed**：input queue push `{type:'user',text:'hi'}`；
   断言收到 `turn/start`(id=3) params `{threadId:'thr_123', input:[{type:'text',text:'hi'}]}`；
   喂 `turn/started` notification → 断言 `currentTurnId` 已存；喂 `turn/completed`(status=completed) →
   断言 `onTurnResult({subtype:'success', is_error:false})` 被调用。
4. **多轮串行**：input queue push 两条；断言第二条 `turn/start` 只在第一条 `turn/completed` 之后发出
   （时序断言：第二条 turn/start 的 write 时间戳 > 第一条 turn/completed 回灌时间）。
5. **interrupt 有 turnId**：turn 运行中（已收 turn/started，currentTurnId='turn_1'）→ `interrupt(handle)`
   返回 `true` + 断言收到 `turn/interrupt` params `{threadId:'thr_123', turnId:'turn_1'}`；喂
   `turn/completed`(status=cancelled) → 断言 `onTurnResult({subtype:'error_during_execution',
   is_error:true})` + currentTurnId 清空。
6. **interrupt 无 turnId**：未发 turn/started（currentTurnId=null）→ `interrupt(handle)` 返回 `false`，
   不发 JSON-RPC；`interrupt(null)` → `false`。
7. **flat message 映射**：喂 `item/agentMessage/delta`、`item/completed(agentMessage)`、
   `item/started(commandExecution)`、`item/completed(commandExecution)`、`item/started(reasoning)`
   notification；断言每条产出对应 event_type 的 flat message，且都带 `session_id='thr_123'`。
8. **恢复路径 thread/resume**：`start(input, {resume:'thr_999'})` → 断言收到 `thread/resume`(id=2)
   params `{threadId:'thr_999'}`，且首轮**不**主动 turn/start（等下一条 inject）。
9. **close 释放 child**：`handle.close()` → 断言 `child.stdin.end()` 被调 + kill 被调 + idempotent
   （二次调用不重复 kill）；close 后再写 stdin 无效。
10. **stderr 上报**：fake child emit stderr `'boom'` → 断言收到
    `{event_type:'error', content:'boom', metadata:{level:'stderr'}, session_id:'thr_123'}`。
11. **未知 event 不崩**：喂一行未知 method notification + 一行坏 JSON → 断言 consume 不抛、不产出
    flat message、继续处理后续正常行。
12. **turn/completed failed status**：喂 `turn/completed`(status=failed, error.message='x') → 断言
    `onTurnResult({subtype:'error_during_execution', is_error:true, result:'x'})`。
13. **server request 临时 fail-closed**（task-04 行为）：喂 `item/commandExecution/requestApproval`
    server request → 断言登记 pendingServerRequests + 回写 `{jsonrpc,id,result:{decision:'decline'}}`
    + 上报一条 tool_use flat message（含 `kind:'approval'`）。

运行：
```bash
pnpm --dir sillyhub-daemon test -- codex-app-server-driver
pnpm --dir sillyhub-daemon typecheck
# 回归：json-rpc / task-runner batch 测试不破
pnpm --dir sillyhub-daemon test -- adapters/json-rpc task-runner
```

## 验收标准

| ID | 验收项 | 验证方式 |
| --- | --- | --- |
| AC-04-1 | `CodexAppServerDriver` 实现 `InteractiveDriver`（start/consume/interrupt），`provider='codex'`，可被 SessionManager 注册（task-02 路由） | tsc 通过 + 单测 start/consume/interrupt 签名匹配 |
| AC-04-2 (FR-01) | spawn `codex app-server --listen stdio://`，握手 initialize→initialized→thread/start 成功，threadId 回传 onSessionId | 单测 TDD-2 |
| AC-04-3 (FR-01) | executable 缺失抛 `CODEX_EXECUTABLE_NOT_FOUND`，不 spawn | 单测 TDD-1 |
| AC-04-4 (FR-02) | 多轮 inject 串行：下一条 turn/start 仅在上一条 turn/completed 后发出，无并发 turn | 单测 TDD-4 |
| AC-04-5 (FR-03) | interrupt 有 turnId 时发 `turn/interrupt({threadId,turnId})` 返回 true；无 turnId 返回 false | 单测 TDD-5/6 |
| AC-04-6 (FR-04/D-004) | 所有 flat message 形如 `{event_type, content, metadata, session_id=threadId}`，4 类事件映射正确 | 单测 TDD-2/7 |
| AC-04-7 (FR-04/D-004) | thread/start response 额外发 `thread_started` flat message 让 backend 对齐 agent_session_id | 单测 TDD-2 |
| AC-04-8 (FR-05) | close() 关 stdin + kill child + idempotent；input queue 关闭触发 close；stderr 作 error flat message 上报 | 单测 TDD-9/10 |
| AC-04-9 (D-002) | 复用 json-rpc.ts 解析，不重发明协议；batch TaskRunner Codex 测试不回归 | `pnpm test -- adapters/json-rpc task-runner` 全绿 |
| AC-04-10 (§7) | 未知 event/坏 JSON 不崩、不阻断已识别事件；turn/completed 异常 status 按 failed 降级 | 单测 TDD-11/12 |
| AC-04-11 (预留 task-05) | server request 登记到 pendingServerRequests + 临时 fail-closed 应答（不自动 accept），task-05 移除 | 单测 TDD-13 |
| AC-04-12 | `pnpm --dir sillyhub-daemon typecheck` + 全量 `pnpm test` 通过 | CI |

## 自审清单

- [x] 蓝图独立完整：JSON-RPC 每方法 params/result、flat message 映射表、driver 伪代码全列，搬砖工可照做。
- [x] flat message 契约（D-004）精确：`event_type+content+metadata+session_id=threadId`，4 类穷举。
- [x] design §5.3 八点职责全部映射（1/2/3/4/6/7/8 实现，5 预留给 task-05 并说明临时 fail-closed）。
- [x] 边界处理 ≥6 条（实际 10 条）。
- [x] D-001/D-002/D-003/D-004 均体现并标注。
- [x] 不改源码，只 Write 蓝图；allowed_paths 仅 driver + json-rpc + tests。
- [x] 复用 json-rpc.ts（D-002），保证 batch 不回归（AC-04-9）。
- [x] interrupt 语义对齐 Claude（turn 级，session 可续，无 turn 返回 false）。
