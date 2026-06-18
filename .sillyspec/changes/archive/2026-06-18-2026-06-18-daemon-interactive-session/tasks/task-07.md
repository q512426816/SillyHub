---
author: qinyi
created_at: 2026-06-18T22:41:08
change: 2026-06-18-daemon-interactive-session
id: task-07
title: "SDK 生命周期联调 + interrupt + 并发 inject 防重 + 空闲 30min 回收（SDK turn 级语义，spike D1/S1）"
wave: W3
priority: P0
estimated_hours: 14
depends_on: [task-04]
blocks: []
requirement_ids: [FR-04, FR-06]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/daemon.ts
---

# task-07 — SDK 生命周期联调 + interrupt + 并发 inject 防重 + 空闲 30min 回收

> v3 重做。依据 `design.md` §5（Wave1 SessionStore + 空闲 30min）、§7.2 SessionManager、§7.6 turn 时序、§10 R-conv；`requirements.md` FR-04（interrupt turn 级）/FR-06（空闲 30min 回收）；`decisions.md` D-004@v1（session_idle_timeout_sec 可配，定时扫描→end_session）；`spike-02-architecture-validation.md` §3.7 D1（interrupt turn 级，result subtype=error_during_execution，session 仍 active 可续轮）+ S1（不支持运行中注入，inputQueue 自然排队到下一 turn QUEUED 语义，不拒绝）。
>
> **v2→v3 关键差异**：v2 task-07（permission 传输闭环）整任务废弃（v3 permission 由 task-08 canUseTool 回调承担）；v3 task-07 改为 SDK 生命周期联调 + interrupt + 并发 inject 防重 + 空闲回收。interrupt 在 v3 下变 turn 级（spike D1，不再是 kill 进程）；并发 inject 不再"拒绝"而是 inputQueue 自然排队到下一 turn（spike S1 QUEUED 语义，不拒绝，UI 可提示排队中）；空闲 30min 复用 task-05 的 `end_session` 统一收口。
>
> **本任务在 task-04 产出的 `SessionManager`/`ClaudeSdkDriver`/`InputQueue` 之上补三件事**：(1) `interrupt()` 的 turn 级语义联调（driver.interrupt + onResult 收尾 failed(interrupted) + status 回 active）；(2) 并发 inject 的"排队检测"提示（不拒绝、可观察）；(3) 空闲 30min 扫描定时器 → 自动 end_session（D-004）。task-04 已给出骨架接口；本任务只补 interrupt 真实联调路径、并发排队可观察性、空闲扫描定时器，不重写 task-04 已定义的核心接口签名。

## 1. 目标与硬约束

1. **interrupt turn 级联调**（FR-04 / spike D1）：`SessionManager.interrupt(sessionId)` 在 `status=running` 时调 `driver.interrupt(state.query)`，SDK 当前 turn 产出 `result(subtype=error_during_execution)`，`_onResult` 收尾该 AgentRun=failed(interrupted)，`status` 回 `active`，`agentSessionId` 保留，下个 inject 可续轮（无需重新 spawn）。
2. **并发 inject 防重 = 排队检测，非拒绝**（R-conv / spike S1）：同一 session 在 `status=running` 时收到第二条 `SESSION_INJECT`，msg 照常 push 进 `InputQueue`（SDK 在当前 turn result 后按 FIFO 消费，spike S1 QUEUED 语义），不抛错、不拒绝；SessionManager 通过 `state.pendingInjectCount` + 可选 `onTurnQueued` 回调通知 backend「排队中」（UI 提示），让 inject 行为可观察、可解释。
3. **空闲 30min 自动回收**（FR-06 / D-004@v1）：SessionManager 启动一个独立空闲扫描定时器（`setInterval`），周期性遍历 `_store`，对 `status ∈ {active, running}` 且 `now - lastActiveAt > session_idle_timeout_sec` 的 session 自动 `end(sessionId)`（复用 task-05 的 `end_session` 经 `onSessionEnd` 通知 backend 收口，agent_sessions.status=ended）；`session_idle_timeout_sec` 可配（daemon env / opts，默认 1800）。
4. **崩溃=failed**（D-003 Wave1/2 语义）：driver `onError` 或不可恢复异常 → SessionManager 标 failed（task-04 已覆盖），本任务不实现 resume（Wave3 task-10）。
5. **不改 task-04 已定接口签名**：本任务只补 `_onResult` 的 interrupt 分支真实化、`inject` 的排队检测计数、新增空闲扫描定时器与 `start()/stop()` 生命周期钩子；`ClaudeSdkDriver`/`InputQueue`/`SessionState`/`SessionManagerDeps` 接口搬砖级复用 task-04 §4。
6. **改 `daemon.ts`**：构造 SessionManager 后启动空闲扫描；daemon 退出（SIGINT/SIGTERM/`shutdown()`）时 `sessionManager.stop()` 清理定时器（避免泄漏未结束 session 与悬挂 timer）。

## 2. 覆盖来源

