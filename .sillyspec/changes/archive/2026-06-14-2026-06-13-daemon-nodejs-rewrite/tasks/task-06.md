---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-06
title: stream_json adapter（src/adapters/stream-json.ts，claude/gemini/cursor）
priority: P0
estimated_hours: 4
depends_on: [task-05]
blocks: [task-11]
allowed_paths:
  - sillyhub-daemon/src/adapters/stream-json.ts
  - sillyhub-daemon/tests/fixtures/stream-json/
---

# task-06：stream_json adapter（src/adapters/stream-json.ts，claude/gemini/cursor）

> W1 最复杂的 adapter，承载两个风险验证：
> - **R-01（P0）解析翻译偏差**：1:1 翻译 Python `stream_json.py` 的 `parse_output` 分支逻辑，从 `test_stream_json_backend.py` 提取 fixture，产出语义等价的 AgentEvent IR。
> - **R-03（P1）stdin control_request hang**：通过 `onControl(stdin)` 显式建模工具批准应答，保持 stdin 开启直到 result 事件。

- Wave：W1（协议抽象层）
- 依赖：task-05（`ProtocolAdapter` 接口 + `AgentEvent` 从 `../types.js` import）
- 阻塞：task-11（`getBackend` 工厂 + `PROTOCOL_PROVIDERS` 注册本 adapter）
- Python 源对照：
  - `sillyhub_daemon/backends/stream_json.py`（解析逻辑 L248-383）
  - `sillyhub_daemon/backends/__init__.py`（AgentEvent dataclass L19-31）
  - `tests/test_stream_json_backend.py`（全部 inline 样本，提取到 fixture）

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/adapters/stream-json.ts` | `StreamJsonAdapter` class，实现 `ProtocolAdapter`；含 `parse(line)` 各事件分支 + `onControl(stdin)` 自动批准策略 |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-system-init.jsonl` | 从 Python test L67-75 提取：system 消息（subtype=init, session_id） |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-assistant-text.jsonl` | 从 Python test L94-107 提取：assistant content[text] |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-assistant-thinking.jsonl` | 从 Python test L114-127 提取：assistant content[thinking] |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-assistant-tool-use.jsonl` | 从 Python test L134-152 提取：assistant content[tool_use]（含 id/name/input） |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-tool-use-null-input.jsonl` | 从 Python test L161-179 提取：tool_use input=null 边界 |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-assistant-multi-block.jsonl` | 从 Python test L201-220 提取：assistant 含多个 text block |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-user-tool-result.jsonl` | 从 Python test L237-253 提取：user content[tool_result] |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-result-success.jsonl` | 从 Python test L270-280 提取：result（is_error=False） |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-result-error.jsonl` | 从 Python test L286-296 提取：result（is_error=True） |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-log.jsonl` | 从 Python test L310-318 提取：log 事件（level+message） |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-control-request.jsonl` | 从 Python test L338-348 提取：control_request（req_001, Bash, echo hello） |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-full-session.jsonl` | 从 Python test L417-436 提取：system→assistant→result 完整会话 |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/claude-control-flow.jsonl` | 从 Python test L543-572 提取：system→control_request→assistant→result |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/gemini-typical.jsonl` | gemini 典型样本（结构与 claude 一致，session_id 前缀差异） |
| 新增 | `sillyhub-daemon/tests/fixtures/stream-json/cursor-typical.jsonl` | cursor 典型样本（结构与 claude 一致） |
| 新增 | `sillyhub-daemon/tests/stream-json.test.ts` | adapter 测试，1:1 迁移 Python test 类（边界/system/assistant/user/result/log/control_request） |

> fixture 文件每个只含 1 行 JSON（`full-session` / `control-flow` 含多行）。命名遵循 task-04 的 `fixtures/README.md` 约定（`<provider>-<scenario>.jsonl`）。

---

## 实现要求

### 1. parse(line) 各事件分支（对照 Python `stream_json.py:248-279`）

`parse` 入口：空行返回 `null`；`JSON.parse` 失败返回 `null`（不抛异常，对照 Python L254-260）；非对象返回 `null`。然后按 `obj.type` 分发：

| obj.type | Python 方法 | Node parse 行为 | 产出 AgentEvent |
|---|---|---|---|
| `"assistant"` | `_parse_assistant` L305-330 | 遍历 `message.content[]` 数组，**每个 block 产出一个 event**（与 Python 取最后一个不同，见下文"多 block"差异说明） | text→`{type:'text',content:text}`；thinking→`{type:'text',content:text,metadata:{thinking:true}}`；tool_use→`{type:'tool_use',content:'',metadata:{tool_name,call_id,tool_input}}` |
| `"user"` | `_parse_user` L332-359 | 遍历 `message.content[]`，对 `type==='tool_result'` 的 block 产出 event。`content` 字段可能是 string / list[{text}] / null，对照 Python L343-358 归一为 string | `{type:'tool_result',content:str,metadata:{call_id:tool_use_id}}` |
| `"system"` | `_parse_system` L361-366 | 提取 `session_id` 存到实例字段 `this.sessionId`，同时产出 status event（让编排层感知到 session 启动） | `{type:'text',content:'',metadata:{status:'running',session_id}}` |
| `"result"` | `_parse_result` L368-373 | **行为升级**（方案B）：Python 把信息存到 `self._last_result_info` 不产 event；Node 版产出 `complete` event，让编排层统一处理终态。`is_error=true` 时产出 `error` event 而非 `complete` | is_error=false→`{type:'complete',content:result_text,metadata:{session_id,is_error:false,stats:{...}}}`；is_error=true→`{type:'error',content:result_text,metadata:{session_id,is_error:true}}` |
| `"log"` | `_parse_log` L375-383 | 提取 `log.level` + `log.message` | `{type:'text',content:message,metadata:{level,log:true}}` |
| `"control_request"` | L198-199（在 `_consume_stdout` 内处理） | **parse 内部识别**：若 `obj.type==='control_request'`，立即调 `this.onControl(...)` 写应答（通过实例持有的 stdin 引用，见下文 R-03），然后返回 `[]`（不产外部 event）。对照 Python：control_request 不进入 `events` 列表 | `[]`（空数组，表示已处理无事件） |
| 其他/未知 | L278-279 | 返回 `null` | — |

**多 block 差异说明（重要，R-01 相关）**：
- Python `_parse_assistant` L312-330 用 `last_event` 变量，**只保留最后一个 block** 的 event。Python test L201-225 `test_parse_output_assistant_multiple_blocks` 显式断言 "返回最后一个"。
- Node 版 task-05 已把 `parse` 签名升级为 `AgentEvent[] | null`，task-05 §7.2 JSDoc 明确写"一行可产出多个 event（stream_json 多 content block）"。故 Node 版**返回所有 block 的 event**（顺序保留），与 Python 行为有差异。
- **此差异是方案B 的预期升级**（非翻译 bug）：编排层拿到全部 block 后能更完整地回放消息流。R-01 验收的"等价"指**语义等价**（同一输入产出同类事件、无丢失），非逐字段 1:1。蓝图的 fixture `claude-assistant-multi-block.jsonl` 专门覆盖此差异，测试断言"返回 2 个 text event"而非 Python 的"返回 1 个"。

### 2. onControl(stdin)：R-03 自动批准策略

对照 Python `_handle_control_request` L206-246：
- 构造 `control_response` JSON：`{type:'control_response',response:{subtype:'success',request_id, response:{behavior:'allow', updatedInput: toolInput}}}`。
- `toolInput` 来源：`request.input`，可能是 dict / string（需二次 JSON.parse）/ 其他类型；归一为 dict（失败则 `{}`）。对照 Python L217-224。
- 写入 stdin：`stdin.write(JSON.stringify(response) + '\n')`。**不关闭 stdin**——子进程可能继续发 control_request，直到 result 事件才由 TaskRunner（task-19）关闭。
- **stdin 来源问题**：`ProtocolAdapter.onControl(stdin)` 签名由 TaskRunner 在调用 parse 前注入 stdin 引用。但 parse 内部识别到 control_request 行时，stdin 还未传给 parse。**解决方案**：StreamJsonAdapter 持有 `private stdin?: NodeJS.WritableStream` 实例字段，由 TaskRunner（task-19）在 spawn 后通过 setter 注入（如 `adapter.attachStdin(proc.stdin)`）；parse 内部识别 control_request 时调 `this.onControl(this.stdin)`。本任务**只实现 `onControl(stdin)` 方法 + 一个 `attachStdin(stdin)` setter**，不实现 TaskRunner 的注入时机（task-19）。
- 错误处理：`stdin.write` 失败（BrokenPipe / 子进程已退出）**不抛异常**，对照 Python L238-246 的 try/except 静默。理由：control_request 可能在子进程即将退出时到达，stdin 已关闭是合法状态。

### 3. 状态字段（实例字段维护，parse 本身对单行纯）

StreamJsonAdapter 是**有状态 adapter**（task-05 §边界处理 B-03 允许）。实例字段：
- `private sessionId: string`：从 system 事件提取（Python L366），后续 result 事件复用。
- `private lastResultInfo?: { session_id, result_text, is_error }`：对照 Python `_last_result_info`（L124-130, L368-373）。虽然 Node 版 result 直接产 complete event，但仍保留此字段供 TaskRunner（task-19）在解析结束后读取最终 session_id / 错误状态（与 Python `execute` L123-130 行为对齐）。
- `private stdin?: NodeJS.WritableStream`：onControl 用，见上文。
- `readonly provider: string`：构造时注入（'claude' / 'gemini' / 'cursor' 之一）。

**纯函数约束**：`parse(line)` 对**单行**保持纯（相同输入相同输出，无副作用除了 onControl 的 stdin write——这是协议必需的副作用，task-05 B-03 允许"状态存实例字段"）。跨行状态（sessionId 累积）通过实例字段维护，每个 lease 一个 adapter 实例（task-11 工厂按需 new）。

### 4. provider 三合一（claude / gemini / cursor 共用一个 class）

对照 Python：`StreamJsonBackend.provider = "stream_json"`（一个 class 服务三个 provider，工厂 `get_backend("claude"/"gemini"/"cursor")` 都返回同一个 class）。Node 版保持此模式：
- `StreamJsonAdapter` 构造函数接收 `provider: 'claude' | 'gemini' | 'cursor'` 参数，存到 `readonly provider` 字段。
- **解析逻辑对三者完全相同**（gemini / cursor 的 stream-json 协议与 claude 一致——这是 PROTOCOL_PROVIDERS 把三者归到 `stream_json` 的依据，design.md §7.3）。本任务不为 gemini / cursor 写独立分支。
- fixture 提供 `gemini-typical.jsonl` / `cursor-typical.jsonl` 验证三者等价（结构同 claude，仅 session_id 前缀等表面差异）。
- task-11 工厂 `getBackend('claude')` 返回 `new StreamJsonAdapter('claude')`，以此类推。

## 接口定义

以下是 `sillyhub-daemon/src/adapters/stream-json.ts` 的完整内容（搬砖工照抄即可）。解析分支用 claude 实际字段名（message.content[].type / tool_use.id/name/input / tool_result.tool_use_id 等）。

```ts
/**
 * StreamJsonAdapter —— NDJSON stream-json 协议适配器（claude / gemini / cursor）。
 *
 * 1:1 翻译自 Python sillyhub_daemon/backends/stream_json.py 的 parse_output
 * 分支逻辑，按 task-05 的 ProtocolAdapter 契约产出 AgentEvent IR。
 *
 * 承载两个风险验证：
 *   - R-01（解析翻译偏差）：fixture 从 test_stream_json_backend.py 提取，
 *     产出语义等价的 AgentEvent（多 block 升级为返回全部 event，见 parse JSDoc）。
 *   - R-03（stdin control_request hang）：onControl 显式建模工具批准应答，
 *     保持 stdin 开启直到 result 事件（由 TaskRunner task-19 关闭）。
 *
 * @see design.md §7.1（AgentEvent IR）/ §7.3（PROTOCOL_PROVIDERS）/ §10 R-01 R-03
 */

