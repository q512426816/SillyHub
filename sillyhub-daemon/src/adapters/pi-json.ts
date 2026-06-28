/**
 * PiJsonAdapter —— Pi CLI 的 JSON 事件流协议解析器。
 *
 * 协议形态（对照 Pi CLI 实测）：
 *   子进程 `pi --mode json -p "<prompt>"` 的 stdout 每行一个 JSON 对象，
 *   顶层 `type` 标识事件类别，payload 直接平铺（不像 opencode 套一层 `part`）。
 *
 * 与 ndjson（opencode/openclaw）的区别——pi 独立协议的根因：
 *   - Pi 无 `run` 子命令、无 `--format json`（用 `--mode json`）、无
 *     `--dangerously-skip-permissions`（默认不弹窗）；
 *   - 事件字段结构与 opencode 完全不同：流式文本走 `message_update` 内的
 *     `assistantMessageEvent.delta`，工具走 `tool_execution_start/update/end`
 *     三段式，usage 在 `turn_end.message.usage`，session id 在 `session.id`。
 *   - 故 pi 从 ndjson provider 列表移除，独立走 `pi_json` 协议（见 index.ts）。
 *
 * 方案B 拆分（与 ndjson/stream-json/jsonl 一致）：
 *   - 本 adapter 只做纯解析 parse(line) → AgentEvent IR；
 *   - 子进程执行（spawn/stdin/超时）下沉到 TaskRunner（task-19）。
 *
 * IR 收敛（与 task-02/06/07/08/09 全局一致）：
 *   - AgentEventType 5 元组（text/tool_use/tool_result/error/complete）。
 *   - Pi 的纯生命周期事件（session / agent_start / agent_end / turn_start /
 *     message_start / message_end / text_start / text_end /
 *     tool_execution_update）不产出 IR，仅更新内部状态，返回 null。
 *   - text_delta → text；tool_execution_start → tool_use；
 *     tool_execution_end → tool_result；error → error。
 *
 * metadata 字段名沿用 snake_case（types.ts 注释"保持 Python 原名以便对照
 * 调试"，与各 adapter 全局一致）。
 *
 * @see src/adapters/ndjson.ts（对照参考：opencode/openclaw 协议）
 * @see src/adapters/index.ts（PROTOCOL_PROVIDERS: pi_json→[pi]）
 */

import type { AgentEvent } from '../types.js';
import type { ProtocolAdapter } from './protocol-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// 内部状态累积器
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pi JSON 事件流累积状态。
 *
 * 跨行累积：
 *   - output：所有 text_delta 的 delta 拼接（最终 TaskResult.output）；
 *   - usage：turn_end.message.usage 的 token（input/output/cacheRead/cacheWrite）；
 *   - sessionId：session 事件的 id；
 *   - finalStatus/finalError：仅 error 事件置 failed（见类 JSDoc）。
 *
 * 这些状态不通过 parse 返回值传递，由 TaskRunner（task-19）在子进程退出后
 * 经 getter 读取，拼装最终 TaskResult。
 */
interface PiState {
  output: string;
  sessionId: string;
  finalStatus: 'completed' | 'failed' | 'timeout' | 'aborted';
  finalError: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    /** Pi `usage.cacheWrite`；= Anthropic `cache_creation_tokens`（见 getUsage 决策）。 */
    cache_write_tokens: number;
  };
  /** 未知事件计数（可观测性：未知事件不 crash 但 warn + 计数）。 */
  ignoredCount: number;
}

/**
 * `getUsage()` 返回类型：基础 4 字段 + `cache_creation_tokens` 别名。
 *
 * 字段名 `cache_creation_tokens` 对齐后端契约（design §7）/ NdjsonUsage /
 * stream-json adapter / task-runner extractStatsFromAdapter（task-03），
 * 让 task-16 提交链 / 后端 `_METADATA_FIELDS` 任一字段名都能命中。
 */
export type PiJsonUsage = PiState['usage'] & {
  /** = `cache_write_tokens`（Pi cacheWrite 即 Anthropic cache_creation）。 */
  cache_creation_tokens: number;
};