| 来源 | 要求/决策 | 本任务落实 |
|---|---|---|
| `plan.md` task-07 | W3 P0，depends_on=[task-04]，blocks=[]；覆盖 FR-04, FR-06 / D-004@v1 | interrupt 联调 + 并发 inject 排队检测 + 空闲扫描→end_session |
| FR-04 | interrupt 当前 turn=failed，session 仍 active 可续轮 | `SessionManager.interrupt` → `driver.interrupt` → result subtype=error_during_execution → `_onResult` 收尾 failed(interrupted) → status active |
| FR-06 | 空闲 30min（session_idle_timeout_sec 可配）自动结束 | 空闲扫描定时器 + 阈值判定 → `SessionManager.end` → `onSessionEnd(ended)` |
| D-004@v1 | SessionStore 记 last_active_at；daemon 定时扫描，空闲超 30min（配置项）自动 end；status=ended | `_idleScanner`（setInterval）+ `_idleTimeoutSec` 配置 + `_onIdleExpire` → end |
| R-conv | 同 session 并发 inject（前一 turn 未 result）inputQueue 自然排队到下一 turn，不拒绝 | `inject` 在 `status=running` 时 `pendingInjectCount++` + 通过 `onTurnQueued` 通知 backend「排队中」，msg 仍 push |
| spike D1 | interrupt() turn 级，result=error_during_execution，query 不结束可续轮 | interrupt 联调单测：mock driver.interrupt + mock SDK 吐 result(error_during_execution) |
| spike S1 | AsyncIterable priority:'now' 仍排队下一 turn（不支持运行中注入） | 并发 inject 排队单测：两条 inject push 顺序 yield，第二条进 turn2 |
| design §7.2 / §7.6 | SessionManager.interrupt / 空闲扫描 / turn 时序 | §5 接口搬砖级引用 task-04 + 补 interrupt 联调 / 排队 / scanner 伪代码 |
| design §8.5 | 结集中在 service.end_session | 本任务 `end`（手动 + 空闲）都经 `onSessionEnd` 通知 backend，不在 daemon 直接改 DB |

## 3. 真实现状与约束

实现前必须用 `rg` 再次核对以下事实（源码随 task-04 实现变化，先改本文档再写代码）：

| 事实 | 当前锚点 | 本任务使用方式 |
|---|---|---|
| SessionManager 接口 | task-04 §4.3 `class SessionManager`（`create/inject/interrupt/end/fail/get/_onResult/_onMessage`） | 补 interrupt 联调路径真实化、`inject` 排队计数、新增 `start()/stop()` + scanner |
| SessionState 字段 | task-04 §4.3 `SessionState`（`lastActiveAt` 已存在） | 新增 `pendingInjectCount?: number`（默认 0）用于排队检测可观察性 |
| ClaudeSdkDriver.interrupt | task-04 §4.2 `interrupt(q: Query \| null): Promise<boolean>`（q null/已结束 no-op 返回 false） | SessionManager.interrupt 内直接调，boolean 决定是否回执 backend |
| InputQueue.push | task-04 §4.1（turn 级串行不靠队列层强制） | 并发 inject：第二条 push 入 buffer，SDK 下一 turn 消费（spike S1） |
| onSessionEnd 回调 | task-04 §4.3 `SessionManagerDeps.onSessionEnd(sessionId, status)`（task-05 实现 backend end_session） | 空闲回收调它传 `'ended'`，backend 统一收口 |
| daemon 启动/退出 | `daemon.ts` 三循环（heartbeat/poll/ws）+ `shutdown()` | SessionManager 实例化后 `start()`；daemon `shutdown()` 调 `sessionManager.stop()` |
| 配置注入 | `daemon.ts` 读 env/`config`（参考现有 env 读取风格） | `_idleTimeoutSec = Number(process.env.SESSION_IDLE_TIMEOUT_SEC ?? 1800)` |
| protocol.ts 常量 | task-03 已定 `MSG.SESSION_*` | 本任务不重定义；`onTurnQueued` 走 deps 回调通知 backend，不在 protocol 层加新常量（避免越界 task-03） |

## 4. 修改文件

| 操作 | 文件 | 责任 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | interrupt turn 级联调真实化（`_onResult` interrupt 分支）；`inject` 并发排队检测（`pendingInjectCount` + `onTurnQueued` 回调）；空闲扫描定时器 `_idleScanner` + `start()/stop()`；`_idleTimeoutSec` 可配；`_onIdleExpire`→`end` |
| 修改 | `sillyhub-daemon/src/daemon.ts` | SessionManager 实例化后调 `start()`；`shutdown()` 路径调 `sessionManager?.stop()`；`SESSION_IDLE_TIMEOUT_SEC` env 透传 |

**测试文件**（按项目惯例挂到 `sillyhub-daemon/tests/interactive/`，execute 阶段在测试目录创建，不计入 allowed_paths 实现文件限制）：

| 操作 | 测试文件 | 覆盖 |
|---|---|---|
| 新增 | `sillyhub-daemon/tests/interactive/session-interrupt.test.ts` | interrupt turn 级（spike D1）：running→driver.interrupt→result(error_during_execution)→failed(interrupted)→active 可续轮 |
| 新增 | `sillyhub-daemon/tests/interactive/session-concurrent-inject.test.ts` | 并发 inject 排队（spike S1）：两条 inject push 顺序 yield，第二条进 turn2；`pendingInjectCount`/`onTurnQueued` 可观察；不拒绝 |
| 新增 | `sillyhub-daemon/tests/interactive/session-idle-scanner.test.ts` | 空闲 30min（可配）回收：fake timer 快进超阈值→end→onSessionEnd(ended)；未超不动；running 也回收；stop() 停定时器 |
| 新增 | `sillyhub-daemon/tests/daemon-session-lifecycle-wiring.test.ts` | daemon 启动调 start、shutdown 调 stop；env 透传 _idleTimeoutSec |