import type { AgentEvent } from '../types.js';
import type { ProtocolAdapter } from './protocol-adapter.js';

/** stream-json 协议支持的 provider 子集。 */
export type StreamJsonProvider = 'claude' | 'gemini' | 'cursor';

/**
 * control_request 自动批准的应答 JSON（写入 stdin）。
 * 对照 Python stream_json.py L226-236。
 */
interface ControlResponse {
  type: 'control_response';
  response: {
    subtype: 'success';
    request_id: string;
    response: {
      behavior: 'allow';
      updatedInput: Record<string, unknown>;
    };
  };
}

/**
 * StreamJsonAdapter —— claude / gemini / cursor 三 provider 共用。
 *
 * 有状态 adapter（task-05 B-03 允许）：
 *   - sessionId：从 system 事件提取，result 事件复用（对照 Python L366）。
 *   - lastResultInfo：result 事件存档，供 TaskRunner 读取最终状态。
 *   - stdin：onControl 用，由 TaskRunner 通过 attachStdin 注入。
 *
 * 每个 lease 一个实例（task-11 工厂按需 new），状态隔离。
 */
export class StreamJsonAdapter implements ProtocolAdapter {
  /** provider 标识（claude / gemini / cursor），与 PROTOCOL_PROVIDERS 注册名一致。 */
  readonly provider: StreamJsonProvider;

