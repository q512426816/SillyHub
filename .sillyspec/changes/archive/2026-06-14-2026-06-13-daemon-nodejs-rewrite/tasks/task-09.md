---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-09
title: ndjson adapter（src/adapters/ndjson.ts，opencode/openclaw/pi）
priority: P0
estimated_hours: 3
depends_on: [task-05]
blocks: [task-11]
allowed_paths:
  - sillyhub-daemon/src/adapters/ndjson.ts
  - sillyhub-daemon/tests/fixtures/ndjson/
---


# task-09：ndjson adapter（src/adapters/ndjson.ts，opencode/openclaw/pi）

> 变更：`2026-06-13-daemon-nodejs-rewrite`，Wave W1（协议抽象层），依赖 task-05（ProtocolAdapter 接口 + AgentEvent IR）。
> 本蓝图产出 `sillyhub-daemon/src/adapters/ndjson.ts`——opencode/openclaw/pi 三个 provider 共用的 NDJSON 流式协议解析器。
> 1:1 迁移自 Python `sillyhub_daemon/backends/ndjson.py` 的 `parse_output_multi` 解析逻辑，剥离 `execute()` 子进程执行（已下沉到 task-19 TaskRunner）。
> Python 源对照：`sillyhub_daemon/backends/ndjson.py:110-262`（解析全部逻辑）+ `tests/test_ndjson_backend.py`（`_make_ndjson_line({...})` 样本）。

