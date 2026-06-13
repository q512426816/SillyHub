/**
 * JsonlAdapter —— copilot CLI 的 JSONL 点分事件协议解析器。
 *
 * copilot CLI 启动参数 `--output-format json` 后，stdout 逐行输出 NDJSON，
 * 每行结构：`{"type": "dotted.event.name", "data": {...}, "sessionId"?, ...}`。
 * 本 adapter 把每行的点分 type 映射到统一 IR AgentEvent，并在实例字段
 * 维护 session 维度的累积状态（output 文本 / session_id / final_status）。
 *
 * 1:1 翻译自 Python `sillyhub_daemon/backends/jsonl.py`（parse_output_multi +
 * _handle_event + 8 个 _handle_* 子方法）。
 *
 * 方案B 定位（task-05）：本类只做纯解析，不负责子进程执行（spawn/stdin/
 * 超时）——执行下沉到 TaskRunner（task-19）。每个 lease 一个新实例，
 * 状态隔离，无需 reset。
 *
 * IR 收敛决策（与 task-02/06/07 全局一致）：
 *   - AgentEventType 为 5 元组（text/tool_use/tool_result/error/complete），
 *     无 status / thinking。
 *   - assistant.turn_start、session.warning → `type:'text' + metadata.status/level`
 *     （对齐 task-06 parseSystem/parseLog 的收敛方式）。
 *   - assistant.reasoning / reasoning_delta、assistant.message.reasoningText
 *     → `type:'text' + metadata.thinking:true`（对齐 task-06 thinking block）。
 *
 * metadata 字段名沿用 snake_case（types.ts L48-55 注释"保持 Python 原名以便
 * 对照调试"，与 task-06/07 全局一致）。
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
 * 状态约定（task-05 B-03 允许有状态 adapter）：状态只在实例字段，不修改全局，
 * 不发起 I/O，不实现 control 应答方法（jsonl 协议无 stdin 应答需求，task-05 §B-02）。
 *
 * parse 返回 `AgentEvent[]`（不带 null）——空行 / 坏 JSON / 未知 type 一律返回 `[]`，
 * 与 Python `parse_output_multi` 永远返回 list 的语义一致（对照 task-06/07 返回
 * `| null` 的差异：jsonl 协议的「无事件」是合法且常见的，返回 [] 让消费端无需
 * 区分 null 与空数组，简化 TaskRunner 聚合逻辑）。
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
   * 分发对照 Python `_handle_event`（jsonl.py L122-171）：按完整 type 字符串
   * switch（不拆分点分层级，理由见 B-04）。
   *
   * 不抛异常：坏行返回 []（task-05 §B-04），TaskRunner 另包 try-catch 兜底。
   */
  parse(line: string): AgentEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return []; // B-05：空行 / 仅空白

    let evt: unknown;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      return []; // B-02：坏 JSON 吞掉
    }
    if (!isRecord(evt)) return []; // 非对象

    const evtType = typeof evt.type === 'string' ? evt.type : '';
    const data = isRecord(evt.data) ? evt.data : {};

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
        // IR 收敛：status 合入 text + metadata.status（对齐 task-02/06）
        return [{ type: 'text', content: '', metadata: { status: 'running' } }];

      case 'session.error':
        return this.handleSessionError(data);

      case 'session.warning':
        return this.handleSessionWarning(data);

      case 'result':
        this.handleResult(evt);
        return [];

      default:
        // B-01：未知 type 静默丢弃（对齐 Python default 无 append）
        return [];
    }
  }

  // ── 各 type handler（对齐 Python _handle_* 方法）──────────────────────

  /** 对照 Python `_handle_session_start`（jsonl.py L175-179）。 */
  private handleSessionStart(data: Record<string, unknown>): void {
    const model = typeof data.selectedModel === 'string' ? data.selectedModel : '';
    const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
    if (model) this.state.activeModel = model;
    if (sessionId) this.state.sessionId = sessionId;
  }

  /** 对照 Python `_handle_message_delta`（jsonl.py L181-186）。 */
  private handleMessageDelta(data: Record<string, unknown>): AgentEvent[] {
    const delta = typeof data.deltaContent === 'string' ? data.deltaContent : '';
    if (!delta) return [];
    this.state.output += delta;
    return [{ type: 'text', content: delta }];
  }

  /**
   * assistant.message：一行多 event 的核心场景。
   * 步骤（对齐 Python `_handle_message`，jsonl.py L188-231）：
   *   1. 若 content 非空：重置 output 防双计（先截尾、加 \n\n 分隔、append）；
   *   2. 若 reasoningText 非空：push thinking 事件（IR 收敛为 text + metadata.thinking）；
   *   3. 遍历 toolRequests[]：每个 push 一个 tool_use 事件（arguments 可为 string/dict）。
   */
  private handleMessage(data: Record<string, unknown>): AgentEvent[] {
    const events: AgentEvent[] = [];

    const content = typeof data.content === 'string' ? data.content : '';
    if (content) {
      // 防双计：若 output 已 endswith content（delta 先到），截掉尾部（B-07）。
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

    // reasoning：IR 收敛为 text + metadata.thinking
    const reasoning = typeof data.reasoningText === 'string' ? data.reasoningText : '';
    if (reasoning) {
      events.push({ type: 'text', content: reasoning, metadata: { thinking: true } });
    }

    // tool requests（arguments 可为 string / dict，B-06）
    const toolRequests = Array.isArray(data.toolRequests) ? data.toolRequests : [];
    for (const tr of toolRequests) {
      if (!isRecord(tr)) continue;
      let toolInput: Record<string, unknown> | undefined;
      const args = tr.arguments;
      if (typeof args === 'string') {
        try {
          const parsed = JSON.parse(args);
          if (isRecord(parsed)) toolInput = parsed;
          else toolInput = { raw: args };
        } catch {
          toolInput = { raw: args };
        }
      } else if (isRecord(args)) {
        toolInput = args;
      }
      const name = typeof tr.name === 'string' ? tr.name : '';
      const callId = typeof tr.toolCallId === 'string' ? tr.toolCallId : '';
      events.push({
        type: 'tool_use',
        content: '',
        metadata: { tool_name: name, call_id: callId, tool_input: toolInput },
      });
    }

    return events;
  }

  /** 对照 Python `_handle_reasoning`（jsonl.py L233-237）。 */
  private handleReasoning(data: Record<string, unknown>): AgentEvent[] {
    // 对齐 Python `data.get("content", "") or data.get("deltaContent", "")`：
    // content 为空串（falsy）时 fallback 到 deltaContent，非「content 存在即取」。
    const content = typeof data.content === 'string' ? data.content : '';
    const deltaContent = typeof data.deltaContent === 'string' ? data.deltaContent : '';
    const text = content || deltaContent;
    if (!text) return [];
    return [{ type: 'text', content: text, metadata: { thinking: true } }];
  }

  /** 对照 Python `_handle_tool_complete`（jsonl.py L239-261）。 */
  private handleToolComplete(data: Record<string, unknown>): AgentEvent[] {
    const callId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
    const success = data.success !== false; // 默认 true（对照 Python data.get("success", True)）
    let resultContent = '';

    if (success) {
      const resultObj = data.result;
      if (isRecord(resultObj)) {
        resultContent = typeof resultObj.content === 'string' ? resultObj.content : '';
      }
    } else {
      const errorObj = data.error;
      if (isRecord(errorObj)) {
        const msg = typeof errorObj.message === 'string' ? errorObj.message : 'unknown';
        resultContent = 'Error: ' + msg;
      } else if (isRecord(data.result)) {
        resultContent =
          typeof data.result.content === 'string' ? data.result.content : '';
      } else {
        resultContent = 'Error: unknown';
      }
    }

    return [
      {
        type: 'tool_result',
        content: resultContent,
        metadata: { call_id: callId, tool_output: resultContent },
      },
    ];
  }

  /** 对照 Python `_handle_session_error`（jsonl.py L263-267）。 */
  private handleSessionError(data: Record<string, unknown>): AgentEvent[] {
    const msg = typeof data.message === 'string' ? data.message : 'unknown error';
    this.state.finalStatus = 'failed';
    this.state.finalError = msg;
    return [{ type: 'error', content: msg }];
  }

  /**
   * 对照 Python `_handle_session_warning`（jsonl.py L269-271）。
   * IR 收敛：status 合入 text + metadata.level（对齐 task-06 parseLog）。
   */
  private handleSessionWarning(data: Record<string, unknown>): AgentEvent[] {
    const msg = typeof data.message === 'string' ? data.message : '';
    return [{ type: 'text', content: msg, metadata: { level: 'warn' } }];
  }

  /** 对照 Python `_handle_result`（jsonl.py L273-284）。 */
  private handleResult(raw: Record<string, unknown>): void {
    const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : '';
    if (sessionId) this.state.sessionId = sessionId;
    const exitCode = typeof raw.exitCode === 'number' ? raw.exitCode : 0;
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

// ─────────────────────────────────────────────────────────────────────────
// 私有 helper（模块级，纯函数）
// ─────────────────────────────────────────────────────────────────────────

/** 类型守卫：值是非 null 的 plain object（非数组）。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