不得修改：`claude-sdk-driver.ts`、`input-queue.ts`、`interactive/types.ts`（接口搬砖级复用 task-04，如需新字段先回看 task-04 §4.3 再决定是否应在 task-04 范围内）、`protocol.ts`（task-03）、`ws-client.ts`（task-04 已接路由）、backend（task-05/06）、frontend、`task-runner.ts`、model/migration。

> 如发现 interrupt/排队/扫描所需的状态字段必须加到 `SessionState`，且该字段属于 task-04 的"地基字段"（而非本任务的可观察增量），应先回 task-04 §4.3 补字段定义，再在本任务消费；本任务本身只加 `pendingInjectCount` 这种明确的本任务增量字段。

## 5. 实现要求与精确接口（搬砖级，引用 task-04）

### 5.1 SessionManager.interrupt turn 级联调（FR-04 / spike D1）

task-04 §4.3 已定义 `interrupt(sessionId): Promise<boolean>` 骨架（status=active no-op false；status=running 调 driver.interrupt）。本任务把"调 driver.interrupt 后 → SDK 吐 result subtype=error_during_execution → `_onResult` 收尾"的**完整联调路径**落实并上单测：

```typescript
// task-07 补强：interrupt 联调（task-04 §4.3 interrupt 骨架的真实化注释）
async interrupt(sessionId: string): Promise<boolean> {
  const state = this._store.get(sessionId);
  if (!state) return false;                         // SessionNotFoundError 语义（task-04 边界 4）
  if (state.status !== 'running') return false;     // active 无 running turn → no-op（不误杀）
  // spike D1：调 driver.interrupt(q)。q 已在 task-04 create 时写入 state.query。
  const interrupted = await this.deps.driver.interrupt(state.query ?? null);
  if (!interrupted) return false;                   // driver 层 q=null/已结束 no-op
  // 不在此处直接改 status；等 SDK 吐 result subtype=error_during_execution 时 _onResult 收尾
  // （spike D1：result 才是干净 turn 边界，interrupt 信号本身不等同 run 终态）。
  // backend 据 onTurnResult(result.subtype=error_during_execution / is_error) 标 failed(interrupted)。
  state.lastActiveAt = Date.now();                  // 算"用户有活动"
  return true;
}
```

`_onResult` interrupt 分支（task-04 §4.3 `_onResult` 已声明按 subtype 路由，本任务确认 subtype=error_during_execution 走 failed(interrupted) 收尾）：

```typescript
// task-07 联调确认（伪代码，落进 task-04 _onResult 实现）：
private async _onResult(state: SessionState, result: SDKResultMessage): Promise<void> {
  // spike D1 / D4：result 是干净边界
  const runId = state.currentRunId;
  await this.deps.onTurnResult(state.sessionId, runId!, result);  // backend 关 AgentRun
  // subtype=success → backend completed；subtype=error_during_execution / is_error → backend failed(interrupted)
  state.status = 'active';              // turn 收尾，session 回 active（可续轮，spike D1）
  state.currentRunId = undefined;       // 待下个 inject 下发新 runId
  if (state.pendingInjectCount && state.pendingInjectCount > 0) state.pendingInjectCount -= 1;
  state.lastActiveAt = Date.now();
}
```

约束：
- interrupt 不直接改 `status`；终态由 `_onResult` 按 SDK 实际 result 收尾（spike D1：interrupt 后 SDK 必吐一条 result subtype=error_during_execution；D4：result 后无孤儿事件）。
- `agentSessionId` 在 interrupt 收尾后保留（resume 仍可用，下个 inject 续轮无需新 session_id）。
- driver.interrupt 返回 false（q null/已结束）时 SessionManager 不改 status、不调 onTurnResult（保守，避免对已结束 query 误标 failed）。

### 5.2 并发 inject 防重 = 排队检测（R-conv / spike S1，非拒绝）

task-04 §4.3 `inject` 在 `status=running` 时已声明"push 仍入 InputQueue 缓冲"。本任务补**可观察性**：计数 + 通知 backend「排队中」（UI 提示），不抛错、不拒绝。