/** 初始化空状态对象。 */
function createInitialState(): PiState {
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
    ignoredCount: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PiJsonAdapter 实现
// ─────────────────────────────────────────────────────────────────────────────

/** 合法的 pi provider 字面量（单 provider）。 */
export type PiJsonProvider = 'pi';

/**
 * Pi CLI 的 JSON 事件流 adapter。
 *
 * 用法（task-19 TaskRunner）：
 *   const adapter = new PiJsonAdapter();
 *   for await (const line of readLines(proc.stdout)) {
 *     const events = adapter.parse(line);
 *     if (events) for (const ev of events) submit(ev);
 *   }
 *   result = {
 *     status: adapter.getFinalStatus(),
 *     output: adapter.getOutput(),
 *     sessionId: adapter.getSessionId(),
 *   };
 *
 * 终态约定：finalStatus 默认 completed，仅在收到 `error` 事件时置 failed
 * （对齐用户规格"completed 默认 / failed 如有 error"）。工具执行错误
 * （tool_execution_end.isError）不改终态，仅写入 metadata.is_error 保留信息。
 */
export class PiJsonAdapter implements ProtocolAdapter {
  readonly provider: PiJsonProvider;
  private state: PiState = createInitialState();

  constructor(provider: PiJsonProvider = 'pi') {
    if (provider !== 'pi') {
      throw new Error(`Unknown PiJsonAdapter provider: ${provider}`);
    }
    this.provider = provider;
  }

  /**
   * Pi CLI 启动参数。
   *
   * 对照 Pi 实测接口：`pi --mode json -p "<prompt>"`。
   *   - `--mode json`：stdout 输出 NDJSON 事件流（本 adapter parse 假设的输入）；
   *   - `-p <prompt>`：用户输入（位置参数，不走 stdin）；
   *   - 可选 `--model`：来自 opts.model；
   *   - 可选 `--provider`：Pi 自身的 LLM 供应商（如 zai）。
   *
   * --provider 数据源说明：TaskRunner（task-runner.ts:441）调 buildArgs 时只透传
   * `{model, sessionId, resumeSessionId, prompt, toolConfig}`，无 LLM provider 字段。
   * 约定 opts.model 形如 `"zai/glm-5.2"` 时拆成 `--provider zai --model glm-5.2`，
   * 无斜杠则整体作 --model。这样 --provider 真正可用且无需改 TaskRunner / 接口。
   *
   * @param opts.prompt 用户 prompt（必须，作 -p 位置参数）
   */
  buildArgs(opts?: {
    model?: string;
    sessionId?: string;
    resumeSessionId?: string;
    prompt?: string;
  }): string[] {
    const args: string[] = ['--mode', 'json'];
    const model = opts?.model;
    if (model) {
      const slash = model.indexOf('/');
      if (slash > 0) {
        // "zai/glm-5.2" → --provider zai --model glm-5.2
        args.push('--provider', model.slice(0, slash));
        args.push('--model', model.slice(slash + 1));
      } else {
        args.push('--model', model);
      }
    }
    args.push('-p', opts?.prompt ?? '');
    return args;
  }

  /**
   * 重置内部累积状态（重试前由 TaskRunner 鸭子类型调用）。
   *
   * 方法名 `resetAccumulator` 对齐 task-runner.ts:433 的实际调用（ndjson 的
   * `resetState` 名字不匹配、重试时不触发；此处修正为运行时真正调用的名字，
   * 让跨 attempt 状态真正重置，避免重试串味）。
   */
  resetAccumulator(): void {
    this.state = createInitialState();
  }

  // ── ProtocolAdapter.parse ──────────────────────────────────────────────

  /**
   * 解析一行 Pi NDJSON，返回 0..N 个 AgentEvent。
   *
   * 边界处理（与各 adapter 一致，B-04）：
   *   - 空行 / 坏 JSON / 非对象 → null；
   *   - 未知 type → null；
   *   - 纯生命周期事件 → null，仅更新内部状态。
   */
  parse(line: string): AgentEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let evt: unknown;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      console.warn(`pi-json: failed to parse line: ${trimmed.slice(0, 200)}`);
      return null;
    }
    if (!isRecord(evt)) return null;

    const evtType = typeof evt.type === 'string' ? evt.type : '';
    return this.handleEvent(evtType, evt);
  }

  // ── 事件分派 ────────────────────────────────────────────────────────────

  private handleEvent(
    evtType: string,
    raw: Record<string, unknown>,
  ): AgentEvent[] | null {
    switch (evtType) {
      case 'session':
        this.handleSession(raw);
        return null;
      case 'message_update':
        return this.handleMessageUpdate(raw);
      case 'tool_execution_start':
        return this.handleToolStart(raw);
      case 'tool_execution_end':
        return this.handleToolEnd(raw);
      case 'turn_end':
        // turn_end：累积 usage 后 emit usage_update 事件，让 task-runner 透传到
        // backend（否则 pi provider 的 agent_runs.input_tokens 永远为空）。
        return this.handleTurnEnd(raw);
      case 'error':
        return this.handleError(raw);
      // 纯生命周期事件，无 IR 产出
      case 'agent_start':
      case 'agent_end':
      case 'turn_start':
      case 'message_start':
      case 'message_end':
        return null;
      default: {
        // 未知 type：不 crash，但可观测——debug warn + ignored 计数。
        // 覆盖 text_start / text_end / tool_execution_update 等已知子事件
        // 及未来新增事件。
        this.state.ignoredCount++;
        console.warn(`pi-json: ignored event type="${evtType}"`);
        return null;
      }
    }
  }

  // ── 单事件 handler ──────────────────────────────────────────────────────

  /** session 事件：提取 id（无事件产出）。 */
  private handleSession(raw: Record<string, unknown>): void {
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (id) this.state.sessionId = id;
  }

  /**
   * message_update：按 assistantMessageEvent.type 分派。
   *   - text_delta → text 事件 + 累积 output；
   *   - text_start / text_end / 其他（reasoning_* 等）→ null。
   *
   * text_end 不重复产出完整文本——text_delta 已逐字累积到 output，
   * 若 text_end 再 append 会双计。
   */
  private handleMessageUpdate(raw: Record<string, unknown>): AgentEvent[] | null {
    const ame = isRecord(raw.assistantMessageEvent)
      ? raw.assistantMessageEvent
      : {};
    const sub = typeof ame.type === 'string' ? ame.type : '';
    if (sub === 'text_delta') {
      const delta = typeof ame.delta === 'string' ? ame.delta : '';
      if (!delta) return null;
      this.state.output += delta;
      return [{ type: 'text', content: delta }];
    }
    return null;
  }

  /** tool_execution_start → tool_use。args 恒为对象（Pi 保证），整体进 tool_input。 */
  private handleToolStart(raw: Record<string, unknown>): AgentEvent[] {
    const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
    const callId = typeof raw.toolCallId === 'string' ? raw.toolCallId : '';
    const args = isRecord(raw.args) ? raw.args : {};
    return [
      {
        type: 'tool_use',
        content: JSON.stringify(args),
        metadata: {
          tool_name: toolName,
          call_id: callId,
          tool_input: args,
        },
      },
    ];
  }

  /**
   * tool_execution_end → tool_result。
   * isError 仅写入 metadata.is_error（不改终态，见类 JSDoc 终态约定）。
   */
  private handleToolEnd(raw: Record<string, unknown>): AgentEvent[] {
    const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
    const callId = typeof raw.toolCallId === 'string' ? raw.toolCallId : '';
    const isError = raw.isError === true;
    const resultText = this.extractResultText(raw.result);
    return [
      {
        type: 'tool_result',
        content: resultText,
        metadata: {
          tool_name: toolName,
          call_id: callId,
          tool_output: resultText,
          is_error: isError,
        },
      },
    ];
  }

  /**
   * turn_end：累积 usage（从 message.usage），并 emit 一个 `usage_update`
   * AgentEvent（带 input_tokens 等累计 snapshot），让 task-runner 的
   * `_eventToMessages`（usage_update 分支）透传到 backend 写库。
   *
   * 字段映射（对齐后端契约，见 getUsage / ndjson.ts / stream-json.ts 同名决策）：
   *   input → input_tokens；output → output_tokens；
   *   cacheRead → cache_read_tokens；cacheWrite → cache_creation_tokens（= creation）。
   *   totalTokens 不映射（后端无对应列）。
   *
   * 事件格式对齐 stream-json adapter `_buildUsageUpdateEvent()`：text 事件 +
   * metadata.status='usage_update' + metadata.usage。无 usage 时仍返回 null（与
   * 原行为一致，避免产出空 token 噪声事件）。
   */
  private handleTurnEnd(raw: Record<string, unknown>): AgentEvent[] | null {
    const message = isRecord(raw.message) ? raw.message : {};
    const usage = isRecord(message.usage) ? message.usage : null;
    if (!usage) return null;
    this.state.usage.input_tokens += numOr0(usage.input);
    this.state.usage.output_tokens += numOr0(usage.output);
    this.state.usage.cache_read_tokens += numOr0(usage.cacheRead);
    this.state.usage.cache_write_tokens += numOr0(usage.cacheWrite);

    // usage_update snapshot = 当前累计 state.usage（cache_creation 别名 = cache_write）。
    return [
      {
        type: 'text',
        content: '',
        metadata: {
          status: 'usage_update',
          usage: {
            input_tokens: this.state.usage.input_tokens,
            output_tokens: this.state.usage.output_tokens,
            cache_read_tokens: this.state.usage.cache_read_tokens,
            cache_creation_tokens: this.state.usage.cache_write_tokens,
          },
        },
      },
    ];
  }

  /**
   * error 事件 → error + finalStatus=failed。
   * message 优先级：error.message > error.name > 'unknown error'（B-09）。
   */
  private handleError(raw: Record<string, unknown>): AgentEvent[] {
    const errObj = isRecord(raw.error) ? raw.error : {};
    const msg =
      (typeof errObj.message === 'string' && errObj.message) ||
      (typeof errObj.name === 'string' && errObj.name) ||
      'unknown error';
    this.state.finalStatus = 'failed';
    this.state.finalError = msg;
    return [{ type: 'error', content: msg }];
  }

  /**
   * 工具结果转文本。
   * Pi result 形如 `{content:[{type:"text",text:"..."}]}` → 拼接所有 text；
   * string 直接返回；其他兜底 JSON.stringify。
   */
  private extractResultText(result: unknown): string {
    if (result === undefined || result === null) return '';
    if (typeof result === 'string') return result;
    if (isRecord(result)) {
      const content = Array.isArray(result.content) ? result.content : null;
      if (content) {
        const parts: string[] = [];
        for (const c of content) {
          if (isRecord(c) && typeof c.text === 'string') parts.push(c.text);
        }
        if (parts.length > 0) return parts.join('');
      }
      // content 缺失 / 空数组 → 兜底 stringify 整个 result
    }
    return JSON.stringify(result);
  }

  // ── 状态读取（供 task-19 TaskRunner 在子进程退出后调用） ────────────────

  /** 累积的文本输出（所有 text_delta 拼接）。 */
  getOutput(): string {
    return this.state.output;
  }

  /** 提取的会话 ID（来自 session 事件）。 */
  getSessionId(): string {
    return this.state.sessionId;
  }

  /** 终态：completed（默认）/ failed（error 事件触发）。 */
  getFinalStatus(): PiState['finalStatus'] {
    return this.state.finalStatus;
  }

  /** 失败时的错误信息（completed 时为空串）。 */
  getFinalError(): string {
    return this.state.finalError;
  }

  /**
   * 累积的 token usage（turn_end 跨行累加）。
   *
   * 返回浅拷贝（扁平 number 对象，调用方修改不影响内部 state）。
   * 出口额外吐 `cache_creation_tokens`（= cache_write_tokens 值），对齐
   * Anthropic / 后端 `agent_runs.cache_creation_tokens` 列名 / NdjsonUsage /
   * stream-json adapter。两个 cache_write/creation 字段并存同值，让
   * task-runner extractStatsFromAdapter、task-16 提交链、后端任一字段名都能
   * 命中，避免 cache 丢失（task-03 教训）。
   */
  getUsage(): PiJsonUsage {
    return {
      ...this.state.usage,
      cache_creation_tokens: this.state.usage.cache_write_tokens, // 别名：write=creation
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 私有 helper（模块级，纯函数）
// ─────────────────────────────────────────────────────────────────────────────

/** 类型守卫：值是非 null 的 plain object（非数组）。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 取有限数，否则 0（防 NaN / Infinity / 非数值字段污染累加）。 */
function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
