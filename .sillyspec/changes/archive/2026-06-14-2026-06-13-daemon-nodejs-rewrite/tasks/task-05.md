---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-05
title: ProtocolAdapter 接口 + AgentEvent IR（src/adapters/protocol-adapter.ts）
priority: P0
estimated_hours: 1
depends_on: [task-02]
blocks: [task-06, task-07, task-08, task-09, task-10, task-11]
allowed_paths:
  - sillyhub-daemon/src/adapters/protocol-adapter.ts
---

# task-05：ProtocolAdapter 接口 + AgentEvent IR（src/adapters/protocol-adapter.ts）

> 本任务是方案B 的核心深化点。Python 版 `AgentBackend(ABC)` 同时承担「执行子进程」和「解析输出」两职；Node 版拆开——子进程执行下沉到 TaskRunner（task-19）单点，adapter 只保留纯解析职责 `parse(line)`，输出统一 IR `AgentEvent`。本任务只产出**接口契约**，不实现任何具体协议。

- Wave：W1（协议抽象层）
- 依赖：task-02（`src/types.ts` 已定义 `AgentEvent`）
- 阻塞：task-06~10（5 个 adapter 实现）、task-11（`getBackend` 工厂 + `PROTOCOL_PROVIDERS`）
- Python 源对照：`sillyhub_daemon/backends/__init__.py`（提取 ABC 抽象方法签名）

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/adapters/protocol-adapter.ts` | `ProtocolAdapter` 接口 + `BackendExecResult` 接口；`AgentEvent` 从 `../types.js` import，不重复定义 |

本任务**仅触碰 1 个文件**。不新增测试文件（接口无逻辑，TDD 走 compile-time 断言，见下文 §TDD 步骤）。

---

## 实现要求

1. **定义 `ProtocolAdapter` 接口**：包含 `provider` 只读字段、`parse(line)` 方法、可选 `onControl(stdin)` 方法。三个成员的语义与 Python `AgentBackend` 的 `provider` 属性 + `parse_output` 抽象方法对齐，但把 `execute()` 抽象方法**移除**（执行职责下沉到 task-19 TaskRunner）。
2. **定义 `BackendExecResult` 接口**：子进程执行的通用结果结构（status / output / error / sessionId），由 TaskRunner 统一生成，**不是 adapter 职责**，但与 adapter 同文件声明，供 task-19 引用。
3. **从 `types.ts` import `AgentEvent`**：`import type { AgentEvent } from '../types.js';`。**禁止在本文件重新定义 `AgentEvent`**（DRY，避免双源漂移，AC-04）。`AgentEventType` 联合类型同样由 task-02 的 types.ts 提供。
4. **方案B 拆分原理（写进 JSDoc）**：在 `ProtocolAdapter` 接口顶部 JSDoc 注明——Python 版 `AgentBackend(ABC)` 的 `execute()` + `parse_output()` 双职在 Node 版拆开，子进程执行（spawn/stdin/env/diff）下沉到 TaskRunner 单点；adapter 只保留纯解析职责。新增协议 = 新增一个 parse 实现，零侵入编排层（对应 G-03）。
5. **解释 `parse` 为何返回数组**：一行 stdout 可能产出多个 event（如 jsonl 的复合行 / stream_json 一个 message 内多段 content block），故返回 `AgentEvent[] | null`，而非 Python 版的单个 `AgentEvent | None`。JSDoc 须写明此差异原因。
6. **解释 `onControl` 为何可选**：仅 stream_json 协议（claude/gemini/cursor）的 `control_request` 需要向 stdin 写批准应答（R-03），其余 4 种协议不需要。声明为可选方法（`onControl?`），缺省即 no-op。
7. **零运行时逻辑**：本文件只有 `import type` + `interface` 声明，编译后不产出 JS（`isolatedModules` + type-only），保证零副作用。

---

## 接口定义

以下是 `sillyhub-daemon/src/adapters/protocol-adapter.ts` 的完整内容（搬砖工照抄即可）：

```ts
/**
 * ProtocolAdapter —— 子进程 stdout 的纯解析契约（方案B 核心）。
 *
 * 设计动机（方案B 深化点）：
 * Python 版 `AgentBackend(ABC)` 同时承担「执行子进程」（execute）和
 * 「解析输出」（parse_output）两职。Node 版拆开——
 *   - 子进程执行（spawn / stdin / env / diff 收集）下沉到 TaskRunner 唯一入口；
 *   - adapter 只保留纯解析职责 parse(line) → AgentEvent IR。
 * 新增协议 = 新增一个 parse 实现，零侵入编排层（design.md G-03）。
 *
 * @see design.md §5.1 / §7.2
 */

