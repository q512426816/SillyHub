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
//   | turn_end.message.usage | usage（text 空事件承载，见 buildUsageEvent） | design §5.2 第 6 条；cacheRead→cache_read / cacheWrite→cache_creation（批量 pi-json.ts:341-344 已验证口径）；ctx_tokens = input + cacheRead + cacheWrite 净值三和（ctxTokensFromNetInput 共享 helper） |
//   | agent_settled | []（driver 收敛信号，不经归一化器） | 任务卡明示；design §5.1 B-05 |
//   | 其余已知生命周期型（session/agent_start/agent_end/turn_start/message_start/tool_execution_update/queue_update/compaction_*/auto_retry_*/summarization_retry_*/entry_appended/session_info_changed/thinking_level_changed） | [] | 批量 pi-json.ts:234-240 同决策（纯生命周期无 IR）；session 为打印模式首帧，rpc 不发，防御容忍 |
//   | 未知事件 | status + subtype='task_notification' 降级桶（content=原 type；metadata.original_event_type + 原字段全量保留） | design §5.2 第 7 条 fail-safe；subtype 取值与 codex driver 降级桶一致（codex-app-server-driver.ts:513-520：schema 强制 status 必带闭合枚举 subtype，task_notification 走瞬时通道不污染持久化） |
//
// ── 任务事件派生层（2026-09-07-pi-task-events task-01，D-001/D-002/D-004）───
//   上表映射产出**原始内容事件**之外，本归一化器按实例级 turnTask 状态机额外
//   **派生** status/agent_task_status 事件（一轮一任务聚合，metadata 键对齐
//   claude-events _normalizeTaskMessage 先例：task_id/task_name/status 必填 +
//   last_tool_name/summary/elapsed_ms/tool_uses 可选）。派生事件在返回数组
//   **前部**、原始内容事件随后（statusEvents 先行约定）；上表各行映射语义
//   **零改动**，仅追加：
//   | turn_start | 开新行：task_id=`pi-t<seq>`（实例内单调递增）、task_name='执行任务'（pi 无首轮摘要可提取，保守命名） | agent_task_status(running)；上轮行仍 open（turn_end 丢失）先补 completed（FR-03 防御，summary=pendingError） |
//   | tool_execution_start | last_tool_name=toolName、tool_uses+1 | agent_task_status(running) 刷新（summary=`正在调用 <toolName>`）；无 running 行防御跳过 |
//   | tool_execution_end | 零状态零事件（tool_uses 已在 start 计；工具成败≠任务成败） | — |
//   | turn_end stopReason==='error' | failed，summary=errorMessage | agent_task_status(failed) |
//   | turn_end 其余 stopReason（fixture 实证仅 'stop'） | completed（D-004：aborted 非 stopReason 取值，打断走 ame.error，轮收尾按 completed 收行，无悬挂 running） | agent_task_status(completed) |
//   | error / extension_error / ame.error | 置 pendingError 记录、零新增事件（轮失败主要经 turn_end 浮出，design 派生规则表） | — |
//
//   派生推进整体 try/catch 隔离（design 兼容策略降级条款）：任何异常仅
//   console.error('[pi-events] turnTask derive failed', err) 并跳过派生，
//   原始内容事件照常返回。
//
// 全部产出事件满足 agent-event-schema.ts 的 safeParseAgentEvent（验收项，
// 测试逐条断言）。

import type { AgentEvent, AgentEventUsage } from '../types.js';
import { ctxTokensFromNetInput } from './usage-ctx.js';

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
 * 实例状态（per-session：pi-rpc-driver 每会话 `new PiEventNormalizer()`，
 * 单实例不可跨会话复用）：
 *   - 轮内合并缓冲（ql-20260904-031：segments / assistantMsgSeq）；
 *   - turnTask 任务行状态机（2026-09-07-pi-task-events task-01，见字段注释与
 *     文件头「任务事件派生层」表）。
 * 不抛错（fail-safe）：行解析与任务派生均有隔离。
 */
