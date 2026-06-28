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
   * 跨 assistant 事件累加的 usage（task-06：对齐 SERVER _extract_result_metadata 聚合策略）。
   * parseAssistant 每次累加 message.usage.input_tokens/output_tokens；
   * parseResult 时通过 extractResultStats 与 result.usage 求和（result.usage 优先 +
   * accumulated 防御性双保险）。
   *
   * 跨 lease 重置：TaskRunner 在 runLease 步骤4 拿到 adapter 后调 resetAccumulator，
   * 避免 adapter 单例场景下跨 lease 累加污染（task-06 §边界处理 6）。
   */
  private _accumulatedUsage: {
    input_tokens: number;
    output_tokens: number;
    // task-01 (2026-06-24-runtime-usage-stats): cache 两维（短名，内部存储统一去 _input_ 后缀）
    cache_read_tokens: number;
    cache_creation_tokens: number;
  } = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };

  /**
   * ql-20260617-006：当前 turn 的实时 usage（来自 stream_event/message_delta）。
   *
   * Claude CLI stream-json 模式下，中间 assistant 事件 message.usage 永远是 {0,0}，
   * 但加 --include-partial-messages 后会额外吐 stream_event 事件流，其中
   * message_delta 子事件的 event.usage 字段含当前 turn 的**累积** token 数
   * （不是增量——同一个 turn 内多次 message_delta 的 usage 后到为准）。
   *
   * 实时展示策略：
   *   - 解析 message_delta 时 `_currentTurnUsage = event.usage`（replace 语义）
   *   - 解析 assistant 事件（turn 结束）时 commit：`_accumulatedUsage += _currentTurnUsage`，
   *     `_currentTurnUsage = {0,0}`
   *   - snapshot 取 `_accumulatedUsage + _currentTurnUsage`，让前端在 turn 进行中
   *     就能看到当前 turn 的累积值，turn 结束后无缝过渡到下一轮累加
   *
   * ql-20260617-007：实测 message_delta 每 turn 只在结束时发一次（CLI 硬限制），
   * 单 turn 短响应下用户在执行过程中看不到 token 变化。补充 content_block_delta
   * 流式估算：每收到 text_delta 就按 chars/4 粗估 output_tokens 累加到
   * `_currentTurnUsage.output_tokens`，让前端看到 output tokens 流式增长。
   * 真 usage 在 message_delta 到达时覆盖估算值。
   */
  private _currentTurnUsage: {
    input_tokens: number;
    output_tokens: number;
    // task-01: cache 两维（短名）。取值点映射 Claude 原始 cache_*_input_tokens。
    cache_read_tokens: number;
    cache_creation_tokens: number;
  } = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };

  /**
   * ql-20260617-007：当前 turn 是否已经收到过 message_delta（真 usage）。
   *
   * 用于让 content_block_delta 估算值不要在 message_delta 到达后继续覆盖真值。
   * 一旦 message_delta 给出了真 usage，本 turn 内后续 delta 不再更新
   * `_currentTurnUsage.output_tokens`（避免估算值覆盖真值）。
   */
  private _currentTurnHasRealUsage = false;

  /**
   * ql-20260617-007：上次 emit usage_update 时的 output_tokens 快照值。
   *
   * content_block_delta 单次 text 通常 1-5 字符 → est=1，单 delta 增量永远 < 20。
   * 必须跟踪「自上次 emit 以来的累计增量」，每累计 ≥ 20 token 才推一次 event。
   * resetAccumulator / message_start / commit 时一并清零。
   */
  private _lastEmittedOutputTokens = 0;

  /**
   * ql-20260617-010：本 turn 是否已通过 thinking_delta 流式输出过 thinking。
   *
   * parseAssistant 处理完整 thinking block 时若为 true，则跳过（避免与流式输出重复）。
   * message_start 时 reset；commit（parseAssistant 入口）时一并 reset。
   * 未开 --include-partial-messages 时永远 false，parseAssistant 正常输出完整 thinking。
   */
  private _currentTurnEmittedThinking = false;

  /**
   * ql-20260617-012：thinking_delta 字符缓冲。
   *
   * 每个 thinking_delta 累积到 buffer，达到 THINKING_FLUSH_CHARS 字符或
   * THINKING_FLUSH_MS 毫秒（自 buffer 起始算）后才 emit 一条 event（一批 chunk）。
   * 避免每个 token 都触发 HTTP POST + DB commit + Redis publish，让
   * 长 thinking 推送累积十几秒延迟。
   *
   * 残留 buffer 在 parseAssistant 入口（turn 结束 / 完整 message）时 flush，
   * 保证最后一段不丢。message_start 时清空（多 turn 防御）。
   *
   * _thinkingBufStartedAt 仅在 buffer 非空时有效（首次 push 时设置），
   * 避免 resetAccumulator/message_start 后立即触发时间窗口 flush。
   */
  private _thinkingBuf = '';
  private _thinkingBufStartedAt = 0;
  private static readonly THINKING_FLUSH_CHARS = 80;
  private static readonly THINKING_FLUSH_MS = 120;

  /**
   * ql-20260618-012：部分 CLI 的 partial assistant 会反复推送「截至当前的累积全文」
   *（非增量 delta）。若在流式过程中按字符/时间 flush，会：
   *   1. 同一段落重复出现在运行日志
   *   2. 每个 flush 一次 HTTP submit → 执行慢一个数量级
   * 策略对齐 Claude Code：assistant 文本只在完整 message 或 tool 边界 emit；
   * cursor 不使用 --stream-partial-output，走完整 assistant 事件。
   */
  private _assistantBuf = '';
  private _lastFlushedAssistant = '';

  private _usesPartialAssistantStream(): boolean {
    return false;
  }

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

  /**
   * 重置跨 message 累加器（task-06）。
   * TaskRunner 在 runLease 步骤4 拿到 adapter 后调用，避免 adapter 单例时跨 lease 污染。
   */
  resetAccumulator(): void {
    this._accumulatedUsage = {
      input_tokens: 0,
      output_tokens: 0,
      // task-01: cache 两维一并清零（防跨 lease 污染）
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    };
    // ql-20260617-006：连当前 turn 一起清零，防止跨 lease 污染。
    this._currentTurnUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    };
    // ql-20260617-007：估算状态也清零。
    this._currentTurnHasRealUsage = false;
    this._lastEmittedOutputTokens = 0;
    // ql-20260617-010：thinking 流式标记也清零。
    this._currentTurnEmittedThinking = false;
    // ql-20260617-012：thinking buffer 也清零。
    this._thinkingBuf = '';
    this._thinkingBufStartedAt = 0;
    this._assistantBuf = '';
    this._lastFlushedAssistant = '';
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
   * 构造子进程 spawn 命令的参数列表（不含 cmdPath 本身）。
   * 对照 Python `stream_json.py _build_args` L281-291 + `execute` L49-52 的 resume 追加。
   *
   * 必须 `-p`（print 模式 / 非交互），否则 claude 裸启动会进入交互 REPL 阻塞 stdin，
   * task 整体 hang（正是本 bug 的根因——TaskRunner 走可选兜底 args=[] 时命中此路径）。
   * stream-json 输入输出格式让 prompt 走 stdin NDJSON、stdout 吐 NDJSON 事件流；
   * `--permission-mode bypassPermissions` 配合下面的 control_response 自动批准，
   * `--verbose` 让 result 事件带 usage/cost stats（parseResult 提取到 metadata.stats）。
   *
   * resumeSessionId 非空时追加 `--resume <id>`（多轮续跑，对照 Python execute L50-52）。
   */
  buildArgs(opts?: {
    model?: string;
    sessionId?: string;
    resumeSessionId?: string;
    prompt?: string;
    toolConfig?: {
      mode?: string;
      allowed_tools?: string[];
      max_turns?: number;
    };
  }): string[] {
    const model = opts?.model?.trim();
    const prompt = opts?.prompt?.trim() ?? '';

    if (this.provider === 'cursor') {
      // cursor-agent CLI 与 claude 参数集不同：无 --input-format / --permission-mode /
      // --include-partial-messages；prompt 作位置参数，不走 stdin NDJSON。
      // 不加 --stream-partial-output：partial 会高频重发累积全文，运行日志重复且
      // 每条都 submit_messages 拖慢执行。完整 assistant message 与 Claude Code 一致。
      const args = [
        '-p',
        '--output-format', 'stream-json',
        '--force',
        '--trust',
      ];
      if (model) {
        args.push('--model', model);
      }
      if (opts?.resumeSessionId) {
        args.push('--resume', opts.resumeSessionId);
      }
      if (prompt) {
        args.push(prompt);
      }
      return args;
    }

    // tool_config (from lease) governs Worker execution: mode overrides the
    // default bypassPermissions, allowed_tools is an explicit whitelist,
    // max_turns bounds execution (without it Workers ran 6min+ unbounded).
    const tc = opts?.toolConfig;
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-mode', tc?.mode || 'bypassPermissions',
      // ql-20260617-006：开启后 stream_event 的 message_delta 子事件会带真实 usage
      // （input_tokens/output_tokens 是当前 turn 的累积值）。不开启时 assistant 事件
      // 的 message.usage 永远是 {0,0}，只能在最终 result 事件拿到真实值——无法实时累加。
      '--include-partial-messages',
    ];
    if (tc?.allowed_tools && tc.allowed_tools.length > 0) {
      args.push('--allowedTools', tc.allowed_tools.join(','));
    }
    if (tc?.max_turns && tc.max_turns > 0) {
      args.push('--max-turns', String(tc.max_turns));
    }
    if (model) {
      args.push('--model', model);
    }
    if (opts?.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }
    return args;
  }

  /**
   * 构造写入子进程 stdin 的 prompt 数据。
   * 对照 Python `stream_json.py _build_input` L293-303。
   *
   * stream-json 输入格式要求把 prompt 包成一条 user message NDJSON（单行 JSON + `\n`）。
   * TaskRunner（task-runner.ts:457-460）拿到本方法返回值后会 Buffer.from + stdin.write，
   * 并保持 stdin 开启直到 result 事件（R-03），中途还能回写 control_response。
   */
  buildInput(prompt: string): string {
    if (this.provider === 'cursor') {
      // cursor-agent 通过 buildArgs 位置参数传 prompt，stdin 留空。
      return '';
    }
    const payload = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    };
    return JSON.stringify(payload) + '\n';
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
      case 'result': {
        const events: AgentEvent[] = [];
        if (this._usesPartialAssistantStream()) {
          const flushed = this._flushAssistantBuf();
          if (flushed) events.push(...flushed);
        }
        const parsed = this.parseResult(msg);
        if (parsed) events.push(...parsed);
        return events.length > 0 ? events : null;
      }
      case 'log':
        return this.parseLog(msg);
      case 'control_request':
        return this.handleControlRequest(msg);
      case 'stream_event':
        // ql-20260617-006：--include-partial-messages 启用后才有，含真实 message_delta.usage
        return this.parseStreamEvent(msg);
      default:
        // 未知 type：返回 null（对照 Python L278-279）
        return null;
    }
  }

  /**
   * ql-20260617-006 / ql-20260617-007：解析 stream_event 事件（仅 --include-partial-messages 启用）。
   *
   * 关键子事件 event.type：
   *   - message_start：新 turn 开始，reset _currentTurnHasRealUsage（实际 commit 在
   *     assistant 事件做，这里只是兜底防多 turn 串扰）
   *   - content_block_delta（text_delta）：流式内容 → 按 chars/3 粗估 output_tokens
   *     累加（仅在尚未收到真 usage 时），让前端在 turn 进行中就能看到 output 增长
   *   - message_delta：含 event.usage（当前 turn 累积值）→ 覆盖估算值，更新
   *     _currentTurnUsage 并产 1 个 status='usage_update' 的 text event（空 content +
   *     metadata.usage），让 task-runner → submit_messages 实时回写到 AgentRun。
   *
   * 节流：仅在累计 usage 真有增长时产 event（避免高频刷屏 backend）。
   */
  private parseStreamEvent(msg: Record<string, unknown>): AgentEvent[] | null {
    const event = msg.event;
    if (!isRecord(event)) return null;
    const eventType = typeof event.type === 'string' ? event.type : '';

    if (eventType === 'message_start') {
      this._currentTurnHasRealUsage = false;
      // ql-20260617-007：新 turn 开始时清掉 emit 节流状态
      this._lastEmittedOutputTokens = 0;
      // ql-20260617-010：新 turn 开始时清掉 thinking 流式标记
      this._currentTurnEmittedThinking = false;
      // ql-20260617-012：新 turn 开始时清掉 thinking buffer（防御多 turn 残留）
      this._thinkingBuf = '';
      this._thinkingBufStartedAt = 0;

      // ql-token-fix：message_start.message.usage 含本次 API call 的 input_tokens
      // 和 cache 维度——message_delta 不带 input_tokens，所以必须在这里提取。
      // 累加到 _currentTurnUsage（跨 API call 累积 → 走 _accumulatedUsage 在 commit 时合并）。
      const msg = event.message;
      if (isRecord(msg)) {
        const startUsage = msg.usage;
        if (isRecord(startUsage)) {
          if (typeof startUsage.input_tokens === 'number') {
            this._currentTurnUsage.input_tokens += startUsage.input_tokens;
          }
          if (typeof startUsage.cache_creation_input_tokens === 'number') {
            this._currentTurnUsage.cache_creation_tokens += startUsage.cache_creation_input_tokens;
          }
          if (typeof startUsage.cache_read_input_tokens === 'number') {
            this._currentTurnUsage.cache_read_tokens += startUsage.cache_read_input_tokens;
          }
        }
      }

      // 如果 input_tokens 已有值，立即 emit 一个 usage_update 让前端看到
      if (
        this._currentTurnUsage.input_tokens > 0 ||
        this._currentTurnUsage.cache_read_tokens > 0
      ) {
        this._currentTurnHasRealUsage = true;
        return this._buildUsageUpdateEvent();
      }
      return null;
    }

    // content_block_delta：流式 text 估算（仅当本 turn 还没拿到真 usage 时）
    if (eventType === 'content_block_delta') {
      const delta = event.delta;
      if (!isRecord(delta)) return null;
      const deltaType = typeof delta.type === 'string' ? delta.type : '';

      // ql-20260617-010 / ql-20260617-012：thinking_delta 流式输出 + 字符/时间双节流。
      //（无 --include-partial-messages 时不会到达此分支，parseAssistant 兜底完整 thinking）。
      // 标记本 turn 已流式输出，parseAssistant 跳过完整 thinking block 避免重复。
      //
      // ql-20260617-012：每个 delta 通常 1-5 字符（一个 token），如果每个都 emit 一条
      // event → 每个 event 一次 HTTP POST + DB commit + Redis publish + SSE push，
      // 100 个 token 累积十几秒延迟。节流：累积到 THINKING_FLUSH_CHARS 字符或
      // THINKING_FLUSH_MS 毫秒才 flush 一次。残留 buffer 在 parseAssistant 入口 flush。
      if (deltaType === 'thinking_delta') {
        const thinking = typeof delta.thinking === 'string' ? delta.thinking : '';
        if (!thinking) return null;
        if (this._thinkingBuf === '') {
          this._thinkingBufStartedAt = Date.now();
        }
        this._thinkingBuf += thinking;
        const elapsed = Date.now() - this._thinkingBufStartedAt;
        if (
          this._thinkingBuf.length >= StreamJsonAdapter.THINKING_FLUSH_CHARS ||
          elapsed >= StreamJsonAdapter.THINKING_FLUSH_MS
        ) {
          return this._flushThinkingBuf();
        }
        return null;
      }

      if (this._currentTurnHasRealUsage) return null;
      if (deltaType !== 'text_delta') return null;
      const text = typeof delta.text === 'string' ? delta.text : '';
      if (!text) return null;

      // 粗估：~3 chars/token（中英文折中）。这不是精确值——message_delta 到达后
      // 会被真 usage 覆盖。仅用于让用户在执行过程中看到数字增长。
      const est = Math.max(1, Math.ceil(text.length / 3));
      this._currentTurnUsage.output_tokens += est;

      // 节流：累计自上次 emit 增长 ≥ 20 token 才推一次 event（避免每个 delta 都刷 backend）
      if (this._currentTurnUsage.output_tokens - this._lastEmittedOutputTokens < 20) {
        return null;
      }
      this._lastEmittedOutputTokens = this._currentTurnUsage.output_tokens;
      return this._buildUsageUpdateEvent();
    }

    if (eventType !== 'message_delta') return null;

    const usage = event.usage;
    if (!isRecord(usage)) return null;

    const prevInput = this._currentTurnUsage.input_tokens;
    const prevOutput = this._currentTurnUsage.output_tokens;
    const prevCacheRead = this._currentTurnUsage.cache_read_tokens;
    const prevCacheCreation = this._currentTurnUsage.cache_creation_tokens;
    if (typeof usage.input_tokens === 'number') {
      this._currentTurnUsage.input_tokens = usage.input_tokens;
    }
    if (typeof usage.output_tokens === 'number') {
      this._currentTurnUsage.output_tokens = usage.output_tokens;
    }
    // task-01: Claude cache 词元提取。
    // 字段名映射：Claude 原始事件用 cache_creation_input_tokens / cache_read_input_tokens
    //（带 _input_），内部统一存短名 cache_creation_tokens / cache_read_tokens（去 _input_）。
    // typeof === 'number' 守卫：字段缺失/非 number（含 null/字符串）不覆盖，保持原值。
    if (typeof usage.cache_creation_input_tokens === 'number') {
      this._currentTurnUsage.cache_creation_tokens = usage.cache_creation_input_tokens;
    }
    if (typeof usage.cache_read_input_tokens === 'number') {
      this._currentTurnUsage.cache_read_tokens = usage.cache_read_input_tokens;
    }
    // 标记本 turn 已拿到真 usage，后续 content_block_delta 不再覆盖
    this._currentTurnHasRealUsage = true;

    // task-01: grew 四维 — cache 任一增长也要 emit（否则 cache 涨但 input/output 不变
    // 时不产 usage_update，前端实时看不到 cache）
    const grew =
      this._currentTurnUsage.input_tokens > prevInput ||
      this._currentTurnUsage.output_tokens > prevOutput ||
      this._currentTurnUsage.cache_read_tokens > prevCacheRead ||
      this._currentTurnUsage.cache_creation_tokens > prevCacheCreation;
    if (!grew) return null;
    return this._buildUsageUpdateEvent();
  }

  /**
   * ql-20260617-012：flush 累积的 thinking_delta buffer。
   *
   * 返回值：
   *   - null：buffer 为空，无需 emit
   *   - AgentEvent[]：含 1 条 text event（content=累积的 thinking 全文，metadata.thinking=true）
   *
   * 副作用：清空 buffer + 更新 _thinkingBufLastFlushMs + 标记 _currentTurnEmittedThinking。
   */
  private _flushThinkingBuf(): AgentEvent[] | null {
    if (!this._thinkingBuf) return null;
    const content = this._thinkingBuf;
    this._thinkingBuf = '';
    this._thinkingBufStartedAt = 0;
    this._currentTurnEmittedThinking = true;
    return [{ type: 'text', content, metadata: { thinking: true } }];
  }

  private _appendPartialAssistantText(incoming: string): void {
    if (!incoming) return;
    if (!this._assistantBuf) {
      this._assistantBuf = incoming;
      return;
    }
    const cur = this._assistantBuf;
    if (incoming === cur) return;
    if (incoming.startsWith(cur)) {
      this._assistantBuf = incoming;
      return;
    }
    if (cur.startsWith(incoming)) return;
    const norm = (s: string) => s.replace(/\s+/g, '');
    const inNorm = norm(incoming);
    const curNorm = norm(cur);
    if (inNorm && curNorm) {
      if (inNorm.startsWith(curNorm) || curNorm.startsWith(inNorm)) {
        this._assistantBuf = incoming.length >= cur.length ? incoming : cur;
        return;
      }
    }
    this._assistantBuf = cur + incoming;
  }

  private _flushAssistantBuf(): AgentEvent[] | null {
    if (!this._assistantBuf) return null;
    const content = this._assistantBuf;
    this._assistantBuf = '';
    if (!content || content === this._lastFlushedAssistant) return null;
    this._lastFlushedAssistant = content;
    return [{ type: 'text', content }];
  }

  /**
   * ql-20260617-007：构造 usage_update text event（snapshot = 累计 + 当前 turn）。
   * 抽出来给 message_delta 和 content_block_delta 共用。
   */
  private _buildUsageUpdateEvent(): AgentEvent[] {
    return [
      {
        type: 'text',
        content: '',
        metadata: {
          status: 'usage_update',
          usage: {
            input_tokens:
              this._accumulatedUsage.input_tokens + this._currentTurnUsage.input_tokens,
            output_tokens:
              this._accumulatedUsage.output_tokens + this._currentTurnUsage.output_tokens,
            // task-01: cache 两维透传（短名）。snapshot = 累计 + 当前 turn。
            cache_read_tokens:
              this._accumulatedUsage.cache_read_tokens + this._currentTurnUsage.cache_read_tokens,
            cache_creation_tokens:
              this._accumulatedUsage.cache_creation_tokens +
              this._currentTurnUsage.cache_creation_tokens,
          },
        },
      },
    ];
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

    // ql-20260617-006 / ql-20260617-007：先 commit 当前 turn 的实时 usage（来自
    // stream_event/message_delta 真 usage 或 content_block_delta 估算值）到
    // _accumulatedUsage，再处理本 turn 的 assistant content。message_delta 已给出
    // 真实累积值，比 message.usage 的 {0,0} 可靠；只在 _currentTurnUsage > 0 时 commit
    // （没有 --include-partial-messages 时 _currentTurnUsage 永远 0，回退到 message.usage
    // 兜底）。
    // ql-20260617-010：capture 本 turn 是否已流式输出 thinking（在 commit/reset 前）。
    // parseAssistant 处理 thinking block 时用 captured 值决定是否跳过（避免重复）。
    // ql-20260617-012：thinking_delta 节流后，turn 结束时（收到完整 assistant message）
    // buffer 可能有未达 flush 阈值的残留，必须先 flush 再继续处理，否则丢失尾部 token。
    const pendingFlush = this._flushThinkingBuf();
    const turnEmittedThinking = this._currentTurnEmittedThinking || (pendingFlush !== null);
    this._currentTurnEmittedThinking = false;

    if (this._currentTurnUsage.input_tokens > 0 || this._currentTurnUsage.output_tokens > 0) {
      this._accumulatedUsage.input_tokens += this._currentTurnUsage.input_tokens;
      this._accumulatedUsage.output_tokens += this._currentTurnUsage.output_tokens;
      // task-01: cache 两维一并 commit（_currentTurnUsage 累加到 _accumulatedUsage）
      this._accumulatedUsage.cache_read_tokens += this._currentTurnUsage.cache_read_tokens;
      this._accumulatedUsage.cache_creation_tokens += this._currentTurnUsage.cache_creation_tokens;
      this._currentTurnUsage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      };
      // ql-20260617-007：commit 后 reset 估算 flag + emit 节流状态
      this._currentTurnHasRealUsage = false;
      this._lastEmittedOutputTokens = 0;
    } else {
      // 兜底：未开启 --include-partial-messages 或 CLI 未吐 message_delta 时，
      // 从 assistant.message.usage 取（通常是 {0,0}，等于无数据但保留 task-06 行为）。
      const usage = message.usage;
      if (isRecord(usage)) {
        if (typeof usage.input_tokens === 'number') {
          this._accumulatedUsage.input_tokens += usage.input_tokens;
        }
        if (typeof usage.output_tokens === 'number') {
          this._accumulatedUsage.output_tokens += usage.output_tokens;
        }
        // task-01: 兜底分支同样提取 cache（映射字段名 cache_*_input_tokens → cache_*_tokens）
        if (typeof usage.cache_creation_input_tokens === 'number') {
          this._accumulatedUsage.cache_creation_tokens += usage.cache_creation_input_tokens;
        }
        if (typeof usage.cache_read_input_tokens === 'number') {
          this._accumulatedUsage.cache_read_tokens += usage.cache_read_input_tokens;
        }
      }
    }

    const events: AgentEvent[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      const blockType = typeof block.type === 'string' ? block.type : '';

      if (blockType === 'text') {
        const text = typeof block.text === 'string' ? block.text : '';
        if (!text) continue;
        if (this._usesPartialAssistantStream()) {
          this._appendPartialAssistantText(text);
          continue;
        }
        events.push({ type: 'text', content: text });
      } else if (blockType === 'thinking') {
        // thinking 收敛为 type='text' + metadata.thinking（AgentEventType 5 元组无 thinking）
        // ql-20260617-010：若本 turn 已通过 thinking_delta 流式输出过 thinking，
        // 跳过完整 block（避免重复）。未开 --include-partial-messages 时
        // turnEmittedThinking 恒 false，正常输出完整 thinking（保留兜底）。
        if (turnEmittedThinking) continue;
        const text = typeof block.text === 'string' ? block.text : '';
        if (text) {
          events.push({ type: 'text', content: text, metadata: { thinking: true } });
        }
      } else if (blockType === 'tool_use') {
        if (this._usesPartialAssistantStream()) {
          const flushed = this._flushAssistantBuf();
          if (flushed) events.push(...flushed);
        }
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
    // ql-20260617-012：parseAssistant 入口 flush 的残留 thinking_delta 事件
    // 必须排在前面（chronologically 先于完整 message 的 content blocks）。
    if (pendingFlush !== null) {
      events.unshift(...pendingFlush);
    }
    // 对照 Python：无 content 或全空 → 返回 None。Node 返回 null（无 event）。
    if (events.length === 0) return null;

    // ql-20260616-004 + ql-20260617-006：实时 token 透传 —— 每次 assistant 事件把当前
    // 累加 usage snapshot（含当前 turn 的实时值）注入到每个 event.metadata.usage，
    // 让 task-runner → backend submit_messages 收到时实时 UPDATE
    // AgentRun.input_tokens/output_tokens。snapshot 必须深拷贝，否则后续累加会污染已
    // 发出 event 的 metadata（_accumulatedUsage/_currentTurnUsage 都是 mutable）。
    //
    // 注意：本处 commit 已把 _currentTurnUsage 并入 _accumulatedUsage 并清零，所以
    // snapshot 只取 _accumulatedUsage 即可代表「截止当前 turn 结束」的累积值。
    const usageSnapshot = {
      input_tokens: this._accumulatedUsage.input_tokens,
      output_tokens: this._accumulatedUsage.output_tokens,
      // task-01: snapshot 透传 cache 两维（短名，由 for 循环注入到所有 event.metadata.usage）
      cache_read_tokens: this._accumulatedUsage.cache_read_tokens,
      cache_creation_tokens: this._accumulatedUsage.cache_creation_tokens,
    };
    for (const ev of events) {
      ev.metadata = { ...(ev.metadata ?? {}), usage: { ...usageSnapshot } };
    }
    return events;
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
    if (this._usesPartialAssistantStream()) {
      const flushed = this._flushAssistantBuf();
      if (flushed) events.push(...flushed);
    }
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
   * system 消息：累积 sessionId + 产 status='system' event。
   * 对照 Python _parse_system L361-366。
   *
   * ql-20260617-008：Claude CLI stream-json 模式下会发多种 subtype 的 system 事件，
   * 每种都有诊断价值（不能丢）：
   *   - subtype=init：启动初始化（cwd / model / claude_code_version）
   *   - subtype=status：状态变化（requesting / ide_connected）
   *   - subtype=api_retry：API 限流重试（attempt / max_retries / error）
   *   - 其他未知 subtype：兜底产 event（保留 JSON 关键字段）
   *
   * content 编码人类可读摘要，task-runner 渲染成 `[SYSTEM:<subtype>] <摘要>` 一行。
   * status='system' 与 status='running' 区分：'running' 仍是子类型，仅用于 init 时
   * 兼容旧前端分组逻辑（isThinkingContent 把 [SYSTEM 开头折叠），但 content 已带
   * subtype 信息避免重复显示。
   */
  private parseSystem(msg: Record<string, unknown>): AgentEvent[] | null {
    const sessionId = typeof msg.session_id === 'string' ? msg.session_id : '';
    if (sessionId) {
      this.sessionId = sessionId;
    }
    const subtype = typeof msg.subtype === 'string' ? msg.subtype : 'unknown';
    // ql-20260617-010：status=requesting 是 Claude CLI 等待 API 响应的高频心跳
    //（每 2-3 秒一次），无信息量且会刷屏淹没真正的 thinking / assistant 内容。
    // 仍提取 sessionId（上面已 set），但不再产日志 event。
    if (subtype === 'status' && msg.status === 'requesting') {
      return null;
    }
    // thinking_tokens：Claude CLI extended thinking 时的高频 token 估算事件
    //（每秒多条），纯内部诊断无展示价值，丢弃避免日志刷屏。
    if (subtype === 'thinking_tokens') {
      return null;
    }
    const parts: string[] = [];
    if (sessionId) parts.push(`session=${sessionId}`);
    if (subtype === 'init') {
      const cwd = typeof msg.cwd === 'string' ? msg.cwd : '';
      const model = typeof msg.model === 'string' ? msg.model : '';
      const ccVer = typeof msg.claude_code_version === 'string' ? msg.claude_code_version : '';
      if (cwd) parts.push(`cwd=${cwd}`);
      if (model) parts.push(`model=${model}`);
      if (ccVer) parts.push(`cli=${ccVer}`);
    } else if (subtype === 'status') {
      const status = typeof msg.status === 'string' ? msg.status : '';
      if (status) parts.push(`status=${status}`);
    } else if (subtype === 'api_retry') {
      const attempt = typeof msg.attempt === 'number' ? msg.attempt : '';
      const max = typeof msg.max_retries === 'number' ? msg.max_retries : '';
      const errStatus = typeof msg.error_status === 'number' ? msg.error_status : '';
      const err = typeof msg.error === 'string' ? msg.error : '';
      if (attempt !== '' && max !== '') parts.push(`attempt=${attempt}/${max}`);
      if (errStatus !== '') parts.push(`http=${errStatus}`);
      if (err) parts.push(`error=${err}`);
    } else {
      // 未知 subtype：保留 subtype + 任何顶层标量字段（除 session_id/subtype 本身）
      for (const [k, v] of Object.entries(msg)) {
        if (k === 'type' || k === 'subtype' || k === 'session_id') continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          parts.push(`${k}=${v}`);
        }
      }
    }
    return [
      {
        type: 'text',
        content: parts.join(' '),
        metadata: { status: 'system', subtype, session_id: sessionId },
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
          stats: extractResultStats(msg, this._accumulatedUsage),
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
  onControl(_line: string, _stdin: NodeJS.WritableStream): void {
    // 空实现：具体 control_response 回写在 parse 内部识别到 control_request 行时，
    // 通过 handleControlRequest → writeControlResponse 完成（需 msg 上下文构造
    // request_id / updatedInput，见 316-328）。此方法保留为 ProtocolAdapter 契约
    // 签名（task-19 方案B：onControl(line, stdin)），但实际应答路径是 parse 内部回写。
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
 * 从 result 消息提取 usage / cost 等 stats，并把 usage.input_tokens/output_tokens
 * 拆平到顶层 + 与历史累加值求和（对齐 SERVER `_extract_result_metadata` 聚合策略，
 * backend claude_code.py 同名实现）。
 *
 * task-06 §实现要求 1：
 *   - knownKeys 收集顶层标量 stats（cost / duration / num_turns 等）；
 *   - usage 拆平：优先取 result.usage（claude CLI 汇总值），叠加 accumulated（跨 assistant
 *     事件累加值，防御性双保险；result.usage 本身已是 CLI 汇总，accumulated 兜底缺失场景）；
 *   - result 无 usage 时仅用 accumulated。
 *
 * @param resultMsg   result 消息（type:'result' 那一行 JSON）
 * @param accumulated 跨 message 累加的 input_tokens/output_tokens（来自 assistant 事件）
 * @returns stats dict（input_tokens/output_tokens 已累加；含 total_cost_usd?/num_turns? 等）
 */
function extractResultStats(
  resultMsg: Record<string, unknown>,
  accumulated: {
    input_tokens: number;
    output_tokens: number;
    // task-01: cache 两维（短名，与 _accumulatedUsage 类型一致）
    cache_read_tokens: number;
    cache_creation_tokens: number;
  },
): Record<string, unknown> {
  const stats: Record<string, unknown> = {};
  const knownKeys = [
    'total_cost_usd',
    'total_duration_ms',
    'total_api_duration_ms',
    'num_turns',
    'is_error',
    'duration_ms',
    'result',
  ];
  for (const key of knownKeys) {
    if (key in resultMsg) stats[key] = resultMsg[key];
  }
  // usage 拆平（优先取 result.usage；缺失时回落 accumulated）
  const usage = resultMsg.usage;
  if (isRecord(usage)) {
    stats.input_tokens =
      (typeof usage.input_tokens === 'number' ? usage.input_tokens : 0) + accumulated.input_tokens;
    stats.output_tokens =
      (typeof usage.output_tokens === 'number' ? usage.output_tokens : 0) +
      accumulated.output_tokens;
    // task-16 修复（2026-06-24-runtime-usage-stats task-16 / execute step13）：
    // cache 两维采用「result.usage 优先，缺失才回落 accumulated」语义（replace/max），
    // 而非 input/output 的求和语义。原因：Claude CLI 在 stream-json 模式下，
    // cache_*_input_tokens 是**会话级累计快照**（不是 turn 增量）——
    //   - result.usage.cache_*_input_tokens = 整个会话累计
    //   - assistant.message.usage.cache_*_input_tokens（无 --include-partial-messages 时）
    //     = 截至该 turn 的累计（与 result 同一份全局值的子集）
    //   - message_delta.event.usage.cache_*_input_tokens（--include-partial-messages 时）
    //     = 当前 turn 累计快照（同样非增量）
    // 若按 input/output 求和（result.cache + accumulated.cache），accumulated 已含
    // assistant/message_delta 的同一份 cache，必然翻倍（task-16 测试发现的 bug）。
    // 故 cache 只取权威源：result.usage 有则用（覆盖 accumulated），无则回落 accumulated。
    // 字段名映射：result.usage 用 cache_*_input_tokens（Claude 原始名），
    // stats 输出统一用短名 cache_*_tokens。
    const resultCacheCreation =
      typeof usage.cache_creation_input_tokens === 'number'
        ? usage.cache_creation_input_tokens
        : undefined;
    const resultCacheRead =
      typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : undefined;
    stats.cache_creation_tokens =
      resultCacheCreation !== undefined
        ? resultCacheCreation
        : accumulated.cache_creation_tokens;
    stats.cache_read_tokens =
      resultCacheRead !== undefined ? resultCacheRead : accumulated.cache_read_tokens;
  } else if (
    accumulated.input_tokens > 0 ||
    accumulated.output_tokens > 0 ||
    accumulated.cache_read_tokens > 0 ||
    accumulated.cache_creation_tokens > 0
  ) {
    // result 无 usage → 仅用 accumulated（assistant 事件聚合值）
    stats.input_tokens = accumulated.input_tokens;
    stats.output_tokens = accumulated.output_tokens;
    stats.cache_read_tokens = accumulated.cache_read_tokens;
    stats.cache_creation_tokens = accumulated.cache_creation_tokens;
  }
  return stats;
}