  /** 从 system 事件累积的 session_id（对照 Python self.session_id 等价物）。 */
  private sessionId = '';

  /** 从 result 事件累积的最终状态（对照 Python self._last_result_info L368-373）。 */
  private lastResultInfo?: {
    sessionId: string;
    resultText: string;
    isError: boolean;
  };

  /**
   * 子进程 stdin 引用，onControl 用。
   * 由 TaskRunner（task-19）在 spawn 后通过 attachStdin 注入。
   * parse 内部识别到 control_request 行时调 this.onControl(this.stdin)。
   */
  private stdin?: NodeJS.WritableStream;

  constructor(provider: StreamJsonProvider) {
    this.provider = provider;
  }

  /** TaskRunner 在 spawn 子进程后注入 stdin，使 parse 能在 control_request 时回写。 */
  attachStdin(stdin: NodeJS.WritableStream): void {
    this.stdin = stdin;
  }

  /** 读取累积的 session_id（供 TaskRunner 在 lease 结束时上报）。 */
  getSessionId(): string {
    return this.sessionId;
  }

  /** 读取 result 事件的最终状态（对照 Python getattr(self, '_last_result_info')）。 */
  getLastResultInfo(): typeof this.lastResultInfo {
    return this.lastResultInfo;
  }

  /**
   * 解析子进程 stdout 的一行，返回 0..N 个 AgentEvent。
   *
   * 分支对照 Python stream_json.py parse_output L248-279：
   *   - 空行 / 非 JSON / 非对象 → null
   *   - type=assistant → 遍历 content blocks，每 block 产 1 event
   *   - type=user → 遍历 content，tool_result block 产 1 event
   *   - type=system → 累积 sessionId + 产 status event
   *   - type=result → 累积 lastResultInfo + 产 complete/error event（方案B 升级）
   *   - type=log → 产 log event（content=message, metadata.level）
   *   - type=control_request → 调 onControl 回写应答 + 返回 []（不产外部 event）
   *   - 未知 type → null
   *
   * 与 Python 的差异（方案B 预期升级，R-01 语义等价非逐字段）：
   *   1. assistant 多 content block：Python 取最后一个，Node 返回全部。
   *   2. result 事件：Python 不产 event（存 self._last_result_info），
   *      Node 产出 complete/error event，让编排层统一处理终态。
   *   3. thinking block：Python 产 event_type='thinking'，Node 收敛为
   *      type='text' + metadata.thinking=true（AgentEventType 5 元组无 thinking）。
   *   4. status/log：Python 独立 event_type，Node 收敛为 type='text' + metadata 标记。
   */
  parse(line: string): AgentEvent[] | null {
    // 空行 / 仅空白：返回 null（对照 Python L254-255）
    if (!line || !line.trim()) {
      return null;
    }

    // JSON.parse 失败：返回 null，不抛异常（对照 Python L257-260）
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }

