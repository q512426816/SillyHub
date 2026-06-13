---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-08
title: jsonl adapter（src/adapters/jsonl.ts，copilot）
priority: P0
estimated_hours: 3
depends_on: [task-05]
blocks: [task-11]
allowed_paths:
  - sillyhub-daemon/src/adapters/jsonl.ts
  - sillyhub-daemon/tests/fixtures/jsonl/
---

# task-08：jsonl adapter（src/adapters/jsonl.ts，copilot）

> jsonl 协议（copilot）的纯解析 adapter。子进程（copilot CLI `--output-format json`）逐行输出 NDJSON，每行 `{"type": "dotted.event.name", "data": {...}, ...}`。本任务实现 `JsonlAdapter` 把每个点分事件映射到统一 IR `AgentEvent`，并维护 session 维度的累积状态（output 文本 / session_id / final_status）。

- Wave：W1（协议抽象层，5 个 adapter 之一）
- 依赖：task-05（`ProtocolAdapter` 接口 + `AgentEvent` IR 已就绪）
- 阻塞：task-11（`getBackend` 工厂 + `PROTOCOL_PROVIDERS` 注册 `copilot` provider）
- Python 源对照：`sillyhub_daemon/backends/jsonl.py`（核心解析逻辑 `_handle_event` + 8 个 `_handle_*` 子方法）
- 测试对照：`sillyhub_daemon/tests/test_jsonl_backend.py`（`_make_jsonl_line(event_type, data)` helper 构造的样本，1:1 迁移到 vitest）

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/adapters/jsonl.ts` | `JsonlAdapter implements ProtocolAdapter`，provider=`'copilot'`，`parse(line)` 按点分事件 type 分发，session 状态累积 |
| 新增 | `sillyhub-daemon/tests/fixtures/jsonl/copilot/session_start.txt` | `{"type":"session.start","data":{"sessionId":"abc-123","selectedModel":"gpt-4.1"}}` 一行 |
| 新增 | `sillyhub-daemon/tests/fixtures/jsonl/copilot/tool_use.txt` | `{"type":"assistant.message","data":{"messageId":"m1","content":"","toolRequests":[{"toolCallId":"tc1","name":"Read","arguments":{"file_path":"/tmp/x.py"},"type":"tool_call"}]}}` 一行 |
| 新增 | `sillyhub-daemon/tests/fixtures/jsonl/copilot/message.txt` | `{"type":"assistant.message_delta","data":{"messageId":"m1","deltaContent":"Hello "}}` 一行 |
| 新增 | `sillyhub-daemon/tests/fixtures/jsonl/copilot/complete.txt` | `{"type":"result","sessionId":"final-session-1","exitCode":0}` 一行 |

> 测试文件本身（`tests/adapters/jsonl.test.ts`）不在 allowed_paths 内——按项目惯例测试文件计入开发期验证，验收时与 fixture 一同提交。**若项目要求测试文件也必须在 allowed_paths**，扩展该字段即可（当前对齐 task-06~10 兄弟任务惯例：fixture 进 allowed_paths，test 文件作为开发期产出）。

---

## 实现要求

### parse 事件 type 映射

jsonl 协议的 `type` 字段使用**点分事件名**（如 `session.start`、`assistant.message_delta`）。Python 版在 `_handle_event`（jsonl.py L122-171）用 `if/elif` 链按完整 type 字符串匹配。**Node 版对齐为 switch 分支**（不拆分点分层级，直接对整个 type 字符串 switch，理由见 §边界处理 B-04）。事件 type 与 IR 映射表如下（**真实事件名，照搬 Python 版**）：

| copilot 事件 type | 产出 IR AgentEvent | Python handler | 说明 |
|---|---|---|---|
| `session.start` | `[]`（无事件，仅更新状态） | `_handle_session_start` | 从 `data.sessionId` 存 session_id，`data.selectedModel` 存 active_model |
| `assistant.message_delta` | `[{type:'text', content: delta}]` 或 `[]` | `_handle_message_delta` | 取 `data.deltaContent`，空串返回 `[]`，非空则 append 到 `output` |
| `assistant.message` | `[reasoning?, tool_use...]`（可多 event） | `_handle_message` | **一行多 event 的核心场景**：先产出 reasoning（thinking）事件，再为每个 `toolRequests[]` 产出 tool_use 事件；同时重置 output 避免与 delta 双计 |
| `assistant.reasoning` / `assistant.reasoning_delta` | `[{type:'thinking', content: text}]` 或 `[]` | `_handle_reasoning` | 取 `data.content` 或 `data.deltaContent` |
| `tool.execution_complete` | `[{type:'tool_result', call_id, tool_output}]` | `_handle_tool_complete` | `data.success` 区分成功/失败；失败时 `data.error.message` 拼成 `"Error: ..."` |
| `assistant.turn_start` | `[{type:'status', metadata:{status:'running'}}]` | 直接 append | 标记一轮开始 |
| `session.error` | `[{type:'error', content: msg}]` | `_handle_session_error` | 同时置 `final_status='failed'`、`final_error=msg` |
| `session.warning` | `[{type:'status', content: msg, metadata:{level:'warn'}}]` | `_handle_session_warning` | 警告不影响 final_status |
| `result` | `[]`（无事件，仅更新状态） | `_handle_result` | 终止行：`raw.sessionId` 存 session_id；`raw.exitCode != 0` → final_status='failed' + final_error 拼接 `"copilot exited with code N"` |
| 其它未知 type | `[]`（忽略） | default 分支静默丢弃 | 见 §边界处理 B-01 |

> **AgentEvent 字段映射约定**：Python 版 `AgentEvent` 有平铺字段（`event_type`/`content`/`tool_name`/`call_id`/`tool_input`/`tool_output`/`status`/`level`/`session_id`），Node 版 IR（task-02 types.ts）收敛为 `{type, content, metadata?}`。映射规则：
> - `event_type` → `type`
> - `content` → `content`
> - 其余字段（`tool_name`/`call_id`/`tool_input`/`tool_output`/`status`/`level`）→ `metadata: { ... }`
>
> **若 task-02 的 types.ts 把 `AgentEvent` 定义为平铺字段而非 metadata 收敛**，则 adapter 直接赋平铺字段即可，本任务的接口定义骨架已同时给出两种写法的注释占位（见 §接口定义注释）。**实现时以 task-02 实际定义为准**（依赖 task-05 通过 import 拿到的类型）。

### session 状态

adapter 实例维护一个 `_state`（私有字段），跨多行累积（对应 task-05 §B-03「有状态 adapter」约定，状态只在实例字段，不污染全局）：

```ts
interface JsonlState {
  output: string;        // 累积的文本输出（delta 拼接 / message 重置）
  sessionId: string;     // 从 session.start 或 result 行获取
  activeModel: string;   // 从 session.start.selectedModel 获取
  finalStatus: 'completed' | 'failed' | 'timeout';  // 默认 completed
  finalError: string;    // 错误信息累积
}
```

- **实例化时初始化**为默认值（`output=''`、`finalStatus='completed'`）。
- **不暴露 reset 方法**给外部（Python 版的 `_reset_state` 是给 execute 用的，Node 版 execute 已下沉 task-19；若 task-19 需要重置，直接 new 新实例）。
- **TaskRunner（task-19）约定**：每个 lease 一个新 `JsonlAdapter` 实例（task-11 工厂 new），状态天然隔离，无需手动 reset。

### 一行多 event 行为（关键对齐点）

Python 版 `parse_output_multi`（jsonl.py L101-120）会返回 `list[AgentEvent]`，而非单个。唯一会一行产出多个 event 的 type 是 **`assistant.message`**（`_handle_message` L188-231）：当一行同时含 `reasoningText` + 多个 `toolRequests[]` 时，先 push thinking 事件，再为每个 toolRequest push 一个 tool_use 事件。

Node 版对齐：`parse(line)` 返回 `AgentEvent[]`，对 `assistant.message` 分支产出多 event 数组。**这是 task-05 接口 `parse` 返回数组（而非单值）的核心动机之一**（task-05 §实现要求 5 已注明 jsonl 复合行场景）。验证用例：`test_jsonl_backend.py::TestJsonlParseMessageFull::test_parse_message_full_with_tool_requests`（L194-216）断言 `events[0].event_type == "tool_use"`；**注意 Python 版该用例 input 只有 toolRequests 没有 reasoningText**，故只产出 1 个 tool_use；真正的多 event 用例需构造 reasoning + toolRequests 同时存在的 input（Python 版无此测试，本任务需补一条对齐用例，见 §TDD 步骤 6）。

### output 累积与重置（防双计）

Python 版 `_handle_message`（L188-231）有特殊逻辑：当 `assistant.message` 的 `content` 到达时，先检查 `output` 是否已 endswith 该 content（因 delta 先到），若是则截掉尾部，再加 `\n\n` 分隔符，最后 append content。这是为避免 delta + 全量 message 双计。Node 版**逐行翻译此逻辑**，不简化。

---

## 接口定义

以下是 `sillyhub-daemon/src/adapters/jsonl.ts` 的完整骨架（搬砖工照抄即可，`// TODO` 处填具体字段提取）。事件 type 名是真实 copilot 协议名，直接对齐 Python 版 jsonl.py L134-170：