```typescript
// task-07 补强：inject 排队检测（task-04 §4.3 inject 在 running 时的可观察增量）
export interface SessionManagerDeps /* task-04 §4.3 + 本任务增量 */ {
  // ... task-04 既有 onTurnResult / onTurnMessage / onSessionEnd ...
  /**
   * task-07 新增（FR-06/R-conv 可观察性）：当 inject 命中"前一 turn 未 result"
   * （status=running）时回调，backend/前端据此提示"排队中"。
   * 可选；未注入则 SessionManager 只做内部计数，不通知。
   */
  onTurnQueued?: (sessionId: string, runId: string, queuePosition: number) => void | Promise<void>;
}

async inject(sessionId: string, prompt: string, runId: string): Promise<InjectResult> {
  const state = this._store.get(sessionId);
  if (!state) throw new SessionNotFoundError(/* task-04 */);
  if (state.status === 'ended' || state.status === 'failed') throw new SessionNotActiveError(/* task-04 */);

  // spike S1：push 永远进 InputQueue（turn 级串行由 SDK result 边界保证），不拒绝。
  state.inputQueue.push(this._toUserMessage(prompt));   // task-04 _toUserMessage helper
  state.lastActiveAt = Date.now();                      // inject 算活动（影响空闲回收，见 §5.3）

  if (state.status === 'running') {
    // 前一 turn 未 result：本条排队到下一 turn（spike S1 QUEUED 语义）
    state.pendingInjectCount = (state.pendingInjectCount ?? 0) + 1;
    await this.deps.onTurnQueued?.(sessionId, runId, state.pendingInjectCount);
    // runId 仍由 backend 在 inject 时创建并下发；SessionManager 不切换 currentRunId
    // （task-04 §4.3 约定：收当前 turn result 前不切 currentRunId，避免双 run 串扰）。
    // 注：currentRunId 的切换策略由 backend inject 流转触发（task-05），
    // 本任务只保证 push 顺序 + 计数可观察。
  }
  return { runId };
}
```

约束：
- **绝不拒绝并发 inject**（spike S1 实测：msg2 带 priority:'now' 仍排队到 turn2，SDK 不支持运行中注入但也不报错）。任何"前一 turn 未 result 就抛错"的写法都违反 spike S1。
- `pendingInjectCount` 是可观察计数，不参与 SDK 行为控制；SDK 是否按 FIFO 消费由 InputQueue 顺序 yield 保证（task-04 §4.1）。
- `onTurnQueued` 可选；未注入时 session 行为不变（只少一个 UI 提示），不报错。
- `_onResult` 收尾时 `pendingInjectCount` 递减（min 0），表示一条排队 turn 被消费。

### 5.3 空闲 30min 扫描定时器（FR-06 / D-004@v1）

新增 SessionManager 的 `start()/stop()` 生命周期 + `_idleScanner`（`setInterval`，生产用；测试用 fake timer）：

```typescript
export class SessionManager /* task-04 §4.3 + 本任务增量 */ {
  private _idleTimer: ReturnType<typeof setInterval> | null = null;
  /** D-004@v1：空闲阈值秒，默认 1800（30min）；env SESSION_IDLE_TIMEOUT_SEC / opts 覆盖。 */
  private readonly _idleTimeoutSec: number;
  /** 扫描周期秒，默认 60；避免与空闲阈值同量级导致抖动。测试可注入短周期。 */
  private readonly _idleScanSec: number;

  constructor(
    deps: SessionManagerDeps,
    opts: { idleTimeoutSec?: number; idleScanSec?: number } = {},
  ) {
    this.deps = deps;   // task-04 §4.3
    const envTimeout = Number(process.env.SESSION_IDLE_TIMEOUT_SEC ?? 1800);
    this._idleTimeoutSec = Number.isFinite(envTimeout) && envTimeout > 0
      ? (opts.idleTimeoutSec ?? envTimeout)
      : (opts.idleTimeoutSec ?? 1800);
    this._idleScanSec = opts.idleScanSec ?? 60;
  }

  /** daemon 启动后调用；启动空闲扫描定时器。幂等。 */
  start(): void {
    if (this._idleTimer) return;
    this._idleTimer = setInterval(() => {
      void this._scanIdle().catch((err) => {
        // 扫描异常不崩 daemon；记录后继续下一周期
        // （真实 log 用 daemon 现有 logger；此处用 console.error 兜底）
        console.error('[session-manager] idle scan failed', err);
      });
    }, this._idleScanSec * 1000);
    // node 标准：不阻塞 daemon 退出（daemon.shutdown 会显式 stop）
    if (typeof this._idleTimer.unref === 'function') this._idleTimer.unref();
  }

  /** daemon shutdown 调用；停定时器。不主动 end 所有 session（由 backend 端空闲/WS 收口）。
   *  幂等。 */
  stop(): void {
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /** D-004 扫描一轮：active/running 且空闲超阈值的 session → end。 */
  private async _scanIdle(): Promise<void> {
    const now = Date.now();
    // 快照 sessionId 列表，避免 end 修改 _store 时迭代异常
    const ids = Array.from(this._store.keys());
    for (const sessionId of ids) {
      const state = this._store.get(sessionId);
      if (!state) continue;
      if (state.status !== 'active' && state.status !== 'running') continue; // ended/failed/reconnecting 跳过
      const idleSec = (now - state.lastActiveAt) / 1000;
      if (idleSec > this._idleTimeoutSec) {
        try { await this._onIdleExpire(state); }
        catch (err) { console.error('[session-manager] idle expire failed', sessionId, err); }
      }
    }
  }

  /** 空闲到期：走 end 统一收口（design §8.5 service.end_session）。 */
  private async _onIdleExpire(state: SessionState): Promise<void> {
    // 若 running turn 进行中：先 interrupt（spike D1 turn 级）再 end，
    // 避免 end 时 InputQueue.close 与 SDK 当前 turn result 竞态无人收尾。
    if (state.status === 'running' && state.query) {
      try { await this.deps.driver.interrupt(state.query); }
      catch { /* interrupt 失败不阻塞 end；end 会 close InputQueue 让 query 自然结束 */ }
    }
    await this.end(state.sessionId);   // task-04 §4.3 end：InputQueue.close + status=ended + onSessionEnd(ended)
    // backend end_session 统一更新 agent_sessions.status=ended + lease=completed（design §8.5）
  }
}
```