export class PiEventNormalizer {
  /**
   * ql-20260904-031：轮内合并状态（修复 pi 输出碎片乱序）。
   *
   * 原「text_delta 逐条直通」在真实会话暴雷：一个 turn 277 行 1-5 字碎片行
   * （DB 膨胀+前端拼接乱序——pi 高速 delta 下游异步段存在乱序窗口）。
   * 改对齐 claude-events 的流式模式：
   *   - delta 到达时按 contentIndex 取 partial 快照（累积文本，天然免疫 delta
   *     乱序/丢失），500ms 节流 flush **增量**（快照长度 - 已 flush 长度）产
   *     is_partial+segment_id 事件（前端追加语义正确）；
   *   - message_end 产 **override 完整事件**（D-004 语义：backend 撤同 segment
   *     已落库 partial 行+落完整行；前端替换同 segment）——终态以全文为准，
   *     partial 乱序不影响最终渲染。
   */
  private readonly flushIntervalMs: number;
  private readonly now: () => number;
  /** assistant message 轮内序号（message_start role=assistant 时递增）。 */
  private assistantMsgSeq = -1;
  /**
   * segment 累积状态：key=`m<msgSeq>ci<contentIndex>`，值为已 flush 长度+上次
   * flush 时刻。ql-20260905-001：键并入 msgSeq——contentIndex 是每条消息内 content
   * 数组下标，跨消息天然重号（真实 fixture 两条 text 消息均 ci0），只按 ci 记键会让
   * 第二条消息继承上一条的 flushedLen → partial 全被压制或从错误偏移截取。
   * message_end 清当前消息段（override 已出全文，记账作废）、turn_end 全清兜底。
   */
  private readonly segments = new Map<string, { flushedLen: number; lastFlushAt: number }>();

  // ── turnTask 任务行状态机（2026-09-07-pi-task-events task-01 / D-001）──────
  /** 已开任务行序号：task_id=`pi-t<seq>`，实例内单调递增（R-04：pi 前缀隔离）。 */
  private turnSeq = 0;
  /**
   * 当前轮的任务行聚合状态；null=无行。open=true 表示行已开未收终态
   * （turn_end 收行置 false）。字段语义见文件头「任务事件派生层」表。
   */
  private turnTask: {
    taskId: string;
    taskName: string;
    toolUses: number;
    lastToolName: string;
    startedAtMs: number;
    open: boolean;
  } | null = null;
  /**
   * 最近一次错误记录（顶层 error / extension_error / ame.error 置入，零新增
   * 事件）：仅用于 FR-03 防御补 completed 时的 summary——轮失败主要经
   * turn_end(errorMessage) 浮出，error 帧先到而无 turn_end 承接的异常流里
   * 任务行收行时把错误带出来。''=无。turn 边界（turn_start/turn_end 收行）消费清零。
   */
  private pendingError = '';