    // 非对象：返回 null（对照 Python L262-263）
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return null;
    }

    const msg = obj as Record<string, unknown>;
    const msgType = typeof msg.type === 'string' ? msg.type : '';

    switch (msgType) {
      case 'assistant':
        return this.parseAssistant(msg);
      case 'user':
        return this.parseUser(msg);
      case 'system':
        return this.parseSystem(msg);
      case 'result':
        return this.parseResult(msg);
      case 'log':
        return this.parseLog(msg);
      case 'control_request':
        return this.handleControlRequest(msg);
      default:
        // 未知 type：返回 null（对照 Python L278-279）
        return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 各事件分支（私有方法，对照 Python _parse_* 系列）
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * assistant 消息：遍历 message.content[]，每 block 产 1 event。
   * 对照 Python _parse_assistant L305-330。
   *
   * 差异：Python 用 last_event 只保留最后一个 block；Node 返回全部（方案B 升级）。
   */
  private parseAssistant(msg: Record<string, unknown>): AgentEvent[] | null {
    const message = msg.message;
    if (!isRecord(message)) return null;
    const content = message.content;
    if (!Array.isArray(content)) return null;

    const events: AgentEvent[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      const blockType = typeof block.type === 'string' ? block.type : '';

      if (blockType === 'text') {
        const text = typeof block.text === 'string' ? block.text : '';
        if (text) {
          events.push({ type: 'text', content: text });
        }
      } else if (blockType === 'thinking') {
        // thinking 收敛为 type='text' + metadata.thinking（AgentEventType 5 元组无 thinking）
        const text = typeof block.text === 'string' ? block.text : '';
        if (text) {
          events.push({ type: 'text', content: text, metadata: { thinking: true } });
        }
      } else if (blockType === 'tool_use') {
        // tool_use：对照 Python L323-329
        const name = typeof block.name === 'string' ? block.name : '';
        const id = typeof block.id === 'string' ? block.id : '';
        // input 可能为 null / 非对象，归一为 dict（对照 Python L328: block.get("input") or {}）
        const input = isRecord(block.input) ? block.input : {};
        events.push({
          type: 'tool_use',
          content: '',
          metadata: {
            tool_name: name,
            call_id: id,
            tool_input: input,
          },
        });
      }
    }
    // 对照 Python：无 content 或全空 → 返回 None。Node 返回 null（无 event）。
    return events.length > 0 ? events : null;
  }

  /**
   * user 消息：遍历 message.content[]，对 tool_result block 产 event。
   * 对照 Python _parse_user L332-359。
   */
  private parseUser(msg: Record<string, unknown>): AgentEvent[] | null {
    const message = msg.message;
    if (!isRecord(message)) return null;
    const content = message.content;
    if (!Array.isArray(content)) return null;

    const events: AgentEvent[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type !== 'tool_result') continue;

      // tool_use_id 对照 Python block.get("tool_use_id", "")
      const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';

      // content 可能是 string / list[{text}] / null，对照 Python L343-358 归一为 string
      const resultContent = normalizeToolResultContent(block.content);

      events.push({
        type: 'tool_result',
        content: resultContent,
        metadata: { call_id: toolUseId },
      });
    }
    return events.length > 0 ? events : null;
  }

  /**
   * system 消息：累积 sessionId + 产 status event。
   * 对照 Python _parse_system L361-366。
   *
   * status 收敛为 type='text' + metadata.status（AgentEventType 5 元组无 status）。
   */
  private parseSystem(msg: Record<string, unknown>): AgentEvent[] | null {
    const sessionId = typeof msg.session_id === 'string' ? msg.session_id : '';
    if (sessionId) {
      this.sessionId = sessionId;
    }
    return [
      {
        type: 'text',
        content: '',
        metadata: { status: 'running', session_id: sessionId },
      },
    ];
  }

  /**
   * result 消息：累积 lastResultInfo + 产 complete/error event。
   * 对照 Python _parse_result L368-373。
   *
   * 方案B 升级：Python 不产 event（存 self._last_result_info，由 execute 读取）；
   * Node 产出 complete/error event，让编排层统一处理终态。
   */
  private parseResult(msg: Record<string, unknown>): AgentEvent[] {
    const sessionId = typeof msg.session_id === 'string' ? msg.session_id : '';
    const resultText = typeof msg.result === 'string' ? msg.result : '';
    const isError = msg.is_error === true;

    this.lastResultInfo = { sessionId, resultText, isError };
    if (sessionId) {
      this.sessionId = sessionId;
    }

    if (isError) {
      return [
        {
          type: 'error',
          content: resultText,
          metadata: { session_id: sessionId, is_error: true },
        },
      ];
    }
    return [
      {
        type: 'complete',
        content: resultText,
        metadata: {
          session_id: sessionId,
          is_error: false,
          stats: extractResultStats(msg),
        },
      },
    ];
  }

  /**
   * log 消息：提取 log.level + log.message。
   * 对照 Python _parse_log L375-383。
   *
   * log 收敛为 type='text' + metadata.level/log（AgentEventType 5 元组无 log）。
   */
  private parseLog(msg: Record<string, unknown>): AgentEvent[] | null {
    const log = msg.log;
    if (!isRecord(log)) return null;
    const level = typeof log.level === 'string' ? log.level : '';
    const message = typeof log.message === 'string' ? log.message : '';
    return [
      {
        type: 'text',
        content: message,
        metadata: { level, log: true },
      },
    ];
  }

  /**
   * control_request：调 onControl 回写应答 + 返回 []（不产外部 event）。
   * 对照 Python _consume_stdout L194-204 + _handle_control_request L206-246。
   *
   * R-03 核心：若不回写 control_response，子进程会 hang 等待批准。
   */
  private handleControlRequest(msg: Record<string, unknown>): AgentEvent[] {
    if (this.stdin) {
      try {
        this.onControl(this.stdin);
      } catch {
        // stdin write 失败静默（对照 Python L238-246 try/except）
      }
    }
    // control_request 不产外部 event（对照 Python：不进入 events 列表）
    return [];
  }

  /**
   * 对 stdin 写 control_response 自动批准工具使用。
   * 对照 Python _handle_control_request L206-246。
   *
   * 策略：所有 control_request 一律 allow（daemon 自治模式，对照 Python L209 注释）。
   * 不关闭 stdin——子进程可能继续发 control_request，直到 result 事件。
   */
  onControl(stdin: NodeJS.WritableStream): void {
    // 注意：onControl 在 handleControlRequest 内被调用时，
    // msg 上下文已丢失（onControl 签名只有 stdin）。
    // 实际应答构造需要 msg.request_id / msg.request.input，
    // 故真正的回写逻辑在 handleControlRequest 内完成（见 buildControlResponse）。
    // 此方法保留为 ProtocolAdapter 契约的公开入口，
    // TaskRunner 也可在识别 control 类事件时直接调用（传入 stdin）。
    // 空实现——具体回写在 handleControlRequest 内通过 buildControlResponse 完成。
  }

  /**
   * 构造 control_response JSON 并写入 stdin。
   * 对照 Python _handle_control_request L217-237。
   */
  private writeControlResponse(
    stdin: NodeJS.WritableStream,
    msg: Record<string, unknown>,
  ): void {
    const requestId =
      typeof msg.request_id === 'string' ? msg.request_id : '';

    // request 可能是 dict 或 string（需二次 JSON.parse），对照 Python L211-215
    let request: Record<string, unknown> = {};
    if (isRecord(msg.request)) {
      request = msg.request;
    } else if (typeof msg.request === 'string') {
      try {
        const parsed = JSON.parse(msg.request);
        if (isRecord(parsed)) request = parsed;
      } catch {
        // 解析失败保留空 dict（对照 Python L213-215）
      }
    }

    // tool_input 可能是 dict / string / 其他，归一为 dict，对照 Python L217-224
    let toolInput: Record<string, unknown> = {};
    if (isRecord(request.input)) {
      toolInput = request.input;
    } else if (typeof request.input === 'string') {
      try {
        const parsed = JSON.parse(request.input);
        if (isRecord(parsed)) toolInput = parsed;
      } catch {
        // 保留空 dict
      }
    }

    const response: ControlResponse = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          behavior: 'allow',
          updatedInput: toolInput,
        },
      },
    };

    try {
      stdin.write(JSON.stringify(response) + '\n');
    } catch {
      // BrokenPipe / 子进程已退出：静默（对照 Python L238-246）
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 私有 helper（模块级，纯函数）
// ─────────────────────────────────────────────────────────────────────────

/** 类型守卫：值是非 null 的 plain object（非数组）。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 归一 tool_result 的 content 字段为 string。
 * 对照 Python _parse_user L343-358：
 *   - string → 原样返回
 *   - list[{text}] → 各 item.text 用 \n 拼接
 *   - list[非 dict] → 各 item str() 后用 \n 拼接
 *   - null → 空串
 */
function normalizeToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (isRecord(item) && typeof item.text === 'string') {
        parts.push(item.text);
      } else {
        parts.push(String(item));
      }
    }
    return parts.join('\n');
  }
  // 其他类型：降级为 JSON 字符串（Python 不会到这分支，但 TS 类型安全兜底）
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