约束：
- **lastActiveAt 更新点**（影响空闲判定）：`create`（task-04）、`inject`（§5.2）、`interrupt`（§5.1）、`_onResult`（§5.1）、`_onMessage`（task-04，可选）。**空闲扫描本身不更新 lastActiveAt**（否则永不超时）。
- **running 也回收**：30min 内一个 turn 一直没 result（异常卡死），扫描到期先 interrupt 再 end（spike D1 turn 级 interrupt 兜底）；若 interrupt 抛错忽略，靠 `end` 的 `InputQueue.close` 让 query 自然结束。
- **reconnecting 不回收**（D-003 Wave3 状态，task-10 处理）；Wave1/2 不会出现 reconnecting，但扫描守卫仍跳过。
- **定时器 unref**：避免 SessionManager 的 setInterval 阻止 node 进程退出；daemon `shutdown()` 显式 `stop()` 清理。
- **扫描异常隔离**：单 session end 失败不中断整轮扫描（`_onIdleExpire` 外层 try/catch）。
- **配置来源**：`SESSION_IDLE_TIMEOUT_SEC` env（daemon 启动读一次）；opts 注入用于测试短周期（如 `idleTimeoutSec: 2, idleScanSec: 1` + fake timer）。

### 5.4 daemon.ts 接线

```typescript
// daemon 构造/启动路径（task-04 已实例化 SessionManager）：
// task-07 追加：启动空闲扫描
if (this._sessionManager) {
  this._sessionManager.start();
}

// daemon shutdown() 路径（现有 SIGINT/SIGTERM/shutdown handler）：
// task-07 追加：停定时器（顺序在 WS close 之前，避免 shutdown 中途扫描又触发 end→onSessionEnd→WS 已关报错）
try { this._sessionManager?.stop(); }
catch (err) { /* 记日志，不阻塞 shutdown 其余清理 */ }

// env 透传：task-04 已在 SessionManager 构造读 env；daemon 侧只需确认 process.env.SESSION_IDLE_TIMEOUT_SEC
// 在 SessionManager 实例化前已就绪（daemon env 加载在 main 启动早期）。本任务不改 daemon env 加载机制。
```

约束：
- SessionManager null（task-04 边界 14：未注入）时 `start()/stop()` 不调用（`?.` 链）；batch 路径完全不受影响。
- daemon `shutdown()` 顺序：先停定时器、再关 WS（避免 shutdown 中途扫描又触发 end→onSessionEnd→WS 已关报错）。

## 6. 边界处理（≥5，全部上单测）

| # | 场景 | 必须行为 |
|---|---|---|
| 1 | interrupt 无 running turn（status=active） | `interrupt` no-op 返回 false；status 保持 active；不调 driver.interrupt（q.interrupt 在无活动 turn 时 SDK 行为未验证，保守 no-op，复用 task-04 边界 4）；不误杀后续进程 |
| 2 | 并发 inject（前一 turn 未 result）**非拒绝** | 第二条 push 进 InputQueue 缓冲（spike S1）；`pendingInjectCount++`；`onTurnQueued(sessionId, runId, pos)` 回调一次（若注入）；SDK 在当前 turn result 后按 FIFO 消费第二条 → turn2；currentRunId 在前 turn result 收尾前不切换；不抛 SessionNotActiveError（active/running 都接受） |
| 3 | 空闲扫描与 inject 竞态 | inject 更新 `lastActiveAt=now`；扫描在同一 tick 读到新 lastActiveAt → 不超时；若扫描已进入 `_onIdleExpire`（已判定超时）此时 inject 到达：end 优先（InputQueue.close），inject 抛 SessionNotActiveError（status 已 ended，task-04 边界 3 先触发）；可接受（极端竞态，UI 重试） |
| 4 | end 与 turn 完成竞态（含空闲触发的 end） | end 先置 status=ended + InputQueue.close；迟到的 onResult 在 status=ended 时只记日志不再调 onTurnResult（幂等，复用 task-04 边界 8）；若 end 时 running turn 未 result，先 interrupt（§5.3）让 SDK 吐 result 收尾，再 close |
| 5 | sessionManager 未注入（task-04 边界 14） | daemon `start()/stop()` 用 `?.` 不调；空闲扫描不启动；interactive session 不会被回收（由 backend 端空闲/WS 兜底）；batch 路径完全不受影响 |
| 6 | 空闲扫描周期内单 session end 抛错 | `_onIdleExpire` 外层 try/catch 记日志；不中断本轮其他 session 扫描；下一周期继续；不崩 daemon 主循环 |
| 7 | interrupt 后 SDK 未吐 result（异常路径） | driver.interrupt 返回 true 但 SDK 迟迟不吐 result subtype=error_during_execution：status 仍 running；空闲扫描兜底（30min 后 interrupt 再次→若仍无 result→end close InputQueue）；不在此处强制改 status（保守，等 SDK 真实 result） |
| 8 | pendingInjectCount 下溢 | `_onResult` 收尾 `pendingInjectCount = Math.max(0, (pendingInjectCount ?? 0) - 1)`；never 负；测试覆盖多条排队 + 逐条 result 收尾归零 |
| 9 | `SESSION_IDLE_TIMEOUT_SEC` 非法值（NaN/<=0） | `Number(...)` NaN 或 <=0 时回退默认 1800（构造时校验：`Number.isFinite(x) && x > 0 ? x : 1800`）；不抛构造错（避免 daemon 启动失败） |
| 10 | daemon shutdown 时仍有 active session | `stop()` 只停定时器，不主动 end 所有 session（避免 shutdown 风暴 backend）；active session 内存态随进程退出丢失（D-003 Wave1/2=failed，task-10 Wave3 持久化）；backend 侧 lease 心跳超时/WS 断开兜底收口 |
| 11 | 空闲扫描命中 reconnecting session（Wave3 才有） | 守卫跳过（status !== active && !== running → continue）；不误 end 处于重连中的 session；Wave1/2 无此状态，测试用 mock state 强置 reconnecting 验证守卫 |
| 12 | stop() 后再 start() | 幂等重建定时器；`_idleTimer=null` 后 start 可重新启动；测试覆盖 stop→start→扫描恢复 |
| 13 | interrupt 时 state.query 为 undefined（driver 未启动完/异常） | `driver.interrupt(undefined ?? null)` → driver 返回 false（task-04 §4.2 q=null no-op）；SessionManager 返回 false，不改 status；不调 onTurnResult |

