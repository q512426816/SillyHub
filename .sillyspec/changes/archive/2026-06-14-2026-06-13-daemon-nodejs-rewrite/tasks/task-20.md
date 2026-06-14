---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-20
title: Daemon 主类（src/daemon.ts，register/心跳/事件分发/lease 状态机）
priority: P0
estimated_hours: 6
depends_on: [task-16, task-17, task-12, task-03, task-18, task-19]
blocks: [task-21, task-22]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
---

# task-20: Daemon 主类（src/daemon.ts，register/心跳/事件分发/lease 状态机）

> 变更：`2026-06-13-daemon-nodejs-rewrite` · Wave W4（编排层）· **W4 最复杂任务，依赖最多**（6 个前置）。
> 对应 design.md §5.1「分层架构」第二层「Daemon 主类」、§5.2 W4 验收门槛「端到端 mock 流程测试」。
> 对应 requirements FR-03（通信契约对齐）、FR-04（lease 生命周期）、FR-07（agent 检测驱动）。
> 替代 Python 源 `sillyhub-daemon/sillyhub_daemon/daemon.py`（共 341 行，**已逐行读完**作为权威基准）。

本任务是 daemon Node.js 重写的**编排核心**：把 6 个前置模块（config / protocol / agent-detector / HubClient / WsClient / TaskRunner）组装成一个完整的守护进程生命周期。**不实现任何子能力**（agent 检测、HTTP、WS、子进程执行、git mirror 都不在本任务），只做编排：加载配置 → 探测 agent → 注册 runtime → 启动三循环 → 收 task_available → 驱动 lease 状态机 → 优雅停止。

被 task-21（cli.ts 通过 `new Daemon(config).start()` 启动）和 task-22（测试迁移，1:1 迁移 Python `tests/test_daemon.py` 用例）阻塞依赖，因此 `Daemon` class 的公开方法签名（`start` / `stop` / `isRunning` / 构造参数）必须**零偏差**。

## 修改文件

精确路径（仓库根为 `/Users/qinyi/SillyHub`）：

| 文件 | 动作 | 说明 |
|---|---|---|
| `sillyhub-daemon/src/daemon.ts` | 新建 | `Daemon` class（构造/start/stop/isRunning + 三循环私有方法 + lease 状态机 + 事件分发 + 信号注册），单一文件承载全部编排逻辑 |

> 测试文件 `sillyhub-daemon/tests/daemon.test.ts` 不在本任务的 `allowed_paths` 内（受限于 `allowed_paths` 只允许 src/daemon.ts），但 TDD 步骤要求先写测试再写实现。execute 阶段若严格受限，测试由 task-01 已建好的 tests/ 目录承载，或由 verify/task-22 阶段补写。本蓝图「TDD 步骤」章节给出完整可运行的 mock 测试骨架，供 execute 子代理或 task-22 落地。

## 实现要求

### R1. 公开 API（与 Python `Daemon` class 行为 1:1）

逐方法对照 `sillyhub_daemon/daemon.py`：

| 方法/属性 | Python 来源 | Node 行为 |
|---|---|---|
| `constructor(config, client, taskRunner?, options?)` | `daemon.py:47-60` `__init__` | 持有 config/client/taskRunner；初始化 `_running=false`、`_tasks=new Set<Promise>`、`_registeredRuntimes=new Map<string,string>()`（agent_name → server_runtime_id）；可选注入 detector/wsClient 便于测试 |
| `start()` | `daemon.py:64-118` | `_running=true` → detectAgents → 逐个 register → `_fire` 三循环 |
| `stop()` | `daemon.py:120-132` | `_running=false` → cancel 所有 _tasks → Promise.allSettled 等待 → wsClient.close() + client.close() |
| `get isRunning` | `daemon.py:134-137` property | 返回 `_running` |

### R2. start() 流程（六步，严格按 daemon.py:64-118 顺序）

1. **置位**：`this._running = true`（必须先置位，三循环 while 条件依赖它）。
2. **探测 agent**：`const agents = await this._detector.detectAll()`（task-16 `AgentDetector.detectAll(): Promise<DetectedAgent[]>`）；过滤 `agents.filter(a => a.available)`。
3. **逐个注册**：遍历 `availableAgents`，对每个调 `this._client.register({ name: hostname, provider: agent.name, version: agent.version ?? 'unknown', protocol: agent.protocol, os: process.platform, arch: process.arch, capabilities: {...} })`（task-17 `HubClient.register` 签名）。
   - 成功：`this._registeredRuntimes.set(agent.name, resp.id)`。
   - 失败：单个 agent 注册失败**不中断**，try/catch 内 `logger.error` 后继续下一个（Python daemon.py:105-111 行为）。
4. **启动心跳循环**：`this._fire(this._heartbeatLoop())`。
5. **启动轮询循环**：`this._fire(this._pollLoop())`。
6. **启动 WS 循环**：`this._fire(this._wsLoop())`。

> **注意 register 的 runtime_id 形态**：Python 版 `client.register(runtime_id=...)` 不传 runtime_id（让 server 生成），daemon 内部用 `resp.id` 作为 server 分配的 runtime_id。Node 版保持一致——**不**主动传 `config.runtime_id` 给 register，让 server 分配后存入 `_registeredRuntimes`。心跳/轮询/WS 都用 `_registeredRuntimes` 里的 server 分配 id，而非 `config.runtime_id`（后者仅作 WS 连接的 query 参数，见 R6）。这是 daemon.py:160 `_build_ws_url` 用 `self._runtime_id`（即 `config.runtime_id`）而非 registered id 的历史约定，本任务保持一致避免破坏 backend WS Hub 路由。

### R3. stop() 流程（四步，daemon.py:120-132）

1. `this._running = false`（三循环 while 条件立即失效）。
2. `this._tasks.forEach(t => t.cancel())` —— 但 Node 没有 asyncio.Task.cancel 对等的 Promise.cancel；用 `AbortController` 实现（见 R7「CancelledError 映射」）。
3. `await Promise.allSettled([...this._tasks])` 等待所有循环退出。
4. `await this._wsClient?.close()` + `await this._client.close()`。

### R4. 三循环（heartbeat / poll / ws）

#### R4.1 heartbeatLoop（daemon.py:164-179）

```pseudo
while (this._running):
  await sleep(this._config.heartbeat_interval * 1000)  // 秒→毫秒
  for rid of this._registeredRuntimes.values():
    try: await this._client.heartbeat(rid)
    catch e: logger.warn(...)  // 单个 rid 心跳失败不影响其他
```

- 循环体异常**不**冒泡到外层（否则一次心跳失败整循环退出）。
- sleep 期间收到 stop 信号（AbortSignal.abort）立即退出循环。

#### R4.2 pollLoop（daemon.py:183-215，HTTP 轮询兜底）

```pseudo
while (this._running):
  await sleep(this._config.poll_interval * 1000)
  if (!this._taskRunner) continue  // Python daemon.py:188-189
  for rid of [...this._registeredRuntimes.values()]:
    try:
      pending = await this._client.getPendingLeases(rid)  // task-17 HubClient
      for task of pending:
        lease_id = task.lease_id
        if (lease_id) this._fire(this._executeTask(normalizePayload(task, rid)))
    catch e: logger.debug(...)
```

- Python 版 poll payload 字段映射（daemon.py:199-206）：`{ lease_id, agent_run_id, runtime_id: rid, prompt, provider, cmd_path }`。Node 版**保持字段名一致**（task-17 getPendingLeases 返回 `Array<Record<string, unknown>>`，本任务负责组装成 `_executeTask` 需要的 payload 形状）。

#### R4.3 wsLoop（daemon.py:219-251，抽象为 task-18 WsClient 委托）

Python 版直接在 daemon 内 `websockets.connect` + `async for msg`。Node 版**抽象**：把 WS 连接/重连/逐行接收下沉到 task-18 `WsClient`，daemon 只负责：

```pseudo
this._wsClient = new WsClient(wsUrl, {
  onMessage: (msg) => this._handleWsMessage(msg),
  onClose: () => { if (this._running) setTimeout reconnect, 5000 }
})
await this._wsClient.connect()  // 不阻塞，内部维护重连
```

> **设计取舍：内联 WS vs 抽象 WsClient**。Python 版内联在 daemon 是历史包袱（websockets 库 API 限制）。Node 版按 design §5.1「通信层 = HubClient + WsClient」显式抽象，理由：(1) WsClient 可独立单测（task-18）；(2) daemon 不关心重连细节，只关心消息分发；(3) design §6 文件清单第 117 行已规划 `src/ws-client.ts`。本任务**只消费** WsClient 的 `connect/close/onMessage` 接口，不实现其内部。