```ts
/**
 * JsonlAdapter —— copilot CLI 的 JSONL 点分事件协议解析器。
 *
 * copilot CLI 启动参数 `--output-format json` 后，stdout 逐行输出 NDJSON，
 * 每行结构：`{"type": "dotted.event.name", "data": {...}, "sessionId"?, ...}`。
 * 本 adapter 把每行的点分 type 映射到统一 IR AgentEvent，并在实例字段
 * 维护 session 维度的累积状态（output 文本 / session_id / final_status）。
 *
 * 设计参考：Python 版 `sillyhub_daemon/backends/jsonl.py`（1:1 行为对齐）。
 *
 * 方案B 定位（task-05）：本类只做纯解析，不负责子进程执行（spawn/stdin/
 * 超时）——执行下沉到 TaskRunner（task-19）。每个 lease 一个新实例，
 * 状态隔离，无需 reset。
 *
 * @see design.md §7.1（AgentEvent IR）/ §7.3（PROTOCOL_PROVIDERS: jsonl→[copilot]）
 * @see Python 源 sillyhub_daemon/backends/jsonl.py
 */

import type { AgentEvent } from '../types.js';
import type { ProtocolAdapter } from './protocol-adapter.js';

/** jsonl adapter 内部累积状态（对应 Python _JsonlState，jsonl.py L28-36）。 */
interface JsonlState {
  output: string;
  sessionId: string;
  activeModel: string;
  finalStatus: 'completed' | 'failed' | 'timeout';
  finalError: string;
}

/**
 * copilot 的点分 JSONL 协议解析器。
 *
 * 一行可产出 0..N 个 AgentEvent：
 *   - 大多数 type 产出 0 或 1 个 event；
 *   - `assistant.message` 是唯一一行多 event 的 type（reasoning + 多个 tool_use）。
 *
 * 状态约定（task-05 §B-03）：状态只在实例字段，不修改全局，不发起 I/O。
 */
export class JsonlAdapter implements ProtocolAdapter {
  readonly provider = 'copilot';

  private state: JsonlState = {
    output: '',
    sessionId: '',
    activeModel: '',
    finalStatus: 'completed',
    finalError: '',
  };

  /** 暴露只读 state 快照，供 TaskRunner（task-19）读取累积 output / session_id。 */
  getState(): Readonly<JsonlState> {
    return this.state;
  }

  /**
   * 解析一行 JSONL，返回 0..N 个 AgentEvent。
   *
   * 语义（对齐 task-05 接口约定）：
   *   - 空行 / 坏 JSON / 未知 type → 返回 []（已处理无事件，等价于 null）；
   *   - session.start / result → 仅更新状态，返回 []；
   *   - assistant.message_delta / reasoning / tool.execution_complete → 返回 [event]；
   *   - assistant.message（含 reasoning + toolRequests）→ 返回 [thinking, tool_use, ...]。
   *
   * 不抛异常：坏行返回 []（task-05 §B-04），TaskRunner 另包 try-catch 兜底。
   */
  parse(line: string): AgentEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    let evt: any;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      // 坏 JSON：吞掉，返回空（对齐 Python except (JSONDecodeError, ValueError)）。
      return [];
    }
    if (typeof evt !== 'object' || evt === null) return [];

    const evtType: string = evt.type ?? '';
    const data: any = evt.data ?? {};

    switch (evtType) {
      case 'session.start':
        this.handleSessionStart(data);
        return [];

      case 'assistant.message_delta':
        return this.handleMessageDelta(data);

      case 'assistant.message':
        return this.handleMessage(data);

      case 'assistant.reasoning':
      case 'assistant.reasoning_delta':
        return this.handleReasoning(data);

      case 'tool.execution_complete':
        return this.handleToolComplete(data);

      case 'assistant.turn_start':
        return [{ type: 'status', content: '', metadata: { status: 'running' } }];

      case 'session.error':
        return this.handleSessionError(data);

      case 'session.warning':
        return this.handleSessionWarning(data);

      case 'result':
        this.handleResult(evt);
        return [];

      default:
        // 未知 type：静默丢弃（对齐 Python default 无 append）。
        return [];
    }
  }

  // ── 各 type handler（对齐 Python _handle_* 方法）──────────────────────

  private handleSessionStart(data: any): void {
    if (data.selectedModel) this.state.activeModel = data.selectedModel;
    if (data.sessionId) this.state.sessionId = data.sessionId;
  }

  private handleMessageDelta(data: any): AgentEvent[] {
    const delta: string = data.deltaContent ?? '';
    if (!delta) return [];
    this.state.output += delta;
    return [{ type: 'text', content: delta }];
  }

  /**
   * assistant.message：一行多 event 的核心场景。
   * 步骤（对齐 Python _handle_message，jsonl.py L188-231）：
   *   1. 若 content 非空：重置 output 防双计（先截尾、加 \n\n 分隔、append）；
   *   2. 若 reasoningText 非空：push thinking 事件；
   *   3. 遍历 toolRequests[]：每个 push 一个 tool_use 事件（arguments 可为 string/dict）。
   */
  private handleMessage(data: any): AgentEvent[] {
    const events: AgentEvent[] = [];

    const content: string = data.content ?? '';
    if (content) {
      // 防双计：若 output 已 endswith content（delta 先到），截掉尾部。
      const current = this.state.output;
      if (current.endsWith(content)) {
        this.state.output = current.slice(0, -content.length);
      }
      // 加分隔符（若已有内容且不以 \n\n 结尾）。
      if (this.state.output && !this.state.output.endsWith('\n\n')) {
        this.state.output += '\n\n';
      }
      this.state.output += content;
    }

    // reasoning
    const reasoning: string = data.reasoningText ?? '';
    if (reasoning) {
      events.push({ type: 'thinking', content: reasoning });
    }

    // tool requests
    const toolRequests: any[] = Array.isArray(data.toolRequests) ? data.toolRequests : [];
    for (const tr of toolRequests) {
      let toolInput: Record<string, unknown> | undefined;
      const args = tr.arguments;
      if (args) {
        if (typeof args === 'string') {
          try {
            toolInput = JSON.parse(args);
          } catch {
            toolInput = { raw: args };
          }
        } else if (typeof args === 'object') {
          toolInput = args as Record<string, unknown>;
        }
      }
      events.push({
        type: 'tool_use',
        content: '',
        metadata: {
          toolName: tr.name ?? '',
          callId: tr.toolCallId ?? '',
          toolInput,
        },
      });
    }

    return events;
  }

  private handleReasoning(data: any): AgentEvent[] {
    const text: string = data.content ?? data.deltaContent ?? '';
    if (!text) return [];
    return [{ type: 'thinking', content: text }];
  }

  private handleToolComplete(data: any): AgentEvent[] {
    const callId: string = data.toolCallId ?? '';
    const success: boolean = data.success ?? true;
    let resultContent = '';

    if (success) {
      const resultObj = data.result;
      if (resultObj && typeof resultObj === 'object') {
        resultContent = resultObj.content ?? '';
      }
    } else {
      const errorObj = data.error;
      if (errorObj && typeof errorObj === 'object') {
        resultContent = 'Error: ' + (errorObj.message ?? 'unknown');
      } else if (data.result && typeof data.result === 'object') {
        resultContent = data.result.content ?? '';
      } else {
        resultContent = 'Error: unknown';
      }
    }

    return [{
      type: 'tool_result',
      content: resultContent,
      metadata: {
        callId,
        toolOutput: resultContent,
      },
    }];
  }

  private handleSessionError(data: any): AgentEvent[] {
    const msg: string = data.message ?? 'unknown error';
    this.state.finalStatus = 'failed';
    this.state.finalError = msg;
    return [{ type: 'error', content: msg }];
  }

  private handleSessionWarning(data: any): AgentEvent[] {
    const msg: string = data.message ?? '';
    return [{
      type: 'status',
      content: msg,
      metadata: { level: 'warn' },
    }];
  }

  private handleResult(raw: any): void {
    if (raw.sessionId) this.state.sessionId = raw.sessionId;
    const exitCode: number = raw.exitCode ?? 0;
    if (exitCode !== 0) {
      this.state.finalStatus = 'failed';
      const exitMsg = `copilot exited with code ${exitCode}`;
      if (this.state.finalError) {
        if (!this.state.finalError.includes(exitMsg)) {
          this.state.finalError += '; ' + exitMsg;
        }
      } else {
        this.state.finalError = exitMsg;
      }
    }
  }
}

/**
 * NOTE（搬砖工）：
 * 1. AgentEvent 的 metadata 字段名（toolName / callId / toolInput / toolOutput /
 *    status / level）以 task-02 的 types.ts 实际定义为准。若 types.ts 把
 *    AgentEvent 定义为平铺字段（而非 metadata 收敛），把上述 metadata:{...}
 *    改为平铺赋值（如 `{ type:'tool_use', toolName: ..., callId: ... }`）。
 *    task-05 §实现要求 3 明确「AgentEvent 从 types.ts import，不重复定义」，
 *    以 task-02 实际形状为准。
 * 2. provider 字段必须为 'copilot'（小写），与 task-11 PROTOCOL_PROVIDERS
 *    中 `jsonl: ['copilot']` 逐字一致（task-05 §B-06）。
 * 3. 不实现 onControl（jsonl 协议无 stdin 应答需求，task-05 §B-02）。
 */
```