## 7. 非目标（本任务不做的事）

- **不实现 resume / 崩溃恢复持久化**：SessionStore 内存态；daemon 重启 session 丢失（D-003 Wave1/2=failed）；Wave3 `query({resume})` + 磁盘元数据由 task-10。崩溃=failed 路径 task-04 已覆盖（onError→fail），本任务不补恢复。
- **不实现 canUseTool 远程人审**：driver 默认不传 canUseTool；D-007 远程人审由 task-08。本任务 interrupt/inject/空闲扫描不涉及权限回调。
- **不修改 ClaudeSdkDriver / InputQueue 接口**：task-04 已定；本任务只消费（`driver.interrupt`、`inputQueue.push`）。
- **不修改 protocol.ts 常量**：task-03 已定 `MSG.SESSION_*`；`onTurnQueued` 走 deps 回调通知 backend，不在 protocol 层加新常量（避免越界 task-03）。若 backend 端需要 WS 消息提示前端"排队中"，由 task-05/task-11 在消费 `onTurnQueued` 时决定协议，本任务只提供回调钩子。
- **不实现 backend end_session**：本任务 `end` 经 `onSessionEnd(ended)` 通知 backend；真正更新 agent_sessions.status + lease=completed 由 task-05。
- **不实现 session 级 SSE**：`onTurnResult`/`onTurnMessage`/`onTurnQueued` 是回调入口（mock 即可），真正 Redis publish + `stream_session_logs` 由 task-06。
- **不实现前端"排队中"UI**：task-11；本任务只提供可观察回调。
- **不改 task-runner.ts / batch 路径**：FR-09 零回归。
- **不主动 end shutdown 时的所有 session**：D-003 内存态语义，backend 兜底；避免 shutdown 风暴。
- **不实现 CodexAppServerDriver**：provider 非 claude → task-04 已抛 UnsupportedProviderError。

## 8. 参考

- `design.md` §5（Wave1 SessionStore + 空闲 30min）、§7.2 SessionManager（interrupt / 空闲扫描）、§7.6 turn 时序、§8.5（结集中在 service.end_session）、§10 R-conv（并发 inject 排队非拒绝）。
- `spike-02-architecture-validation.md` §3.7：**D1**（interrupt() turn 级，result subtype=error_during_execution，query 不结束可续轮，msg2 续轮 result2 success）、**S1**（AsyncIterable priority:'now' 仍排队到 turn2，不支持运行中注入，QUEUED 语义）、**D4**（result 是干净边界，无孤儿后台事件 → interrupt 后必吐一条 result 收尾）。
- spike sandbox 脚本（仓库外）`%TEMP%\claude-sdk-spike\d1.mjs`（interrupt 续轮）/`s1.mjs`（priority:'now' 排队下一 turn）。
- `requirements.md` FR-04（interrupt turn 级）/ FR-06（空闲 30min 回收，session_idle_timeout_sec 可配）。
- `decisions.md` D-004@v1（SessionStore 记 last_active_at；daemon 定时扫描，空闲超 30min 自动 end；agent_sessions.status=ended）。
- `tasks/task-04.md` §4.2 `ClaudeSdkDriver.interrupt`、§4.3 `SessionManager`/`SessionState`/`SessionManagerDeps`/`inject`/`interrupt`/`end` 骨架（本任务在其上补 interrupt 联调 + 排队 + scanner，接口搬砖级复用）。
- `tasks/task-05.md`（backend `end_session` 统一收口，本任务 `onSessionEnd` 的下游）。
- `sillyhub-daemon/src/daemon.ts` 三循环 + `shutdown()`（本任务接线 `sessionManager.start()/stop()`）。

## 9. TDD 实施顺序

严格"测试先失败 → 最小实现 → 重构 → 全量回归"。SDK 调用一律 mock（不连真实 bigmodel，避免 CI 依赖网络/鉴权）；定时器用 vitest fake timer。

### Step 1：interrupt turn 级联调单测（红，spike D1）