### R5. 事件分发（daemon.py:253-267 _handleWsMessage）

```pseudo
_handleWsMessage(msg: DaemonMessage):
  switch msg.type:
    case MSG.TASK_AVAILABLE:
      if (!this._taskRunner) { logger.warn('no_runner'); return }
      this._fire(this._executeTask(msg.payload))
    case MSG.HEARTBEAT_ACK:
      logger.debug(...)  // 仅记录，无副作用
    default:
      logger.warn('unknown_message_type', msg.type)
```

- **非阻塞分发**：`this._fire(this._executeTask(...))` 立即返回 Promise，不等执行完成，WS 接收下一条消息不受影响（Python daemon.py:263 `self._fire` 同语义）。
- payload 形状由 task-02 `TaskAvailablePayload` 类型定义（`{ lease_id, runtime_id, agent_run_id, prompt, provider, cmd_path }`）。

### R6. lease 状态机（daemon.py:269-340 _execute_task，**本任务核心**）

四步状态机，**严格**按 Python 顺序：

```pseudo
async _executeTask(payload):
  lease_id = payload.lease_id
  runtime_id = payload.runtime_id ?? this._config.runtime_id
  if (!lease_id) { logger.warn('no_lease_id'); return }

  // 1. CLAIM：拿 claim_token
  try:
    claim_resp = await this._client.claimLease(lease_id, runtime_id)  // task-17
  catch e:
    logger.error('claim_failed', lease_id, e); return
  claim_token = claim_resp.claim_token
  if (!claim_token) { logger.error('no_token', lease_id); return }

  // 2. START：通知 server lease 开始执行
  try:
    await this._client.startLease(lease_id, claim_token)  // task-17
  catch e:
    logger.error('start_failed', lease_id, e); return

  // 3. EXECUTE：委托 TaskRunner（内部 spawn + 逐行 parse + submitMessages + collectDiff）
  exec_payload = claim_resp.payload ?? claim_resp  // Python daemon.py:306 兼容两种形态
  task_result = await this._taskRunner.executeTask(lease_id, claim_token, exec_payload)  // task-19

  // 4. COMPLETE：回传结果（patch/stats/output/error）
  try:
    await this._client.completeLease(lease_id, claim_token, {
      success: task_result.success,
      output: task_result.output,
      error: task_result.error,
      patch: task_result.patch,
      files_changed: task_result.files_changed,
      insertions: task_result.insertions,
      deletions: task_result.deletions,
      duration_ms: task_result.duration_ms,
      session_id: task_result.metadata?.session_id ?? '',
    })  // task-17
    logger.info('task_completed', lease_id, task_result.success)
  catch e:
    logger.error('complete_failed', lease_id, e)
```

- **claim→start→execute→complete 任一步失败不崩主循环**：每步独立 try/catch，失败即 return（Python daemon.py:279-340 逐段 catch 的语义）。
- **execute 步本身可能长时间运行**（agent 子进程可能跑几分钟），`_fire` 后主循环不受阻塞。
- **去重**：同一 lease_id 被 WS 与 poll 双触发时，第二步 `claimLease` 会因 server 端 lease 已被认领而失败（409/conflict），被 step 1 的 catch 捕获后 return，天然去重（见边界 2）。

### R7. CancelledError 优雅退出映射（Python→Node 关键差异）

Python 用 `asyncio.CancelledError` + `task.cancel()`。Node 没有 Promise cancel，**必须**用 `AbortController`：

```pseudo
_fire(promiseFactory: (signal: AbortSignal) => Promise<void>): void {
  const controller = new AbortController()
  this._controllers.add(controller)
  promiseFactory(controller.signal)
    .catch(e => {
      if (e.name === 'AbortError') return  // 正常停止，吞掉
      logger.error('loop_crashed', e)
    })
    .finally(() => this._controllers.delete(controller))
}

stop():
  this._running = false
  this._controllers.forEach(c => c.abort())  // 触发所有循环的 signal.abort
  await Promise.allSettled([...this._loopPromises])
```

- 各循环的 `sleep` 改为 `await abortableSleep(ms, signal)`，signal.aborted 时抛 `AbortError`，循环 catch 后 `break`。
- **不**用 `Promise.race([sleep, abortPromise])` 模式（会产生未处理的 rejection 警告），用 `AbortSignal` + `setTimeout` + `signal.addEventListener('abort', ...)` 实现可中断 sleep。

### R8. 信号处理（SIGTERM/SIGINT，daemon.py 注释提及但 Python 版用 asyncio.run 自然处理）

Node 进程默认收到 SIGTERM/SIGINT 会立即退出，**必须**显式注册：

```pseudo
// 在 start() 末尾注册，stop() 中注销（避免重复注册）
this._sigtermHandler = () => void this.stop()
process.on('SIGTERM', this._sigtermHandler)
process.on('SIGINT', this._sigtermHandler)
```

- `stop()` 返回 Promise，但信号 handler 不能 await（Node 信号 handler 是同步的），用 `void this.stop()` fire-and-forget，stop 内部 `process.exit(0)` 可选（由 cli/task-21 决定是否退出进程；本任务只保证清理逻辑跑完）。
- **防重复**：第二次信号（用户连按 Ctrl+C）直接 `process.exit(130)` 强制退出（Unix 惯例 128+SIGINT=130），不等 stop 完成。

### R9. 日志（与 Python logger 对齐）

- 用 `console` + 前缀（design G-05 零依赖，不装 winston/pino）。
- 日志格式：`[daemon.${event}] key=value ...`（对齐 Python `logger.info("daemon.starting runtime_id=%s", ...)` 的结构化风格）。
- 日志级别由 `config.log_level` 控制（task-12 已有字段），本任务实现一个最小 `logger` 对象（debug/info/warn/error 四级，按 log_level 过滤）。

### R10. 依赖整合清单（6 个前置模块的接口消费点）

| 依赖 task | 模块 | 本任务消费的接口 |
|---|---|---|
| task-12 | config.ts | `DaemonConfig`（server_url/token/runtime_id/heartbeat_interval/poll_interval/max_concurrent_tasks/log_level），构造时传入只读使用 |
| task-03 | protocol.ts | `MSG.TASK_AVAILABLE` / `MSG.HEARTBEAT_ACK`（事件分发 switch）、`WS_PATH`（构造 wsUrl） |
| task-16 | agent-detector.ts | `AgentDetector.detectAll(): Promise<DetectedAgent[]>`，start step 2 调用 |
| task-17 | hub-client.ts | `HubClient.register/heartbeat/claimLease/startLease/submitMessages/completeLease/getPendingLeases/close`，全部 lease 生命周期 |
| task-18 | ws-client.ts | `WsClient` class：`connect()/close()/onMessage(cb)`，WS 长连委托 |
| task-19 | task-runner.ts | `TaskRunner.executeTask(leaseId, claimToken, payload): Promise<TaskResult>`，lease 状态机 step 3 |
| task-02（间接，非 depends_on） | types.ts | `DaemonMessage` / `TaskAvailablePayload` / `TaskResult` 类型 |

> **task-02 不在 depends_on**：因 task-02 是 W0 共享类型，所有 W1+ 任务都隐式依赖（task-03 已 depends_on task-02，传递依赖）。本任务显式列 task-16/17/12/03/18/19 六个直接消费模块。

## 接口定义

以下为 `src/daemon.ts` 的**完整骨架**，execute 子代理可直接照搬，仅需补全实现体（标 `// TODO` 处）。整合 6 个依赖模块的接口签名，编排逻辑清晰可读。