---

## 边界处理

| 编号 | 边界场景 | 处理策略 |
|---|---|---|
| **B-01** | 未知事件 type（如 `foo.bar`、未来 copilot 新增的事件） | 返回 `[]`（静默丢弃）。对齐 Python 版 `_handle_event` 的 default 无 append 分支（jsonl.py L171 直接 `return events` 空 list）。**不抛异常、不产出 error 事件**——未知 type 不等于错误（copilot 可能发新增的辅助事件）。测试用例：`test_jsonl_backend.py::TestJsonlEdgeCases::test_unknown_event_type_skipped`（L335-339）。 |
| **B-02** | `JSON.parse` 失败（坏 JSON / 非 JSON 噪声行） | 返回 `[]`，吞掉异常。对齐 Python 版 `except (json.JSONDecodeError, ValueError): return []`（jsonl.py L113-115）。理由：子进程 stdout 可能有 git 提示 / 警告 / ANSI 残片等非协议噪声（task-05 §B-04）。TaskRunner（task-19）另包一层 try-catch 兜底，防止 adapter 违反约定抛异常。测试用例：`test_invalid_json_skipped`（L331-333）。 |
| **B-03** | session 未开始（未收到 `session.start`）就收到 `message` / `tool_use` 等 | **正常处理，不报错**。对齐 Python 版行为——`_handle_message` 等不检查 session 是否已 start，直接处理 data。理由：copilot 实际输出顺序有保证（session.start 必先到），但 adapter 不做强校验；即使乱序，状态字段（sessionId/activeModel）会保持默认空串，不影响事件产出。**不额外加「session 未开始则丢弃」的逻辑**——这是过度设计，Python 版无此逻辑，对齐原则下不加。 |
| **B-04** | 点分事件名层级（`session.start` 是 2 段，`assistant.message_delta` 也是 2 段，是否有 3 段以上的 type？） | **不拆分层级，直接对整个 type 字符串 switch**。对齐 Python 版 `if evt_type == "session.start"`（jsonl.py L134）的完整字符串匹配策略。理由：(1) copilot 当前协议所有 type 都是 ≤2 段点分名，无 3 段；(2) 即使未来出现 3 段，按完整字符串 switch 仍能精确匹配；(3) 拆分前缀（如 `assistant.*`）会引入隐式优先级，与 Python 版「逐字匹配」语义不符。**不引入 `evtType.split('.')[0]` 之类的层级分发**。 |
| **B-05** | 空行 / 仅空白字符的 line | 返回 `[]`。对齐 Python 版 `line = line.strip(); if not line: return []`（jsonl.py L107-109）。测试用例：`test_empty_line_skipped`（L320-322）、`test_whitespace_line_skipped`（L324-326）。task-05 §B-07 亦约定空行返回 null/[]。 |
| **B-06** | `assistant.message` 的 `toolRequests[].arguments` 可能是 string（需 JSON.parse）也可能是 dict（直接用） | 对齐 Python 版 `_handle_message` L211-221：string 则 try JSON.parse，失败则 `{raw: args}`；dict 则直接用。本任务接口定义 §handleMessage 已实现此分支。测试用例：`test_parse_message_full_with_tool_requests`（L194-216）用 dict 形式。 |
| **B-07** | `assistant.message` 同时含 `content` 和已累积的 delta output（双计风险） | 对齐 Python 版防双计逻辑（jsonl.py L196-202）：若 `output.endsWith(content)` 则截掉尾部，再加 `\n\n` 分隔符，最后 append。测试用例：`test_parse_message_full_resets_output`（L168-192）。**逐行翻译，不简化**——这是 copilot 协议的实际行为，简化会导致 output 翻倍。 |
| **B-08** | `result` 行的 `exitCode != 0` 且已有 finalError（如 session.error 先到） | 对齐 Python 版 `_handle_result` L278-284：exitMsg 拼接到 finalError（若不含则 `+= '; ' + exitMsg`），不覆盖原错误。测试用例：`test_parse_result_failure_exit_code`（L298-309）断言 `"exited with code 1" in final_error`。 |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-08-1**：不执行子进程（spawn copilot CLI / stdin 管理 / 超时看门狗 / stdout readline）。执行职责在 task-19 TaskRunner。本任务的 `JsonlAdapter` 只暴露 `parse(line)`，由 task-19 调用。
- **N-08-2**：不实现 `getBackend` 工厂和 `PROTOCOL_PROVIDERS` 映射。在 task-11。本任务只产出 `JsonlAdapter` 类，工厂注册由 task-11 完成。
- **N-08-3**：不迁移 Python 版的全部测试（17 个测试文件 ~6660 行）。本任务只迁移 `test_jsonl_backend.py` 一个文件的等价用例到 `tests/adapters/jsonl.test.ts`（约 1:1 行为覆盖）。其余 16 个测试文件在 task-22（测试迁移总任务）。
- **N-08-4**：不实现 `build_args`（copilot 启动参数组装）。Python 版 `build_args`（jsonl.py L58-86）属于执行层职责，下沉到 task-19 TaskRunner（或 task-19 调用的子模块）。本任务的 adapter 只解析，不组装命令。
- **N-08-5**：不处理 stdin 应答（`onControl`）。jsonl 协议无 control_request 需求，`JsonlAdapter` 不实现 `onControl` 方法（task-05 §B-02 允许可选）。
- **N-08-6**：不修改 `AgentEvent` / `ProtocolAdapter` 接口定义。从 task-02 types.ts / task-05 protocol-adapter.ts import。若发现接口缺失字段，应回头改 task-02/task-05，不在本任务擅自扩展。
- **N-08-7**：不做 copilot CLI 的真实集成测试（实际 spawn copilot）。本任务用 fixture 文本样本做单元测试；真实集成在 task-23（W5 冒烟）。

