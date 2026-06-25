/**
 * NdjsonAdapter —— opencode/openclaw NDJSON 流式协议解析器。
 *
 * 协议形态（对照 opencode.go processEvents / Python ndjson.py）：
 *   子进程 `run --format json --dangerously-skip-permissions <prompt>` 的 stdout
 *   每行一个 JSON 对象 `{"type":"text"|"tool_use"|"error"|"step_start"|
 *   "step_finish", "part":{...}, "sessionID"?:"..."}`。
 *
 * 方案B 拆分（task-05 已定义）：
 *   - Python NdjsonBackend 的 execute() + parse_output_multi 双职拆开。
 *   - 本 adapter 只保留 parse(line) → AgentEvent IR 纯解析。
 *   - 子进程执行（spawn / stdin / 超时）下沉到 task-19 TaskRunner。
 *
 * 两 provider（opencode/openclaw）共享完全相同的 NDJSON 字段结构
 * （Python _BINARY_MAP 仅区分 binary 名，解析逻辑无差异）。本 adapter
 * 不引入 provider 分支，但保留 provider 字段标识，为未来协议漂移留扩展点。
 *
 * IR 收敛决策（与 task-02/06/07/08 全局一致）：
 *   - AgentEventType 为 5 元组（text/tool_use/tool_result/error/complete），无 status。
 *   - Python `step_start` 产出 event_type="status"，Node 收敛为
 *     `type:'text' + metadata.status:'running'`（对齐 task-06/07/08 的 status 收敛）。
 *
 * metadata 字段名沿用 snake_case（types.ts L48-55 注释"保持 Python 原名"，
 * 与 task-06/07/08 全局一致）。
 *
 * @see design.md §7.1（AgentEvent IR）/ §7.3（PROTOCOL_PROVIDERS: ndjson→[opencode,openclaw]）
 * @see Python 源 sillyhub_daemon/backends/ndjson.py
 */

import type { AgentEvent } from '../types.js';
import type { ProtocolAdapter } from './protocol-adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// 内部状态累积器（对照 Python _NdjsonState，ndjson.py L27-42）
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
 *
 * usage 字段命名说明（task-03 决策，对齐后端契约 design §7）：
 *   - `cache_write_tokens`（opencode 原始 `tokens.cache.write`）即 Anthropic
 *     的 `cache_creation_tokens`（写入/创建缓存的 token），语义同义。
 *   - 后端 `agent_runs` 列名 / `_METADATA_FIELDS` / 聚合 schema / stream-json
 *     adapter（task-01）统一使用 `cache_creation_tokens`（creation 命名）。
 *   - 本接口内部仍用 `cache_write_tokens`（贴近 opencode 源字段、最小改动），
 *     在 `getUsage()` 出口额外吐 `cache_creation_tokens` 别名（=同值），
 *     让 task-16 提交链 / 后端 `_METADATA_FIELDS` 任一字段名都能命中。
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
    /** opencode `tokens.cache.write`；= Anthropic `cache_creation_tokens`（见类 JSDoc）。 */
    cache_write_tokens: number;
  };
}

/**
 * `getUsage()` 返回类型：基础 4 字段 + `cache_creation_tokens` 别名。
 *
 * 导出该类型供调用方（task-19 TaskRunner / task-16 提交链 / 测试）引用，
 * 字段名 `cache_creation_tokens` 对齐后端契约（design §7 schema）。
 */
export type NdjsonUsage = NdjsonState['usage'] & {
  /** = `cache_write_tokens`（opencode write 即 Anthropic cache_creation）。 */
  cache_creation_tokens: number;
};

/** 初始化一个空状态对象（对照 Python _NdjsonState 默认值）。 */
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
 * 对照 Python _BINARY_MAP 的两个 key（ndjson.py:56-60，pi 已拆出独立 pi_json 协议）。
 */
export type NdjsonProvider = 'opencode' | 'openclaw';