```typescript
// sillyhub-daemon/src/daemon.ts
// 替代 sillyhub_daemon/daemon.py（共 341 行）
// 守护进程主类：register → 三循环 → task_available 事件分发 → lease 状态机

import { hostname, platform, arch } from 'node:os';
import type { DaemonConfig } from './config.js';        // task-12
import { MSG, WS_PATH } from './protocol.js';            // task-03
import type {
  DaemonMessage,
  TaskAvailablePayload,
  TaskResult,
} from './types.js';                                     // task-02（传递依赖）
import { AgentDetector } from './agent-detector.js';     // task-16
import type { DetectedAgent } from './agent-detector.js';
import { HubClient } from './hub-client.js';             // task-17
import { WsClient } from './ws-client.js';               // task-18
import type { TaskRunner } from './task-runner.js';      // task-19

// ── 最小日志（design G-05 零依赖，不装 winston/pino）──────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function createLogger(level: LogLevel) {
  const filter = LOG_ORDER[level] ?? LOG_ORDER.info;
  const log = (lvl: LogLevel, event: string, kv?: Record<string, unknown>) => {
    if (LOG_ORDER[lvl] < filter) return;
    const parts = kv ? Object.entries(kv).map(([k, v]) => `${k}=${formatVal(v)}`) : [];
    // eslint-disable-next-line no-console
    console[lvl === 'debug' ? 'log' : lvl](`[daemon.${event}]`, ...parts);
  };
  return {
    debug: (e: string, kv?: Record<string, unknown>) => log('debug', e, kv),
    info: (e: string, kv?: Record<string, unknown>) => log('info', e, kv),
    warn: (e: string, kv?: Record<string, unknown>) => log('warn', e, kv),
    error: (e: string, kv?: Record<string, unknown>) => log('error', e, kv),
  };
}
function formatVal(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v instanceof Error) return v.message;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ── 可中断 sleep（AbortSignal 替代 asyncio.CancelledError，R7）───────────────

class AbortError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new AbortError());
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ── DaemonOptions（便于测试注入 mock detector/wsClient）──────────────────────

export interface DaemonOptions {
  /** 注入自定义 AgentDetector（测试用 mock）。默认 new AgentDetector() */
  detector?: AgentDetector;
  /** 注入自定义 WsClient（测试用 mock）。若不传，start() 时按 wsUrl 自动 new */
  wsClient?: WsClient;
  /** WS 重连退避（毫秒），默认 5000（design §9 / FR-03「5 秒退避重连」） */
  wsReconnectDelay?: number;
}

// ── Daemon class（核心）──────────────────────────────────────────────────────

/**
 * 守护进程主类。生命周期：
 *   start() → detectAgents → register each → 启动三循环（heartbeat/poll/ws）
 *   → 收 task_available → _executeTask（claim→start→run→complete）
 *   stop()  → 中断三循环 → 关闭 WS/HTTP
 *
 * 行为对齐 sillyhub_daemon/daemon.py:36-341。
 * 编排层：不实现任何子能力，只组装 6 个前置模块。
 */
export class Daemon {
  private readonly _config: DaemonConfig;
  private readonly _client: HubClient;
  private readonly _taskRunner: TaskRunner | null;
  private readonly _detector: AgentDetector;
  private readonly _logger: ReturnType<typeof createLogger>;

  /** WS 客户端（start 时 lazy 创建或使用注入的 mock） */
  private _wsClient: WsClient | null = null;
  private readonly _wsReconnectDelay: number;

  /** 运行标志，三循环 while 条件 */
  private _running = false;

  /** 每个 _fire 的 AbortController（stop 时全部 abort，R7） */
  private readonly _controllers = new Set<AbortController>();

  /** 每个 _fire 的 Promise（stop 时 allSettled 等待） */
  private readonly _loopPromises = new Set<Promise<void>>();

  /** agent_name → server 分配的 runtime_id（register 成功后填入） */
  private readonly _registeredRuntimes = new Map<string, string>();

  /** 进行中的 lease_id 集合（并发去重，R-边界 3） */
  private readonly _inflightLeases = new Set<string>();

  /** 信号 handler 引用（stop 时 process.off 注销，R8） */
  private _sigtermHandler: (() => void) | null = null;
  private _sigintHandler: (() => void) | null = null;

  constructor(
    config: DaemonConfig,
    client: HubClient,
    taskRunner?: TaskRunner | null,
    options?: DaemonOptions,
  ) {
    this._config = config;
    this._client = client;
    this._taskRunner = taskRunner ?? null;
    this._detector = options?.detector ?? new AgentDetector();
    this._wsClient = options?.wsClient ?? null;
    this._wsReconnectDelay = options?.wsReconnectDelay ?? 5000;
    this._logger = createLogger(
      (config.log_level as LogLevel) ?? 'info',
    );
  }

  // ── 公开 API ──────────────────────────────────────────────────────────────

  /** 运行中状态查询（对齐 daemon.py:134 is_running property）。 */
  get isRunning(): boolean {
    return this._running;
  }

  /**
   * 启动 daemon：detectAgents → register each → 启动三循环 → 注册信号 handler。
   * 对齐 daemon.py:64-118 start()。
   *
   * 幂等性：若已 _running，直接 return（防重复 start）。
   */
  async start(): Promise<void> {
    if (this._running) {
      this._logger.warn('already_running');
      return;
    }
    this._running = true;
    this._logger.info('starting', { runtime_id: this._config.runtime_id });

    // 1. 探测 agent（task-16）
    const agents = await this._detector.detectAll();
    const availableAgents = agents.filter((a) => a.available);
    this._logger.info('agents_detected', {
      agents: availableAgents.map((a) => a.name),
    });

    // 2. 逐个 register（task-17）
    if (availableAgents.length === 0) {
      this._logger.info('no_agents_detected');
    } else {
      for (const agent of availableAgents) {
        await this._registerOne(agent);
      }
    }

    // 3. 启动三循环
    this._fire((signal) => this._heartbeatLoop(signal));
    this._fire((signal) => this._pollLoop(signal));
    this._fire((signal) => this._wsLoop(signal));

    // 4. 注册信号 handler（R8）
    this._installSignalHandlers();

    this._logger.info('started', { runtime_id: this._config.runtime_id });
  }

  /**
   * 优雅停止：_running=false → abort 所有循环 → 等待 → 关闭 WS/HTTP → 注销信号。
   * 对齐 daemon.py:120-132 stop()。
   */
  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;
    this._logger.info('stopping');

    // 注销信号 handler（避免 stop 中再次收到信号二次触发）
    this._uninstallSignalHandlers();

    // abort 所有循环的 AbortController
    for (const c of this._controllers) c.abort();

    // 等待所有循环退出（AbortError 被 _fire 的 catch 吞掉）
    await Promise.allSettled([...this._loopPromises]);
    this._controllers.clear();
    this._loopPromises.clear();

    // 关闭 WS + HTTP
    try {
      await this._wsClient?.close();
    } catch (e) {
      this._logger.warn('ws_close_failed', { error: e });
    }
    try {
      await this._client.close();
    } catch (e) {
      this._logger.warn('client_close_failed', { error: e });
    }

    this._logger.info('stopped');
  }

  // ── 内部：register 单个 agent（task-17 HubClient.register）─────────────────

  private async _registerOne(agent: DetectedAgent): Promise<void> {
    try {
      const resp = await this._client.register({
        name: hostname(),
        provider: agent.name,
        version: agent.version ?? 'unknown',
        protocol: agent.protocol,
        os: platform(),
        arch: arch(),
        capabilities: {
          provider: agent.name,
          version: agent.version,
          protocol: agent.protocol,
          bin_path: agent.bin_path,
        },
      });
      const serverRuntimeId = String(resp.id ?? '');
      this._registeredRuntimes.set(agent.name, serverRuntimeId);
      this._logger.info('registered', {
        provider: agent.name,
        runtime_id: serverRuntimeId,
      });
    } catch (e) {
      // 单个 agent 失败不中断其余注册（daemon.py:105-111）
      this._logger.error('register_failed', { provider: agent.name, error: e });
    }
  }

  // ── 内部：_fire（AbortController 追踪，R7）─────────────────────────────────

  private _fire(loop: (signal: AbortSignal) => Promise<void>): void {
    const controller = new AbortController();
    this._controllers.add(controller);
    const p = loop(controller.signal)
      .catch((e) => {
        if (e instanceof AbortError || e?.name === 'AbortError') return;
        this._logger.error('loop_crashed', { error: e });
      })
      .finally(() => {
        this._controllers.delete(controller);
        this._loopPromises.delete(p!);
      });
    this._loopPromises.add(p);
  }

  // ── 心跳循环（daemon.py:164-179）───────────────────────────────────────────

  private async _heartbeatLoop(signal: AbortSignal): Promise<void> {
    while (this._running) {
      try {
        await abortableSleep(this._config.heartbeat_interval * 1000, signal);
        for (const rid of this._registeredRuntimes.values()) {
          try {
            await this._client.heartbeat(rid);
          } catch (e) {
            this._logger.warn('heartbeat_failed', { runtime_id: rid, error: e });
          }
        }
      } catch (e) {
        if (e instanceof AbortError) break;
        // 非预期异常：记日志后继续循环（不崩）
        this._logger.warn('heartbeat_loop_error', { error: e });
      }
    }
  }

  // ── 轮询循环（daemon.py:183-215，HTTP 兜底）────────────────────────────────

  private async _pollLoop(signal: AbortSignal): Promise<void> {
    while (this._running) {
      try {
        await abortableSleep(this._config.poll_interval * 1000, signal);
        if (!this._taskRunner) continue; // daemon.py:188-189
        const allIds = [...this._registeredRuntimes.values()];
        for (const rid of allIds) {
          try {
            const pending = await this._client.getPendingLeases(rid);
            for (const task of pending) {
              const leaseId = task.lease_id as string | undefined;
              if (!leaseId) continue;
              this._logger.info('poll_task', { lease_id: leaseId });
              const payload: TaskAvailablePayload = {
                lease_id: leaseId,
                agent_run_id: task.agent_run_id,
                runtime_id: rid,
                prompt: (task.prompt as string) ?? '',
                provider: (task.provider as string) ?? '',
                cmd_path: (task.cmd_path as string) ?? '',
              };
              this._fire((_sig) => this._executeTask(payload));
            }
          } catch (e) {
            this._logger.debug('poll_runtime_failed', { rid, error: e });
          }
        }
      } catch (e) {
        if (e instanceof AbortError) break;
        this._logger.warn('poll_failed', { error: e });
      }
    }
  }

  // ── WS 循环（daemon.py:219-251，抽象为 WsClient 委托，R4.3）─────────────────

  private async _wsLoop(signal: AbortSignal): Promise<void> {
    const wsUrl = this._buildWsUrl();
    if (!this._wsClient) {
      this._wsClient = new WsClient(wsUrl, {
        onMessage: (msg) => {
          void this._handleWsMessage(msg);
        },
      });
    }

    // 连接 + 重连循环（WsClient 内部已实现重连，daemon 只负责首次连接）
    while (this._running) {
      try {
        await this._wsClient.connect(signal);
        // connect 正常 resolve 表示连接关闭（WsClient 设计：连接生命周期结束）
        if (this._running) {
          this._logger.info('ws_disconnected_reconnect', {
            delay_ms: this._wsReconnectDelay,
          });
          await abortableSleep(this._wsReconnectDelay, signal);
        }
      } catch (e) {
        if (e instanceof AbortError) break;
        this._logger.warn('ws_connect_failed', { error: e });
        if (this._running) {
          try {
            await abortableSleep(this._wsReconnectDelay, signal);
          } catch (ae) {
            if (ae instanceof AbortError) break;
          }
        }
      }
    }
  }

  /** 由 server_url 推导 ws URL（http→ws / https→wss，daemon.py:148-160）。 */
  private _buildWsUrl(): string {
    const base = this._config.server_url.replace(/\/+$/, '');
    let wsBase: string;
    if (base.startsWith('https://')) wsBase = 'wss://' + base.slice('https://'.length);
    else if (base.startsWith('http://')) wsBase = 'ws://' + base.slice('http://'.length);
    else wsBase = 'ws://' + base;
    return `${wsBase}${WS_PATH}?runtime_id=${encodeURIComponent(this._config.runtime_id)}`;
  }

  // ── 事件分发（daemon.py:253-267）───────────────────────────────────────────

  private async _handleWsMessage(msg: DaemonMessage): Promise<void> {
    const msgType = msg.type;
    const payload = (msg.payload ?? {}) as TaskAvailablePayload;

    switch (msgType) {
      case MSG.TASK_AVAILABLE: {
        this._logger.info('task_available', { lease_id: payload.lease_id });
        if (!this._taskRunner) {
          this._logger.warn('task_available_no_runner');
          return;
        }
        // 非阻塞分发：_fire 立即返回，WS 接收下一条不受影响（R5）
        this._fire((_sig) => this._executeTask(payload));
        break;
      }
      case MSG.HEARTBEAT_ACK: {
        this._logger.debug('heartbeat_ack', { payload });
        break;
      }
      default: {
        this._logger.warn('unknown_message_type', { type: msgType });
      }
    }
  }

  // ── lease 状态机（daemon.py:269-340，本任务核心 R6）────────────────────────

  private async _executeTask(payload: TaskAvailablePayload): Promise<void> {
    const leaseId = payload.lease_id;
    const runtimeId = payload.runtime_id ?? this._config.runtime_id;

    if (!leaseId) {
      this._logger.warn('task_no_lease_id', { payload });
      return;
    }

    // 并发去重（边界 3）：同一 lease_id 已在执行，跳过
    if (this._inflightLeases.has(leaseId)) {
      this._logger.info('lease_inflight_skip', { lease_id: leaseId });
      return;
    }
    this._inflightLeases.add(leaseId);
    try {
      await this._runLeaseStateMachine(leaseId, runtimeId, payload);
    } finally {
      this._inflightLeases.delete(leaseId);
    }
  }

  private async _runLeaseStateMachine(
    leaseId: string,
    runtimeId: string,
    payload: TaskAvailablePayload,
  ): Promise<void> {
    // 1. CLAIM：拿 claim_token（task-17 claimLease）
    let claimResp: Record<string, unknown>;
    try {
      claimResp = await this._client.claimLease(leaseId, runtimeId);
    } catch (e) {
      this._logger.error('lease_claim_failed', { lease_id: leaseId, error: e });
      return;
    }
    const claimToken = String(claimResp.claim_token ?? '');
    if (!claimToken) {
      this._logger.error('lease_claim_no_token', { lease_id: leaseId });
      return;
    }

    // 2. START：通知 server lease 开始（task-17 startLease）
    try {
      await this._client.startLease(leaseId, claimToken);
    } catch (e) {
      this._logger.error('lease_start_failed', { lease_id: leaseId, error: e });
      return;
    }

    // 3. EXECUTE：委托 TaskRunner（task-19 executeTask，内部 spawn+parse+submit+diff）
    // claimResp.payload 兼容两种形态（daemon.py:306）：
    //   - server 返回 { lease_id, claim_token, payload: {...}, lease_expires_at }
    //   - 或 server 直接返回 payload 字段平铺
    const execPayload = (claimResp.payload as Record<string, unknown> | undefined) ?? {
      ...payload,
      ...claimResp,
    };
    const taskResult: TaskResult = await this._taskRunner!.executeTask(
      leaseId,
      claimToken,
      execPayload as Record<string, unknown>,
    );

    // 4. COMPLETE：回传结果（task-17 completeLease）
    try {
      await this._client.completeLease(leaseId, claimToken, {
        success: taskResult.success,
        output: taskResult.output,
        error: taskResult.error,
        patch: taskResult.patch,
        files_changed: taskResult.files_changed,
        insertions: taskResult.insertions,
        deletions: taskResult.deletions,
        duration_ms: taskResult.duration_ms,
        session_id: taskResult.metadata?.session_id ?? '',
      });
      this._logger.info('task_completed', {
        lease_id: leaseId,
        success: taskResult.success,
      });
    } catch (e) {
      this._logger.error('lease_complete_failed', { lease_id: leaseId, error: e });
    }
  }

  // ── 信号处理（R8）──────────────────────────────────────────────────────────

  private _installSignalHandlers(): void {
    if (this._sigtermHandler) return; // 防重复注册
    this._sigtermHandler = () => {
      void this.stop().finally(() => process.exit(0));
    };
    this._sigintHandler = () => {
      // 第一次：优雅 stop；第二次（连按）：强制退出
      if (!this._running) {
        process.exit(130); // 128 + SIGINT(2)
      }
      void this.stop().finally(() => process.exit(0));
    };
    process.on('SIGTERM', this._sigtermHandler);
    process.on('SIGINT', this._sigintHandler);
  }

  private _uninstallSignalHandlers(): void {
    if (this._sigtermHandler) {
      process.off('SIGTERM', this._sigtermHandler);
      this._sigtermHandler = null;
    }
    if (this._sigintHandler) {
      process.off('SIGINT', this._sigintHandler);
      this._sigintHandler = null;
    }
  }
}
```