  constructor(opts: { flushIntervalMs?: number; now?: () => number } = {}) {
    this.flushIntervalMs = opts.flushIntervalMs ?? 500;
    this.now = opts.now ?? Date.now;
  }

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
      case 'turn_start':
        // 任务派生：开新行（status 先行；turn_start 本无原始内容事件产出）
        return this.derive(() => this.deriveTurnStart());
      case 'tool_execution_start': {
        // status 派生事件先行，tool_use 内容事件随后（statusEvents 先行约定）
        const derived = this.derive(() => this.deriveToolStart(raw));
        return [...derived, this.handleToolStart(raw)];
      }
      case 'tool_execution_end':
        // 派生零事件零状态（tool_uses 已在 start 计；工具成败≠任务成败）
        return [this.handleToolEnd(raw)];
      case 'turn_end': {
        // status 派生终态先行，既有 error/usage 内容事件随后
        const derived = this.derive(() => this.deriveTurnEnd(raw));
        return [...derived, ...this.handleTurnEnd(raw)];
      }
      case 'error':
        return [this.handleTopLevelError(raw)];
      case 'extension_error':
        return [this.handleExtensionError(raw)];
      case 'message_start': {
        // assistant 消息边界：递增轮内序号（segment 隔离）。user/toolResult 不计。
        const msg = isRecord(raw.message) ? raw.message : {};
        if (msg.role === 'assistant') this.assistantMsgSeq += 1;
        // ql-20260907-011：user 消息在轮初携带指令全文（真实流实证）——提取
        // 摘要升级任务名（backend upsert task_name latest-wins，前端同步覆盖）。
        if (msg.role === 'user') {
          const derived = this.derive(() => this.deriveUserName(msg));
          return derived;
        }
        return [];
      }
      default:
        // 其余已知生命周期型（agent_start/agent_end/message_start/
        // tool_execution_update/agent_settled/session 等；turn_start 已上移
        // 任务派生）→ 无 IR 产出（映射表第 8 行）
        return [];
    }
  }

  /**
   * message_update：按 assistantMessageEvent.type 分派。
   *   - text_delta → 轮内合并节流（见类头 ql-20260904-031 说明）：partial 快照
   *     增量 500ms 节流 flush（is_partial+segment_id）；无 partial 时退化 delta
   *     追加（旧链路兼容，防御 pi 变体）；
   *   - error → error（流层中止：reason=aborted|error + error: AssistantMessage）；
   *   - 其余子事件（text_start/text_end/thinking 三段/toolcall 三段/start/done）→ []。
   */
  private handleMessageUpdate(raw: Record<string, unknown>): AgentEvent[] {
    const ame = isRecord(raw.assistantMessageEvent)
      ? raw.assistantMessageEvent
      : {};
    const sub = typeof ame.type === 'string' ? ame.type : '';

    if (sub === 'text_delta') {
      const contentIndex = typeof ame.contentIndex === 'number' ? ame.contentIndex : 0;
      // 优先用 partial 快照（累积文本，免疫 delta 乱序）；缺失退化 delta 追加。
      const partialMsg = isRecord(ame.partial) ? ame.partial : (isRecord(raw.partial) ? raw.partial : null);
      const partialContent = partialMsg && Array.isArray(partialMsg.content) ? partialMsg.content : null;
      const part =
        partialContent && isRecord(partialContent[contentIndex]) ? partialContent[contentIndex] : null;
      const snapshot = part && typeof part.text === 'string' ? part.text : null;

      // ql-20260905-001：键并入 msgSeq（见类头 segments 注释）——跨消息 contentIndex
      // 重号不再共用记账。
      const segKey = `m${this.assistantMsgSeq}ci${contentIndex}`;
      const seg = this.segments.get(segKey);
      if (snapshot !== null && seg) {
        // 快照守卫：长度回缩（乱序旧快照/异常）→ 忽略，等终态 override 纠正。
        if (snapshot.length <= seg.flushedLen) return [];
        if (this.now() - seg.lastFlushAt < this.flushIntervalMs) return [];
        const inc = snapshot.slice(seg.flushedLen);
        seg.flushedLen = snapshot.length;
        seg.lastFlushAt = this.now();
        return [{
          type: 'text',
          content: inc,
          is_partial: true,
          segment_id: this.segmentId(contentIndex),
        }];
      }
      // 退化路径：无快照状态（首个 delta）用 delta 起段。
      const delta = typeof ame.delta === 'string' ? ame.delta : '';
      if (!delta) return [];
      if (!seg) {
        this.segments.set(segKey, { flushedLen: delta.length, lastFlushAt: this.now() });
        return [{
          type: 'text',
          content: delta,
          is_partial: true,
          segment_id: this.segmentId(contentIndex),
        }];
      }
      // 已有段但无快照：累积近似（delta 追加到 flushedLen 记账）——仅防御。
      if (this.now() - seg.lastFlushAt < this.flushIntervalMs) return [];
      seg.flushedLen += delta.length;
      seg.lastFlushAt = this.now();
      return [{ type: 'text', content: delta, is_partial: true, segment_id: this.segmentId(contentIndex) }];
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
      this.notePendingError(content);
      return [{ type: 'error', content }];
    }

    return [];
  }

  /** segment_id：轮内 assistant 序 + contentIndex（同 turn 内唯一）。 */
  private segmentId(contentIndex: number): string {
    return `pi:msg${Math.max(this.assistantMsgSeq, 0)}:ci${contentIndex}`;
  }

  /**
   * message_end：完整消息边界——text part 产 **override 完整事件**（撤同 segment
   * partial+落全文，D-004 语义），thinking part 产完整 thinking（现状保留）。
   *
   * override 终态是本次修复的关键：即使 partial 行因上游乱序错位，最终渲染/
   * 落库以本事件全文为准（backend 撤 partial 行+前端替换同 segment）。
   * thinking 不走 delta 直通（design §5.2），以完整 part 为单位产出无重复。
   * user/toolResult 消息的 content 不含 assistant text/thinking，自然零产出。
   */
  private handleMessageEnd(raw: Record<string, unknown>): AgentEvent[] {
    const message = isRecord(raw.message) ? raw.message : {};
    if (message.role !== 'assistant') return [];
    if (!Array.isArray(message.content)) return [];

    const out: AgentEvent[] = [];
    for (const part of message.content) {
      if (!isRecord(part)) continue;
      if (part.type === 'text' && typeof part.text === 'string') {
        if (!part.text) continue;
        // 找该 part 的 contentIndex（同序数组定位；找不到退化 0——单 text part 主流）
        const idx = message.content.findIndex(
          (p) => isRecord(p) && p.type === 'text' && p.text === part.text
        );
        const ci = idx >= 0 ? idx : 0;
        out.push({
          type: 'text',
          content: part.text,
          override: true,
          segment_id: this.segmentId(ci),
        });
      } else if (part.type === 'thinking' && typeof part.thinking === 'string') {
        // ThinkingContent（pi-ai types.d.ts:230-238）
        if (!part.thinking) continue;
        out.push({ type: 'thinking', content: part.thinking });
      }
    }
    // ql-20260905-001：override 全文已出，清当前消息的 segment 记账（键前缀
    // m<seq>ci）——Map 不随消息数膨胀，也杜绝后续异常 delta 复用旧记账。
    const msgPrefix = `m${this.assistantMsgSeq}ci`;
    for (const k of this.segments.keys()) {
      if (k.startsWith(msgPrefix)) this.segments.delete(k);
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
    // ql-20260905-001：turn 边界全清 segment 记账（message_end 丢帧时的兜底，
    // 下一 turn 从零起段）。
    this.segments.clear();
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
    this.notePendingError(content);
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
    this.notePendingError(content);
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
   *   cacheRead→cache_read_tokens；cacheWrite→cache_creation_tokens（= creation）；
   *   ctx_tokens = input + cacheRead + cacheWrite 净值三和（ctxTokensFromNetInput
   *   共享 helper）——numOr0 恒返回 number → pi 恒派生（全零轮如实携带 0，
   *   Grill D-1 有意口径，勿加全零省略分支）。
   *   totalTokens/cost/reasoning 不映射（契约无对应字段）。
   */
  private buildUsageEvent(usage: Record<string, unknown>): AgentEvent {
    const inputTokens = numOr0(usage.input);
    const cacheReadTokens = numOr0(usage.cacheRead);
    const cacheWriteTokens = numOr0(usage.cacheWrite);
    const mapped: AgentEventUsage = {
      input_tokens: inputTokens,
      output_tokens: numOr0(usage.output),
      cache_read_tokens: cacheReadTokens,
      cache_creation_tokens: cacheWriteTokens,
      ctx_tokens: ctxTokensFromNetInput(inputTokens, cacheReadTokens, cacheWriteTokens),
    };
    return {
      type: 'text',
      content: '',
      usage: mapped,
      metadata: { status: 'usage_update', usage: mapped },
    };
  }

  // ── turnTask 派生（2026-09-07-pi-task-events task-01，私有）───────────────

  /**
   * 派生推进的异常隔离（design 兼容策略降级条款）：turnTask 状态机任何异常
   * 仅记错误并跳过派生（返回 []），原始内容事件照常产出——不阻断事件流。
   */
  private derive(fn: () => AgentEvent[]): AgentEvent[] {
    try {
      return fn();
    } catch (err) {
      console.error('[pi-events] turnTask derive failed', err);
      return [];
    }
  }

  /** 顶层 error / extension_error / ame.error 的 pendingError 记录（零新增事件）。 */
  private notePendingError(content: string): void {
    this.pendingError = content;
  }

  /**
   * turn_start → 开新任务行（D-001 一轮一任务）。
   * FR-03 防御：上轮行仍 open（turn_end 丢失的异常流）先补 completed 再开
   * 新行（summary 用 pendingError 兜底带出错误），不产生悬挂 running。
   */
  private deriveTurnStart(): AgentEvent[] {
    const out: AgentEvent[] = [];
    if (this.turnTask?.open) {
      const stale = this.turnTask;
      out.push(
        this.buildTurnTaskEvent('completed', {
          taskId: stale.taskId,
          taskName: stale.taskName,
          toolUses: stale.toolUses,
          lastToolName: stale.lastToolName,
          summary: this.pendingError || undefined,
          elapsedMs: Math.max(this.now() - stale.startedAtMs, 0),
        }),
      );
    }
    this.pendingError = '';
    this.turnSeq += 1;
    this.turnTask = {
      taskId: `pi-t${this.turnSeq}`,
      taskName: DEFAULT_TASK_NAME,
      toolUses: 0,
      lastToolName: '',
      startedAtMs: this.now(),
      open: true,
    };
    out.push(
      this.buildTurnTaskEvent('running', { taskId: this.turnTask.taskId }),
    );
    return out;
  }

  /**
   * message_start(role=user) → 任务名升级（ql-20260907-011）：真实流实证 user
   * 帧在轮初携带指令全文（content[0].text）——截断摘要写进行名并刷新一次 running
   * 事件。无 open 行 / 无文本防御跳过（零事件）。摘要规则：去换行压空白、
   * 40 字符截断加省略号。
   */
  private deriveUserName(msg: Record<string, unknown>): AgentEvent[] {
    const task = this.turnTask;
    if (!task?.open) return [];
    const parts = Array.isArray(msg.content) ? msg.content : [];
    let text = '';
    for (const part of parts) {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
        text = part.text;
        break;
      }
    }
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!snippet) return [];
    task.taskName = snippet.length < text.replace(/\s+/g, ' ').trim().length
      ? `${snippet}…`
      : snippet;
    return [
      this.buildTurnTaskEvent('running', {
        taskId: task.taskId,
        taskName: task.taskName,
      }),
    ];
  }

  /**
   * tool_execution_start → running 刷新：last_tool_name / tool_uses / summary
   * （`正在调用 <toolName>`）。无 running 行（turnTask 未开）防御跳过派生，
   * 工具内容事件不受影响。
   */
  private deriveToolStart(raw: Record<string, unknown>): AgentEvent[] {
    const task = this.turnTask;
    if (!task?.open) return [];
    const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
    task.lastToolName = toolName;
    task.toolUses += 1;
    const summary = `正在调用 ${toolName}`;
    return [
      this.buildTurnTaskEvent('running', {
        taskId: task.taskId,
        taskName: task.taskName,
        toolUses: task.toolUses,
        lastToolName: task.lastToolName,
        summary,
      }),
    ];
  }

  /**
   * turn_end → 收行终态：stopReason==='error' → failed（summary=errorMessage）；
   * 其余（fixture 实证仅 'stop'；D-004：aborted 非 stopReason 取值，打断的轮
   * 按 completed 收行）→ completed。无 running 行防御跳过。elapsed_ms =
   * now()-startedAtMs（now 注入可测）。收行置 open=false，轮边界 pendingError 清零。
   */
  private deriveTurnEnd(raw: Record<string, unknown>): AgentEvent[] {
    const task = this.turnTask;
    if (!task?.open) return [];
    const message = isRecord(raw.message) ? raw.message : {};
    const failed = message.stopReason === 'error';
    const summary = failed
      ? typeof message.errorMessage === 'string' && message.errorMessage
        ? message.errorMessage
        : 'pi turn ended with error'
      : undefined;
    const event = this.buildTurnTaskEvent(failed ? 'failed' : 'completed', {
      taskId: task.taskId,
      taskName: task.taskName,
      toolUses: task.toolUses,
      lastToolName: task.lastToolName,
      summary,
      elapsedMs: Math.max(this.now() - task.startedAtMs, 0),
    });
    task.open = false;
    this.pendingError = '';
    return [event];
  }

  /**
   * 构造 agent_task_status 事件（形状对齐 claude-events _normalizeTaskMessage
   * 先例，claude-events.ts:663-797）：metadata 键 task_id/task_name/status 必填
   * + last_tool_name/summary/elapsed_ms/tool_uses 可选（缺省不出现键；
   * async 契约字段 pi 恒 false 不传）。content=summary（无则 ''）。
   */
  private buildTurnTaskEvent(
    status: 'running' | 'completed' | 'failed',
    fields: {
      taskId: string;
      taskName?: string;
      toolUses?: number;
      lastToolName?: string;
      summary?: string;
      elapsedMs?: number;
    },
  ): AgentEvent {
    const metadata: Record<string, unknown> = {
      task_id: fields.taskId,
      task_name: fields.taskName || DEFAULT_TASK_NAME,
      status,
    };
    if (fields.lastToolName) metadata.last_tool_name = fields.lastToolName;
    if (fields.summary) metadata.summary = fields.summary;
    if (fields.elapsedMs !== undefined) metadata.elapsed_ms = fields.elapsedMs;
    if (fields.toolUses !== undefined) metadata.tool_uses = fields.toolUses;
    return {
      type: 'status',
      subtype: 'agent_task_status',
      content: fields.summary ?? '',
      metadata,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 私有 helper（模块级，纯函数；对照批量 pi-json.ts:445-453 同款守卫）
// ─────────────────────────────────────────────────────────────────────────────

/** 任务名缺省值（user 指令摘要到达前的占位，ql-20260907-011 前恒定值）。 */
const DEFAULT_TASK_NAME = '执行任务';

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
