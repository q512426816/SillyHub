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

/** stream-json 协议支持的 provider 子集（三者共用一套解析逻辑）。 */
export type StreamJsonProvider = 'claude' | 'gemini' | 'cursor';

/** result 事件累积的最终状态（对照 Python self._last_result_info L368-373）。 */
interface ResultInfo {
  sessionId: string;
  resultText: string;
  isError: boolean;
}

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
  private lastResultInfo?: ResultInfo;

  /**
   * 子进程 stdin 引用，control_request 回写用。
   * 由 TaskRunner（task-19）在 spawn 后通过 attachStdin 注入。
   * parse 内部识别到 control_request 行时调 writeControlResponse 回写。
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
  getLastResultInfo(): ResultInfo | undefined {
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
   *   - type=control_request → 调 writeControlResponse 回写应答 + 返回 []（不产外部 event）
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
  private parseSystem(msg: Record<string, unknown>): AgentEvent[] {
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
   * control_request：调 writeControlResponse 回写应答 + 返回 []（不产外部 event）。
   * 对照 Python _consume_stdout L194-204 + _handle_control_request L206-246。
   *
   * R-03 核心：若不回写 control_response，子进程会 hang 等待批准。
   */
  private handleControlRequest(msg: Record<string, unknown>): AgentEvent[] {
    if (this.stdin) {
      this.writeControlResponse(this.stdin, msg);
    }
    // stdin 未注入（B-10）：跳过回写，子进程会 hang，但 parse 不崩溃。
    // control_request 不产外部 event（对照 Python：不进入 events 列表）
    return [];
  }

  /**
   * ProtocolAdapter 契约的公开 control 入口（可选方法）。
   *
   * 实际 control_response 回写由 parse 内部识别到 control_request 行时，
   * 通过 writeControlResponse 完成（需 msg 上下文构造 request_id / updatedInput）。
   * 此方法保留为契约签名，TaskRunner 也可在识别 control 类事件时直接调用——
   * 但因签名无 msg 参数，直接调用无法构造应答，故建议依赖 parse 内部已回写。
   */
  onControl(_stdin: NodeJS.WritableStream): void {
    // 空实现：具体回写在 writeControlResponse 内完成（见 handleControlRequest）。
    // 参数前缀 _ 表示契约保留但不在此使用。
  }

  /**
   * 构造 control_response JSON 并写入 stdin。
   * 对照 Python _handle_control_request L217-237。
   */
  private writeControlResponse(
    stdin: NodeJS.WritableStream,
    msg: Record<string, unknown>,
  ): void {
    const requestId = typeof msg.request_id === 'string' ? msg.request_id : '';

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