- Wave：W1（协议抽象层）
- 依赖：task-05（ProtocolAdapter 接口 + AgentEvent IR 已就绪）
- 阻塞：task-11（`getBackend` 工厂 + `PROTOCOL_PROVIDERS` 映射，工厂需 import 本文件 `NdjsonAdapter`）
- 风险：R-01（协议解析翻译偏差，应对=1:1 迁移 Python 测试 fixture）

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/adapters/ndjson.ts` | `NdjsonAdapter` class（implements `ProtocolAdapter`），含 provider 字段、`parse(line)` 方法、内部 `_state` 累积器 |
| 新增 | `sillyhub-daemon/tests/fixtures/ndjson/opencode/sample.txt` | opencode 典型 NDJSON 事件流样本（多行，覆盖 text/tool_use/error/step_finish） |
| 新增 | `sillyhub-daemon/tests/fixtures/ndjson/openclaw/sample.txt` | openclaw 典型 NDJSON 事件流样本（与 opencode 同结构，验证无差异分支） |
| 新增 | `sillyhub-daemon/tests/fixtures/ndjson/pi/sample.txt` | pi 典型 NDJSON 事件流样本 |
| 新增 | `sillyhub-daemon/tests/adapters/ndjson.test.ts` | vitest 单测，1:1 迁移自 `test_ndjson_backend.py` 的 14 个用例（test 文件不计入 allowed_paths，开发期产物） |

依赖文件（仅 type-only import，无运行时耦合）：

| 文件路径 | 引用内容 |
|---|---|
| `sillyhub-daemon/src/adapters/protocol-adapter.ts`（task-05 产出） | `ProtocolAdapter` 接口（`NdjsonAdapter implements`） |
| `sillyhub-daemon/src/types.ts`（task-02 产出） | `AgentEvent` / `AgentEventType`（IR 类型，纯 import type） |

> 注意：本任务**只产 adapter + fixture**。不修改 ProtocolAdapter 接口（task-05）、不修改 types.ts（task-02）、不实现工厂（task-11）、不执行子进程（task-19）。

---

## 实现要求

### 1. class 定义与 provider 构造

- `export class NdjsonAdapter implements ProtocolAdapter`。
- 构造函数 `constructor(provider: 'opencode' | 'openclaw' | 'pi' = 'opencode')`：provider 不在合法集合内则 `throw new Error(`Unknown NdjsonAdapter provider: ${provider}`)`（对照 Python `_BINARY_MAP` 校验，L62-66）。
- `readonly provider: string` 字段由构造函数赋值，必须与 task-11 `PROTOCOL_PROVIDERS.ndjson` 数组中的 provider 名**逐字一致**（task-05 B-06 约束）。
- **三 provider 字段差异说明**（诚实记录）：Python `ndjson.py` 中 opencode/openclaw/pi 三者**共用完全相同的 NDJSON 解析逻辑**（type/part/sessionID/tokens 字段名一致，仅 `_BINARY_MAP` 的 binary 名不同）。Node 版同样**不引入 provider 字段差异分支**——adapter 内部 parse 逻辑统一。但保留 `provider` 字段标识，为未来某 provider 协议漂移留扩展点（届时在 `parse` 内按 `this.provider` 加分支）。
- **不实现 `onControl`**（task-05 B-02）：ndjson 协议无需 stdin 应答，类内不声明该方法（接口可选，缺省即 no-op）。
- **不实现 `execute()`**（方案B 拆分）：Python `execute()`（L278-353）的 spawn/进程管理全部下沉到 task-19 TaskRunner。本任务的 adapter 只产出 IR 事件，TaskRunner 负责 spawn + 逐行喂给 `parse`。

### 2. parse(line) type 映射（核心逻辑，对照 Python `_handle_event` L140-171）

`parse(line)` 流程（严格对齐 Python `parse_output_multi` L119-138）：

1. `line = line.trim()`；空串返回 `null`（task-05 B-07，对照 Python L121-123 `return []`）。
2. `JSON.parse(line)`，失败 `catch` 后 `console.warn` 并返回 `null`（task-05 B-04，对照 Python L125-129 的 `logger.warning + return []`）。
3. 取 `evt.type`（字符串，默认 `''`）、`evt.part`（对象，默认 `{}`）、`evt.sessionID`（可选，提取到 `_state.sessionId`）。
4. 按 `evt.type` 分派到 handler：

| evt.type | handler | 产出 AgentEvent | Python 对照 |
|---|---|---|---|
| `'text'` | `_handleTextEvent(part)` | `[{ type: 'text', content: part.text }]`，空 text 返回 `null` | L175-181 |
| `'tool_use'` | `_handleToolUseEvent(part)` | `[{type:'tool_use',...}, {type:'tool_result',...}?]`（completed 时双事件） | L183-229 |
| `'error'` | `_handleErrorEvent(evt.error)` | `[{ type: 'error', content: errMsg }]`，同时设 `_state.finalStatus='failed'` | L231-245 |
| `'step_start'` | 直接产出 | `[{ type: 'text', content: '', metadata: { status: 'running' } }]`（见下方映射说明） | L165-166 |
| `'step_finish'` | `_handleStepFinish(part)` | 返回 `null`（无事件），仅累积 token 到 `_state.usage` | L168-169, L247-262 |
| 其他 | — | 返回 `null`（task-05 B-04，对照 Python `return events` 空数组） | L150-171 |

### 3. step_start 事件 IR 映射（关键决策，必须文档化）

Python 产出 `AgentEvent(event_type="status", status="running")`，但 Node IR 的 `AgentEventType` 是 5 元组（task-02 定义：`text | tool_use | tool_result | error | complete`），**无 `status` 类型**。task-02 §实现要求 #2 明确「thinking/status 合入 metadata」。映射规则：

- `step_start` → `{ type: 'text', content: '', metadata: { status: 'running' } }`
- content 为空串（非空行丢弃），表达「这是一个状态事件，无文本」。
- 注意：这与 Python 的「空 text 返回 null」规则**不冲突**——空 text 规则针对 `evt.type === 'text'` 且 `part.text === ''`（Python L178-179）；`step_start` 是不同 evt.type，其 content 空串是有意为之的 IR 占位。
- 消费方（task-19 TaskRunner 的 `_eventToMessage`）按 `metadata.status` 字段识别为 status 消息，序列化为 `LeaseMessage.status='running'`。

### 4. part 累积（跨行状态，对照 Python `_NdjsonState` L27-42）

adapter 实例维护 `private _state` 字段（task-05 B-03 允许实例有状态，每个 lease 一个 adapter 实例）。累积三类状态：

- **output 文本累积**：`_handleTextEvent` 每次把 `part.text` 追加到 `this._state.output`（Python L180），用于最终 TaskResult.output 拼装（task-19 读取 `_state.output`）。
- **usage token 累积**：`_handleStepFinish` 把 `part.tokens.input/output/cache.read/cache.write` 累加到 `this._state.usage`（Python L247-262），多 step_finish 跨行累加（测试 `test_parse_step_finish_accumulates_across_multiple_steps` 验证）。
- **sessionId 提取**：任意事件带 `evt.sessionID` 即写入 `this._state.sessionId`（Python L134-136），后到覆盖先到。
- **finalStatus/finalError**：error 事件设 `finalStatus='failed'` + `finalError=errMsg`（Python L243-244）。这两个字段不通过 parse 产出 IR 事件，而由 TaskRunner（task-19）在子进程结束后从 adapter 实例读取。

> **状态读取接口**：除 `parse(line)` 外，本任务额外导出 4 个 getter 方法（`getOutput()` / `getSessionId()` / `getFinalStatus()` / `getUsage()`），供 task-19 TaskRunner 在子进程退出后读取累积状态拼装 TaskResult。这些方法**不在 ProtocolAdapter 接口内**（接口只约束 `parse`），是 NdjsonAdapter 的实现细节。

### 5. tool_use 复合事件（对照 Python `_handleToolUseEvent` L183-229）

`tool_use` 事件可能产出 1 或 2 个 IR 事件：

- **始终产出 tool_use 事件**：`{ type: 'tool_use', content: JSON.stringify(toolInput), metadata: { tool_name, call_id, tool_input } }`。
- **若 `part.state.status === 'completed'`**：额外产出 tool_result 事件 `{ type: 'tool_result', content: outputStr, metadata: { tool_name, call_id, tool_output } }`。
- `tool_input` 解析：`part.state.input` 可能是 string（尝试 JSON.parse，失败则包成 `{ raw: inputStr }`）或 object（直接用）（Python L195-204）。
- `tool_output` 提取：`part.state.output` 可能是 undefined（空串）/ string（直接用）/ object（`JSON.stringify`）（Python L264-274，对照 `extractToolOutput`）。

### 6. error 事件 message 提取优先级（对照 Python `_handleErrorEvent` L231-245）

`evt.error` 对象的 message 提取顺序：

1. `error.data.message`（最优先，Python L234-235）。
2. `error.name`（次优先，Python L236-237）。
3. 兜底 `'unknown error'`（Python L240-241）。

---

## 接口定义（完整 TS 代码，照抄即可）

> 文件：`sillyhub-daemon/src/adapters/ndjson.ts`
> 规则：strict 模式；零 `any`（用 `Record<string, unknown>`）；私有字段用 `private`；状态读方法用 `public`。
> 对照 Python：`ndjson.py:110-262`（解析）+ `ndjson.py:27-42`（`_NdjsonState`）。

```ts
/**
 * NdjsonAdapter —— opencode/openclaw/pi NDJSON 流式协议解析器。
 *
 * 协议形态（对照 opencode.go 的 processEvents）：
 *   子进程 `run --format json --dangerously-skip-permissions <prompt>` 的 stdout
 *   每行一个 JSON 对象 `{"type": "text"|"tool_use"|"error"|"step_start"|
 *   "step_finish", "part": {...}, "sessionID"?: "..."}`。
 *
 * 方案B 拆分（task-05 已定义）：
 *   - Python NdjsonBackend 的 execute() + parse_output_multi 双职拆开。
 *   - 本 adapter 只保留 parse(line) → AgentEvent IR 纯解析。
 *   - 子进程执行（spawn / stdin / 超时）下沉到 task-19 TaskRunner。
 *
 * 三 provider（opencode/openclaw/pi）共享完全相同的 NDJSON 字段结构
 *（Python _BINARY_MAP 仅区分 binary 名，解析逻辑无差异）。本 adapter
 * 不引入 provider 分支，但保留 provider 字段标识，为未来协议漂移留扩展点。
 *
 * @see Python sillyhub_daemon/backends/ndjson.py
 */