> **设计取舍：`_executeTask` 拆两层**（`_executeTask` 做去重 + try/finally 清理 inflight，`_runLeaseStateMachine` 做实际状态机）。Python 版是单函数 71 行，Node 版拆开为：(1) 去重逻辑独立可测；(2) 状态机逻辑不被 try/finally 污染；(3) execute 子代理实现时两段可并行写。若偏好单函数，可合并，但去重的 try/finally 必须包裹整个状态机。

> **`_taskRunner!` 非空断言**：`_handleWsMessage` 已在 `_executeTask` 调用前检查 `if (!this._taskRunner) return`，故 `_runLeaseStateMachine` 内可直接 `!` 断言。Poll loop 同理（`_pollLoop` 起始 `if (!this._taskRunner) continue`）。若 strict 模式告警，可在 `_executeTask` 入口再断言一次。

## 边界处理

1. **register 失败（单个 agent）不中断其余**：`_registerOne` 内 try/catch，失败仅 `logger.error('register_failed')`，继续循环下一个 agent（daemon.py:105-111）。**不**重试（YAGNI，backend 端 register 是幂等 POST，重试需 daemon 自行 backoff，留给真实出现 register 偶发失败时再加；当前 backend 单点本地，失败即真失败）。**注意**：若**所有** agent 都 register 失败，daemon 仍启动三循环，但 `_registeredRuntimes` 为空——心跳循环遍历空 Map 是 no-op，poll 循环同理，WS 仍连但不收 task_available（server 端无 runtime 记录就不会推任务）。这是 Python 版同款行为，保持一致。