import type { AgentEvent } from '../types.js';

/**
 * 子进程 stdout 一行的解析契约。协议差异 100% 收敛于此接口。
 *
 * 实现方（task-06~10）：stream_json / json_rpc / jsonl / ndjson / text 各一个
 * 实现。工厂 getBackend(provider)（task-11）按 provider 返回对应实例。
 */
export interface ProtocolAdapter {
  /**
   * provider 标识（claude / codex / copilot / gemini / cursor / ...）。
   * 必须与 PROTOCOL_PROVIDERS（task-11）中注册的 provider 名一致。
   */
  readonly provider: string;

  /**
   * 解析子进程 stdout 的一行，返回 0..N 个 AgentEvent（IR）。
   *
   * 为什么返回数组而非单个：
   *   Python 版 parse_output 返回 AgentEvent | None（单值）。Node 版升级为数组，
   *   因为某些协议一行可产出多个事件——
   *     - stream_json：一个 assistant message 内可能含多段 content block
   *       （text + tool_use 交错）；
   *     - jsonl：某些 provider 的复合行可拆出 session + tool_use；
   *   返回数组让 adapter 一次吐尽，编排层无需二次缓冲。
   *
   * 语义约定：
   *   - 返回 null：该行被识别但主动丢弃（如心跳 / 无业务意义的 keepalive）；
   *   - 返回 []（空数组）：该行已处理但无事件产出（与 null 等价，二者皆合法）；
   *   - 返回非空数组：正常产出事件，编排层逐个 submit_messages。
   *
   * 纯函数约束：parse 不应修改全局/静态状态，不发起 I/O，不抛异常（坏行
   * 应返回 null 或产出 error 事件，见 §边界处理 B-04）。有状态 adapter
   * （需跨行累积，如 jsonl/ndjson/text 的多行拼接）在实例字段维护缓冲，
   * 不污染外部。
   *
   * @param line 子进程 stdout 的一行（已去除换行符，UTF-8 字符串）
   */
  parse(line: string): AgentEvent[] | null;

  /**
   * 可选：对子进程 stdin 的 control_request 应答器。
   *
   * 仅 stream_json 协议（claude / gemini / cursor）需要——子进程输出
   * `control_request`（工具批准 / 权限确认）时，需向 stdin 写应答 JSON
   * 才能继续，否则子进程 hang（风险 R-03）。
   *
   * 其余 4 种协议（json_rpc / jsonl / ndjson / text）不需要 stdin 应答，
   * 故声明为可选方法，缺省即 no-op。
   *
   * 调用时机由 TaskRunner（task-19）在解析到 control 类事件时触发，
   * 传入子进程的 stdin writable stream。
   *
   * @param stdin 子进程的 stdin（NodeJS.WritableStream），adapter 向其 write 应答
   */
  onControl?(stdin: NodeJS.WritableStream): void;
}

/**
 * 子进程执行的通用结果（非 adapter 职责，由 TaskRunner 统一生成）。
 *
 * 此接口声明在 adapter 文件是因为它与 adapter 的产出强相关（TaskRunner
 * 调 adapter.parse 累积事件 → 拼成最终结果），task-19 TaskRunner 与
 * task-11 工厂都会 import 它。放这里避免循环依赖。
 *
 * 注意：这是「执行结果」的简版契约，完整的 TaskResult（含 events 数组 /
 * duration_ms / patch / filesChanged）在 src/types.ts（task-02）定义，
 * TaskRunner 会把 BackendExecResult + diff 合成完整 TaskResult。
 */