mock ClaudeSdkDriver（`interrupt` 记录调用并返回 true）+ mock deps（`onTurnResult`/`onSessionEnd` 记录）：
- 构造一个 `status=running` 的 session（create 后模拟 turn 开始）。
- `interrupt(sessionId)` → 断言 `driver.interrupt(state.query)` 调用一次、返回 true；status 仍 running（等 result）。
- 模拟 SDK 吐 `result(subtype=error_during_execution, is_error=true)`（driver.consume 的 onResult 回调）→ 断言 `onTurnResult(sessionId, runId, result)` 调用一次、status 回 active、currentRunId 清空、agentSessionId 保留、`lastActiveAt` 更新。
- 再 `inject(sessionId, prompt2, runId2)` → 不抛 SessionNotActiveError（status=active，可续轮，spike D1 续轮语义）。
- `interrupt` 对 status=active session → no-op 返回 false；不调 driver.interrupt。
- `interrupt` 对不存在 session → false；对 state.query=undefined → driver.interrupt(null) 返回 false → SessionManager 返回 false。
- 红后实现 §5.1 + 确认 `_onResult` interrupt 分支。

### Step 2：并发 inject 排队单测（红，spike S1）

mock driver（`consume` 不立即吐 result，模拟 turn 进行中）+ mock deps（`onTurnQueued` 记录）：
- create session（status=running，模拟 turn1 进行中未 result）。
- `inject(id, p1, runId1)`（turn1 在跑时再 inject）→ push 进 InputQueue；status=running → `pendingInjectCount=1`；`onTurnQueued(id, runId1, 1)` 调用一次。
- 立即 `inject(id, p2, runId2)`（第二条并发）→ push 进 InputQueue；`pendingInjectCount=2`；`onTurnQueued(id, runId2, 2)` 调用一次。
- **关键断言：两次 inject 都不抛 SessionNotActiveError**（spike S1 不拒绝）；InputQueue 按顺序 yield p1→p2（用真实 InputQueue 验证顺序）。
- 模拟 SDK 吐 result1（turn1 收尾）→ `_onResult` → `pendingInjectCount=1`；模拟 result2（turn2 收尾）→ `pendingInjectCount=0`。
- `onTurnQueued` 未注入（deps 不传）→ inject 行为不变（只少一次回调），不报错。
- 红后实现 §5.2。

### Step 3：空闲扫描定时器单测（红，FR-06 / D-004）

用 vitest fake timer + mock deps（`onSessionEnd` 记录）：
- 构造 SessionManager（`opts: { idleTimeoutSec: 2, idleScanSec: 1 }`）+ create 一个 `status=active, lastActiveAt=now` session。
- `start()`；`vi.advanceTimersByTime(1500)`（未超 2s）→ onSessionEnd 零调用。
- `vi.advanceTimersByTime(1000)`（累计 2.5s > 2s）→ onSessionEnd(sessionId, 'ended') 调用一次；status=ended；InputQueue.close。
- 验证 inject 更新 lastActiveAt 重置空闲：create → advance 1.5s → inject（lastActiveAt=now）→ advance 1.5s（累计从 inject 算 1.5s < 2s）→ onSessionEnd 零调用；再 advance 1s → 超时 end。
- running session 超时：create + 模拟 turn1 running + advance 超阈值 → 先 `driver.interrupt(query)` 调用一次、再 end（onSessionEnd ended）；interrupt 抛错时仍 end（catch 吞）。
- reconnecting session 跳过：mock state 强置 reconnecting + advance 超阈值 → onSessionEnd 零调用。
- 扫描异常隔离：mock `end` 对某 session 抛错 → _scanIdle 外层 catch；其他 session 仍被扫描。
- `stop()`：`clearInterval` 后 advance 任意时间 → onSessionEnd 零调用；stop→start 重建定时器恢复扫描。
- `SESSION_IDLE_TIMEOUT_SEC` 非法（NaN/0/负）→ 回退 1800（构造校验，单独单测，不依赖 fake timer）。
- 红后实现 §5.3。

### Step 4：daemon 接线单测（红）

mock SessionManager（`start`/`stop` 记录调用）：
- daemon 启动（构造 + `run()`/init 路径）→ `sessionManager.start()` 调用一次。
- daemon `shutdown()` → `sessionManager.stop()` 调用一次；顺序在 WS close 之前。
- sessionManager=null（未注入）→ `start()`/`stop()` 不抛（`?.` 链）；batch 路径不受影响。
- `process.env.SESSION_IDLE_TIMEOUT_SEC=60` → SessionManager 构造读到 60（若 daemon 侧负责传 opts，则断言传入值；若 SessionManager 自读 env，则单测在 SessionManager 构造层覆盖，daemon 侧只确认不覆盖）。
- 红后修改 daemon.ts。

### Step 5：回归

```bash
cd sillyhub-daemon
pnpm test -- session-interrupt session-concurrent-inject session-idle-scanner daemon-session-lifecycle-wiring
pnpm test -- session-manager    # task-04 既有测试不回归（inject/interrupt/end 行为）
pnpm test -- claude-sdk-driver  # task-04 driver 测试不回归（interrupt 接口未变）
pnpm test -- daemon-kind-dispatch  # task-04 分流不回归
pnpm typecheck
pnpm test                       # 全量回归，batch 测试零失败
```