---

## 参考

### Python 源（必读，1:1 行为对齐）

- **`sillyhub-daemon/sillyhub_daemon/backends/jsonl.py`**（核心）：
  - `_JsonlState`（L28-36）：状态结构 → Node 版 `JsonlState` interface。
  - `JsonlBackend`（L44-365）：
    - `provider = "copilot"`（L47）→ Node 版 `readonly provider = 'copilot'`。
    - `parse_output_multi`（L101-120）：入口，strip + JSON.loads + 分发 → Node 版 `parse`。
    - `_handle_event`（L122-171）：if/elif 链按 type 分发 → Node 版 switch。
    - `_handle_session_start`（L175-179）→ `handleSessionStart`。
    - `_handle_message_delta`（L181-186）→ `handleMessageDelta`。
    - `_handle_message`（L188-231，**一行多 event 核心**）→ `handleMessage`。
    - `_handle_reasoning`（L233-237）→ `handleReasoning`。
    - `_handle_tool_complete`（L239-261）→ `handleToolComplete`。
    - `_handle_session_error`（L263-267）→ `handleSessionError`。
    - `_handle_session_warning`（L269-271）→ `handleSessionWarning`。
    - `_handle_result`（L273-284）→ `handleResult`。
    - `execute`（L288-365）→ **不在本任务**（下沉 task-19）。
    - `build_args`（L58-86）→ **不在本任务**（下沉 task-19）。