/**
 * 从 result 消息提取 usage / cost 等 stats 字段（若存在）。
 * 对照 Python _parse_result 只提取 session_id/result/is_error，但 claude CLI
 * 实际 result 消息常带 total_cost_usd / usage 字段，方案B 收集到 metadata.stats。
 */
function extractResultStats(msg: Record<string, unknown>): Record<string, unknown> {
  const stats: Record<string, unknown> = {};
  const knownKeys = [
    'total_cost_usd',
    'total_duration_ms',
    'total_api_duration_ms',
    'usage',
    'num_turns',
    'is_error',
    'duration_ms',
    'result',
  ];
  for (const key of knownKeys) {
    if (key in msg) {
      stats[key] = msg[key];
    }
  }
  return stats;
}
```

> **搬砖工注意**：上面 `handleControlRequest` 调 `this.onControl(this.stdin)` 是空操作（onControl 是空实现）。真正的回写逻辑应直接调 `this.writeControlResponse(this.stdin, msg)`。修正：把 `handleControlRequest` 内的 `this.onControl(this.stdin)` 改为 `this.writeControlResponse(this.stdin, msg)`。`onControl` 方法保留为 ProtocolAdapter 契约的公开入口（TaskRunner 也可直接调用，但需传入 msg——故 onControl 签名实际应扩展为 `onControl(stdin, msg?)`，或 TaskRunner 不直接用此方法而依赖 parse 内部已回写）。**最终决策**：`onControl(stdin)` 保持 task-05 契约签名不变（无 msg 参数），实际回写完全在 `handleControlRequest` 内通过 `writeControlResponse` 完成；`onControl` 方法体留空 + JSDoc 说明"具体回写在 parse 内部完成"。搬砖工按此修正实现。

## 边界处理

| 编号 | 边界场景 | 处理策略 | 对照 Python |
|---|---|---|---|
| **B-01** | control_request 必须不阻塞 stdin | parse 内部识别到 `type==='control_request'` 立即调 `writeControlResponse` 回写 control_response（behavior=allow），保持 stdin 开启。回写失败（BrokenPipe）静默，不抛异常。**禁止在 parse 内关闭 stdin**——stdin 关闭时机由 TaskRunner（task-19）在 result 事件或超时后控制。 | `_handle_control_request` L206-246 + `_consume_stdout` L194-204 |
| **B-02** | 跨行 JSON（一行不完整） | **stream_json 协议每行是完整 JSON**（NDJSON 规范，Python 用 `async for raw_line in stdout` 逐行读，每行 `json.loads`）。Node 版由 TaskRunner（task-19）用 `readline` 切行后传入 parse，parse 不处理跨行拼接。若一行 `JSON.parse` 失败，按 B-04 返回 null，**不做缓冲累积**。这与 jsonl/ndjson/text adapter（需跨行累积）不同，是 stream_json 的协议特性。 | `parse_output` L257-260（每行独立 parse） |
| **B-03** | `JSON.parse` 失败（坏行） | parse 用 try/catch 包裹 `JSON.parse`，失败返回 `null`（不抛异常）。对照 Python `json.JSONDecodeError` / `ValueError` 捕获后返回 None。理由：子进程 stdout 可能有非协议噪声（git 提示 / 警告 / ANSI 残片），抛异常会中断整个 lease。 | L257-260 |
| **B-04** | 空行 / 仅空白字符（`\n` / `\t` / `"   "`） | parse 入口 `if (!line || !line.trim()) return null`。对照 Python `if not line.strip(): return None`。不产出空 text event，避免 backend 收到无意义空消息。 | L254-255 |
| **B-05** | result 消息缺字段（无 session_id / 无 result / 无 is_error） | `parseResult` 对每个字段单独 typeof 检查 + 默认值（sessionId='', resultText='', isError=false）。对照 Python `obj.get("session_id", "")` 等。`is_error` 严格 `=== true` 判断（避免 truthy 误判）。 | L368-373 |
| **B-06** | tool_use 的 input 字段非对象（null / string / array / number） | `isRecord(block.input) ? block.input : {}`——非对象一律降级为空 dict。对照 Python `block.get("input") or {}`。fixture `claude-tool-use-null-input.jsonl` 专门覆盖 input=null 场景（Python test L161-179 断言 tool_input==={}}）。 | L328 |
| **B-07** | assistant message 无 content 数组（或 content=null / 非数组） | `parseAssistant` 内 `if (!Array.isArray(content)) return null`。对照 Python `if not content or not isinstance(content, list): return None`。fixture 覆盖：Python test L186-198 断言 `ev is None`。 | L310-311 |
| **B-08** | gemini / cursor 与 claude 字段差异 | **三者 stream-json 协议结构完全一致**（PROTOCOL_PROVIDERS 归类依据）。已知差异仅为 session_id 前缀（claude 用 `sess_`，gemini 可能用 `gemini-`，cursor 用 `cursor-`）——这是表面差异，parse 不做 provider 特殊分支。fixture `gemini-typical.jsonl` / `cursor-typical.jsonl` 验证等价解析。若未来发现真实差异，再在 parse 内按 `this.provider` 分支。 | 无（Python 也不分支） |
| **B-09** | tool_result 的 content 字段是数组（list[{text}]） | `normalizeToolResultContent` 归一：string 原样 / null 空串 / 数组按 `\n` 拼接各 item.text / 其他降级 JSON.stringify。对照 Python L343-358。 | L343-358 |
| **B-10** | stdin 未注入（TaskRunner 未调 attachStdin）就到达 control_request | `handleControlRequest` 内 `if (this.stdin)` 守卫，stdin 缺失时跳过回写（**子进程会 hang，但 parse 不崩溃**）。这是 TaskRunner（task-19）的契约违反，本 adapter 不负责修复，仅在 JSDoc 标注"必须 attachStdin"。单测用 mock stdin 验证回写正确性。 | 无（Python 在 execute 内 stdin 一定存在） |
| **B-11** | 同一 lease 多次 result 事件（异常情况） | `lastResultInfo` 被最后一次覆盖（对照 Python `self._last_result_info` 直接赋值）。每次都产 complete/error event，编排层（task-19）负责去重或只取第一个。本 adapter 不缓冲历史 result。 | L369（直接覆盖） |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-06-1**：不执行子进程（spawn / stdin 生命周期管理 / 超时看门狗 / stderr 收集）。执行职责在 task-19 TaskRunner。本 adapter 只提供 `attachStdin(stdin)` setter 供 TaskRunner 注入，不主动 spawn。
- **N-06-2**：不实现 `getBackend` 工厂和 `PROTOCOL_PROVIDERS` 映射注册。在 task-11。本 adapter 只 export `StreamJsonAdapter` class + `StreamJsonProvider` type，task-11 负责把它们注册进工厂。
- **N-06-3**：不迁移全部 Python 测试用例（17 个文件 ~6660 行）。1:1 全量迁移在 task-22。本任务只迁移 `test_stream_json_backend.py` 的**解析相关**用例（边界 / system / assistant / user / result / log / control_request），execute / factory 相关用例留 task-19 / task-11。
- **N-06-4**：不实现 `_build_args` / `_build_input`（Python L281-303）。CLI 参数构造和 stdin 初始 prompt 写入是 TaskRunner（task-19）的职责（方案B 拆分）。本 adapter 只解析输出 + 回写 control_response。
- **N-06-5**：不做 gemini / cursor 的 provider 特殊分支（见 B-08）。三者协议结构一致，共用一套解析。若冒烟阶段（W5）发现真实差异，再回来加分支。
- **N-06-6**：不处理跨行 JSON 缓冲（见 B-02）。stream_json 每行完整 JSON，由 TaskRunner 的 readline 切行保证。
- **N-06-7**：不实现 `onControl` 的外部直接调用入口（TaskRunner 不应直接调 onControl，而是依赖 parse 内部已回写）。onControl 方法体留空 + JSDoc 说明，保留只为满足 ProtocolAdapter 契约签名。

---

## 参考

### Python 源（逐行理解依据）

| 文件 | 关键行 | 提取内容 |
|---|---|---|
| `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` | L248-279 | `parse_output` 入口分发（空行/JSON失败/非对象 → None；type 分发 assistant/user/system/result/log） |
| 同上 | L305-330 | `_parse_assistant`：content blocks 遍历，text/thinking/tool_use 三类（Python 取最后一个 block，Node 全返回） |
| 同上 | L332-359 | `_parse_user`：tool_result block 提取，content 归一（string/list/null） |
| 同上 | L361-366 | `_parse_system`：session_id 提取 + status='running' event |
| 同上 | L368-373 | `_parse_result`：session_id/result_text/is_error 存到 `self._last_result_info`（Node 升级为产 complete/error event） |
| 同上 | L375-383 | `_parse_log`：log.level + log.message |
| 同上 | L206-246 | `_handle_control_request`：control_response 构造（behavior=allow + updatedInput）+ stdin 回写 |
| 同上 | L174-204 | `_consume_stdout`：control_request 不进 events 列表 + result 触发 close_stdin |
| `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | L19-31 | `AgentEvent` dataclass 字段（event_type/content/tool_name/call_id/tool_input/tool_output/status/level/session_id）→ Node 收敛到 AgentEvent IR 5 元组 + metadata |
| `sillyhub-daemon/tests/test_stream_json_backend.py` | L30-57 | 边界用例：空行 / 非 JSON / 未知 type → None |
| 同上 | L67-83 | system 用例：session_id 提取 |
| 同上 | L94-225 | assistant 用例：text / thinking / tool_use / null input / no content / multi-block |
| 同上 | L237-258 | user 用例：tool_result |
| 同上 | L270-299 | result 用例：success / error |
| 同上 | L310-323 | log 用例 |
| 同上 | L338-351 | control_request 用例（不产 event） |
| 同上 | L417-436, L543-572 | 完整会话 + control 流程（execute 用，本任务提取 fixture） |

