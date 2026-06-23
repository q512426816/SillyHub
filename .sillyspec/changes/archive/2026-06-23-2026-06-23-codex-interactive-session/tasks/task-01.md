---
author: qinyi
created_at: 2026-06-24 00:13:45
id: task-01
title: 建立 provider-neutral interactive driver 契约与输入队列
priority: P0
estimated_hours: 4
depends_on: []
blocks: [task-02, task-03]
requirement_ids: [FR-01, FR-02, FR-10]
decision_ids: [D-001@v1, D-009@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/driver.ts
  - sillyhub-daemon/src/interactive/input-queue.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/interactive/driver.test.ts
  - sillyhub-daemon/src/interactive/input-queue.test.ts
---

# task-01: 建立 provider-neutral interactive driver 契约与输入队列

## 修改文件

- `sillyhub-daemon/src/interactive/driver.ts`（**新增**）：provider-neutral `InteractiveDriver` 契约 + `UserTurnInput` / `InteractiveDriverMessage` / `InteractiveDriverResult` / `InteractiveDriverHandle` / `InteractiveDriverStartOptions` / `InteractiveDriverCallbacks` 类型。纯类型导出文件，不引入任何 provider 运行时。
- `sillyhub-daemon/src/interactive/input-queue.ts`（**修改**）：`InputQueue` 泛型化，默认/新调用点使用 `UserTurnInput`；保留 `SDKUserMessage` 兼容泛型参数以避免本任务强制改 session-manager（task-02 负责）。
- `sillyhub-daemon/src/interactive/types.ts`（**修改**）：`SessionManagerDeps` 增加 `drivers: Partial<Record<'claude' | 'codex', InteractiveDriver>>` 字段；保留兼容入口 `driver?`（构造函数内 task-02 才映射到 `drivers.claude`，本任务仅扩字段类型）。`SessionState` 注释补充 provider/driver 归属语义（不改字段名，避免本任务连锁改动）。
- `sillyhub-daemon/src/interactive/driver.test.ts`（**新增**）：契约可被实现/编译通过的类型层断言测试（compile-time + 一个 fake driver 满足接口的最小运行测试）。
- `sillyhub-daemon/src/interactive/input-queue.test.ts`（**新增或扩展**）：断言泛型化后 `new InputQueue<UserTurnInput>()` 行为与原 `SDKUserMessage` 队列一致（FIFO / close / 双订阅抛错）。

## 覆盖来源

- Requirements: FR-01（Codex runtime 走 provider driver 启动）、FR-02（多轮 prompt 入 provider-neutral 队列）、FR-10（Claude 现有行为不回退——契约不破坏 Claude driver 输入路径）。
- Decisions: D-001@v1（provider driver registry：`drivers` 字段 + `InteractiveDriver` 接口）、D-009@v1（输入队列脱离 `@anthropic-ai/claude-agent-sdk`，SessionManager 只 push `{type:"user", text}`）。

## 实现要求

1. **新建 `driver.ts`**，按"接口定义"章节逐字实现全部导出类型，不写运行时逻辑（本任务不实现任何具体 driver）。文件顶部加模块注释，标明覆盖 D-001@v1 / D-009@v1，来源 design.md §5.1。
2. **`InteractiveDriver.provider` 字段**固定为 `'claude' | 'codex'`（对齐 types.ts 现有 provider union 与 FR-01/FR-10）。
3. **`driver.ts` 不得 import `@anthropic-ai/claude-agent-sdk`**（D-009@v1 normalized_requirement：SessionManager/driver 契约层脱离 SDK；SDK 类型只能出现在 Claude driver 内部）。`InteractiveDriverMessage` 用 `Record<string, unknown>`，`InteractiveDriverResult` 为结构化宽松类型。
4. **`InputQueue` 泛型化**：`class InputQueue<T = UserTurnInput> implements AsyncIterable<T>`。`push(msg: T)`、`_buffer: T[]`、`_pending` resolver 泛型化。默认类型参数 `UserTurnInput`，使新代码 `new InputQueue()` 即得 provider-neutral 队列。**行为逻辑（FIFO / close 幂等 / 双订阅抛 `SessionQueueDoubleSubscribeError` / close 后 push 抛 `SessionQueueClosedError`）逐行保持原样**，只替换类型参数（FR-10 不回退）。
5. **`input-queue.ts` import 改为** `import type { UserTurnInput } from './driver.js';`，移除对 `SDKUserMessage` 的 import（D-009@v1：队列层不再依赖 SDK）。原 `SDKUserMessage` 形态由 Claude driver 在 push 前内部构造。
6. **`types.ts` `SessionManagerDeps` 扩展**：新增 `drivers: Partial<Record<'claude' | 'codex', InteractiveDriver>>`；保留 `driver?: import('./claude-sdk-driver.js').ClaudeSdkDriver` 作为兼容入口（标 `@deprecated`，task-02 在构造函数映射到 `drivers.claude`）。`onTurnResult`/`onTurnMessage` 回调类型**本任务保持现状（仍用 SDK 类型）**，driver message/result 的回调放宽属 task-02/03 范围；本任务只动 `drivers` 字段 + import。
7. **`SessionState` 注释**：在 `provider`/`inputQueue`/`query` 字段注释补一句"driver 归属由 `state.provider` 决定，task-02 起按 provider 选 driver"——不增删字段，避免本任务触发 session-manager 连锁改动（FR-10 保护：现有 Claude 内存态结构不变）。
8. `UnsupportedProviderError` 位于 `types.ts`，本任务不改其实现（task-02 才在 create/restore 路径接 drivers 时使用）；仅在 driver.ts 注释引用其 code `UNSUPPORTED_PROVIDER` 作为契约文档。

## 接口定义

### `sillyhub-daemon/src/interactive/driver.ts`（完整导出）

```ts
/**
 * interactive/driver.ts —— provider-neutral interactive driver 契约（D-001@v1, D-009@v1）。
 *
 * 设计来源：design.md §5.1。SessionManager 只依赖本契约，provider 差异
 *（Claude SDK query / Codex app-server JSON-RPC）封装在各自 driver 内部。
 * 本文件不 import 任何 provider SDK，保持 SessionManager 层 provider-neutral。
 *
 * @module interactive/driver
 */

/** provider 集合（与 types.ts provider union 对齐）。 */
export type InteractiveProvider = 'claude' | 'codex';

/**
 * D-009@v1：provider-neutral 用户输入单元。SessionManager.create/inject 只 push 此形态。
 * - Claude driver 内部转换为 SDKUserMessage `{ type:'user', message:{ role:'user', content:[{type:'text', text}] } }`。
 * - Codex driver 内部转换为 app-server `turn/start` 的 input 字段。
 */
export interface UserTurnInput {
  /** 固定 'user'，标识这是一轮用户输入（未来可扩展 tool_result 注入，但本任务仅 user）。 */
  type: 'user';
  /** 用户文本。空串允许入队（driver 自行决定是否跳过），但 SessionManager 层不在此校验。 */
  text: string;
}

/**
 * driver 上报给 SessionManager 的中间消息（onTurnMessage 回调入参）。
 * provider-neutral：Claude driver 透传 SDKMessage 原对象（鸭子类型满足 Record），
 * Codex driver 上报 flat message `{ event_type, content, metadata?, session_id? }`。
 * SessionManager 不假设具体字段，由 daemon.onTurnMessage 按 provider 归一化（task-02/06）。
 */
export type InteractiveDriverMessage = Record<string, unknown>;

/**
 * driver 上报给 SessionManager 的 turn 结果（onTurnResult 回调入参）。
 * 字段宽松：Claude driver 透传 SDKResultMessage（含 subtype/total_cost_usd/usage 等），
 * Codex driver 用 `{ subtype, is_error, result?, usage? }` 归一化（D-004@v1 flat 契约，task-04）。
 * 所有字段可选，SessionManager 只在 is_error/subtype 上做收敛判断（task-02）。
 */
export interface InteractiveDriverResult {
  /** result 子类型（Claude SDK: success/error_during_execution/...；Codex: success/error）。 */
  subtype?: string;
  /** turn 是否出错（收敛 AgentRun 为 failed 的判据之一）。 */
  is_error?: boolean;
  /** result 主体（error 时为错误信息/堆栈，success 时为最终输出）。 */
  result?: unknown;
  /** 累计花费（Claude SDK 字段，Codex 可选透传）。 */
  total_cost_usd?: number;
  /** turn 数（Claude SDK 字段）。 */
  num_turns?: number;
  /** turn 耗时（ms）。 */
  duration_ms?: number;
  /** API 耗时（ms，Claude SDK 字段）。 */
  duration_api_ms?: number;
  /** token 用量。 */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * driver 启动后返回的会话句柄。SessionManager 持有，用于 interrupt/end/close。
 * - Claude driver：包装 SDK Query（processId 可选）。
 * - Codex driver：包装 app-server child + threadId/turnId（task-04）。
 * `close()` 释放子进程/句柄资源；缺省无需显式 close 的 driver 不实现。
 */
export interface InteractiveDriverHandle {
  /** 该句柄所属 provider（用于 interrupt 路由校验，D-001@v1）。 */
  readonly provider: InteractiveProvider;
  /** 底层子进程 pid（可观测/日志用，可空）。 */
  readonly processId?: number;
  /** 释放底层资源（关 stdin / kill child）。幂等。 */
  close?(): Promise<void> | void;
}

/**
 * driver 启动选项（design §5.1）。provider-neutral 公共字段；provider 专属字段
 *（如 pathToClaudeCodeExecutable / canUseTool）通过 provider 专属 StartOptions
 * 由各 driver 自行定义并 extends 本接口的扩展类型（task-03/04）。
 *
 * 本接口只列 provider 无关的会话级控制字段，避免 SessionManager 依赖 SDK 类型。
 */
export interface InteractiveDriverStartOptions {
  /** 固定 cwd（resume 还原用；driver 必须用此 cwd 启动子进程）。 */
  cwd: string;
  /** resume 用（Claude SDK session_id / Codex threadId）；首 turn 不传。 */
  resume?: string;
  /** 模型覆盖（可空）。 */
  model?: string;
  /** 是否启用远程人工审批（D-006@v1 策略入口；driver 读取并据此决定审批行为）。 */
  manualApproval?: boolean;
  /** AskUserQuestion-only 策略（D-006@v1；true 时只阻塞用户提问类请求）。 */
  askUserOnly?: boolean;
  /** 子进程 env（凭证/配置注入；仅内存，禁止持久化）。 */
  env?: NodeJS.ProcessEnv;
}

/**
 * consume 回调集合（SessionManager 注入）。provider-neutral：
 * - Claude driver：把 SDKMessage 透传给 onTurnMessage，SDKResultMessage 给 onTurnResult。
 * - Codex driver：flat message 给 onTurnMessage，归一化 result 给 onTurnResult。
 */
export interface InteractiveDriverCallbacks {
  /** turn 收敛结果 → SessionManager 关闭当前 AgentRun（task-02 真接线）。 */
  onTurnResult(result: InteractiveDriverResult): void | Promise<void>;
  /** 中间消息 → submit AgentRunLog（task-02/06 接 submitMessages）。可选。 */
  onTurnMessage?(msg: InteractiveDriverMessage): void | Promise<void>;
  /** driver 异常（spawn 失败/进程退出/网络）→ session failed。可选。 */
  onTurnError?(err: unknown): void | Promise<void>;
}

/**
 * D-001@v1 provider-neutral interactive driver 契约。
 *
 * 生命周期：
 *   start(input, opts) → handle（启动子进程 + 订阅 input 队列）
 *   consume(handle, cb) → 遍历 provider 输出流，逐条回调（阻塞直到流结束/出错）
 *   interrupt(handle|null) → turn 级打断；无 active turn 返回 false
 *   handle.close?() → 释放资源（end/stop 时调用）
 *
 * 实现：ClaudeSdkDriver（task-03）、CodexAppServerDriver（task-04）。
 * SessionManager 通过 `drivers[provider]` 选取；未注册 provider 抛
 * `UnsupportedProviderError`（types.ts，task-02 接线）。
 */
export interface InteractiveDriver {
  /**
   * 启动 provider 会话，订阅 input AsyncIterable（长生命周期跨多 turn）。
   * @returns 会话句柄（供 consume/interrupt/close）
   */
  start(
    input: AsyncIterable<UserTurnInput>,
    options: InteractiveDriverStartOptions,
  ): Promise<InteractiveDriverHandle>;

  /**
   * 消费 provider 输出流直到自然结束或出错。SessionManager 在 create/inject 后
   * 作为 session 协程一次启动；每条消息/结果触发对应回调。
   */
  consume(
    handle: InteractiveDriverHandle,
    callbacks: InteractiveDriverCallbacks,
  ): Promise<void>;

  /**
   * turn 级打断（FR-03）。
   * @returns true=已发出打断信号；false=无 active turn / handle 无效 / 打断抛错（no-op 不冒泡）。
   */
  interrupt(handle: InteractiveDriverHandle | null): Promise<boolean>;
}
```

### `input-queue.ts` 改动（伪代码，仅示类型层差异，逻辑保持原样）

```ts
// 顶部 import 改为：
import type { UserTurnInput } from './driver.js';
// 删除： import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

// 类签名泛型化（默认 UserTurnInput）：
export class InputQueue<T = UserTurnInput> implements AsyncIterable<T> {
  private readonly _buffer: T[] = [];
  private _pending: ((msg: T | null) => void) | null = null;
  // _closed / _subscribed 不变
  push(msg: T): void { /* 原逻辑不变，仅类型 T */ }
  [Symbol.asyncIterator](): AsyncIterator<T> { /* 原逻辑不变 */ }
  // return() 内部 IteratorResult<T>
}
// SessionQueueClosedError / SessionQueueDoubleSubscribeError 不变
```

> 注意：现有 `session-manager.ts` 内 `new InputQueue()` + `push({type:'user', message:{...}})`（SDKUserMessage 形态）调用点**本任务不改**。泛型默认 `UserTurnInput` 后，这些调用点的 push 参数类型会与 `UserTurnInput` 不兼容 → 预期产生 typecheck 错误，**这是 task-02 接线时修复的范围**。为避免本任务编译断裂，`InputQueue` 的默认类型参数可暂用 `T = UserTurnInput` 但 session-manager 的调用点在 task-02 之前先用 `new InputQueue<SDKUserMessage>()` 显式标注过渡（见边界处理 E2）。**最终决策：本任务同时把 `session-manager.ts` 中 `new InputQueue()` 改为 `new InputQueue<SDKUserMessage>()` 显式泛型（仅这一处类型标注，不改逻辑），保证 `pnpm typecheck` 全绿；真正的 UserTurnInput 化 push 留 task-02。** 因此 `allowed_paths` 不含 session-manager.ts——若 execute 阶段判定必须动它，仅允许改 `new InputQueue()` → `new InputQueue<SDKUserMessage>()` 这一行类型标注，不得改逻辑。

### `types.ts` `SessionManagerDeps` 改动

```ts
import type { InteractiveDriver } from './driver.js';

export interface SessionManagerDeps {
  /**
   * D-001@v1：provider driver registry。SessionManager 按 session.provider 选取。
   * task-02 在 create/restoreAndReconnect/interrupt 接线；本任务仅扩字段类型。
   */
  drivers: Partial<Record<'claude' | 'codex', InteractiveDriver>>;
  /**
   * @deprecated 兼容入口（task-02 起 SessionManager 构造函数内映射到 drivers.claude）。
   * 保留以避免本任务强制改 cli.ts/mock 构造；新代码用 drivers。
   */
  driver?: import('./claude-sdk-driver.js').ClaudeSdkDriver;
  // onTurnResult / onTurnMessage / onSessionEnd / persistence 保持现状（本任务不改）
}
```

## 边界处理

- **E1（null/空值）**：`UserTurnInput.text` 允许空串入队（队列不校验语义），由 driver 自行决定跳过；`drivers` 字段允许某 provider 缺失（`Partial`），缺该 provider 的 create 由 task-02 抛 `UnsupportedProviderError`。
- **E2（brownfield 兼容，FR-10/D-009 缓冲）**：保留 `SessionManagerDeps.driver?` 兼容入口，并把 session-manager 现有 `new InputQueue()` 显式标注为 `new InputQueue<SDKUserMessage>()`，确保 Claude 现有 interactive 行为与本任务改动前**编译等价、运行等价**；真正的 UserTurnInput push 化与 `drivers` 接线推迟到 task-02，本任务不破坏任何现有 Claude 测试。
- **E3（异常不静默）**：`InputQueue` 错误类（`SessionQueueClosedError` / `SessionQueueDoubleSubscribeError`）行为不变；driver 契约规定 `interrupt` no-op 返回 false 不冒泡（与现有 ClaudeSdkDriver.interrupt 一致，FR-10 对齐），其余 driver 异常必须经 `onTurnError` 上报，不得吞掉。
- **E4（不改传入参数）**：`InteractiveDriver.start` 接收的 `input` AsyncIterable 由 SessionManager 拥有，driver 不得 mutate/close 它（只能消费）；`InteractiveDriverCallbacks` 回调由 SessionManager 提供，driver 不得缓存或跨 session 复用。
- **E5（未知 provider/歧义）**：`InteractiveProvider` 固定 `'claude' | 'codex'`；`InteractiveDriverHandle.provider` 必须与启动它的 driver 一致（实现侧自填），SessionManager/task-02 据此校验 interrupt 路由不串 provider。driver.ts 本身不抛 `UnsupportedProviderError`（那是 SessionManager 职责），但契约注释明确引用其 code。
- **E6（类型隔离）**：`driver.ts` 严禁 import `@anthropic-ai/claude-agent-sdk`（D-009@v1 normalized_requirement）；`input-queue.ts` 同样移除该 import。Execute 后用 `grep -n "claude-agent-sdk" sillyhub-daemon/src/interactive/driver.ts sillyhub-daemon/src/interactive/input-queue.ts` 必须无输出。
- **E7（持久化隔离）**：本任务新增类型不进入 `PersistedSessionRecord` 白名单（task-10 才管持久化）；`InteractiveDriverHandle` 不可序列化（含子进程句柄），driver 契约注释明确禁止落盘。

## 非目标

- **不实现 `ClaudeSdkDriver` 的 `InteractiveDriver` 接口化**（task-03）：本任务只定义契约，ClaudeSdkDriver 仍是现有类，task-03 才让它 `implements InteractiveDriver` 并在内部做 `UserTurnInput → SDKUserMessage` 转换。
- **不实现 CodexAppServerDriver**（task-04）。
- **不建 driver registry 运行时路由**（task-02）：本任务只在 `SessionManagerDeps` 扩 `drivers` 字段类型，不改 SessionManager.create/restore/interrupt 的 provider 分支逻辑，不改 cli.ts 注册。
- **不改 session-manager.ts 业务逻辑**：仅允许一处 `new InputQueue()` → `new InputQueue<SDKUserMessage>()` 类型标注过渡；provider 路由、push 形态化、回调类型放宽均属 task-02。
- **不改 backend / frontend**（task-06..task-09）。
- **不改 onTurnResult/onTurnMessage 回调签名**（task-02/03 放宽为 driver message/result）。
- **不更新模块文档**（task-10 统一同步）。

## 参考

- 现有 `InputQueue`（`input-queue.ts`）：单订阅 FIFO AsyncIterable，close 幂等，双订阅抛 `SessionQueueDoubleSubscribeError`，close 后 push 抛 `SessionQueueClosedError`。泛型化后这些语义逐行保留。
- 现有 `ClaudeSdkDriver`（`claude-sdk-driver.ts`）：`start(input: AsyncIterable<SDKUserMessage>, opts)` / `consume(q, cb)` / `interrupt(q)`，是 `InteractiveDriver` 的 Claude 侧蓝本（task-03 对齐签名）。
- 现有 `SessionManagerDeps.driver`（`types.ts`）：单一 ClaudeSdkDriver；本任务在此基础上加 `drivers` registry。
- design.md §5.1（契约原文）、§4.1（文件清单）、decisions.md D-001@v1 / D-009@v1（normalized_requirement）。

## TDD 步骤

1. **写测试**：
   - `input-queue.test.ts`：新增 `new InputQueue<UserTurnInput>()` 用例——push `{type:'user', text:'hi'}` 后 `[Symbol.asyncIterator]()` 能 yield 该对象；close 后 iterator done；第二次订阅抛 `SessionQueueDoubleSubscribeError`；close 后 push 抛 `SessionQueueClosedError`。回归原 `SDKUserMessage` 用例（用 `new InputQueue<SDKUserMessage>()` 显式标注）确保不回退。
   - `driver.test.ts`：类型层断言——定义 `class FakeDriver implements InteractiveDriver { provider... }` 满足接口；构造一个 fake handle 满足 `InteractiveDriverHandle`；`const d: InteractiveDriver = new FakeDriver()` 编译通过；运行一个最小 `start→consume→interrupt` fake 流程断言回调被调用（用 in-memory async generator 当 input）。
2. **确认失败**：先跑 `pnpm --dir sillyhub-daemon test driver input-queue` 与 `pnpm --dir sillyhub-daemon typecheck`，确认新测试因 `driver.ts` 不存在 / InputQueue 未泛型化而失败。
3. **写实现**：新建 `driver.ts`、泛型化 `input-queue.ts`、扩 `types.ts` `SessionManagerDeps`、session-manager 一处类型标注过渡。
4. **确认通过**：`pnpm --dir sillyhub-daemon typecheck` 全绿（含 session-manager 过渡标注）；`pnpm --dir sillyhub-daemon test` 全绿（Claude 现有 interactive 测试不回退 = FR-10）。
5. **回归**：跑 `rg -n "claude-agent-sdk" sillyhub-daemon/src/interactive/driver.ts sillyhub-daemon/src/interactive/input-queue.ts` 确认无输出（D-009@v1 类型隔离）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `ls sillyhub-daemon/src/interactive/driver.ts` | 文件存在，且 `head` 含 `export interface InteractiveDriver` / `export interface UserTurnInput` / `export type InteractiveProvider` |
| AC-02 | `grep -n "claude-agent-sdk" sillyhub-daemon/src/interactive/driver.ts sillyhub-daemon/src/interactive/input-queue.ts` | **无任何输出**（D-009@v1：契约层与队列层脱离 SDK） |
| AC-03 | `grep -n "export class InputQueue<T" sillyhub-daemon/src/interactive/input-queue.ts` | 命中 `export class InputQueue<T = UserTurnInput>`，泛型默认 `UserTurnInput` |
| AC-04 | `grep -n "drivers:" sillyhub-daemon/src/interactive/types.ts` | 命中 `drivers: Partial<Record<'claude' \| 'codex', InteractiveDriver>>`（D-001@v1 registry 字段） |
| AC-05 | `pnpm --dir sillyhub-daemon typecheck` | 退出码 0（含 session-manager 过渡标注 `new InputQueue<SDKUserMessage>()`，Claude 现有路径编译等价，FR-10 不回退） |
| AC-06 | `pnpm --dir sillyhub-daemon test` | 全绿；现有 Claude interactive session-manager/input-queue 测试 0 失败（FR-10 回归判据） |
| AC-07 | `pnpm --dir sillyhub-daemon test sillyhub-daemon/src/interactive/driver.test.ts` | 新增 fake driver implements InteractiveDriver 测试通过，证明契约可被实现（D-001@v1 契约成立） |
| AC-08 | `pnpm --dir sillyhub-daemon test sillyhub-daemon/src/interactive/input-queue.test.ts` | 泛型化后 `<UserTurnInput>` 与 `<SDKUserMessage>` 两套用例均通过，FIFO/close/双订阅语义不变（D-009@v1 队列行为不回退） |
| AC-09 | `grep -n "InteractiveDriverMessage\|InteractiveDriverResult\|InteractiveDriverHandle\|InteractiveDriverCallbacks\|InteractiveDriverStartOptions" sillyhub-daemon/src/interactive/driver.ts` | 5 个类型全部导出（design §5.1 契约完整性） |