### 测试源（1:1 迁移到 vitest）

- **`sillyhub-daemon/tests/test_jsonl_backend.py`**（关键）：
  - `_make_jsonl_line(event_type, data, **extra)` helper（L16-22）→ vitest 等价 helper。
  - `TestJsonlBuildArgs`（L42-83）：**不迁移**（build_args 下沉 task-19）。
  - `TestJsonlParseSessionStart`（L90-110）→ 迁移。
  - `TestJsonlParseMessageDelta`（L118-157）→ 迁移。
  - `TestJsonlParseMessageFull`（L165-233）→ 迁移（含 reasoning + toolRequests 多 event 用例）。
  - `TestJsonlParseToolComplete`（L240-273）→ 迁移。
  - `TestJsonlParseResult`（L281-309）→ 迁移。
  - `TestJsonlEdgeCases`（L317-441）→ 迁移（空行 / 坏 JSON / 未知 type / session.error/warning / turn_start / reasoning / full_flow）。
  - `test_provider_attribute`（L395-397）：断言 `provider == 'copilot'` → 迁移。
  - `test_is_subclass_of_agent_backend`（L399-401）：TS 无类继承接口的 issubclass，改为 `instanceof` / 类型断言或跳过。
  - `test_full_flow_accumulated_output`（L403-441）：端到端累积用例 → 迁移。