### design.md 章节

| 章节 | 内容 |
|---|---|
| §7.1 | 统一中间表示 AgentEvent IR（text/tool_use/tool_result/error/complete 5 元组 + metadata） |
| §7.2 | ProtocolAdapter 接口（parse 返回 AgentEvent[] \| null + onControl 可选） |
| §7.3 | PROTOCOL_PROVIDERS：`stream_json: ['claude', 'gemini', 'cursor']` |
| §10 R-01 | 解析翻译偏差风险（P0）：1:1 迁移 fixture + 语义等价 |
| §10 R-03 | stdin control_request hang 风险（P1）：onControl 显式建模 + stdin 不关闭 |

### 模块文档

| 文档 | 引用点 |
|---|---|
| `.sillyspec/docs/sillyhub-daemon/modules/backends.md` | 「契约摘要」AgentEvent 字段 / AgentBackend ABC / PROTOCOL_PROVIDERS；「注意事项」event_type 值域（text/tool_use/tool_result/thinking/status/error）→ Node IR 5 元组收敛依据 |

### 关联 task

| task | 关系 |
|---|---|
| task-02 | `src/types.ts` 提供 `AgentEvent` / `AgentEventType`（本任务 import） |
| task-04 | `tests/helpers.ts` 提供 `loadLines` / `loadFixture`（本任务测试复用）+ fixture 目录约定 |
| task-05 | `src/adapters/protocol-adapter.ts` 提供 `ProtocolAdapter` 接口（本任务 implements） |
| task-11 | `src/adapters/index.ts` 的 `getBackend` 工厂注册本 adapter（本任务 export class 供其 new） |
| task-19 | TaskRunner 调本 adapter 的 parse + attachStdin + getSessionId/getLastResultInfo（执行编排） |
| task-22 | 全量测试迁移（本任务的测试是子集） |