2. **WS 与 poll 双触发同一 lease 去重**：WS 推 task_available 触发 `_executeTask`，同时 poll loop 也 getPendingLeases 拿到同一 lease_id 触发 `_executeTask`。**两层防护**：
   - **客户端去重（inflightLeases Set）**：`_executeTask` 入口 `if (this._inflightLeases.has(leaseId)) return`，第一次进入时 `add`，finally 中 `delete`。保证同一 lease_id 不会被两个并发 `_runLeaseStateMachine` 同时跑。
   - **服务端去重（claimLease 失败）**：即使 inflight 检查有 race（极小窗口，Node 单线程事件循环实际无 race，但防御性编程），第二次 `claimLease` 会因 server 端 lease 已被认领返回 409/conflict，被 step 1 catch 捕获后 return。
   - **测试用例**：模拟 WS + poll 同时发同一 lease_id，断言 `taskRunner.executeTask` 只被调用一次（见 TDD 用例 6）。

3. **并发 lease 受 max_concurrent_tasks 限制**：`config.max_concurrent_tasks`（task-12 默认 5）。实现：`_executeTask` 入口检查 `if (this._inflightLeases.size >= this._config.max_concurrent_tasks) { logger.warn('concurrent_limit_reached'); return; }`。**不**排队（YAGNI，Python 版也不排队，超出即丢弃，server 端会因 lease 未被 claim 在超时后重新分配给其他 runtime 或本 runtime 下一轮 poll）。**注意**：inflightLeases.size 检查与 add 必须在同一个 microtask（Node 单线程天然原子，无需锁）。

4. **stop 时运行中 lease 优雅取消**：`stop()` 触发 `_running=false` + abort 所有循环，但**进行中的 `_runLeaseStateMachine`（step 3 executeTask 可能跑几分钟）不受 AbortController 影响**（`_fire` 的 signal 只传给循环，不传给 `_executeTask`）。**设计决策：不强制 kill 进行中 lease**——Python 版也不 kill（daemon.py:125-129 只 cancel 循环 task，不 cancel `_execute_task` 的子 task）。理由：(1) kill 子进程会留下半完成的 git diff / workspace，下次 poll 同一 lease 会重跑；(2) backend 端 lease 有 `lease_expires_at` 超时，daemon 崩了 backend 会自动重分配。**若**未来需要强制取消，task-19 TaskRunner 提供 `cancelTask(taskId)` 方法，本任务可在 stop 时遍历 `_taskRunner` 的 active tasks 调用，但**本任务不实现**（留给真实需求）。stop 只保证：(a) 不再接新 task（_running=false + WS close）；(b) 进行中 lease 跑完或自然失败后 daemon 进程退出。

5. **三循环异常不互杀**：每个循环 `_fire` 独立 try/catch，`catch` 内 `logger.error('loop_crashed')` 后**不**重启该循环（Python 版行为：循环崩了就崩了，靠下次 daemon 重启）。**注意**：`_fire` 的 `.catch` 只处理 AbortError（正常停止）和其余异常（记日志），不重新 `_fire` 自己（避免无限重启循环）。若需自愈，可在外层包一个 supervisor while，但**本任务不做**（YAGNI，daemon 是长进程，崩了靠 systemd/docker restart 重启更可靠）。

6. **信号重复（连按 Ctrl+C）**：第一次 SIGINT → `_sigintHandler` 检查 `_running`（true）→ 优雅 `stop()` + exit 0。第二次 SIGINT → 此时 `_running` 已 false（stop 同步置位）→ 直接 `process.exit(130)`。**注意**：`_installSignalHandlers` 幂等（`if (this._sigtermHandler) return`），防 start 被调两次导致重复注册。`_uninstallSignalHandlers` 在 stop 起始调用，避免 stop 过程中又收到信号二次触发 stop（递归）。

7. **runtime_id 冲突（同一 agent 注册两次）**：`_registeredRuntimes` 是 `Map<string, string>`（agent_name → server_runtime_id），key 是 agent.name（如 "claude"），同一 agent 不会重复 detect（AgentDetector 每个 provider 探测一次）。**但**若 daemon 重启不退出旧实例，两个 daemon 进程会各自 register 同一 agent，backend 端会有两条 runtime 记录（provider=claude × 2）。**本任务不处理**（daemon 单实例运行由 cli/task-21 通过 PID 文件保证，不在编排层职责）。

8. **lease 处理异常不崩主循环**：`_executeTask` 整个被 `_fire` 的 `.catch` 包裹，任何异常（claimLease 抛错、executeTask 抛错、completeLease 抛错）都被 step 1-4 各自的 try/catch 或 `_fire` 的兜底 catch 吞掉，记日志后 return。**主循环（heartbeat/poll/ws）完全不受影响**，继续接收下一个 task_available。**关键**：`_inflightLeases.delete(leaseId)` 在 finally 中，保证异常退出后该 lease_id 可被重新触发（虽然实际不会，因 server 端 lease 状态已变）。

9. **WS 重连期间 poll 兜底**：WS 断线 → `_wsLoop` catch → sleep 5s 重连。期间 poll loop 仍每 `poll_interval` 秒调 `getPendingLeases`，保证任务不丢。**两层独立**：WS 与 poll 是两个 `_fire` 的循环，互不影响（边界 5）。**注意**：WS 重连成功的瞬间，可能 WS 推 task_available 与 poll 同时拿到同一 lease——边界 2 的去重生效。

10. **claim_resp.payload 形态兼容**：Python daemon.py:306 `exec_payload = claim_resp.get("payload", claim_resp)` —— 兼容 server 返回 `{lease_id, claim_token, payload: {...}}`（payload 嵌套）和 `{lease_id, claim_token, prompt, provider, ...}`（payload 平铺）两种。Node 版 `const execPayload = claimResp.payload ?? { ...payload, ...claimResp }` 保持同一兼容性。**测试用例**：两种 claim_resp 形态都断言 `taskRunner.executeTask` 收到正确的 execPayload（见 TDD 用例 5）。

## 非目标

本任务**明确不做**以下事项（避免越界，留给后续 task 或不在 daemon 职责）：

- **不做 CLI 参数解析**：`start/stop/status/logs` 命令、`--server`/`--token` 选项、PID 文件管理归 task-21（cli.ts，commander）。本任务的 `Daemon` class 是纯库，由 cli 实例化调用。
- **不做 credential 渲染细节**：`{{USER_*}}` 占位符、0600 权限归 task-13（credential.ts）。本任务不直接调 CredentialManager——它由 task-19 TaskRunner 内部消费。
- **不做 workspace git mirror 细节**：clone/pull/diff 归 task-15（workspace.ts）。本任务不直接调 WorkspaceManager——它由 task-19 TaskRunner 内部消费。
- **不实现具体通信协议**：WS 帧编解码、HTTP fetch 细节、5s 重连算法归 task-17（HubClient）/ task-18（WsClient）。本任务只消费它们的接口。
- **不实现 agent 执行子进程**：spawn/stdin/stdout 逐行 parse/adapter 选择归 task-19（TaskRunner）+ task-05..11（adapters）。本任务只调 `taskRunner.executeTask`。
- **不实现 agent 检测算法**：12 provider 探测、env 覆盖、PATH 查找、version 校验归 task-16（agent-detector.ts）。本任务只调 `detector.detectAll()`。
- **不做任务排队/优先级**：超出 `max_concurrent_tasks` 的任务直接丢弃（边界 3），不排队。Python 版也不排队。
- **不做进程管理（fork/daemonize）**：本任务的 `Daemon` 是库 class，不调 `process.daemonize` 或类似。后台运行由 cli/task-21 用 `nohup`/`disown`/systemd/docker 实现。
- **不做配置热重载**：config 在构造时传入，运行时不可变（task-12 同款约束）。改配置需重启 daemon。
- **不做 metrics/observability**：不暴露 Prometheus metrics、不集成 OpenTelemetry。日志是唯一观测手段（R9）。
- **不实现 task-22 测试迁移本体**：本任务只产出 `src/daemon.ts`；`tests/daemon.test.ts` 的完整用例迁移归 task-22（W5）。本蓝图 TDD 章节给出 mock 测试骨架供 execute 阶段或 task-22 落地。