### design.md

- **§7.1 统一中间表示 AgentEvent（IR）**：`AgentEvent` 类型定义（type/content/metadata）—— 本任务 import 的来源。
- **§7.3 工厂与映射**：`PROTOCOL_PROVIDERS: { jsonl: ['copilot'] }` —— 本任务 provider 字段对齐依据。
- **§5.1 分层架构**：ProtocolAdapter 抽象层定位（方案B 拆分原理）。
- **§10 R-01**：协议解析翻译偏差风险（P0），应对=1:1 迁移 Python fixture，本任务的核心约束。

### 模块文档

- **`.sillyspec/docs/sillyhub-daemon/modules/backends.md`**：
  - 「契约摘要」`AgentEvent` 字段（event_type/content/tool_name/call_id/tool_input/tool_output/status/level/session_id）→ Node 版 IR 映射参考。
  - 「注意事项」`AgentEvent.event_type` 值域（text/tool_use/tool_result/thinking/status/error）→ 本任务产出的事件 type 必须在此值域内。

### 兄弟任务

- **task-05**：`ProtocolAdapter` 接口 + `AgentEvent` IR —— 本任务的依赖，接口契约来源。
- **task-11**：`getBackend` 工厂 + `PROTOCOL_PROVIDERS` —— 本任务的阻塞对象，工厂会 import `JsonlAdapter` 并注册到 `jsonl: ['copilot']`。
- **task-19**：TaskRunner —— 本任务的下游消费者，调用 `parse(line)` 累积事件 + 读 `getState()` 拿 output/sessionId。

---

## TDD 步骤

按 TDD 顺序（每个用例先写测试、跑红、写实现、跑绿）。fixture 文件先建，测试 helper 先写。

### 前置

1. **确认依赖就绪**：
   - task-02 的 `src/types.ts` 已 export `AgentEvent`（含 `type`/`content`/可选 `metadata`）。
   - task-05 的 `src/adapters/protocol-adapter.ts` 已 export `ProtocolAdapter` 接口。
   - 若未就绪，本任务阻塞（depends_on task-05 已声明）。

2. **建 fixture 文件**（4 份典型样本，对齐 §修改文件表）：
   ```bash
   mkdir -p sillyhub-daemon/tests/fixtures/jsonl/copilot
   # session_start.txt
   echo '{"type":"session.start","data":{"sessionId":"abc-123","selectedModel":"gpt-4.1"}}' > .../copilot/session_start.txt
   # tool_use.txt（assistant.message 含 toolRequests）
   # message.txt（assistant.message_delta）
   # complete.txt（result 行）
   ```

3. **写 vitest helper**（对齐 Python `_make_jsonl_line`，test_jsonl_backend.py L16-22）：
   ```ts
   // tests/adapters/jsonl.test.ts
   function makeJsonlLine(eventType: string, data?: Record<string, unknown>, extra?: Record<string, unknown>): string {
     const obj: Record<string, unknown> = { type: eventType };
     if (data !== undefined) obj.data = data;
     if (extra) Object.assign(obj, extra);
     return JSON.stringify(obj);
   }
   ```

### TDD 1：session.start

```ts
test('session.start updates state, returns no events', () => {
  const adapter = new JsonlAdapter();
  const line = makeJsonlLine('session.start', { sessionId: 'abc-123', selectedModel: 'gpt-4.1' });
  expect(adapter.parse(line)).toEqual([]);
  expect(adapter.getState().sessionId).toBe('abc-123');
  expect(adapter.getState().activeModel).toBe('gpt-4.1');
});
```
- 红：JsonlAdapter 未实现 → 跑红。
- 绿：实现 handleSessionStart。

### TDD 2：assistant.message_delta

```ts
test('message_delta returns text event and accumulates output', () => {
  const adapter = new JsonlAdapter();
  const e1 = adapter.parse(makeJsonlLine('assistant.message_delta', { messageId: 'm1', deltaContent: 'Hello ' }));
  const e2 = adapter.parse(makeJsonlLine('assistant.message_delta', { messageId: 'm1', deltaContent: 'World' }));
  expect(e1).toEqual([{ type: 'text', content: 'Hello ' }]);
  expect(e2).toEqual([{ type: 'text', content: 'World' }]);
  expect(adapter.getState().output).toBe('Hello World');
});

test('message_delta with empty content returns []', () => {
  const adapter = new JsonlAdapter();
  expect(adapter.parse(makeJsonlLine('assistant.message_delta', { deltaContent: '' }))).toEqual([]);
});
```

### TDD 3：assistant.message（防双计 + 多 event）