import type { AgentEvent } from '../types.js';
import type { ProtocolAdapter } from './protocol-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// 内部状态累积器（对照 Python _NdjsonState）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NDJSON 事件流累积状态（对照 Python ndjson.py:27-42 _NdjsonState）。
 *
 * 跨行累积三类信息：
 *   - output：所有 text 事件的文本拼接（用于最终 TaskResult.output）
 *   - usage：所有 step_finish 的 token 累加（input/output/cache.read/write）
 *   - sessionId：从任意事件提取的 sessionID（后到覆盖先到）
 *   - finalStatus / finalError：error 事件置 failed + 错误信息
 *
 * 这些状态不通过 parse 的返回值传递，而由 TaskRunner（task-19）在
 * 子进程退出后通过 getter 方法读取，拼装最终 TaskResult。
 */
interface NdjsonState {
  output: string;
  sessionId: string;
  finalStatus: 'completed' | 'failed' | 'timeout' | 'aborted';
  finalError: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  };
}

/**
 * 初始化一个空状态对象（对照 Python _NdjsonState 默认值）。
 */
function createInitialState(): NdjsonState {
  return {
    output: '',
    sessionId: '',
    finalStatus: 'completed',
    finalError: '',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NdjsonAdapter 实现
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 合法的 ndjson provider 字面量 union。
 * 对照 Python _BINARY_MAP 的三个 key（ndjson.py:56-60）。
 */
export type NdjsonProvider = 'opencode' | 'openclaw' | 'pi';

/**
 * NDJSON 流式协议 adapter（opencode/openclaw/pi 共用）。
 *
 * 用法（task-19 TaskRunner）：
 *   const adapter = new NdjsonAdapter('opencode');
 *   for await (const line of readLines(proc.stdout)) {
 *     const events = adapter.parse(line);
 *     if (events) for (const ev of events) submit(ev);
 *   }
 *   const result: BackendTaskResult = {
 *     status: adapter.getFinalStatus(),
 *     output: adapter.getOutput(),
 *     sessionId: adapter.getSessionId(),
 *   };
 */
export class NdjsonAdapter implements ProtocolAdapter {
  readonly provider: NdjsonProvider;
  private state: NdjsonState = createInitialState();

  constructor(provider: NdjsonProvider = 'opencode') {
    // 校验 provider 合法性（对照 Python L62-66 的 _BINARY_MAP 查找）
    if (provider !== 'opencode' && provider !== 'openclaw' && provider !== 'pi') {
      throw new Error(`Unknown NdjsonAdapter provider: ${provider}`);
    }
    this.provider = provider;
  }

  /**
   * 重置内部状态（新 lease 复用 adapter 实例时调用）。
   * 对照 Python _reset_state() L68-70。
   */
  resetState(): void {
    this.state = createInitialState();
  }

  // ── ProtocolAdapter.parse ──────────────────────────────────────────────

  /**
   * 解析一行 NDJSON，返回 0..N 个 AgentEvent。
   *
   * 流程（对照 Python parse_output_multi L119-138）：
   *   1. trim；空行返回 null。
   *   2. JSON.parse；失败 warn + 返回 null（不抛异常，task-05 B-04）。
   *   3. 提取 type/part/sessionID，按 type 分派到 handler。
   *
   * 返回约定（task-05 B-01）：
   *   - null：空行 / 坏 JSON / step_finish（纯元数据）/ 未知 type
   *   - []：不使用（Python 返回空 list 的场景在 Node 版统一用 null）
   *   - 非空数组：text/tool_use/tool_result/error 事件
   *
   * 注意：step_start 产出单个 text 事件（content 空串 + metadata.status='running'），
   * 这是 IR 5 元组收敛 status 类型的约定（task-02 §实现要求 #2）。
   */
  parse(line: string): AgentEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(trimmed);
    } catch (err) {
      // 对照 Python L128: logger.warning + return []
      console.warn(`ndjson: failed to parse line: ${trimmed.slice(0, 200)}`);
      return null;
    }

    const evtType = (evt['type'] as string) ?? '';
    const part = (evt['part'] as Record<string, unknown>) ?? {};
    const sessionID = evt['sessionID'] as string | undefined;

    // 任意事件都可能携带 sessionID（对照 Python L134-136）
    if (sessionID) {
      this.state.sessionId = sessionID;
    }

    return this.handleEvent(evtType, part, evt);
  }

  // ── 事件分派（对照 Python _handle_event L140-171） ──────────────────────

  private handleEvent(
    evtType: string,
    part: Record<string, unknown>,
    raw: Record<string, unknown>,
  ): AgentEvent[] | null {
    switch (evtType) {
      case 'text': {
        const ev = this.handleTextEvent(part);
        return ev ? [ev] : null;
      }
      case 'tool_use': {
        return this.handleToolUseEvent(part);
      }
      case 'error': {
        const errObj = (raw['error'] as Record<string, unknown>) ?? {};
        const ev = this.handleErrorEvent(errObj);
        return ev ? [ev] : null;
      }
      case 'step_start': {
        // IR 收敛：status 类事件映射为 text + metadata.status（task-02 §实现要求 #2）
        return [{ type: 'text', content: '', metadata: { status: 'running' } }];
      }
      case 'step_finish': {
        this.handleStepFinish(part);
        return null; // 无事件产出，仅累积 usage
      }
      default:
        // 未知 type：对照 Python 默认分支（events 空数组）→ 返回 null
        return null;
    }
  }

  // ── 单事件 handler ──────────────────────────────────────────────────────

  /**
   * text 事件（对照 Python _handle_text_event L175-181）。
   * 空 text 返回 null（不产出空 text 事件，避免 backend 收到无意义消息）。
   */
  private handleTextEvent(part: Record<string, unknown>): AgentEvent | null {
    const text = (part['text'] as string) ?? '';
    if (!text) return null;
    // 累积到 state.output（对照 Python L180）
    this.state.output += text;
    return { type: 'text', content: text };
  }

  /**
   * tool_use 事件（对照 Python _handle_tool_use_event L183-229）。
   * 始终产出 tool_use；若 state.status==='completed' 额外产出 tool_result。
   */
  private handleToolUseEvent(part: Record<string, unknown>): AgentEvent[] | null {
    const events: AgentEvent[] = [];

    const state = (part['state'] as Record<string, unknown>) ?? {};
    const toolName = (part['tool'] as string) ?? '';
    const callId = (part['callID'] as string) ?? '';

    // 解析 tool_input（对照 Python L195-204）
    const rawInput = state['input'];
    let toolInput: Record<string, unknown> | string | null = null;
    if (rawInput !== undefined && rawInput !== null) {
      if (typeof rawInput === 'string') {
        try {
          toolInput = JSON.parse(rawInput) as Record<string, unknown>;
        } catch {
          toolInput = { raw: rawInput };
        }
      } else if (typeof rawInput === 'object') {
        toolInput = rawInput as Record<string, unknown>;
      }
    }

    // 始终产出 tool_use 事件
    events.push({
      type: 'tool_use',
      content: toolInput !== null ? JSON.stringify(toolInput) : '',
      metadata: {
        tool_name: toolName,
        call_id: callId,
        tool_input: toolInput,
      },
    });

    // 若 completed，额外产出 tool_result（对照 Python L217-227）
    if (state['status'] === 'completed') {
      const outputStr = this.extractToolOutput(state['output']);
      events.push({
        type: 'tool_result',
        content: outputStr,
        metadata: {
          tool_name: toolName,
          call_id: callId,
          tool_output: outputStr,
        },
      });
    }

    return events;
  }

  /**
   * error 事件（对照 Python _handle_error_event L231-245）。
   * message 优先级：error.data.message > error.name > 'unknown error'。
   * 同时置 state.finalStatus='failed' + finalError。
   */
  private handleErrorEvent(error: Record<string, unknown>): AgentEvent | null {
    const errData = (error['data'] as Record<string, unknown>) ?? {};
    let errMsg = '';
    if (errData['message']) {
      errMsg = errData['message'] as string;
    } else if (error['name']) {
      errMsg = error['name'] as string;
    }
    if (!errMsg) errMsg = 'unknown error';

    this.state.finalStatus = 'failed';
    this.state.finalError = errMsg;
    return { type: 'error', content: errMsg };
  }

  /**
   * step_finish 事件（对照 Python _handle_step_finish L247-262）。
   * 累加 token 到 state.usage，无事件产出。
   */
  private handleStepFinish(part: Record<string, unknown>): void {
    const tokens = part['tokens'] as Record<string, unknown> | undefined;
    if (!tokens) return;

    this.state.usage.input_tokens += (tokens['input'] as number) ?? 0;
    this.state.usage.output_tokens += (tokens['output'] as number) ?? 0;

    const cache = tokens['cache'] as Record<string, unknown> | undefined;
    if (cache) {
      this.state.usage.cache_read_tokens += (cache['read'] as number) ?? 0;
      this.state.usage.cache_write_tokens += (cache['write'] as number) ?? 0;
    }
  }

  /**
   * 工具输出转字符串（对照 Python _extract_tool_output L264-274）。
   * undefined → ''；string → 原值；object → JSON.stringify。
   */
  private extractToolOutput(output: unknown): string {
    if (output === undefined || output === null) return '';
    if (typeof output === 'string') return output;
    return JSON.stringify(output);
  }

  // ── 状态读取（供 task-19 TaskRunner 在子进程退出后调用） ────────────────

  /** 累积的文本输出（所有 text 事件拼接）。 */
  getOutput(): string {
    return this.state.output;
  }

  /** 提取的会话 ID（用于多轮续跑）。 */
  getSessionId(): string {
    return this.state.sessionId;
  }

  /** 终态：completed（默认）/ failed（error 事件触发）。 */
  getFinalStatus(): NdjsonState['finalStatus'] {
    return this.state.finalStatus;
  }

  /** 失败时的错误信息（completed 时为空串）。 */
  getFinalError(): string {
    return this.state.finalError;
  }

  /** 累积的 token usage（多 step_finish 跨行累加）。 */
  getUsage(): NdjsonState['usage'] {
    return { ...this.state.usage };
  }
}
```

---

## 边界处理

| 编号 | 边界场景 | 处理策略 | Python 对照 |
|---|---|---|---|
| **B-01** | 空行 / 仅空白字符的 line | `line.trim()` 后空串 → 返回 `null`（不产出事件，避免 backend 收空消息，task-05 B-07） | Python L121-123 `return []` |
| **B-02** | JSON.parse 失败（坏 JSON / 非 JSON 噪声） | `catch` 后 `console.warn` 记录前 200 字符 + 返回 `null`（不抛异常，task-05 B-04）。子进程 stdout 可能有 git 提示/ANSI 残片，吞掉而非中断 lease | Python L125-129 `logger.warning + return []` |
| **B-03** | 未知 evt.type（非 text/tool_use/error/step_start/step_finish） | `switch` default 分支返回 `null`（对照 Python 默认空 events 数组）。新增 type 时扩展 switch | Python L150-171 默认分支 |
| **B-04** | part 字段缺失（无 part / part 非 object） | `(evt['part'] as Record<string, unknown>) ?? {}` 兜底为空对象，handler 内各字段用 `?? ''` / `?? 0` 兜底默认值。不抛异常 | Python L133 `part = evt.get("part", {})` |
| **B-05** | tool_use 的 state.input 是 string 但非合法 JSON | `try { JSON.parse } catch { toolInput = { raw: rawInput } }` 保留原值（对照 Python L198-202），避免丢失工具入参 | Python L198-202 |
| **B-06** | tool_use 的 state.output 是 dict/object（非 string） | `extractToolOutput` 用 `JSON.stringify` 序列化（对照 Python L274）。测试 `test_tool_use_with_dict_output` 验证 dict → JSON string 往返 | Python L264-274 |
| **B-07** | part 累积跨行（output 文本 / usage token） | adapter 实例 `private state` 跨多次 parse 调用累积（task-05 B-03 允许实例状态）。output 在 `_handleTextEvent` 追加；usage 在 `_handleStepFinish` 累加。测试 `test_parse_text_event_accumulates_output` + `test_parse_step_finish_accumulates_across_multiple_steps` 验证 | Python L180, L256-262 |
| **B-08** | sessionID 在多个事件重复出现（后到覆盖先到） | `if (sessionID) this.state.sessionId = sessionID`（对照 Python L135-136），后到覆盖。空/undefined 不覆盖已有值 | Python L134-136 |
| **B-09** | error 事件的 error.data.message 和 error.name 都缺失 | 兜底 `'unknown error'`（对照 Python L240-241），保证 content 非空 | Python L240-241 |
| **B-10** | 三 provider 字段差异（实际无差异） | Python 源中 opencode/openclaw/pi 共用相同 NDJSON 字段结构（type/part/sessionID/tokens）。本 adapter **不引入 provider 分支**，parse 逻辑统一。若未来某 provider 字段漂移，按 `this.provider` 在 handler 内加分支——当前 YAGNI 不预设 | Python _BINARY_MAP 仅区分 binary |
| **B-11** | provider 构造参数非法（非三选一） | 构造函数 `throw new Error(...)`（对照 Python L63-64 ValueError）。fail-fast，不让非法 provider 进入工厂 | Python L62-66 |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-09-1**：不执行子进程（spawn / stdin 管理 / 超时看门狗）。执行职责在 task-19 TaskRunner。本 adapter 只产出 IR 事件，由 TaskRunner 喂 line + 收集累积状态。
- **N-09-2**：不实现 `getBackend` 工厂和 `PROTOCOL_PROVIDERS` 映射。在 task-11。本 adapter 只 `export class NdjsonAdapter`，工厂负责实例化。
- **N-09-3**：不实现 `build_args`（命令行参数拼装）。Python `build_args`（L74-106）的 argv 构造逻辑下沉到 task-19 TaskRunner 或独立的 args-builder 模块。本 adapter 不碰 argv。
- **N-09-4**：不实现 `onControl`（stdin 应答）。ndjson 协议无 control_request（task-05 B-02），类内不声明该方法。
- **N-09-5**：不迁移全部 Python 测试（test_ndjson_backend.py 中 `TestNdjsonBuildArgs` 的 6 个 build_args 用例不迁，因 build_args 已下沉 task-19）。仅迁移解析相关用例（text/tool_use/error/step/edge cases 共 ~14 个）。
- **N-09-6**：不产出 `complete` 事件。Python 源不产出 complete 事件，TaskRunner 在子进程退出后统一补发 complete（task-19 职责）。
- **N-09-7**：不修改 ProtocolAdapter 接口（task-05）或 types.ts（task-02）。本任务只 import 既有类型。
- **N-09-8**：不处理子进程 stderr。stderr 由 TaskRunner 捕获并拼入 BackendExecResult.error，本 adapter 不读 stderr。

---

## 参考

### Python 源（字段与逻辑提取依据）

| 文件 | 行号 | 提取内容 |
|---|---|---|
| `sillyhub-daemon/sillyhub_daemon/backends/ndjson.py` | L27-42 | `_NdjsonState` dataclass（output/session_id/final_status/final_error/usage）→ `NdjsonState` interface |
| 同上 | L56-66 | `_BINARY_MAP` + 构造函数 provider 校验 → `NdjsonProvider` union + 构造函数 throw |
| 同上 | L110-138 | `parse_output` / `parse_output_multi` → `parse(line)` 主流程（trim/JSON.parse/sessionID 提取/分派） |
| 同上 | L140-171 | `_handle_event` → `handleEvent` switch 分派 |
| 同上 | L175-181 | `_handle_text_event`（output 累积）→ `handleTextEvent` |
| 同上 | L183-229 | `_handle_tool_use_event`（双事件：tool_use + tool_result）→ `handleToolUseEvent` |
| 同上 | L195-204 | tool_input 解析（string→JSON.parse / object→直接用 / 失败→{raw}） |
| 同上 | L217-227 | completed 时产出 tool_result |
| 同上 | L231-245 | `_handle_error_event`（message 优先级 + 置 failed）→ `handleErrorEvent` |
| 同上 | L247-262 | `_handle_step_finish`（token 累加）→ `handleStepFinish` |
| 同上 | L264-274 | `_extract_tool_output`（string/object/None 分支）→ `extractToolOutput` |
| `sillyhub-daemon/tests/test_ndjson_backend.py` | L16-32 | `_make_ndjson_line` helper + `_new_backend` → fixture 生成器 + 测试 setup |
| 同上 | L103-143 | `TestNdjsonParseTextEvent`（3 用例：text/empty/累积） |
| 同上 | L151-202 | `TestNdjsonParseToolUseEvent`（2 用例：call_only/completed_emits_result） |
| 同上 | L209-234 | `TestNdjsonParseErrorEvent`（2 用例：data.message/name_only） |
| 同上 | L241-299 | `TestNdjsonParseStepEvents`（4 用例：step_start/step_finish tokens/累积/session_id） |
| 同上 | L307-363 | `TestNdjsonEdgeCases`（6 用例：empty/invalid_json/unknown_type/provider×3/dict_output/issubclass） |

### design.md 章节

| 章节 | 引用点 |
|---|---|
| §5.1 分层架构 | ProtocolAdapter 抽象层定位（adapter 只保留 parse 职责） |
| §7.1 统一中间表示 AgentEvent（IR） | AgentEvent 5 元组定义（type/content/metadata）——本 adapter 产出 IR 的目标类型 |
| §7.2 ProtocolAdapter 接口 | `parse(line) → AgentEvent[] \| null` 签名约束（本 adapter implements） |
| §7.3 工厂与映射 | `ndjson: ['opencode', 'openclaw', 'pi']`——本 adapter 支持的 provider 集合 |
| §10 R-01 | 协议解析翻译偏差风险（应对=1:1 迁移 Python fixture） |

### 模块文档

| 文档 | 引用点 |
|---|---|
| `.sillyspec/docs/sillyhub-daemon/modules/backends.md` | `AgentEvent.event_type` 值域（text/tool_use/tool_result/thinking/status/error）→ Node IR 收敛映射依据；`AgentBackend(ABC)` 契约（Node 版拆 parse 出来） |

### 任务依赖链

| 任务 | 关系 |
|---|---|
| task-02（types.ts） | 本任务 import `AgentEvent` / `AgentEventType`（纯 type-only） |
| task-05（protocol-adapter.ts） | 本任务 `implements ProtocolAdapter`（接口契约） |
| task-11（adapters/index.ts） | 工厂 `getBackend('opencode')` 等 → `new NdjsonAdapter(provider)` |
| task-19（task-runner.ts） | TaskRunner 调 `adapter.parse(line)` + 读 `getOutput()`/`getFinalStatus()` 等拼装 BackendTaskResult |

---

## TDD 步骤

> 流程：文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收（项目铁律）。
> 本任务 1:1 迁移 Python `test_ndjson_backend.py` 的 14 个解析用例（排除 6 个 build_args 用例，见 N-09-3）。

### 步骤 1：前置检查

- 确认 task-02 的 `src/types.ts` 已 export `AgentEvent` / `AgentEventType`。
- 确认 task-05 的 `src/adapters/protocol-adapter.ts` 已 export `ProtocolAdapter` 接口。
- 确认 task-04 的 vitest 脚手架就绪（`vitest.config.ts` + `tests/` 目录）。
- 若以上未就绪，本任务阻塞（depends_on task-05 已声明，task-05 又依赖 task-02）。

### 步骤 2：创建 fixture（三 provider 样本）

在 `sillyhub-daemon/tests/fixtures/ndjson/` 下创建三份典型样本（每份多行 NDJSON，覆盖核心 type）：

**opencode/sample.txt**（对照 test 文件的 _make_ndjson_line 样本）：

```json
{"type":"text","part":{"text":"Hello from opencode"},"sessionID":"sess-opencode-1"}
{"type":"step_start","part":{}}
{"type":"tool_use","part":{"tool":"Bash","callID":"call-1","state":{"status":"running","input":{"command":"ls -la"}}}}
{"type":"tool_use","part":{"tool":"Read","callID":"call-2","state":{"status":"completed","input":{"file_path":"/tmp/x.py"},"output":"file contents"}}}
{"type":"step_finish","part":{"tokens":{"input":100,"output":50,"cache":{"read":20,"write":10}}}}
{"type":"error","error":{"name":"ModelError","data":{"message":"invalid model"}}}
```

**openclaw/sample.txt**（同结构，验证无 provider 分支）：

```json
{"type":"text","part":{"text":"Openclaw response"},"sessionID":"sess-openclaw-1"}
{"type":"step_finish","part":{"tokens":{"input":80,"output":40}}}
```

**pi/sample.txt**（同结构）：

```json
{"type":"text","part":{"text":"Pi agent output"},"sessionID":"sess-pi-1"}
{"type":"tool_use","part":{"tool":"Grep","callID":"call-pi-1","state":{"status":"completed","input":{"pattern":"foo"},"output":{"matches":["line1","line2"]}}}}
```

### 步骤 3：写测试（tests/adapters/ndjson.test.ts）

1:1 迁移 Python 14 个用例（vitest 风格）。**先写测试，红→绿**：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NdjsonAdapter, type NdjsonProvider } from '../../src/adapters/ndjson.js';
import type { AgentEvent } from '../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'fixtures', 'ndjson');

// 复刻 Python _make_ndjson_line helper（test_ndjson_backend.py:16-20）
function makeNdjsonLine(eventType: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: eventType, ...fields });
}

function newAdapter(provider: NdjsonProvider = 'opencode'): NdjsonAdapter {
  return new NdjsonAdapter(provider);
}

describe('NdjsonAdapter — text event', () => {
  // 对应 Python TestNdjsonParseTextEvent L103-143
  it('parses text event with content', () => {
    const a = newAdapter();
    const events = a.parse(makeNdjsonLine('text', { part: { text: 'Hello from opencode' }, sessionID: 's1' }));
    expect(events).toHaveLength(1);
    expect(events![0].type).toBe('text');
    expect(events![0].content).toBe('Hello from opencode');
  });

  it('returns null for empty text', () => {
    const a = newAdapter();
    expect(a.parse(makeNdjsonLine('text', { part: { text: '' } }))).toBeNull();
  });

  it('accumulates output across lines', () => {
    const a = newAdapter();
    a.parse(makeNdjsonLine('text', { part: { text: 'Line 1' } }));
    a.parse(makeNdjsonLine('text', { part: { text: 'Line 2' } }));
    expect(a.getOutput()).toBe('Line 1Line 2');
  });
});

describe('NdjsonAdapter — tool_use event', () => {
  // 对应 Python TestNdjsonParseToolUseEvent L151-202
  it('emits tool_use only when status=running', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('tool_use', {
      part: { tool: 'Bash', callID: 'call-1', state: { status: 'running', input: { command: 'ls -la' } } },
    });
    const events = a.parse(line);
    expect(events).toHaveLength(1);
    expect(events![0].type).toBe('tool_use');
    expect(events![0].metadata?.tool_name).toBe('Bash');
    expect(events![0].metadata?.call_id).toBe('call-1');
    expect(events![0].metadata?.tool_input).toEqual({ command: 'ls -la' });
  });

  it('emits tool_use + tool_result when status=completed', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('tool_use', {
      part: { tool: 'Read', callID: 'call-2', state: { status: 'completed', input: { file_path: '/tmp/x.py' }, output: 'file contents' } },
    });
    const events = a.parse(line);
    expect(events).toHaveLength(2);
    expect(events![0].type).toBe('tool_use');
    expect(events![1].type).toBe('tool_result');
    expect(events![1].metadata?.tool_output).toBe('file contents');
  });

  it('serializes dict tool_output to JSON', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('tool_use', {
      part: { tool: 'Grep', callID: 'call-3', state: { status: 'completed', input: {}, output: { matches: ['line1', 'line2'] } } },
    });
    const events = a.parse(line);
    expect(events).toHaveLength(2);
    expect(events![1].type).toBe('tool_result');
    expect(JSON.parse(events![1].content)).toEqual({ matches: ['line1', 'line2'] });
  });
});

describe('NdjsonAdapter — error event', () => {
  // 对应 Python TestNdjsonParseErrorEvent L209-234
  it('extracts message from error.data.message', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('error', { error: { name: 'ModelError', data: { message: 'invalid model' } } });
    const events = a.parse(line);
    expect(events).toHaveLength(1);
    expect(events![0].type).toBe('error');
    expect(events![0].content).toBe('invalid model');
    expect(a.getFinalStatus()).toBe('failed');
  });

  it('falls back to error.name when data.message missing', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('error', { error: { name: 'FatalError' } });
    const events = a.parse(line);
    expect(events![0].content).toBe('FatalError');
  });
});

describe('NdjsonAdapter — step events', () => {
  // 对应 Python TestNdjsonParseStepEvents L241-299
  it('maps step_start to text + metadata.status', () => {
    const a = newAdapter();
    const events = a.parse(makeNdjsonLine('step_start', { part: {} }));
    expect(events).toHaveLength(1);
    expect(events![0].type).toBe('text'); // IR 收敛
    expect(events![0].metadata?.status).toBe('running');
  });

  it('accumulates tokens from step_finish', () => {
    const a = newAdapter();
    const line = makeNdjsonLine('step_finish', {
      part: { tokens: { input: 100, output: 50, cache: { read: 20, write: 10 } } },
    });
    expect(a.parse(line)).toBeNull();
    const usage = a.getUsage();
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(50);
    expect(usage.cache_read_tokens).toBe(20);
    expect(usage.cache_write_tokens).toBe(10);
  });

  it('accumulates tokens across multiple step_finish', () => {
    const a = newAdapter();
    a.parse(makeNdjsonLine('step_finish', { part: { tokens: { input: 100, output: 50 } } }));
    a.parse(makeNdjsonLine('step_finish', { part: { tokens: { input: 200, output: 100 } } }));
    const usage = a.getUsage();
    expect(usage.input_tokens).toBe(300);
    expect(usage.output_tokens).toBe(150);
  });

  it('extracts sessionID from any event', () => {
    const a = newAdapter();
    a.parse(makeNdjsonLine('text', { part: { text: 'hi' }, sessionID: 'sess-ndjson-1' }));
    expect(a.getSessionId()).toBe('sess-ndjson-1');
  });
});

describe('NdjsonAdapter — edge cases', () => {
  // 对应 Python TestNdjsonEdgeCases L307-363
  it('returns null for empty line', () => {
    expect(newAdapter().parse('')).toBeNull();
  });

  it('returns null for whitespace-only line', () => {
    expect(newAdapter().parse('   \n\t  ')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(newAdapter().parse('not json')).toBeNull();
  });

  it('returns null for unknown event type', () => {
    expect(newAdapter().parse(makeNdjsonLine('unknown_event', { part: {} }))).toBeNull();
  });

  it('exposes provider field for opencode/openclaw/pi', () => {
    expect(newAdapter('opencode').provider).toBe('opencode');
    expect(newAdapter('openclaw').provider).toBe('openclaw');
    expect(newAdapter('pi').provider).toBe('pi');
  });

  it('throws on invalid provider', () => {
    expect(() => new NdjsonAdapter('claude' as NdjsonProvider)).toThrow(/Unknown NdjsonAdapter provider/);
  });
});

describe('NdjsonAdapter — fixture samples (three providers equivalence)', () => {
  // AC-01: 三 provider 样本产出等价 IR（验证无 provider 分支）
  it.each(['opencode', 'openclaw', 'pi'] as const)('parses %s fixture without error', (provider) => {
    const a = new NdjsonAdapter(provider);
    const content = readFileSync(join(FIXTURES, provider, 'sample.txt'), 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const allEvents: AgentEvent[] = [];
    for (const line of lines) {
      const ev = a.parse(line);
      if (ev) allEvents.push(...ev);
    }
    expect(allEvents.length).toBeGreaterThan(0);
    // 验证 state 累积正常
    expect(a.getOutput().length).toBeGreaterThan(0);
  });

  it('opencode and openclaw produce equivalent parse logic (no provider branch)', () => {
    // 同一行输入，两个 provider 产出完全相同的 IR
    const line = makeNdjsonLine('text', { part: { text: 'same' } });
    const ev1 = new NdjsonAdapter('opencode').parse(line);
    const ev2 = new NdjsonAdapter('openclaw').parse(line);
    expect(ev1).toEqual(ev2);
  });
});
```