## 参考

### Python 源（**核心必读**，已逐行读完作为权威基准）

- `/Users/qinyi/SillyHub/sillyhub-daemon/sillyhub_daemon/daemon.py`（341 行，全部）
  - 第 36-60 行：`Daemon.__init__`（config/client/task_runner/_running/_tasks/_registered_runtimes 字段）
  - 第 64-118 行：`start()`（detect → register each → `_fire` 三循环）
  - 第 120-132 行：`stop()`（`_running=False` → cancel tasks → gather → client.close）
  - 第 141-146 行：`_fire`（asyncio.create_task + add_done_callback 追踪）
  - 第 148-160 行：`_build_ws_url`（http→ws / https→wss + `/api/daemon/ws?runtime_id=`）
  - 第 164-179 行：`_heartbeat_loop`（sleep heartbeat_interval → for rid → client.heartbeat，单个失败不中断）
  - 第 183-215 行：`_poll_loop`（sleep poll_interval → if task_runner → for rid → getPendingLeases → _fire _execute_task）
  - 第 219-251 行：`_ws_loop`（websockets.connect + async for msg → _handle_ws_message，异常 10s 重连）
  - 第 253-267 行：`_handle_ws_message`（switch type：TASK_AVAILABLE → _fire _execute_task；HEARTBEAT_ACK → debug；default → warn）
  - 第 269-340 行：`_execute_task`（**lease 状态机**：claim → start → execute_task → complete，每步独立 try/catch）

### 各依赖蓝图接口签名（已读，整合点见 R10）

- `tasks/task-12.md`：`DaemonConfig` interface（9 字段：server_url/token/runtime_id/profile/workspace_dir/poll_interval/heartbeat_interval/max_concurrent_tasks/log_level），`loadConfig()`/`saveConfig()` 函数式 API。
- `tasks/task-03.md`：`MSG` 对象（8 个消息类型字面量）、`LEASE_STATE`（5 个状态）、`WS_PATH='/api/daemon/ws'`、`REST_PREFIX='/api/daemon'`。
- `tasks/task-16.md`（W2 并行生成中）：`AgentDetector.detectAll(): Promise<DetectedAgent[]>`、`DetectedAgent { name, bin_path, version, protocol, available, version_warning? }`。来源 Python `agent_detector.py:180-185` + `:48-57` dataclass。
- `tasks/task-17.md`（W3 并行生成中）：`HubClient` class 方法签名 — `register(opts): Promise<{id, ...}>`、`heartbeat(rid): Promise<...>`、`claimLease(leaseId, rid): Promise<{claim_token, payload?, ...}>`、`startLease(leaseId, token)`、`submitMessages(leaseId, token, agentRunId, msgs)`、`completeLease(leaseId, token, result)`、`getPendingLeases(rid): Promise<Array<Record<string,unknown>>>`、`close()`。来源 Python `client.py:55-192` 全部 7 个方法 + close。
- `tasks/task-18.md`（W3 并行生成中）：`WsClient` class — `constructor(url, { onMessage, onClose? })`、`connect(signal?): Promise<void>`、`close(): Promise<void>`、`send(data)`。本任务消费 `connect/close/onMessage`。
- `tasks/task-19.md`（W4 并行生成中）：`TaskRunner` class — `executeTask(leaseId: string, claimToken: string, payload: Record<string, unknown>): Promise<TaskResult>`、`TaskResult { success, exit_code, patch, files_changed, insertions, deletions, output, error, duration_ms, metadata }`。来源 Python `task_runner.py:77-245`。
- `tasks/task-02.md`（W0，传递依赖）：`DaemonMessage { type: MsgType; payload?: Record<string, unknown> }`、`TaskAvailablePayload { lease_id, runtime_id?, agent_run_id?, prompt?, provider?, cmd_path? }`、`TaskResult`（与 task-19 一致）。

### design.md 章节

- §5.1 第 70-78 行：分层架构第二层「Daemon 主类 — register→心跳循环→事件分发→5s 重连+HTTP 轮询兜底」。
- §5.2 第 88 行：W4 验收门槛「端到端 mock 流程测试」。
- §7.4 第 189-203 行：protocol.ts MSG 常量蓝图（task-03 已落地）。
- §7.5 第 207-229 行：TaskRunner 编排骨架（task-19 消费点参考）。
- §9 第 250-253 行：兼容策略「WS 断线 5s 重连 + HTTP 轮询兜底策略保留」。
- §10 R-02（第 262 行）：WS 契约漂移 P0 风险，本任务消费 task-03/task-17/task-18 的契约单测成果。

### requirements.md 功能需求

- FR-03（第 36-43 行）：通信契约对齐 — 5 秒退避重连 + HTTP 轮询兜底，本任务 `_wsLoop` + `_pollLoop` 落地。
- FR-04（第 45-48 行）：lease 生命周期 — claim→start→messages→complete 全流程，本任务 `_runLeaseStateMachine` 落地。
- FR-07（第 63-65 行）：agent 检测 — 本任务 `start()` step 2 调 `detector.detectAll()` 驱动。

### 模块文档

- `/Users/qinyi/SillyHub/.sillyspec/docs/sillyhub-daemon/modules/daemon.md`：契约摘要（`Daemon(config, client, task_runner?)` / `start()` / `stop()` / `is_running`）+ 关键逻辑（start 五步 + _execute_task 四步）+ 注意事项（WS 5s 重连、_fire task 追踪、_handle_ws_message 仅处理两种消息）。
- `/Users/qinyi/SillyHub/.sillyspec/docs/sillyhub-daemon/modules/task-runner.md`：TaskResult 字段 + execute_task 七步（本任务 step 3 委托点）。

### Node API 参考

- `node:os`：`hostname()`（替代 Python `platform.node()`）、`platform()`（替代 `platform.system().lower()`）、`arch()`（替代 `platform.machine()`）。**注意**：`platform()` 返回 `'darwin'/'linux'/'win32'`，Python `platform.system()` 返回 `'Darwin'/'Linux'/'Windows'`——backend 端按字符串存储不校验，但若需与 Python 版 byte 级一致，需映射；本任务**不映射**（backend 不关心具体值，只作 metadata）。
- `node:async_hooks` 不用——AbortController 是浏览器+Node 18+ 原生 API（`new AbortController()` / `controller.signal` / `controller.abort()`），无需 import。
- `process.on('SIGTERM'/'SIGINT', handler)` + `process.off(...)` + `process.exit(code)`：Node 原生信号处理。**注意**：Windows 下 SIGTERM 无效（被当 SIGINT），但 daemon 主要跑 POSIX，Windows 兼容由 cli/task-21 处理。

## TDD 步骤

按「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」顺序。本任务是**编排层**，测试策略以 **mock 6 个依赖模块**为主，断言编排逻辑（调用顺序、状态机流转、去重、优雅退出），不测真实 HTTP/WS/子进程（那些归各自模块的单测）。

### 集成测试难点（先说清楚）

Daemon 是长生命周期对象（start 后三循环无限跑），测试难点：

1. **三循环是无限 while**：测试不能真等 `heartbeat_interval` 秒。解法：把 `heartbeat_interval`/`poll_interval` 设为极小值（如 0.01 秒），用 `vi.useFakeTimers()` 控制 sleep 推进，或注入 mock sleep。
2. **WS 连接生命周期**：mock `WsClient`，`connect()` 返回一个可控的 Promise（测试决定何时 resolve/reject 模拟断线重连）。
3. **`_fire` 的 Promise 追踪**：测试需等待所有 inflight `_executeTask` 完成，暴露一个 `await daemon._waitForIdle()` 辅助方法（仅测试用，可挂 `// @internal`）或在测试中 `await Promise.allSettled([...daemon._loopPromises])`（需把 `_loopPromises` 暴露为 readonly getter）。
4. **信号 handler 测试**：不真发 SIGTERM（会杀测试进程），直接 `process.emit('SIGTERM')` 或调 `_sigtermHandler?.()`。

**推荐方案**：在 `DaemonOptions` 增加 `detector`/`wsClient` 注入点（已在接口定义中），测试时全注入 mock，三循环用 fake timers 控制。本蓝图给出完整骨架。

### RED 阶段 — 先写测试骨架 `tests/daemon.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { MSG } from '../src/protocol.js';

// ── Mock 6 个依赖模块 ────────────────────────────────────────────────────────

const mockConfig: DaemonConfig = {
  server_url: 'http://test:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.01, // 极小值加速测试
  heartbeat_interval: 0.01,
  max_concurrent_tasks: 5,
  log_level: 'debug',
};

