// src/interactive/pi-events.ts
// 2026-09-04-provider-pi-onboarding task-01 / design.md §5.2 §7 / FR-02 / D-001@v1。
//
// PiEventNormalizer：pi `--mode rpc` 下行事件流（JSONL，每行一个
// AgentSessionEvent）→ AgentEvent[]（v2 统一契约，types.ts）的**纯函数**归一化器。
// 与批量 pi_json 适配器（src/adapters/pi-json.ts）词汇同源（同一条 AgentSessionEvent
// 联合），差异：rpc 输入无 `session` 首帧（那是 -p --mode json 打印模式专属，
// design §5.1 B-03），错误另有 rpc 层 extension_error 形状。
//
// 纯函数约定（design §7）：normalizeRpcLine 逐行独立、无跨行状态——pi 事件流
// 自带完整语义（delta 直通 / call_id 天然配对 / usage 在 turn_end 定格），不需要
// claude-events 那类缓冲与 depth 状态机。driver（task-02 PiRpcDriver）负责分帧、
// response 分流、agent_settled 收敛与 session_started 合成（get_state）。
//
// ── 事件词表（pi 0.81.1 真源）───────────────────────────────────────────────
//   AgentSessionEvent 联合 = AgentEvent 九型（@earendil-works/pi-agent-core
//   dist/types.d.ts:368-406）+ agent-session.d.ts:40 扩展（agent_settled /
//   queue_update / compaction_* / auto_retry_* / summarization_retry_* /
//   entry_appended / session_info_changed / thinking_level_changed）+
//   rpc 专属 extension_error（dist/modes/rpc/rpc-mode.js:259）。
//   message_update 的 assistantMessageEvent 子事件（@earendil-works/pi-ai
//   dist/types.d.ts:347-389）：text_start/delta/end、thinking_start/delta/end、
//   toolcall_start/delta/end、start/done、error（reason=aborted|error）。
//
// ── 映射表（design §5.2，逐条锚定）─────────────────────────────────────────
//   | pi 事件 | AgentEvent | 依据 |
//   |---|---|---|
//   | message_update + ame.text_delta | text（逐 delta 直通，不合并、无 is_partial） | pi 天然逐 delta 流（对照 Anthropic block 缓冲），design §5.2 第 1 条 |
//   | message_end.message.content 内 thinking part | thinking（每 part 一事件） | design §5.2 第 2 条；ThinkingContent（pi-ai types.d.ts:230-238）。text part 不在 message_end 提取——text 已由 text_delta 流式直通，重复展开会双计（批量 pi-json.ts:263-266 同决策） |
//   | tool_execution_start | tool_use（tool_name/call_id 一等 + content=入参 JSON + metadata.tool_input） | design §5.2 第 3 条；批量 pi-json.ts:283-298 口径 |
//   | tool_execution_end | tool_result（call_id 配对；无 edit_patch——pi edit 结果为 diff 文本无结构化 patch，design §3 非目标） | design §5.2 第 4 条；批量 pi-json.ts:304-321 口径 |
//   | error（顶层）/ extension_error / message_update+ame.error | error | design §5.2 第 5 条；ame.error 覆盖流层中止（reason=aborted|error，pi-ai types.d.ts:386-389） |
//   | turn_end.message.stopReason==='error' | error（errorMessage 载体） | pi 0.81.1 实跑证实（fixture real-error-turn.jsonl）：流层无独立 error 事件时，失败仅经 turn_end 浮出，不映射则错误对下游不可见 |
//   | turn_end.message.usage | usage（text 空事件承载，见 buildUsageEvent） | design §5.2 第 6 条；cacheRead→cache_read / cacheWrite→cache_creation（批量 pi-json.ts:341-344 已验证口径） |
//   | agent_settled | []（driver 收敛信号，不经归一化器） | 任务卡明示；design §5.1 B-05 |
//   | 其余已知生命周期型（session/agent_start/agent_end/turn_start/message_start/tool_execution_update/queue_update/compaction_*/auto_retry_*/summarization_retry_*/entry_appended/session_info_changed/thinking_level_changed） | [] | 批量 pi-json.ts:234-240 同决策（纯生命周期无 IR）；session 为打印模式首帧，rpc 不发，防御容忍 |
//   | 未知事件 | status + subtype='task_notification' 降级桶（content=原 type；metadata.original_event_type + 原字段全量保留） | design §5.2 第 7 条 fail-safe；subtype 取值与 codex driver 降级桶一致（codex-app-server-driver.ts:513-520：schema 强制 status 必带闭合枚举 subtype，task_notification 走瞬时通道不污染持久化） |
//
// 全部产出事件满足 agent-event-schema.ts 的 safeParseAgentEvent（验收项，
// 测试逐条断言）。