### 步骤 4：写实现（src/adapters/ndjson.ts）

按上文「接口定义」章节完整写入。测试此时应由红转绿。

### 步骤 5：跑验证

```bash
cd sillyhub-daemon
npx tsc --noEmit                                                # AC-04: tsc 零错误
npx vitest run tests/adapters/ndjson.test.ts                    # AC-03: vitest 全绿
npx vitest run tests/adapters/ndjson.test.ts --coverage          # 覆盖率检查（可选）
```

### 步骤 6：对照 Python 用例回归

人工核对：本 adapter 的 14 个用例与 `test_ndjson_backend.py` 的解析用例（排除 TestNdjsonBuildArgs）一一对应，断言语义等价（AgentEvent 字段映射差异已在 IR 收敛中说明）。

---

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | 三 provider（opencode/openclaw/pi）样本产出**等价** AgentEvent | 运行 `ndjson.test.ts` 的 `fixture samples` + `opencode and openclaw produce equivalent` 用例 | 三 provider 各自样本解析无异常、产出事件数 > 0；同输入下 opencode/openclaw 的 IR 深度相等（`expect(ev1).toEqual(ev2)`） |
| **AC-02** | part 累积行为**对齐 Python** | 运行 `accumulates output across lines` + `accumulates tokens from step_finish` + `accumulates tokens across multiple step_finish` 三个用例 | output 跨行拼接（'Line 1Line 2'）；usage token 跨 step_finish 累加（input 100+200=300, output 50+100=150）；sessionID 后到覆盖先到 |
| **AC-03** | vitest 单测全绿 | `cd sillyhub-daemon && npx vitest run tests/adapters/ndjson.test.ts` | exit code 0；所有用例 pass（≥14 个解析用例 + ≥2 个 fixture 等价用例） |
| **AC-04** | TypeScript 编译零错误 | `cd sillyhub-daemon && npx tsc --noEmit` | exit code 0；零 error/warning；strict + noImplicitAny 下零 `any` |
| **AC-05** | `NdjsonAdapter implements ProtocolAdapter` 类型断言通过 | tsc 编译时检查 implements 关系；可选 type-test | `new NdjsonAdapter('opencode')` 可赋值给 `ProtocolAdapter` 类型变量无 TS 错误 |
| **AC-06** | type 映射 5 种全覆盖 | grep + 测试覆盖 | text/tool_use/tool_result/error/complete（complete 由 TaskRunner 补，本 adapter 产 text/tool_use/tool_result/error 4 种 + step_start 收敛为 text） |
| **AC-07** | tool_use completed 双事件正确 | 运行 `emits tool_use + tool_result when status=completed` + `serializes dict tool_output to JSON` 用例 | state.status==='completed' 时产出 2 个事件（tool_use + tool_result）；dict output 经 JSON.stringify 往返可解析 |
| **AC-08** | error message 优先级正确 | 运行 `extracts message from error.data.message` + `falls back to error.name` 用例 | data.message 优先；缺失时回退 name；都缺失时 'unknown error'；同时置 getFinalStatus()='failed' |
| **AC-09** | step_start IR 收敛为 text + metadata.status | 运行 `maps step_start to text + metadata.status` 用例 | 产出单事件 `{type:'text', content:'', metadata:{status:'running'}}`（Python status 事件经 IR 5 元组收敛） |
| **AC-10** | 坏行不抛异常（返回 null） | 运行 `returns null for invalid JSON` + `returns null for empty line` + `returns null for unknown event type` 用例 | JSON.parse 失败/空行/未知 type 均返回 null，不中断 lease |
| **AC-11** | provider 构造校验 fail-fast | 运行 `throws on invalid provider` 用例 | 非法 provider 抛 `Error: Unknown NdjsonAdapter provider: <name>` |
| **AC-12** | 仅触碰 allowed_paths 内文件 | `git diff --name-only` | `sillyhub-daemon/src/adapters/ndjson.ts` + `sillyhub-daemon/tests/fixtures/ndjson/{opencode,openclaw,pi}/sample.txt` + `sillyhub-daemon/tests/adapters/ndjson.test.ts`（测试文件开发期产物） |