## TDD 步骤

### RED：从 Python test 提取期望 → 写失败测试

1. **提取 fixture（落盘到 `tests/fixtures/stream-json/`）**：
   - 从 `test_stream_json_backend.py` 的每个 `json.dumps({...})` 调用提取**原始 JSON 行**（不是 Python dict），写入对应 `.jsonl` 文件（每文件 1 行，`full-session` / `control-flow` 多行）。
   - 提取规则：把 Python test 里的 dict 字面量用 `json.dumps` 序列化成单行 JSON，**保留原字段顺序和值**（不美化、不重排）。
   - 示例（`claude-system-init.jsonl`）：
     ```json
     {"type": "system", "session_id": "sess_abc123", "subtype": "init"}
     ```
   - gemini / cursor fixture：复制 claude 结构，改 session_id 前缀（`gemini-xxx` / `cursor-xxx`），验证三者等价解析。

2. **写测试文件 `tests/stream-json.test.ts`**（1:1 迁移 Python test 的解析相关用例）：
   - 用 `loadLines` 加载 fixture，对每行调 `adapter.parse(line)`，断言产出的 AgentEvent。
   - **期望值按 Node IR 收敛后的语义**（非 Python 原始 event_type）：
     - Python `event_type='thinking'` → Node `{type:'text', metadata:{thinking:true}}`
     - Python `event_type='status'` → Node `{type:'text', metadata:{status:'running'}}`
     - Python `event_type='log'` → Node `{type:'text', metadata:{level, log:true}}`
     - Python result 不产 event → Node 产 `{type:'complete'}` 或 `{type:'error'}`
     - Python assistant 多 block 取最后 → Node 返回全部（数组长度 = block 数）
   - 测试用例分组（对照 Python test class）：
     - `TestParseOutputEdgeCases`：空行 / 非 JSON / 未知 type → null
     - `TestParseOutputSystem`：system → status event + sessionId 累积
     - `TestParseOutputAssistant`：text / thinking / tool_use / null input / no content / multi-block
     - `TestParseOutputUser`：tool_result（含 content 为 list 的归一）
     - `TestParseOutputResult`：success → complete event；error → error event
     - `TestParseOutputLog`：level + message
     - `TestParseOutputControlRequest`：调 onControl + 返回 []（用 mock stdin 断言 write 被调用）
   - control_request 测试用 mock stdin（`{ write: vi.fn() }`）验证回写内容正确。

3. **跑测试确认 RED**：
   ```bash
   cd sillyhub-daemon && npx vitest run tests/stream-json.test.ts
   ```
   预期：全部失败（StreamJsonAdapter 未实现，import 报错或断言不通过）。

### GREEN：实现 parse → 测试转绿

4. **实现 `src/adapters/stream-json.ts`**：照「接口定义」章节完整写入。注意 `handleControlRequest` 内调 `this.writeControlResponse(this.stdin, msg)`（不是空实现的 onControl）。

5. **跑测试确认 GREEN**：
   ```bash
   cd sillyhub-daemon && npx vitest run tests/stream-json.test.ts
   ```
   预期：全部用例 pass。

### REFACTOR：抽取 helper + 补边界

6. **重构**：
   - 把 `isRecord` / `normalizeToolResultContent` / `extractResultStats` 抽为模块级私有函数（已在接口定义中）。
   - 检查重复逻辑（如 `request.input` 和 `block.input` 的归一可否共用 helper——实际语义不同，request.input 来自 control_request，block.input 来自 assistant tool_use，保留各自归一）。
   - 补充 B-10（stdin 未注入）的测试用例：构造 adapter 不调 attachStdin，parse control_request 行应不崩溃（返回 []，stdin write 未调用）。

7. **跑全量测试**：
   ```bash
   cd sillyhub-daemon && npx vitest run
   ```
   预期：包括 task-04 的 sanity 测试 + 本任务的 stream-json 测试全绿。

8. **tsc 编译验证**：
   ```bash
   cd sillyhub-daemon && npx tsc --noEmit
   ```
   预期：零错误（strict 模式）。

### fixture 落盘清单（对照修改文件表）