import type { AgentEvent, AgentEventUsage } from '../types.js';

/** pi 下行事件的顶层 `type` 已知集合（词表真源见文件头）。 */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  // AgentEvent 九型（pi-agent-core）
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  // AgentSessionEvent 扩展（agent-session.d.ts）
  'agent_settled',
  'queue_update',
  'compaction_start',
  'compaction_end',
  'auto_retry_start',
  'auto_retry_end',
  'summarization_retry_scheduled',
  'summarization_retry_attempt_start',
  'summarization_retry_finished',
  'entry_appended',
  'session_info_changed',
  'thinking_level_changed',
  // 打印模式首帧（rpc 不发；防御容忍，无产出）
  'session',
  // rpc 层错误转发（rpc-mode.js:259）
  'extension_error',
  // 批量词汇中的顶层 error（pi-json.ts:232 实测口径；当前版本主要经
  // turn_end/ame 浮出，此处防御兼容）
  'error',
]);

/**
 * PiEventNormalizer：pi rpc 下行事件 → AgentEvent v2。
 *
 * 用法（task-02 PiRpcDriver consume 内）：
 *   const normalizer = new PiEventNormalizer();
 *   for (const line of framedLines) {          // LF 分帧后
 *     for (const ev of normalizer.normalizeRpcLine(line)) {
 *       // → onTurnMessage(envelope)
 *     }
 *   }
 *
 * 无状态：可单实例复用多会话；无构造参数；不抛错（fail-safe）。
 */