```ts
test('message resets output to avoid delta double-counting', () => {
  const adapter = new JsonlAdapter();
  adapter.parse(makeJsonlLine('assistant.message_delta', { deltaContent: 'Hello World' }));
  expect(adapter.getState().output).toBe('Hello World');
  adapter.parse(makeJsonlLine('assistant.message', { messageId: 'm1', content: 'Hello World' }));
  expect(adapter.getState().output).toBe('Hello World'); // 不翻倍
});

test('message with toolRequests returns tool_use events', () => {
  const adapter = new JsonlAdapter();
  const events = adapter.parse(makeJsonlLine('assistant.message', {
    messageId: 'm1', content: '',
    toolRequests: [{ toolCallId: 'tc1', name: 'Read', arguments: { file_path: '/tmp/x.py' }, type: 'tool_call' }],
  }));
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe('tool_use');
  expect(events[0].metadata).toMatchObject({ toolName: 'Read', callId: 'tc1', toolInput: { file_path: '/tmp/x.py' } });
});

test('message with reasoning returns thinking event', () => {
  const adapter = new JsonlAdapter();
  const events = adapter.parse(makeJsonlLine('assistant.message', { messageId: 'm1', content: 'answer', reasoningText: 'Let me think...' }));
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe('thinking');
  expect(events[0].content).toBe('Let me think...');
});

// TDD 6：补一条 Python 版没有的多 event 对齐用例（reasoning + 多 toolRequests 同时存在）
test('message with reasoning + multiple toolRequests returns multiple events', () => {
  const adapter = new JsonlAdapter();
  const events = adapter.parse(makeJsonlLine('assistant.message', {
    messageId: 'm1', content: '',
    reasoningText: 'I need to read two files',
    toolRequests: [
      { toolCallId: 'tc1', name: 'Read', arguments: { file_path: '/a.py' }, type: 'tool_call' },
      { toolCallId: 'tc2', name: 'Read', arguments: { file_path: '/b.py' }, type: 'tool_call' },
    ],
  }));
  expect(events).toHaveLength(3);
  expect(events[0].type).toBe('thinking');
  expect(events[1].type).toBe('tool_use');
  expect(events[2].type).toBe('tool_use');
  expect(events[1].metadata).toMatchObject({ callId: 'tc1' });
  expect(events[2].metadata).toMatchObject({ callId: 'tc2' });
});
```

### TDD 4：tool.execution_complete

```ts
test('tool_complete success returns tool_result', () => {
  const adapter = new JsonlAdapter();
  const events = adapter.parse(makeJsonlLine('tool.execution_complete', { toolCallId: 'tc1', success: true, result: { content: 'file contents here' } }));
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe('tool_result');
  expect(events[0].metadata).toMatchObject({ callId: 'tc1', toolOutput: 'file contents here' });
});

test('tool_complete failure returns tool_result with Error: prefix', () => {
  const adapter = new JsonlAdapter();
  const events = adapter.parse(makeJsonlLine('tool.execution_complete', { toolCallId: 'tc2', success: false, error: { message: 'file not found' } }));
  expect(events[0].metadata?.toolOutput).toContain('Error: file not found');
});
```

### TDD 5：result（终止行）

```ts
test('result success sets session_id and final_status completed', () => {
  const adapter = new JsonlAdapter();
  adapter.parse(JSON.stringify({ type: 'result', sessionId: 'final-session-1', exitCode: 0 }));
  expect(adapter.parse('{"type":"result","sessionId":"final-session-1","exitCode":0}')).toEqual([]);
  expect(adapter.getState().sessionId).toBe('final-session-1');
  expect(adapter.getState().finalStatus).toBe('completed');
});

test('result failure exit code sets final_status failed', () => {
  const adapter = new JsonlAdapter();
  adapter.parse(JSON.stringify({ type: 'result', sessionId: 'final-session-2', exitCode: 1 }));
  expect(adapter.getState().finalStatus).toBe('failed');
  expect(adapter.getState().finalError).toContain('exited with code 1');
});
```

### TDD 6：边界用例（对齐 TestJsonlEdgeCases）

```ts
test('empty line skipped', () => expect(new JsonlAdapter().parse('')).toEqual([]));
test('whitespace line skipped', () => expect(new JsonlAdapter().parse('   ')).toEqual([]));
test('invalid json skipped', () => expect(new JsonlAdapter().parse('not valid json')).toEqual([]));
test('unknown event type skipped', () => {
  expect(new JsonlAdapter().parse(makeJsonlLine('unknown.event.type', { foo: 'bar' }))).toEqual([]);
});
test('session.error sets final_status failed and returns error event', () => {
  const adapter = new JsonlAdapter();
  const events = adapter.parse(makeJsonlLine('session.error', { errorType: 'fatal', message: 'OOM killed' }));
  expect(events[0].type).toBe('error');
  expect(events[0].content).toBe('OOM killed');
  expect(adapter.getState().finalStatus).toBe('failed');
});
test('session.warning returns status event with level warn', () => {
  const events = new JsonlAdapter().parse(makeJsonlLine('session.warning', { warningType: 'deprecation', message: 'model deprecated' }));
  expect(events[0].type).toBe('status');
  expect(events[0].metadata?.level).toBe('warn');
});
test('assistant.turn_start returns status running', () => {
  const events = new JsonlAdapter().parse(makeJsonlLine('assistant.turn_start', {}));
  expect(events[0].type).toBe('status');
  expect(events[0].metadata?.status).toBe('running');
});
test('assistant.reasoning returns thinking', () => {
  const events = new JsonlAdapter().parse(makeJsonlLine('assistant.reasoning', { content: 'I should check the file first' }));
  expect(events[0].type).toBe('thinking');
});
test('assistant.reasoning_delta returns thinking', () => {
  const events = new JsonlAdapter().parse(makeJsonlLine('assistant.reasoning_delta', { deltaContent: 'Hmm' }));
  expect(events[0].type).toBe('thinking');
  expect(events[0].content).toBe('Hmm');
});
```