## 10. 验收标准

| AC | 验收场景 | 可观察证据 | 对齐 | 状态 |
|---|---|---|---|---|
| AC-01 | interrupt turn 级（spike D1） | status=running 时 `interrupt` → driver.interrupt(q) 调用一次、返回 true；SDK 吐 result subtype=error_during_execution → onTurnResult 标 failed(interrupted)、status 回 active、currentRunId 清空、agentSessionId 保留；下个 inject 可续轮（不抛 SessionNotActiveError） | FR-04 / spike D1 | [ ] |
| AC-02 | interrupt 无 running turn（status=active）no-op | interrupt 返回 false；不调 driver.interrupt；status 保持 active；不误杀后续进程 | FR-04 边界 | [ ] |
| AC-03 | interrupt 不存在 session / query undefined | 返回 false；不改 status；不调 onTurnResult（保守，避免对已结束 query 误标 failed） | 边界 | [ ] |
| AC-04 | 并发 inject 非拒绝（spike S1） | status=running 时第二条 inject：push 进 InputQueue、pendingInjectCount++、onTurnQueued 回调；**不抛 SessionNotActiveError**；InputQueue 按 FIFO 顺序 yield；currentRunId 在前 turn result 收尾前不切换 | R-conv / spike S1 | [ ] |
| AC-05 | 排队计数归零 | 多条排队 inject 经多次 result 收尾后 pendingInjectCount 归零（min 0，不下溢） | R-conv | [ ] |
| AC-06 | 空闲 30min（可配）自动 end（FR-06 / D-004） | active session 空闲超 session_idle_timeout_sec → 扫描命中 → end → onSessionEnd(ended) 调用一次；status=ended；InputQueue.close；未超阈值不动 | FR-06 / D-004@v1 | [ ] |
| AC-07 | inject 更新 lastActiveAt 重置空闲窗口 | 空闲窗口内 inject 后 lastActiveAt=now；扫描从 inject 时刻重新计时；连续 inject 不超时 | FR-06 | [ ] |
| AC-08 | running session 空闲回收先 interrupt 再 end | running turn 卡死超阈值 → 扫描先 driver.interrupt(q) 兜底、再 end；interrupt 抛错时 catch 仍 end（InputQueue.close 让 query 自然结束） | FR-06 / spike D1 | [ ] |
| AC-09 | reconnecting session 跳过扫描 | status=reconnecting 不被空闲扫描 end（守卫 continue）；ended/failed 跳过 | D-003 Wave3 | [ ] |
| AC-10 | 扫描异常隔离 | 单 session end 抛错 → _scanIdle 外层 catch 记日志；本轮其他 session 仍扫描；下一周期继续；daemon 主循环不崩 | 稳定性 | [ ] |
| AC-11 | session_idle_timeout_sec 可配 + 非法值兜底 | env SESSION_IDLE_TIMEOUT_SEC 覆盖默认 1800；NaN/<=0 回退 1800；不抛构造错（daemon 启动不失败） | FR-06 / D-004@v1 | [ ] |
| AC-12 | start/stop 生命周期 + unref | start 启动定时器（幂等）；stop clearInterval；stop→start 重建；定时器 unref 不阻止 node 退出；daemon shutdown 调 stop（顺序在 WS close 前） | 资源管理 | [ ] |
| AC-13 | sessionManager 未注入兜底 | daemon `?.start()`/`?.stop()` 不调；空闲扫描不启动；batch 路径零影响 | task-04 边界 14 | [ ] |
| AC-14 | end 与 turn 完成竞态幂等 | 迟到的 onResult 在 status=ended 时只记日志、不再调 onTurnResult；不重复发双终态（复用 task-04 边界 8） | 稳定性 | [ ] |
| AC-15 | 验证命令 | `pnpm typecheck` + `pnpm test`（定向 + 全量）退出码 0；diff 只在 allowed_paths（session-manager.ts / daemon.ts）+ 测试目录 | 质量门 | [ ] |

## 11. 完成定义

- FR-04（interrupt turn 级）在代码与测试中有直接证据：`interrupt` → driver.interrupt → result subtype=error_during_execution → failed(interrupted) → status active 可续轮（spike D1 完整联调路径）。
- FR-06 / D-004@v1（空闲 30min 回收）在代码与测试中有直接证据：`_idleScanner` 定时扫描 + `session_idle_timeout_sec` 可配 + 到期走 `end` → `onSessionEnd(ended)`（backend end_session 统一收口）。
- R-conv / spike S1（并发 inject 非拒绝）在代码与测试中有直接证据：status=running 时第二条 inject 进 InputQueue 排队、pendingInjectCount 计数、onTurnQueued 可观察、不抛 SessionNotActiveError。
- AC-01~AC-15 全部通过；所有异常路径有明确处理（no-op / catch / 兜底），禁止裸 `try/catch` 吞错（必须有日志或回退）。
- 未越过 allowed_paths：未改 claude-sdk-driver.ts / input-queue.ts / types.ts / protocol.ts / ws-client.ts / task-runner.ts / backend / frontend / model / migration / SSE / canUseTool 人审。
- task-04 既有测试（session-manager / claude-sdk-driver / daemon-kind-dispatch）零回归；batch 测试全绿（FR-09）。