export class PiEventNormalizer {
  /**
   * 归一化一行 pi rpc 下行 JSON。
   *
   * 边界处理（fail-safe，对照批量 pi-json.ts parse 的 B-04 约定）：
   *   - 空行 / 坏 JSON / 非 object / 无 string type → []（无事件可归，不抛）；
   *   - 未知 type → status 降级桶（不丢：原 type 与全部字段进 metadata）。
   *
   * @param line 一行 NDJSON（调用方已按严格 LF 分帧，此处只做 trim）
   */
  normalizeRpcLine(line: string): AgentEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    let evt: unknown;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      // 坏行不抛：rpc 分帧层的半行/脏数据由 driver 日志兜底（对照批量
      // pi-json.ts:203-205 warn+null 的等价语义）
      return [];
    }
    if (!isRecord(evt)) return [];

    const evtType = typeof evt.type === 'string' ? evt.type : '';
    if (!evtType) return [];

    return this.dispatch(evtType, evt);
  }

  // ── 事件分派（私有） ──────────────────────────────────────────────────────

  private dispatch(evtType: string, raw: Record<string, unknown>): AgentEvent[] {
    // 未知事件 → status 降级桶（映射表最后一行；codex 同款策略）
    if (!KNOWN_EVENT_TYPES.has(evtType)) {
      return [this.degradeUnknown(evtType, raw)];
    }

    switch (evtType) {
      case 'message_update':
        return this.handleMessageUpdate(raw);
      case 'message_end':
        return this.handleMessageEnd(raw);
      case 'tool_execution_start':
        return [this.handleToolStart(raw)];
      case 'tool_execution_end':
        return [this.handleToolEnd(raw)];
      case 'turn_end':
        return this.handleTurnEnd(raw);
      case 'error':
        return [this.handleTopLevelError(raw)];
      case 'extension_error':
        return [this.handleExtensionError(raw)];
      default:
        // 已知生命周期型（含 agent_settled/session）→ 无 IR 产出（映射表第 8 行）
        return [];
    }
  }

  /**
   * message_update：按 assistantMessageEvent.type 分派。
   *   - text_delta → text 逐条直通（不合并、无 is_partial——pi delta 本就是
   *     流式单元，契约 is_partial 语义是「同段多次 flush」标记，直通场景恒缺省）；
   *   - error → error（流层中止：reason=aborted|error + error: AssistantMessage）；
   *   - 其余子事件（text_start/text_end/thinking 三段/toolcall 三段/start/done）→ []。
   *
   * 空 delta 跳过（无信息量，批量 pi-json.ts:275-276 同决策）。
   */
  private handleMessageUpdate(raw: Record<string, unknown>): AgentEvent[] {
    const ame = isRecord(raw.assistantMessageEvent)
      ? raw.assistantMessageEvent
      : {};
    const sub = typeof ame.type === 'string' ? ame.type : '';

    if (sub === 'text_delta') {
      const delta = typeof ame.delta === 'string' ? ame.delta : '';
      if (!delta) return [];
      return [{ type: 'text', content: delta }];
    }

    if (sub === 'error') {
      // pi-ai types.d.ts:386-389：{reason: 'aborted'|'error', error: AssistantMessage}
      // errorMessage 是 AssistantMessage 的可选字段，缺失退化 reason 描述
      const errObj = isRecord(ame.error) ? ame.error : {};
      const reason = typeof ame.reason === 'string' ? ame.reason : 'error';
      const content =
        typeof errObj.errorMessage === 'string' && errObj.errorMessage
          ? errObj.errorMessage
          : `assistant stream ${reason}`;
      return [{ type: 'error', content }];
    }

    return [];
  }

  /**
   * message_end：完整消息边界——提取 content 内 thinking part → thinking。
   *
   * 只提取 thinking：text 已由 text_delta 逐条直通，message_end 再展开 text
   * part 会双计（批量 pi-json.ts:263-266 对 text_end 的同款防双计决策）；
   * thinking 不走 delta 直通（design §5.2「message content thinking part」），
   * 以完整 part 为单位在本边界产出，天然无重复。
   *
   * user/toolResult 消息的 content（text/image part）不含 thinking，自然零产出。
   */
  private handleMessageEnd(raw: Record<string, unknown>): AgentEvent[] {
    const message = isRecord(raw.message) ? raw.message : {};
    if (!Array.isArray(message.content)) return [];

    const out: AgentEvent[] = [];
    for (const part of message.content) {
      if (!isRecord(part)) continue;
      // ThinkingContent（pi-ai types.d.ts:230-238）：{type:'thinking', thinking}
      if (part.type === 'thinking' && typeof part.thinking === 'string') {
        if (!part.thinking) continue;
        out.push({ type: 'thinking', content: part.thinking });
      }
    }
    return out;
  }

  /** tool_execution_start → tool_use。args 恒为对象（pi 类型保证），非对象退化 {}。 */
  private handleToolStart(raw: Record<string, unknown>): AgentEvent {
    const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
    const callId = typeof raw.toolCallId === 'string' ? raw.toolCallId : '';
    const args = isRecord(raw.args) ? raw.args : {};
    return {
      type: 'tool_use',
      content: JSON.stringify(args),
      tool_name: toolName,
      call_id: callId,
      metadata: { tool_input: args },
    };
  }

  /**
   * tool_execution_end → tool_result（call_id 与 tool_use 天然同值配对，
   * 归一化无状态不做登记）。isError 仅写 metadata.is_error（不改会话终态，
   * 批量 pi-json.ts:302-303 同决策）。无 edit_patch（design §3 非目标）。
   */
  private handleToolEnd(raw: Record<string, unknown>): AgentEvent {
    const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
    const callId = typeof raw.toolCallId === 'string' ? raw.toolCallId : '';
    const isError = raw.isError === true;
    const resultText = extractResultText(raw.result);
    return {
      type: 'tool_result',
      content: resultText,
      tool_name: toolName,
      call_id: callId,
      metadata: { tool_output: resultText, is_error: isError },
    };
  }

  /**
   * turn_end：pi 的 turn 终结帧——usage 载体（design §5.1：turn 收敛由 driver 的
   * agent_settled 承担，turn_end 不触发收敛）。产出 0..2 事件：
   *   - stopReason==='error' → error（errorMessage；实跑证实 pi 流层失败仅经此
   *     浮出，见 fixture real-error-turn.jsonl 与映射表）；
   *   - message.usage 为 record → usage 快照事件（含全零——错误轮的用量事实）。
   */
  private handleTurnEnd(raw: Record<string, unknown>): AgentEvent[] {
    const message = isRecord(raw.message) ? raw.message : {};
    const out: AgentEvent[] = [];

    if (message.stopReason === 'error') {
      const content =
        typeof message.errorMessage === 'string' && message.errorMessage
          ? message.errorMessage
          : 'pi turn ended with error';
      out.push({ type: 'error', content });
    }

    if (isRecord(message.usage)) {
      out.push(this.buildUsageEvent(message.usage));
    }
    return out;
  }

  /**
   * 顶层 error（批量 pi-json.ts:232/368-377 实测词汇）：error 对象的
   * message > name > 'unknown error'（B-09 口径）；error 为字符串时直传。
   */
  private handleTopLevelError(raw: Record<string, unknown>): AgentEvent {
    const errObj = raw.error;
    let content: string;
    if (typeof errObj === 'string') {
      content = errObj || 'unknown error';
    } else if (isRecord(errObj)) {
      content =
        (typeof errObj.message === 'string' && errObj.message) ||
        (typeof errObj.name === 'string' && errObj.name) ||
        'unknown error';
    } else {
      content = 'unknown error';
    }
    return { type: 'error', content };
  }

  /**
   * extension_error（rpc 层错误转发，rpc-mode.js:259）：
   * {extensionPath, event, error:string}（ExtensionError 接口，
   * extensions/types.d.ts:1253-1258）。→ error 事件，原字段进 metadata。
   */
  private handleExtensionError(raw: Record<string, unknown>): AgentEvent {
    const extensionPath =
      typeof raw.extensionPath === 'string' ? raw.extensionPath : '';
    const eventName = typeof raw.event === 'string' ? raw.event : '';
    const errorText = typeof raw.error === 'string' ? raw.error : '';
    const content = `extension error (${extensionPath}) in ${eventName}: ${errorText}`;
    return {
      type: 'error',
      content,
      metadata: {
        original_event_type: 'extension_error',
        extension_path: extensionPath,
        extension_event: eventName,
        extension_error: errorText,
      },
    };
  }

  /**
   * 未知事件降级（fail-safe，不丢不抛）：status/task_notification 桶。
   *
   * 形状对齐 codex driver 降级桶（codex-app-server-driver.ts:530-543）：
   * schema 强制 type='status' 必带闭合枚举 subtype，task_notification 走
   * onSessionEvent 瞬时通道（design §7.5）；原 type 进 content +
   * metadata.original_event_type，原事件全部字段（除 type）平铺进 metadata。
   */
  private degradeUnknown(evtType: string, raw: Record<string, unknown>): AgentEvent {
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k !== 'type') rest[k] = v;
    }
    return {
      type: 'status',
      subtype: 'task_notification',
      content: evtType,
      metadata: { original_event_type: evtType, ...rest },
    };
  }

  /**
   * turn_end usage → AgentEvent 快照事件。
   *
   * 载体选择：type='text' + content=''（「usage-only 空事件」，session-manager
   * _liftSessionUsage 识别该形态为轮级累计来源做 replace 更新，session-manager.ts
   * :2736-2738；codex usage_update 同款，json-rpc.ts:411-426 + driver #3 提升）。
   * 一等 usage 字段供上报 dict 顶层透传（session-manager.ts:4901），
   * metadata.status='usage_update' 标记供 legacy 消费者识别。
   *
   * 字段映射（批量 pi-json.ts:341-344 已验证口径，设计 §5.2）：
   *   input→input_tokens；output→output_tokens；
   *   cacheRead→cache_read_tokens；cacheWrite→cache_creation_tokens（= creation）。
   *   totalTokens/cost/reasoning 不映射（契约无对应字段）。
   */
  private buildUsageEvent(usage: Record<string, unknown>): AgentEvent {
    const mapped: AgentEventUsage = {
      input_tokens: numOr0(usage.input),
      output_tokens: numOr0(usage.output),
      cache_read_tokens: numOr0(usage.cacheRead),
      cache_creation_tokens: numOr0(usage.cacheWrite),
    };
    return {
      type: 'text',
      content: '',
      usage: mapped,
      metadata: { status: 'usage_update', usage: mapped },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 私有 helper（模块级，纯函数；对照批量 pi-json.ts:445-453 同款守卫）
// ─────────────────────────────────────────────────────────────────────────────

/** 类型守卫：值是非 null 的 plain object（非数组）。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 取有限数，否则 0（防 NaN / Infinity / 非数值字段污染映射）。 */
function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * pi 工具结果转文本（批量 pi-json.ts:384-399 同款口径，交互式复用）：
 *   - result.content[].text → 拼接全部 text part；
 *   - string → 直传；
 *   - null/undefined → ''；
 *   - 其余 → JSON.stringify 兜底。
 */
function extractResultText(result: unknown): string {
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
    // content 缺失 / 空 / 无 text part → 兜底 stringify 整个 result
  }
  return JSON.stringify(result);
}