function createMockClient() {
  const calls = { register: 0, heartbeat: 0, claimLease: 0, startLease: 0, completeLease: 0, getPendingLeases: 0, close: 0 };
  return {
    calls,
    register: vi.fn(async () => { calls.register++; return { id: `srv-rid-${calls.register}` }; }),
    heartbeat: vi.fn(async () => { calls.heartbeat++; return {}; }),
    claimLease: vi.fn(async (leaseId: string) => {
      calls.claimLease++;
      return { claim_token: `token-${leaseId}`, payload: { prompt: 'hi', provider: 'claude' } };
    }),
    startLease: vi.fn(async () => { calls.startLease++; return {}; }),
    completeLease: vi.fn(async () => { calls.completeLease++; return {}; }),
    getPendingLeases: vi.fn(async () => { calls.getPendingLeases++; return []; }),
    close: vi.fn(async () => { calls.close++; }),
  };
}

function createMockDetector(availableAgents: string[] = ['claude', 'codex']) {
  return {
    detectAll: vi.fn(async () => availableAgents.map((name) => ({
      name, bin_path: `/usr/bin/${name}`, version: '1.0.0',
      protocol: 'stream_json', available: true,
    }))),
  };
}

function createMockWsClient() {
  const handlers: { onMessage?: (m: any) => void } = {};
  return {
    connect: vi.fn(async () => { /* 模拟长连，不立即 resolve */ return new Promise(() => {}); }),
    close: vi.fn(async () => {}),
    _emit: (msg: any) => handlers.onMessage?.(msg),
    _setHandler: (h: any) => { handlers.onMessage = h.onMessage; },
  };
}

function createMockTaskRunner() {
  return {
    executeTask: vi.fn(async () => ({
      success: true, exit_code: 0, patch: 'diff --git',
      files_changed: 2, insertions: 10, deletions: 3,
      output: 'done', error: '', duration_ms: 500,
      metadata: { session_id: 'sess-1' },
    })),
  };
}