export interface BackendExecResult {
  /** 退出状态：completed（exit 0）/ failed（exit !=0）/ timeout（看门狗触发） */
  status: 'completed' | 'failed' | 'timeout';
  /** 累积的 stdout 文本输出（已 strip ANSI / 去除协议噪声后的可读文本） */
  output: string;
  /** 失败或超时时的错误信息（status 为 completed 时应缺省） */
  error?: string;
  /** agent 会话 ID（若协议产出，用于 backend 侧追溯） */
  sessionId?: string;
}
```

---

## 边界处理

| 编号 | 边界场景 | 处理策略 |
|---|---|---|
| **B-01** | `parse` 返回 `null` vs `[]`（空数组）的语义区分 | 二者在编排层等价（皆不产事件）。约定：`null` 表示「该行被识别但主动丢弃」（如 keepalive / 心跳）；`[]` 表示「该行已处理但无事件」（如纯元数据行）。adapter 实现可任选其一，但 JSDoc 须写明选择哪类。编排层（task-19）对两者都按「跳过」处理，不做区分。 |
| **B-02** | `onControl` 缺省 no-op | 声明为可选方法（`onControl?`）。TaskRunner 调用前用 `typeof adapter.onControl === 'function'` 守卫，未实现则跳过。对 stream_json（task-06）是必填，对其余 4 个 adapter（task-07~10）不实现。 |
| **B-03** | `parse` 是否持有状态（纯函数 vs 有状态 adapter） | `parse` 本身是「无副作用」的方法签名，但 adapter **实例可以有状态**。原因：jsonl / ndjson / text 协议需跨行累积（如多行拼成一个完整事件、会话上下文）。约定：状态只能存在 adapter 实例字段（如 `private buffer: string[]`），不能修改全局/静态，不能发起 I/O。这样每个 lease 一个 adapter 实例（task-11 工厂按需 new），状态隔离。 |
| **B-04** | `parse` 遇到坏行（无法解析的 JSON / 格式错乱）：吞掉还是抛异常？ | **不抛异常**。约定：坏行返回 `null`（或产出单个 `{ type: 'error', content: 'unparseable line: ...' }` 事件，取决于 adapter 实现策略，JSDoc 须写明）。理由：子进程 stdout 可能有非协议噪声（git 提示 / 警告 / ANSI 残片），抛异常会中断整个 lease。TaskRunner（task-19）应额外包一层 try-catch 兜底，防止 adapter 实现违反约定。 |
| **B-05** | `line` 含非 UTF-8 字节 / 二进制噪声 | Node 的 `readline` 默认按 UTF-8 解码，无法解码的字节会被替换为 U+FFFD（replacement char）。adapter 不负责编码修复，直接对替换后的字符串 parse。若整行都是二进制（极端情况），按 B-04 返回 null 丢弃。TaskRunner（task-19）负责用 `readline` 切行并保证传入 parse 的是已去换行符的 UTF-8 字符串。 |
| **B-06** | `provider` 字段与工厂注册名不一致 | adapter 实现的 `provider` 字段必须与 task-11 `PROTOCOL_PROVIDERS` 映射中的 provider 名**逐字一致**（小写、无空格，如 `'claude'` 非 `'Claude'`）。task-11 工厂会做断言校验（若不一致抛错）。本任务的接口不强制运行时校验，但 JSDoc 写明此约束。 |
| **B-07** | 空行 / 仅空白字符的 line | adapter 应返回 `null`（主动丢弃），不产出空 text 事件。避免 backend 收到无意义的空消息。task-06~10 各 adapter 实现须覆盖此边界用例。 |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-05-1**：不实现任何具体协议的 parse 逻辑。stream_json / json_rpc / jsonl / ndjson / text 的具体实现分别在 task-06 / task-07 / task-08 / task-09 / task-10。本任务只产出接口契约。
- **N-05-2**：不实现子进程执行（spawn / stdin 管理 / 超时看门狗）。执行职责在 task-19 TaskRunner。`BackendExecResult` 只是声明类型，生成逻辑在 task-19。
- **N-05-3**：不实现 `getBackend` 工厂和 `PROTOCOL_PROVIDERS` 映射。在 task-11。
- **N-05-4**：不重新定义 `AgentEvent` / `AgentEventType`。从 task-02 的 `src/types.ts` import。若 task-02 尚未定义 `AgentEvent`，本任务阻塞（depends_on task-02 已声明）。
- **N-05-5**：不写运行时测试（接口无逻辑）。仅写 compile-time 断言测试（见 §TDD 步骤）。
- **N-05-6**：不处理 stdin 应答的具体协议细节（control_request 的 JSON 格式）。在 task-06 stream_json adapter。

---

## 参考

- **Python 源**：`sillyhub-daemon/sillyhub_daemon/backends/__init__.py`
  - `AgentBackend(ABC)`（L51-74）：本任务提取 `provider` 属性 + `parse_output` 抽象方法签名；`execute` 抽象方法移除（下沉 TaskRunner）。
  - `AgentEvent` dataclass（L19-31）：task-02 已映射为 TS interface，本任务 import。
  - `TaskResult` dataclass（L34-43）：task-02 已映射；本任务的 `BackendExecResult` 是其子集（执行层视角）。
  - `PROTOCOL_PROVIDERS` / `get_protocol` / `get_backend`（L81-146）：在 task-11，不在本任务。
- **design.md**：
  - §5.1 分层架构（ProtocolAdapter 抽象层定位 + 方案B 拆分原理）
  - §7.1 统一中间表示 AgentEvent（IR）—— 本任务 import 的来源
  - §7.2 ProtocolAdapter 抽象接口（方案B 核心）—— 本任务的接口定义依据
  - §10 R-03（stdin control_request 应答风险，对应 `onControl` 可选方法）
- **模块文档**：`.sillyspec/docs/sillyhub-daemon/modules/backends.md`
  - 「契约摘要」`AgentBackend(ABC)` 条目：子类须实现 execute() 和 parse_output() → Node 版拆开。
  - 「注意事项」：`AgentEvent.event_type` 值域（text/tool_use/tool_result/thinking/status/error）。
- **plan.md**：task-05 行（L81）「方案B 核心：parse(line)→AgentEvent[] + onControl?(stdin) 可选；拆开执行与解析两职」。

---

## TDD 步骤

接口无运行时逻辑，TDD 走 **compile-time 断言**（type-level test）。步骤：

1. **前置**：确认 task-02 的 `src/types.ts` 已 export `AgentEvent`（含 `type` 字段为 `AgentEventType` 联合，`content: string`，可选 `metadata`）。若未就绪，本任务阻塞。
2. **写测试**（与本文件同 PR，但测试文件**不计入 allowed_paths**——作为开发期验证，可临时放 `tests/adapters/protocol-adapter.type-test.ts`，验收后可删；或直接用 `tsc --noEmit` 验证不产出测试文件）：

   ```ts
   // tests/adapters/protocol-adapter.type-test.ts
   import type { AgentEvent } from '../../src/types.js';
   import type { ProtocolAdapter, BackendExecResult } from '../../src/adapters/protocol-adapter.js';

   // AC-03: mock adapter 能赋值给 ProtocolAdapter 接口
   const mockAdapter: ProtocolAdapter = {
     provider: 'mock',
     parse(line: string): AgentEvent[] | null {
       return line.trim() ? [{ type: 'text', content: line }] : null;
     },
     // onControl 故意不实现 —— 验证可选性
   };

   // 验证 parse 返回类型
   const events: AgentEvent[] | null = mockAdapter.parse('hello');
   if (events === null) throw new Error('expected events');

   // 验证 onControl 可选调用
   mockAdapter.onControl?.(process.stdin);

   // AC: BackendExecResult 结构正确
   const result: BackendExecResult = {
     status: 'completed',
     output: 'done',
   };
   if (result.status !== 'completed') throw new Error('type mismatch');
   ```

3. **跑验证**：
   ```bash
   cd sillyhub-daemon
   npx tsc --noEmit                    # AC-01: 零错误
   npx vitest run tests/adapters/protocol-adapter.type-test.ts  # mock 赋值通过
   ```
4. **通过标准**：`tsc --noEmit` 零错误 + type-test 运行通过（mock adapter 满足接口 + `onControl` 可省略）。

---

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | TypeScript 编译零错误 | `cd sillyhub-daemon && npx tsc --noEmit` | 退出码 0，无任何 error/warning 输出 |
| **AC-02** | `ProtocolAdapter` 接口含三个成员 | `grep -E 'provider\|parse\|onControl' src/adapters/protocol-adapter.ts` | 命中 `readonly provider: string`、`parse(line: string): AgentEvent[] \| null`、`onControl?(stdin: NodeJS.WritableStream): void` 三行 |
| **AC-03** | mock adapter 能赋值给 `ProtocolAdapter` 接口 | 运行 type-test（§TDD 步骤） | 编译通过 + 运行通过；省略 `onControl` 不报 TS 错误 |
| **AC-04** | `AgentEvent` 从 `types.ts` 复用，非重复定义 | `grep -c 'interface AgentEvent\|type AgentEvent' src/adapters/protocol-adapter.ts` 应为 0；`grep "from '../types.js'" src/adapters/protocol-adapter.ts` 应命中 1 行 | 本文件 0 处定义 AgentEvent；1 处 `import type { AgentEvent } from '../types.js'` |
| **AC-05** | `BackendExecResult` 接口已声明且字段完整 | `grep -A4 'export interface BackendExecResult' src/adapters/protocol-adapter.ts` | 含 `status`（联合类型 completed/failed/timeout）、`output`、可选 `error`、可选 `sessionId` 四个字段 |
| **AC-06** | 方案B 拆分原理写进 JSDoc | 人工 review `protocol-adapter.ts` 顶部 JSDoc | 注释明确写「Python 版 execute + parse_output 双职拆开，执行下沉 TaskRunner，adapter 只保留 parse」语义 |
| **AC-07** | `parse` 返回数组的原因写进 JSDoc | 人工 review `parse` 方法 JSDoc | 注释说明「一行可产出多个 event（stream_json 多 content block / jsonl 复合行）」 |
| **AC-08** | 仅触碰 allowed_paths 内文件 | `git diff --name-only` | 只有 `sillyhub-daemon/src/adapters/protocol-adapter.ts` 一个文件（type-test 文件若保留则另算，验收后建议删除） |