/**
 * NDJSON 流式协议 adapter（opencode/openclaw 共用）。
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
    if (provider !== 'opencode' && provider !== 'openclaw') {
      throw new Error(`Unknown NdjsonAdapter provider: ${provider}`);
    }
    this.provider = provider;
  }

  /**
   * 三 provider 共享启动参数（ql-20260617-008）。
   *
   * 对照 ndjson.ts:23 协议形态：`run --format json --dangerously-skip-permissions <prompt>`。
   * prompt 作为 args 末尾位置参数传入（不走 stdin），故 buildInput 不会被调用。
   *
   * - `run`：opencode/openclaw 都用此子命令触发非交互执行
   * - `--format json`：stdout 输出 NDJSON 事件流（本 adapter parse 假设的输入格式）
   * - `--dangerously-skip-permissions`：跳过工具批准（daemon 自动审批）
   * - `<prompt>`：用户输入（位置参数）
   *
   * @param opts.prompt 用户 prompt（必须，作位置参数）
   */
  buildArgs(opts?: {
    model?: string;
    sessionId?: string;
    resumeSessionId?: string;
    prompt?: string;
  }): string[] {
    const args = ['run', '--format', 'json', '--dangerously-skip-permissions'];
    if (opts?.model) {
      args.push('--model', opts.model);
    }
    args.push(opts?.prompt ?? '');
    return args;
  }

  /** 重置内部状态（新 lease 复用 adapter 实例时调用）。对照 Python _reset_state() L68-70。 */
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
   * 返回约定（task-05 B-01，对照 Python 返回空 list 的场景统一用 null）：
   *   - null：空行 / 坏 JSON / step_finish（纯元数据）/ 未知 type
   *   - 非空数组：text/tool_use/tool_result/error 事件
   *
   * 注意：step_start 产出单个 text 事件（content 空串 + metadata.status='running'），
   * 这是 IR 5 元组收敛 status 类型的约定（task-02 §实现要求 #2）。
   */
  parse(line: string): AgentEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null; // B-01：空行 / 仅空白

    let evt: unknown;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      // 对照 Python L128: logger.warning + return []
      console.warn(`ndjson: failed to parse line: ${trimmed.slice(0, 200)}`);
      return null; // B-02：坏 JSON 吞掉
    }
    if (!isRecord(evt)) return null; // 非对象

    const evtType = typeof evt.type === 'string' ? evt.type : '';
    const part = isRecord(evt.part) ? evt.part : {};

    // 任意事件都可能携带 sessionID（对照 Python L134-136，后到覆盖）
    if (typeof evt.sessionID === 'string' && evt.sessionID) {
      this.state.sessionId = evt.sessionID;
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
        const errObj = isRecord(raw.error) ? raw.error : {};
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

  // ── 单事件 handler（对齐 Python _handle_* 方法）───────────────────────

  /**
   * text 事件（对照 Python _handle_text_event L175-181）。
   * 空 text 返回 null（不产出空 text 事件，避免 backend 收到无意义消息）。
   */
  private handleTextEvent(part: Record<string, unknown>): AgentEvent | null {
    const text = typeof part.text === 'string' ? part.text : '';
    if (!text) return null;
    this.state.output += text; // 累积到 state.output（对照 Python L180）
    return { type: 'text', content: text };
  }

  /**
   * tool_use 事件（对照 Python _handle_tool_use_event L183-229）。
   * 始终产出 tool_use；若 state.status==='completed' 额外产出 tool_result。
   */
  private handleToolUseEvent(part: Record<string, unknown>): AgentEvent[] {
    const events: AgentEvent[] = [];

    const state = isRecord(part.state) ? part.state : {};
    const toolName = typeof part.tool === 'string' ? part.tool : '';
    const callId = typeof part.callID === 'string' ? part.callID : '';

    // 解析 tool_input（对照 Python L195-204）
    const rawInput = state.input;
    let toolInput: Record<string, unknown> | null = null;
    if (rawInput !== undefined && rawInput !== null) {
      if (typeof rawInput === 'string') {
        try {
          const parsed: unknown = JSON.parse(rawInput);
          toolInput = isRecord(parsed) ? parsed : { raw: rawInput };
        } catch {
          toolInput = { raw: rawInput }; // B-05：非合法 JSON 保留原值
        }
      } else if (isRecord(rawInput)) {
        toolInput = rawInput;
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
    if (state.status === 'completed') {
      const outputStr = this.extractToolOutput(state.output);
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
  private handleErrorEvent(error: Record<string, unknown>): AgentEvent {
    const errData = isRecord(error.data) ? error.data : {};
    let errMsg = '';
    if (typeof errData.message === 'string' && errData.message) {
      errMsg = errData.message;
    } else if (typeof error.name === 'string' && error.name) {
      errMsg = error.name;
    }
    if (!errMsg) errMsg = 'unknown error'; // B-09

    this.state.finalStatus = 'failed';
    this.state.finalError = errMsg;
    return { type: 'error', content: errMsg };
  }

  /**
   * step_finish 事件（对照 Python _handle_step_finish L247-262）。
   * 累加 token 到 state.usage，无事件产出。
   *
   * cache 映射（task-03）：
   *   - `tokens.cache.read` → `cache_read_tokens`
   *   - `tokens.cache.write` → `cache_write_tokens`（opencode 命名）
   *     = Anthropic `cache_creation_tokens`（写入/创建缓存，语义同义）。
   *     出口别名见 `getUsage()`。
   */
  private handleStepFinish(part: Record<string, unknown>): void {
    const tokens = isRecord(part.tokens) ? part.tokens : null;
    if (!tokens) return;

    this.state.usage.input_tokens += typeof tokens.input === 'number' ? tokens.input : 0;
    this.state.usage.output_tokens += typeof tokens.output === 'number' ? tokens.output : 0;

    const cache = isRecord(tokens.cache) ? tokens.cache : null;
    if (cache) {
      this.state.usage.cache_read_tokens += typeof cache.read === 'number' ? cache.read : 0;
      this.state.usage.cache_write_tokens += typeof cache.write === 'number' ? cache.write : 0;
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

  /**
   * 累积的 token usage（多 step_finish 跨行累加）。
   *
   * 返回浅拷贝（扁平 number 对象，调用方修改不影响内部 state）。
   *
   * 字段名映射（task-03，对齐后端契约 design §7）：
   *   - 内部存储用 opencode 命名 `cache_write_tokens`（贴近源字段）。
   *   - 出口额外吐 `cache_creation_tokens`（= cache_write_tokens 值），对齐
   *     Anthropic / 后端 `agent_runs.cache_creation_tokens` 列名 / stream-json
   *     adapter（task-01）/ `_METADATA_FIELDS`。两个 cache_write/creation 字段
   *     并存同值，让 task-16 提交链、后端任一字段名都能命中，避免 cache 丢失。
   *
   * 供 task-19 TaskRunner 在子进程退出后读取，拼装 TaskResult.usage。
   */
  getUsage(): NdjsonUsage {
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