describe('Daemon', () => {
  let daemon: Daemon;

  afterEach(async () => {
    if (daemon?.isRunning) await daemon.stop();
  });

  // AC-01: register 流程
  it('AC-01: start 探测 agent 并逐个 register，填入 _registeredRuntimes', async () => {
    const client = createMockClient();
    const detector = createMockDetector(['claude', 'codex']);
    const wsClient = createMockWsClient();
    const taskRunner = createMockTaskRunner();
    daemon = new Daemon(mockConfig, client as any, taskRunner as any, {
      detector: detector as any, wsClient: wsClient as any,
    });

    await daemon.start();

    expect(detector.detectAll).toHaveBeenCalledOnce();
    expect(client.register).toHaveBeenCalledTimes(2);
    // 每个 agent 注册后 _registeredRuntimes 应有对应 server runtime_id
    // （通过心跳调用间接验证）
    await new Promise((r) => setTimeout(r, 50)); // 等一拍心跳
    expect(client.heartbeat).toHaveBeenCalled();
  });

  it('AC-01b: 单个 agent register 失败不中断其余', async () => {
    const client = createMockClient();
    client.register.mockRejectedValueOnce(new Error('net err'));
    const detector = createMockDetector(['claude', 'codex']);
    daemon = new Daemon(mockConfig, client as any, null, {
      detector: detector as any, wsClient: createMockWsClient() as any,
    });
    await daemon.start();
    // 第一个失败，第二个仍被调用
    expect(client.register).toHaveBeenCalledTimes(2);
  });

  // AC-02: 三循环启动
  it('AC-02: start 后心跳与轮询循环运行（heartbeat/poll 调用次数递增）', async () => {
    const client = createMockClient();
    daemon = new Daemon(mockConfig, client as any, null, {
      detector: createMockDetector() as any, wsClient: createMockWsClient() as any,
    });
    await daemon.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(client.heartbeat.mock.calls.length).toBeGreaterThan(0);
    expect(client.getPendingLeases.mock.calls.length).toBeGreaterThan(0);
  });

  // AC-03: task_available → claim → start → run → complete 全链
  it('AC-03: WS 推 task_available 触发 claim→start→executeTask→complete 全链', async () => {
    const client = createMockClient();
    const wsClient = createMockWsClient();
    const taskRunner = createMockTaskRunner();
    daemon = new Daemon(mockConfig, client as any, taskRunner as any, {
      detector: createMockDetector() as any, wsClient: wsClient as any,
    });
    await daemon.start();

    // 触发 WS 消息
    wsClient._emit({
      type: MSG.TASK_AVAILABLE,
      payload: { lease_id: 'lease-1', runtime_id: 'srv-rid-1', prompt: 'do task' },
    });

    // 等待异步 _executeTask 完成
    await new Promise((r) => setTimeout(r, 50));

    expect(client.claimLease).toHaveBeenCalledWith('lease-1', 'srv-rid-1');
    expect(client.startLease).toHaveBeenCalledWith('lease-1', 'token-lease-1');
    expect(taskRunner.executeTask).toHaveBeenCalledWith(
      'lease-1', 'token-lease-1',
      expect.objectContaining({ prompt: 'hi', provider: 'claude' }),
    );
    expect(client.completeLease).toHaveBeenCalledWith(
      'lease-1', 'token-lease-1',
      expect.objectContaining({ success: true, patch: 'diff --git', files_changed: 2 }),
    );
  });

  it('AC-03b: task_available 无 taskRunner 时仅 warn 不崩', async () => {
    const wsClient = createMockWsClient();
    daemon = new Daemon(mockConfig, createMockClient() as any, null, {
      detector: createMockDetector() as any, wsClient: wsClient as any,
    });
    await daemon.start();
    expect(() => wsClient._emit({
      type: MSG.TASK_AVAILABLE, payload: { lease_id: 'x' },
    })).not.toThrow();
  });

  // AC-04: 并发 lease 去重
  it('AC-04: WS 与 poll 同时触发同一 lease_id，executeTask 只调一次', async () => {
    const client = createMockClient();
    client.getPendingLeases.mockResolvedValue([
      { lease_id: 'lease-x', agent_run_id: 'ar-1', prompt: 'p' },
    ]);
    const wsClient = createMockWsClient();
    const taskRunner = createMockTaskRunner();
    // 让 executeTask 慢一点，确保 inflight 检查生效
    taskRunner.executeTask.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { success: true, exit_code: 0, patch: '', files_changed: 0, insertions: 0, deletions: 0, output: '', error: '', duration_ms: 30, metadata: {} };
    });
    daemon = new Daemon(mockConfig, client as any, taskRunner as any, {
      detector: createMockDetector() as any, wsClient: wsClient as any,
    });
    await daemon.start();

    // WS 触发
    wsClient._emit({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'lease-x' } });
    // 立即再触发（模拟并发）
    wsClient._emit({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'lease-x' } });

    await new Promise((r) => setTimeout(r, 80));
    expect(taskRunner.executeTask).toHaveBeenCalledTimes(1);
  });

  it('AC-04b: 超出 max_concurrent_tasks 时丢弃新 lease', async () => {
    const cfg = { ...mockConfig, max_concurrent_tasks: 1 };
    const wsClient = createMockWsClient();
    const taskRunner = createMockTaskRunner();
    taskRunner.executeTask.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { success: true } as any;
    });
    daemon = new Daemon(cfg, createMockClient() as any, taskRunner as any, {
      detector: createMockDetector() as any, wsClient: wsClient as any,
    });
    await daemon.start();

    wsClient._emit({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'l1' } });
    wsClient._emit({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'l2' } }); // 被丢弃

    await new Promise((r) => setTimeout(r, 80));
    expect(taskRunner.executeTask).toHaveBeenCalledTimes(1);
  });

  // AC-05: stop 优雅取消
  it('AC-05: stop 后 _running=false，所有循环停止，client/ws close 被调', async () => {
    const client = createMockClient();
    const wsClient = createMockWsClient();
    daemon = new Daemon(mockConfig, client as any, null, {
      detector: createMockDetector() as any, wsClient: wsClient as any,
    });
    await daemon.start();
    const hbCountBefore = client.heartbeat.mock.calls.length;
    await daemon.stop();
    expect(daemon.isRunning).toBe(false);
    expect(client.close).toHaveBeenCalledOnce();
    expect(wsClient.close).toHaveBeenCalledOnce();
    // 等一拍，确认心跳不再递增
    await new Promise((r) => setTimeout(r, 50));
    expect(client.heartbeat.mock.calls.length).toBe(hbCountBefore);
  });

  // AC-06: 信号处理
  it('AC-06: SIGTERM 触发 stop（通过直接调用 handler 测试）', async () => {
    const client = createMockClient();
    daemon = new Daemon(mockConfig, client as any, null, {
      detector: createMockDetector() as any, wsClient: createMockWsClient() as any,
    });
    await daemon.start();
    // 不真发信号，直接 emit（避免杀测试进程）
    process.emit('SIGTERM', 'SIGTERM');
    await new Promise((r) => setTimeout(r, 30));
    expect(daemon.isRunning).toBe(false);
    // 防止 afterEach 再 stop 报错
  });

  // AC-07: lease 状态机与 Python 一致（claim_resp.payload 嵌套 vs 平铺）
  it('AC-07a: claim_resp.payload 嵌套形态被正确传给 executeTask', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 't1',
      payload: { prompt: 'nested', provider: 'codex', workspace_name: 'ws' },
    });
    const wsClient = createMockWsClient();
    const taskRunner = createMockTaskRunner();
    daemon = new Daemon(mockConfig, client as any, taskRunner as any, {
      detector: createMockDetector() as any, wsClient: wsClient as any,
    });
    await daemon.start();
    wsClient._emit({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'L1' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(taskRunner.executeTask).toHaveBeenCalledWith(
      'L1', 't1',
      expect.objectContaining({ prompt: 'nested', provider: 'codex', workspace_name: 'ws' }),
    );
  });

  it('AC-07b: claim_resp 平铺形态（无 payload 字段）兼容', async () => {
    const client = createMockClient();
    client.claimLease.mockResolvedValueOnce({
      claim_token: 't2',
      prompt: 'flat', provider: 'claude',
    });
    const wsClient = createMockWsClient();
    const taskRunner = createMockTaskRunner();
    daemon = new Daemon(mockConfig, client as any, taskRunner as any, {
      detector: createMockDetector() as any, wsClient: wsClient as any,
    });
    await daemon.start();
    wsClient._emit({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'L2' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(taskRunner.executeTask).toHaveBeenCalledWith(
      'L2', 't2', expect.objectContaining({ prompt: 'flat' }),
    );
  });

  it('AC-07c: claimLease 失败不调 startLease/executeTask/complete', async () => {
    const client = createMockClient();
    client.claimLease.mockRejectedValueOnce(new Error('409 conflict'));
    const wsClient = createMockWsClient();
    const taskRunner = createMockTaskRunner();
    daemon = new Daemon(mockConfig, client as any, taskRunner as any, {
      detector: createMockDetector() as any, wsClient: wsClient as any,
    });
    await daemon.start();
    wsClient._emit({ type: MSG.TASK_AVAILABLE, payload: { lease_id: 'L3' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(client.startLease).not.toHaveBeenCalled();
    expect(taskRunner.executeTask).not.toHaveBeenCalled();
    expect(client.completeLease).not.toHaveBeenCalled();
  });

  // AC-08: 未知 WS 消息类型不崩
  it('AC-08: 未知 WS 消息类型仅 warn 不抛异常', async () => {
    const wsClient = createMockWsClient();
    daemon = new Daemon(mockConfig, createMockClient() as any, null, {
      detector: createMockDetector() as any, wsClient: wsClient as any,
    });
    await daemon.start();
    expect(() => wsClient._emit({ type: 'daemon:unknown_xyz' as any, payload: {} })).not.toThrow();
  });
});
```

### GREEN 阶段 — 写实现 `src/daemon.ts`

照「接口定义」章节骨架补全 TODO 体，关键是：

1. 三循环用 `abortableSleep(ms, signal)` 替代 `await new Promise(setTimeout)`。
2. `_fire` 用 `AbortController` 追踪（不依赖 Promise cancel）。
3. `_executeTask` 入口 `inflightLeases` 去重 + finally 清理。
4. `_installSignalHandlers` / `_uninstallSignalHandlers` 成对调用。

### REFACTOR 阶段

- 检查 `_taskRunner!` 非空断言点（`_runLeaseStateMachine` 内）是否有更安全的写法（如 `if (!this._taskRunner) return` 前置守卫）。
- 检查 `abortableSleep` 的 `signal.removeEventListener('abort', onAbort)` 是否在 resolve 路径也调用（防内存泄漏）。
- 检查日志格式与 Python `logger.info("daemon.starting runtime_id=%s", ...)` 是否可读性对齐。

### 验证命令

```bash
cd sillyhub-daemon
pnpm test tests/daemon.test.ts   # 至少 12 个用例全绿
pnpm typecheck                    # tsc --noEmit 零错误
pnpm build                        # 确认未破坏 task-01 工程
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `start()` 调用，断言 `detector.detectAll` 被调一次、`client.register` 对每个 available agent 被调、单个 register 失败（mock rejectOnce）后第二个 agent 仍被调 | `detectAll` 调用 1 次；`register` 调用次数 = available agent 数；失败不中断（用例 AC-01 + AC-01b 双绿） |
| AC-02 | `start()` 后等 100ms，断言 `client.heartbeat` 与 `client.getPendingLeases` 调用次数 > 0 | 两者调用次数均 ≥ 1，证明 heartbeat_loop 与 poll_loop 在跑（用例 AC-02 绿） |
| AC-03 | mock WsClient `_emit({type: MSG.TASK_AVAILABLE, payload: {lease_id: 'lease-1'}})`，等 50ms，断言 `client.claimLease('lease-1')` → `client.startLease('lease-1', token)` → `taskRunner.executeTask(lease-1, token, payload)` → `client.completeLease(lease-1, token, result)` 四步按序调用 | 四个 mock 都被调，且参数链一致：claim 的返回 claim_token 传给 start、execute、complete；execute 返回的 TaskResult 字段映射到 complete 的 result（success/patch/files_changed/session_id 等）（用例 AC-03 绿） |
| AC-04 | 同一 `lease_id` 连续两次 `_emit` task_available（WS 双触发），或 WS + poll 同时触发，等 80ms，断言 `taskRunner.executeTask` 只被调一次；再测 `max_concurrent_tasks=1` 时第二个 lease 被丢弃 | `executeTask` 调用次数 = 1（去重生效）；并发限制下丢弃新 lease 不崩（用例 AC-04 + AC-04b 双绿） |
| AC-05 | `start()` 后立即 `await stop()`，断言 `daemon.isRunning === false`、`client.close` 与 `wsClient.close` 各被调一次、再等 50ms 心跳调用次数不递增 | isRunning=false；close 各 1 次；停止后心跳/轮询不再触发（用例 AC-05 绿） |
| AC-06 | `process.emit('SIGTERM')` 后等 30ms，断言 `daemon.isRunning === false`（信号 handler 触发了 stop） | isRunning=false，证明 SIGTERM handler 正确注册并调用 stop（用例 AC-06 绿） |
| AC-07 | claim_resp 嵌套形态 `{claim_token, payload: {prompt, provider}}` 与平铺形态 `{claim_token, prompt, provider}` 两种，断言 `taskRunner.executeTask` 收到的 payload 都正确；claimLease reject 时断言 start/execute/complete 都未被调 | 嵌套时 executeTask 收到 prompt=nested/provider=codex；平铺时收到 prompt=flat；claim 失败后续三步全不调（用例 AC-07a/b/c 三绿） |
| AC-08 | `_emit({type: 'daemon:unknown' as any})`，断言不抛异常；无 taskRunner 时 `_emit(TASK_AVAILABLE)` 仅 warn 不崩 | 两种情况都不 throw，主循环继续（用例 AC-08 绿） |
| AC-09 | `cd sillyhub-daemon && pnpm test tests/daemon.test.ts` | 全部 ≥12 个用例通过，exit 0 |
| AC-10 | `cd sillyhub-daemon && pnpm typecheck`（tsc --noEmit strict 模式） | 零错误零警告；特别确认 `_taskRunner!` 非空断言点、`AbortSignal` 类型推导、`process.on` 的 handler 类型签名均无 TS 报错 |
| AC-11 | 对照 Python `daemon.py:269-340` 逐行核对 `_runLeaseStateMachine` | 四步状态机顺序 1:1（claim→start→execute→complete）；每步独立 try/catch；claim_resp.payload 兼容形态一致；complete result 字段映射（success/output/error/patch/files_changed/insertions/deletions/duration_ms/session_id）9 个字段全对齐 |
| AC-12 | 确认未修改 Python 源 | `git diff --name-only sillyhub-daemon/sillyhub_daemon/` 为空，Python daemon.py 保持原样（W5 task-24 才删） |
| AC-13 | 确认零运行时依赖新增 | `git diff sillyhub-daemon/package.json` 为空或仅 devDependencies 变化；dependencies 仍只有 ws + commander（daemon.ts 只用 node: 内置模块 + 6 个项目内模块） |