### TDD 7：provider 字段 + 完整流程

```ts
test('provider is copilot', () => expect(new JsonlAdapter().provider).toBe('copilot'));

test('full flow accumulates output', () => {
  const adapter = new JsonlAdapter();
  adapter.parse(makeJsonlLine('session.start', { sessionId: 'sess-flow', selectedModel: 'gpt-4.1' }));
  adapter.parse(makeJsonlLine('assistant.message_delta', { deltaContent: 'Hello' }));
  adapter.parse(makeJsonlLine('assistant.message', { messageId: 'm1', content: 'Hello' }));
  adapter.parse(JSON.stringify({ type: 'result', sessionId: 'sess-flow', exitCode: 0 }));
  expect(adapter.getState().output).toBe('Hello');
  expect(adapter.getState().sessionId).toBe('sess-flow');
  expect(adapter.getState().finalStatus).toBe('completed');
});
```

### TDD 8：fixture 文件测试（验证真实样本可解析）

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixtureDir = path.resolve(fileURLToPath(import.meta.url), '../../fixtures/jsonl/copilot');

test('fixture session_start.txt parses to session state', () => {
  const adapter = new JsonlAdapter();
  const line = readFileSync(path.join(fixtureDir, 'session_start.txt'), 'utf8').trim();
  adapter.parse(line);
  expect(adapter.getState().sessionId).toBe('abc-123');
});

test('fixture complete.txt sets final_status completed', () => {
  const adapter = new JsonlAdapter();
  adapter.parse(readFileSync(path.join(fixtureDir, 'complete.txt'), 'utf8').trim());
  expect(adapter.getState().finalStatus).toBe('completed');
});
```

### 跑验证

```bash
cd sillyhub-daemon
npx tsc --noEmit                                                # AC-03: 零编译错误
npx vitest run tests/adapters/jsonl.test.ts                    # AC-01/AC-02: 全绿
```

---

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | copilot 各事件 type 1:1 映射到 AgentEvent | `npx vitest run tests/adapters/jsonl.test.ts` | 全部用例绿：session.start/message_delta/message（含 reasoning+toolRequests 多 event）/reasoning/tool.execution_complete/turn_start/session.error/session.warning/result 九类 type 的产出事件 type 与 Python 版 `AgentEvent.event_type` 值域（text/tool_use/tool_result/thinking/status/error）逐字一致 |
| **AC-02** | 一行多 event 行为对齐 Python 版 | `test('message with reasoning + multiple toolRequests returns multiple events')` 用例 | 单行 `assistant.message` 同时含 reasoningText + 2 个 toolRequests 时，`parse` 返回长度=3 的数组（1 thinking + 2 tool_use），顺序为 thinking 在前、tool_use 按 toolRequests 数组顺序；与 Python 版 `_handle_message`（jsonl.py L204-229）的 push 顺序一致 |
| **AC-03** | vitest 全绿 | `cd sillyhub-daemon && npx vitest run tests/adapters/jsonl.test.ts` | 退出码 0；用例数 ≥ 20（覆盖 TDD 1~7 全部分支 + 边界）；无 skip/only 残留 |
| **AC-04** | TypeScript 编译零错误 | `cd sillyhub-daemon && npx tsc --noEmit` | 退出码 0，无任何 error/warning；`JsonlAdapter` 满足 `ProtocolAdapter` 接口（implements 通过类型检查）；`AgentEvent` 从 `../types.js` import 未重复定义 |
| **AC-05** | provider 字段对齐工厂注册名 | `grep "readonly provider = 'copilot'" src/adapters/jsonl.ts` | 命中 1 行，值为小写 `'copilot'`（与 task-11 `PROTOCOL_PROVIDERS.jsonl = ['copilot']` 逐字一致，task-05 §B-06） |
| **AC-06** | 不实现 onControl（jsonl 无 stdin 应答） | `grep -c "onControl" src/adapters/jsonl.ts` | 计数为 0（jsonl 协议无 control_request，task-05 §B-02 允许可选） |
| **AC-07** | 状态隔离（每实例独立） | 测试：两个 `new JsonlAdapter()` 实例分别 parse 不同 line，互不污染 | 实例 A 的 `getState().output` 不含实例 B parse 的内容；证明状态只在实例字段 |
| **AC-08** | fixture 文件可解析 | TDD 8 的 2 条 fixture 用例 | `session_start.txt` 解析后 sessionId='abc-123'；`complete.txt` 解析后 finalStatus='completed' |
| **AC-09** | 防双计逻辑对齐 Python | `test('message resets output to avoid delta double-counting')` | delta 累积 'Hello World' 后，收到 content='Hello World' 的 message 行，output 仍为 'Hello World'（不翻倍为 'Hello WorldHello World'） |
| **AC-10** | 仅触碰 allowed_paths 内文件 | `git diff --name-only && git status --porcelain` | 变更文件限于 `src/adapters/jsonl.ts` + `tests/fixtures/jsonl/copilot/*.txt`（4 份）+ `tests/adapters/jsonl.test.ts`（测试文件，开发期产出） |