```
tests/fixtures/stream-json/
├── claude-system-init.jsonl              （Python test L67-75）
├── claude-assistant-text.jsonl           （L94-107）
├── claude-assistant-thinking.jsonl       （L114-127）
├── claude-assistant-tool-use.jsonl       （L134-152）
├── claude-tool-use-null-input.jsonl      （L161-179）
├── claude-assistant-multi-block.jsonl    （L201-220）
├── claude-user-tool-result.jsonl         （L237-253）
├── claude-result-success.jsonl           （L270-280）
├── claude-result-error.jsonl             （L286-296）
├── claude-log.jsonl                      （L310-318）
├── claude-control-request.jsonl          （L338-348）
├── claude-full-session.jsonl             （L417-436，多行）
├── claude-control-flow.jsonl             （L543-572，多行）
├── gemini-typical.jsonl                  （claude 结构 + gemini session_id）
└── cursor-typical.jsonl                  （claude 结构 + cursor session_id）
```

---

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | parse 对 claude/gemini/cursor 各样本产出语义等价 AgentEvent | `npx vitest run tests/stream-json.test.ts`；逐 fixture 用例断言 type/content/metadata | 所有用例 pass；claude 14 个 fixture + gemini 1 + cursor 1 全覆盖；语义对照 Python test 断言（thinking→text+metadata.thinking 等 IR 收敛已说明） |
| **AC-02** | control_request 触发 onControl 不阻塞 stdin | 测试用 mock stdin（`{ write: vi.fn() }`），parse control_request 行后断言：(a) `write` 被调用 1 次；(b) 写入内容含 `"type":"control_response"` + `"behavior":"allow"` + 正确 `request_id`；(c) parse 返回 `[]`（不产外部 event）；(d) stdin 未被关闭（无 close 调用） | mock 断言全部通过；fixture `claude-control-request.jsonl` + `claude-control-flow.jsonl` 覆盖 |
| **AC-03** | result → complete event 含 stats metadata | parse `claude-result-success.jsonl` 后断言：产出 1 个 `{type:'complete'}` event；`metadata.session_id` 非空；`metadata.is_error===false`；`metadata.stats` 存在（即使原 result 无 usage 字段，stats 也是空 dict 而非 undefined）；`adapter.getLastResultInfo()` 返回 `{sessionId, resultText, isError:false}` | 测试断言通过；对照 Python `_parse_result` L368-373 字段 |
| **AC-03b** | result is_error=true → error event | parse `claude-result-error.jsonl` 后断言：产出 1 个 `{type:'error'}` event；`metadata.is_error===true`；`content` 含错误文本；`getLastResultInfo().isError===true` | 测试断言通过 |
| **AC-04** | vitest 该 adapter 测试全绿 | `npx vitest run tests/stream-json.test.ts` | `Test Files 1 passed` + 所有用例 pass + exit code 0 |
| **AC-05** | tsc 零错误 | `cd sillyhub-daemon && npx tsc --noEmit` | exit code 0，无 error/warning 输出（strict + noImplicitAny） |
| **AC-06** | 坏行处理与 Python 一致 | 测试覆盖：空行 / `"   "` / `"not json"` / `"{invalid}"` / `"12345"` / `json.dumps({type:'custom'})` 全部返回 `null`；非对象 JSON（如 `[1,2,3]` / `"string"` / `123`）返回 `null` | 6+ 用例全部断言 `parse(line) === null`；对照 Python test L34-55 |
| **AC-07** | assistant 多 block 返回全部 event（方案B 升级） | parse `claude-assistant-multi-block.jsonl`（含 2 个 text block）后断言：返回数组长度 2；两个 event 的 content 分别为 "Part 1" / "Part 2" | 测试断言通过；与 Python（返回最后 1 个）的差异已在 JSDoc + 蓝图说明 |
| **AC-08** | tool_use input=null 归一为 `{}` | parse `claude-tool-use-null-input.jsonl` 后断言：`metadata.tool_input` 深度等于 `{}`（不是 null / undefined） | 测试断言通过；对照 Python test L161-183 |
| **AC-09** | tool_result content 为 list 归一为 string | 构造 fixture `claude-user-tool-result-list.jsonl`（content 为 `[{type:'text',text:'a'},{type:'text',text:'b'}]`），parse 后断言 `content === 'a\nb'` | 测试断言通过；对照 Python L343-352 |
| **AC-10** | provider 字段正确 + sessionId 累积 | `new StreamJsonAdapter('claude').provider === 'claude'`；parse system 行后 `adapter.getSessionId()` 返回正确 session_id；parse result 行后 sessionId 被更新（若 result 带 session_id） | 测试断言通过 |
| **AC-11** | onControl 签名符合 ProtocolAdapter 契约 | `grep 'onControl(stdin' src/adapters/stream-json.ts` 命中；`grep 'implements ProtocolAdapter' src/adapters/stream-json.ts` 命中 | grep 验证；onControl 是公开方法，签名 `(stdin: NodeJS.WritableStream): void` |
| **AC-12** | 仅触碰 allowed_paths 内文件 | `git diff --name-only` + `git status --short` | 只有 `src/adapters/stream-json.ts` + `tests/fixtures/stream-json/*` + `tests/stream-json.test.ts`（若测试文件计入 allowed_paths 则 OK，否则需补充 allowed_paths） |
| **AC-13** | gemini / cursor 与 claude 等价解析 | parse `gemini-typical.jsonl` / `cursor-typical.jsonl`（结构同 claude-assistant-text）后断言：产出相同结构的 AgentEvent（type/content 一致，metadata.session_id 保留各自前缀） | 测试断言通过；验证 PROTOCOL_PROVIDERS 三合一归类正确 |

> **AC-12 备注**：`tests/stream-json.test.ts` 不在 allowed_paths 列表中。搬砖工若需严格合规，应在 PR 前把 `sillyhub-daemon/tests/stream-json.test.ts` 加入 allowed_paths（或按项目惯例测试文件默认允许）。蓝图保持与 task-04 一致（task-04 allowed_paths 含 `sillyhub-daemon/tests/`）。

