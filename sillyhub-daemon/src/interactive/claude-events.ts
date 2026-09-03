// src/interactive/claude-events.ts
// 2026-09-03-agent-provider-abstraction task-03 / design.md §5.1 §7 / D-002@v1 D-004@v1。
//
// ClaudeEventNormalizer：Claude SDK 消息流 → AgentEvent[]（v2 统一事件契约）的
// 有状态归一化器（一轮会话一个实例）。三块移植 + 一块事件化：
//
//   1. 完整消息展开（text/thinking block、tool_use/tool_result 配对、usage、
//      session_id、子代理归属、Edit structuredPatch）—— 移植自 backend
//      `_extract_sdk_messages`（backend/app/modules/daemon/run_sync/service.py:3446-3716）。
//      注意：该函数对 stream_event 恒返回空（service.py:3474-3476 的 message dict
//      形状守卫），partial 不在其中——partial 归下方第 2 块。
//   2. partial 流式（stream_event content_block_delta 缓冲、节流 flush、segment_id
//      标记）与 override 撤回（[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 等价语义，
//      D-004@v1 事件化为 override:true + segment_id + 完整内容）—— 移植自 daemon
//      session-manager 现实现（session-manager.ts:5629-5853 缓冲、5864-5988 flush、
//      6066-6153 清理与 override 信号）。
//   3. depth 状态机（跨消息 subagentDepth 映射）—— 移植自 session-manager.ts
//      :4557-4569（depth 计算 + tool_use 预登记）与 :5500-5528（turn 收尾收缩）。
//   4. 会话级信号事件化（D-002@v1）：system/init → status/session_started；
//      Bash/plan/Task tool_use 与 task_* system 帧 → status subtype 事件
//      （bash_chunk/bash_status/plan_mode/agent_task_status/task_notification）；
//      无业务价值的 system 帧静默丢弃（返回空，对齐 backend 对 system 类的丢弃）。
//
// 纯函数可测性：不 spawn SDK 进程、不做 IO；节流窗口由构造参数注入（默认对齐
// session-manager.ts:786 PARTIAL_FLUSH_MS=500），时钟经可选 now() 注入（bash
// elapsed_ms 等），定时器在 vitest fake timers 下可控。
//
// 事件化语义映射决策（与现状 flat record 的差异，均经设计 §7/§7.5 背书）：
//   - 旧轨每 block 产 1-2 条 flat 行（[ASSISTANT] 文本行 + tool_call JSON 行）；
//     事件轨每 block 产 1 个 AgentEvent，文本行合成移交 backend _persist_agent_event
//     （task-07）。content 语义：text/thinking=正文（thinking 保留 20000 截断，
//     service.py:3547；tool_result 保留 100000 截断 + 中文标注，service.py:77/3664）、
//     tool_use=入参 JSON（service.py:3581 的 json.dumps(input) 口径）。
//   - 旧轨完整行 + 尾随 [*_OVERRIDE] 信号行是两条消息；事件轨合并为单条
//     override:true 事件（§7.5：DELETE 同 segment_id 已落库 partial → INSERT 完整行）。
//   - 完整 assistant 消息边界对残留缓冲做 flush（任务卡「消息边界 flush 残留缓冲」；
//     message_stop 亦然）。现状（session-manager.ts:6066-6103）是直接丢弃尾部——
//     正常流下 message_stop 已先行 flush，此路径仅兜底无 message_stop 的退化流，
//     且 flush 出的 partial 随即被同消息的 override 事件撤回，终态无重复。

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { AgentEvent, AgentEventUsage } from '../types.js';
import { classifyToolKind } from '../tool-kind.js';

/** partial flush 节流间隔默认值（ms）。照抄 session-manager.ts:786 PARTIAL_FLUSH_MS。 */
const DEFAULT_PARTIAL_FLUSH_MS = 500;

/**
 * thinking block 完整展开截断上限。移植自 service.py:3547（preview = text[:20000]
 * + 超长追加 "..."）。
 */
const THINKING_PREVIEW_MAX_CHARS = 20000;

/**
 * tool_result 内容截断上限 + 超长中文标注。移植自 service.py:77
 * （TOOL_RESULT_MAX_CHARS = 100_000）与 :3664-3669（截断标注格式）。
 */
const TOOL_RESULT_MAX_CHARS = 100_000;

/** 构造选项。 */
export interface ClaudeEventNormalizerOptions {
  /** partial flush 回调（节流窗口到期 / 消息边界时同步调用）。 */
  onPartialFlush: (ev: AgentEvent) => void;
  /** 节流间隔 ms（默认 500，对齐 session-manager.ts:786）。禁止顺带调优（task 约束）。 */
  flushIntervalMs?: number;
  /** 可注入时钟（默认 Date.now）。bash elapsed_ms 等时长的唯一时间来源。 */
  now?: () => number;
}

/** partial 桶内已 flush 的 segment 记录（override 撤回候选）。 */
interface FlushedSegment {
  segmentId: string;
  /** thinking / assistant(text)——与 segmentId 第 3 段（:thinking/:text）一致。 */
  kind: 'thinking' | 'assistant';
}

/**
 * per-parentKey partial 缓冲桶（session-manager.ts:438-551 PartialFlushBuffer 的
 * 事件化子集：保留 segmentId/节流/usage 追踪字段（含 D-005@v1 补遗的 ctx_tokens
 * 环分子三 tracker）；budget 会话级累计（sessionInput/OutputTokens）属
 * SessionManager 职责，不移植——见文件尾「契约缺口记录」）。
 */
interface PartialBucket {
  /** 归属 parentKey（'main'=主 agent；否则子代理 tool_use_id）。session-manager.ts:444。 */
  parentKey: string;
  /** 累积的 thinking_delta.thinking 内容（待 flush）。session-manager.ts:446。 */
  thinking: string;
  /** 累积的 text_delta.text 内容（待 flush）。session-manager.ts:448。 */
  assistant: string;
  /** 节流定时器句柄（null = idle）。session-manager.ts:454。 */
  timer: ReturnType<typeof setTimeout> | null;
  /** 当前 turn 的 SDK message.id（message_start 设置，segmentId 拼接用）。session-manager.ts:460。 */
  currentMessageId: string | null;
  /** 累积中的 thinking segment id。session-manager.ts:465。 */
  currentSegmentId: string | null;
  /** 累积中的 assistant text segment id。session-manager.ts:475。 */
  currentAssistantSegmentId: string | null;
  /** 本 turn 已 flush 的 partial segment 列表（完整消息到达时算 override 候选）。session-manager.ts:485。 */
  flushedSegments: FlushedSegment[];
  /** 本 turn 已完成 segment 集合（late partial 守卫）。session-manager.ts:494。 */
  completedSegments: Set<string>;
  /** 最新 message_delta.usage（轮级 input/output + cache 快照 + main 桶 ctx_tokens）。session-manager.ts:501。 */
  pendingUsage: AgentEventUsage | null;
  /** 上次已 flush 的 usage（去重，仅变化时注入）。session-manager.ts:503。 */
  flushedUsage: AgentEventUsage | null;
  /** 轮级累计输入（task-02 轮级口径）。session-manager.ts:525。 */
  turnInputTokens: number;
  /** 轮级累计输出（差分累加）。session-manager.ts:525。 */
  turnOutputTokens: number;
  /** cache_read 快照（per-call replace 语义）。session-manager.ts:514。 */
  sessionCacheReadTokens: number;
  /** cache_creation 快照（per-call replace 语义）。session-manager.ts:514。 */
  sessionCacheCreationTokens: number;
  /** 当前 API call 上次的 output_tokens（算 delta 用）。session-manager.ts:535。 */
  lastCallOutputTokens: number;
  /** 当前 API call 上次的 input_tokens（GLM 兼容端点 delta 携带 cumulative input 用）。session-manager.ts:543。 */
  lastCallInputTokens: number;
  /**
   * 最近一次调用提示词大小（input+cache_read+cache_creation 瞬时量和，上下文环
   * 分子）。仅 main 桶计算（子代理上下文非会话主上下文）。session-manager.ts:533。
   * D-005@v1：随 pendingUsage.ctx_tokens 上报（SSE summary 环分子实时透传对齐）。
   */
  lastCallCtxTokens: number;
  /** 当前 API call cache_read 快照（ctx 差分重算用）。session-manager.ts:546。 */
  lastCallCacheReadTokens: number;
  /** 当前 API call cache_creation 快照（ctx 差分重算用）。session-manager.ts:546。 */
  lastCallCacheCreationTokens: number;
}

/** 运行中 Bash 命令索引条目（bash_chunk/bash_status 终态配对用）。session-manager.ts:816-819。 */
interface RunningBashEntry {
  command: string;
  startedAtMs: number;
}

/**
 * Claude SDK 消息流归一化器（每会话实例，task-03）。
 *
 * 用法（task-06/08 接线后）：driver 每收到一条 SDK 消息调 normalizeMessage，
 * 返回的 AgentEvent[] 走 onTurnMessage 事件轨；partial flush 经构造注入的
 * onPartialFlush 同步吐出（先于随后返回的完整事件——partial 在前、完整/override
 * 在后的顺序契约）。turn 收尾调 onTurnEnd（depth 回落 + 桶收缩），会话终态调
 * dispose（清定时器）。
 */
export class ClaudeEventNormalizer {
  /** depth 状态机：父 tool_use_id → 子代理 depth。session-manager.ts:1437/4582。 */
  private readonly subagentDepth = new Map<string, number>();

  /** 运行中 Bash 命令索引（tool_use_id → 命令/起始时刻）。session-manager.ts:816。 */
  private readonly runningBash = new Map<string, RunningBashEntry>();

  /** partial 缓冲桶（key = parentKey，'main' 或子代理 tool_use_id）。session-manager.ts:783。 */
  private readonly buckets = new Map<string, PartialBucket>();

  private readonly onPartialFlush: (ev: AgentEvent) => void;
  private readonly flushIntervalMs: number;
  private readonly now: () => number;

  constructor(opts: ClaudeEventNormalizerOptions) {
    this.onPartialFlush = opts.onPartialFlush;
    this.flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_PARTIAL_FLUSH_MS;
    this.now = opts.now ?? Date.now;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 主入口：一帧 SDK 消息 → 0..N 个事件
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 归一化一帧 SDK 消息。partial flush 不在返回值里——经构造注入的 onPartialFlush
   * 回调同步吐出（本方法执行期间即可触发）。返回数组内部顺序：status 会话信号 →
   * 内容事件（usage/session_id 盖章在首条内容事件上，对齐 service.py:3481-3501
   * stamp 仅首条）→ 内容事件自身（含 override 替换位）。
   */
  normalizeMessage(msg: SDKMessage): AgentEvent[] {
    const record = msg as unknown as Record<string, unknown>;
    const msgType = record['type'];

    // ── depth 状态机（session-manager.ts:4557-4569）─────────────────────────
    // 主 agent（parent_tool_use_id=null）→ 0；子代理按父 tool_use_id 查表得
    // depth（查不到退化 1，R-04 口径）。assistant 消息另遍历 tool_use blocks
    // 预登记 id → msgDepth+1，供该 tool_use 派生的子代理消息查 depth。
    const rawParent = record['parent_tool_use_id'];
    const parentToolUseId = typeof rawParent === 'string' && rawParent ? rawParent : null;
    const msgDepth = parentToolUseId
      ? (this.subagentDepth.get(parentToolUseId) ?? 1)
      : 0;

    if (msgType === 'assistant') {
      const blocks = contentBlocksOf(record);
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          const block = b as Record<string, unknown>;
          if (block && block['type'] === 'tool_use') {
            const tId = block['id'];
            if (typeof tId === 'string' && tId) {
              this.subagentDepth.set(tId, msgDepth + 1);
            }
          }
        }
      }
      return this._normalizeAssistantMessage(record, parentToolUseId, msgDepth);
    }

    if (msgType === 'user') {
      return this._normalizeUserMessage(record, parentToolUseId, msgDepth);
    }

    if (msgType === 'stream_event') {
      this._bufferPartial(record);
      // message_stop = 消息边界：flush 残留缓冲（任务卡要求；正常流下完整
      // assistant 消息随其后到达并以 override 撤回本批 partial）。
      const event = record['event'] as Record<string, unknown> | undefined;
      if (event && typeof event === 'object' && event['type'] === 'message_stop') {
        this._flushBucket(this._parentKeyOf(record));
      }
      return [];
    }

    if (msgType === 'system') {
      return this._normalizeSystemMessage(record, parentToolUseId);
    }

    // result / status / compact_boundary 等其余帧：旧轨由 backend
    // _extract_sdk_messages 返回 []（service.py:3474-3476）或 SessionManager 透传后
    // 丢弃；turn 终态经 driver onResult 独立链路（InteractiveDriverResult），不入事件流。
    return [];
  }

  /**
   * override 撤回事件（design §7 / D-004@v1）。现 [ASSISTANT_OVERRIDE]/
   * [THINKING_OVERRIDE] 文本信号的事件等价：type 区分 thinking/text（旧轨靠信号
   * 前缀 + metadata.thinking 分流，session-manager.ts:6136-6144），override:true +
   * segment_id + 完整内容（backend 据此 DELETE 同 segment partial → INSERT 完整行）。
   */
  normalizeOverrideSignal(
    kind: 'text' | 'thinking',
    segmentId: string,
    content: string,
  ): AgentEvent {
    return { type: kind, content, segment_id: segmentId, override: true };
  }

  /**
   * turn 收尾（对齐 _onResult 边界收尾 + _shrinkSubagentBuffers，
   * session-manager.ts:4462-4483/5500-5528）：
   *   - 全桶 completedSegments 重置（新 turn segmentId 空间独立，防跨 turn 误判）；
   *   - main 桶轮级计数器清零 + pendingUsage 置空（防上轮残留注入新 run）；
   *   - 子代理桶删桶（含定时器）；subagentDepth.clear()（depth「结束后回落」）。
   * 会话级 budget 聚合与子桶 session 计数折算不在此（SessionManager 职责）。
   */
  onTurnEnd(): void {
    for (const [key, buf] of this.buckets) {
      buf.completedSegments = new Set<string>();
      if (key === 'main') {
        buf.turnInputTokens = 0;
        buf.turnOutputTokens = 0;
        buf.pendingUsage = null;
      } else {
        if (buf.timer) {
          clearTimeout(buf.timer);
          buf.timer = null;
        }
        this.buckets.delete(key);
      }
    }
    this.subagentDepth.clear();
  }

  /** 会话终态清理：清全部定时器与桶（对齐 _destroyPartialBuffer，session-manager.ts:6159-6176）。 */
  dispose(): void {
    for (const buf of this.buckets.values()) {
      if (buf.timer) {
        clearTimeout(buf.timer);
        buf.timer = null;
      }
    }
    this.buckets.clear();
    this.subagentDepth.clear();
    this.runningBash.clear();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 完整消息展开（移植 _extract_sdk_messages，service.py:3446-3716）
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * 完整 assistant 消息：会话信号（Bash/plan/Task tool_use）→ partial 边界收尾 →
   * block 展开（含 override 替换）。
   */
  private _normalizeAssistantMessage(
    record: Record<string, unknown>,
    parentToolUseId: string | null,
    msgDepth: number,
  ): AgentEvent[] {
    const blocks = contentBlocksOf(record);
    const blockList = Array.isArray(blocks) ? blocks : [];

    // 会话信号先行（对齐 _onMessage 在转发消息前 emit，session-manager.ts:4584-4660）。
    const statusEvents = this._toolUseSessionSignals(blockList);

    // partial 边界收尾（session-manager.ts:4758-4787 顺序：flush 残留 → 快照 →
    // sync 清理 + completedSegments 登记 → 展开 → override）。任务卡要求的边界
    // flush 在快照前执行——flush 出的 segment 计入 flushedSnapshot，随本消息的
    // override 事件一并撤回，终态无重复。
    const parentKey = parentToolUseId ?? 'main';
    this._flushBucket(parentKey);
    const completed = this._extractCompletedSegments(record, parentKey);
    const buf = this.buckets.get(parentKey);
    const flushedSnapshot = buf ? buf.flushedSegments.slice() : [];
    this._clearBucketSync(parentKey, completed);

    const contentEvents = this._expandBlocks(record, blockList, parentKey, flushedSnapshot);

    // 归属字段注入到每条内容事件（service.py:3694-3714：归属是 message 级属性，
    // 同消息所有 block 同属一个子代理）。注意 depth 恒注入（主 agent=0）——现
    // daemon 的 session-manager 对每条消息都挂 msg.depth（session-manager.ts:4569
    // 无条件赋值），backend 落库 depth 列恒有值；service.py:3700 注释「主 agent
    // attribution 空 → NULL」描述的是未挂 depth 的旧 daemon，以现行为为准。
    const attribution = this._attributionOf(record, parentToolUseId, msgDepth);
    if (attribution) {
      for (const ev of contentEvents) {
        Object.assign(ev, attribution);
      }
    }

    // usage/session_id 仅注入首条内容事件（service.py:3481-3501 stamp 语义，防
    // sibling block 重复累加）。status 事件走 onSessionEvent 独立通道不落库，不盖章。
    this._stampCarriedFields(record, contentEvents);

    return [...statusEvents, ...contentEvents];
  }

  /**
   * 完整 user 消息：Bash 终态配对（bash_chunk + bash_status）→ block 展开
   * （_extract_sdk_messages 对 user/assistant 的 block 遍历是角色无关的，
   * service.py:3517 起只按 block type 分派；user 串 content → 非数组 → 无事件）。
   */
  private _normalizeUserMessage(
    record: Record<string, unknown>,
    parentToolUseId: string | null,
    msgDepth: number,
  ): AgentEvent[] {
    const blocks = contentBlocksOf(record);
    const blockList = Array.isArray(blocks) ? blocks : [];

    // task-04（FR-02）Bash 终态：tool_result 配对运行中命令 → bash_chunk（终块）
    // + bash_status（终态）。移植自 session-manager.ts:4792-4831。
    // （异步 Agent 启动回执兜底 _registerAsyncReceiptTask 依赖 SessionManager 的
    // 后台任务注册表，不随归一化器迁移——归 task-06/08 接线时由 SessionManager
    // 消费 status 事件侧维持。）
    const statusEvents: AgentEvent[] = [];
    for (const item of blockList) {
      const block = item as Record<string, unknown>;
      if (!block || block['type'] !== 'tool_result') continue;
      const resultToolUseId = block['tool_use_id'];
      if (typeof resultToolUseId !== 'string' || !resultToolUseId) continue;
      const running = this.runningBash.get(resultToolUseId);
      if (!running) continue;
      const raw = block['content'];
      const contentStr =
        raw === undefined
          ? ''
          : typeof raw === 'string'
            ? raw
            : JSON.stringify(raw);
      const isError = block['is_error'] === true;
      statusEvents.push({
        type: 'status',
        subtype: 'bash_chunk',
        content: contentStr,
        metadata: {
          command: running.command,
          channel: isError ? 'stderr' : 'stdout',
          is_final: true,
        },
      });
      statusEvents.push({
        type: 'status',
        subtype: 'bash_status',
        content: '',
        metadata: {
          command: running.command,
          status: isError ? 'failed' : 'completed',
          exit_code: isError ? 1 : 0,
          elapsed_ms: this.now() - running.startedAtMs,
        },
      });
      this.runningBash.delete(resultToolUseId);
    }

    const parentKey = parentToolUseId ?? 'main';
    const contentEvents = this._expandBlocks(record, blockList, parentKey, []);
    const attribution = this._attributionOf(record, parentToolUseId, msgDepth);
    if (attribution) {
      for (const ev of contentEvents) {
        Object.assign(ev, attribution);
      }
    }
    this._stampCarriedFields(record, contentEvents);

    return [...statusEvents, ...contentEvents];
  }

  /**
   * block 数组 → 内容事件（service.py:3517-3692 的事件化移植）：
   *   - text       → 1× {type:'text', content, segment_id}（service.py:3522-3542；
   *                  旧轨 metadata.segmentId/isComplete 提升为一等 segment_id，
   *                  完整性由 is_partial 缺席表达）
   *   - thinking   → 1× {type:'thinking', content: preview[:20000], segment_id}
   *                  （service.py:3544-3563）
   *   - tool_use   → 1× {type:'tool_use', tool_name, call_id, content: args JSON,
   *                  metadata.tool_kind}（service.py:3565-3640 两条 flat 行的事件
   *                  合并；tool_kind 落 metadata 开放容器）
   *   - tool_result→ 1× {type:'tool_result', call_id, content: 截断正文,
   *                  edit_patch?}（service.py:3642-3692）
   * 已 flush 过 partial 的 text/thinking segment 用 override 事件原位替换
   * （D-004@v1：单事件承载「撤回 + 完整内容」，替代旧轨完整行 + 尾随信号行两条）。
   */
  private _expandBlocks(
    record: Record<string, unknown>,
    blockList: unknown[],
    parentKey: string,
    flushedSnapshot: FlushedSegment[],
  ): AgentEvent[] {
    const out: AgentEvent[] = [];
    const flushedIds = new Set(flushedSnapshot.map((s) => s.segmentId));
    const inner = record['message'] as Record<string, unknown> | undefined;
    const rawMid = inner?.['id'];
    const mid = typeof rawMid === 'string' && rawMid ? rawMid : null;

    for (const item of blockList) {
      const b = item as Record<string, unknown>;
      if (!b || typeof b !== 'object') continue;
      const btype = b['type'];

      if (btype === 'text') {
        const text = strOf(b['text']);
        if (text) {
          // segmentId 格式 `${parentKey}:${msg_id}:text`（service.py:3537，与 daemon
          // partial 端 _resolveSegmentId / _extractCompletedSegments 严格同格式）。
          const segId = mid ? `${parentKey}:${mid}:text` : null;
          if (segId && flushedIds.has(segId)) {
            out.push(this.normalizeOverrideSignal('text', segId, text));
          } else {
            const ev: AgentEvent = { type: 'text', content: text };
            if (segId) ev.segment_id = segId;
            out.push(ev);
          }
        }
      } else if (btype === 'thinking') {
        const text = strOf(b['thinking'] ?? b['text']);
        if (text) {
          // preview 截断（service.py:3547）。
          const preview =
            text.length > THINKING_PREVIEW_MAX_CHARS
              ? text.slice(0, THINKING_PREVIEW_MAX_CHARS) + '...'
              : text;
          // segmentId：mid 缺失退化 `${parentKey}:unknown:thinking`（service.py:5602
          // 的 runKey 分支；归一化器无 currentRunId 概念，两侧统一 'unknown'）。
          const segId = `${parentKey}:${mid ?? 'unknown'}:thinking`;
          if (flushedIds.has(segId)) {
            out.push(this.normalizeOverrideSignal('thinking', segId, preview));
          } else {
            out.push({ type: 'thinking', content: preview, segment_id: segId });
          }
        }
      } else if (btype === 'tool_use') {
        const name = strOf(b['name']) || 'unknown';
        const rawInput = b['input'];
        const inputObj = isRecord(rawInput) ? rawInput : {};
        const rawId = b['id'];
        const callId = typeof rawId === 'string' && rawId ? rawId : undefined;
        let argsJson: string;
        try {
          argsJson = JSON.stringify(inputObj);
        } catch {
          argsJson = '';
        }
        // tool_kind 识别（service.py:3624-3626 try/except 静默退化 None 的对齐）。
        let toolKind: string | null = null;
        try {
          toolKind = classifyToolKind(name, inputObj);
        } catch {
          toolKind = null;
        }
        const ev: AgentEvent = {
          type: 'tool_use',
          tool_name: name,
          content: argsJson,
          metadata: { tool_kind: toolKind },
        };
        if (callId) ev.call_id = callId;
        out.push(ev);
      } else if (btype === 'tool_result') {
        // content 兼容 str 或 [{type:'text',text}] blocks（service.py:3643-3654）。
        const raw = b['content'];
        let text: string;
        if (Array.isArray(raw)) {
          const parts: string[] = [];
          for (const rb of raw) {
            if (isRecord(rb)) {
              parts.push(strOf(rb['text']));
            } else {
              parts.push(String(rb));
            }
          }
          text = parts.join('');
        } else {
          text = strOf(raw);
        }
        const rawTuid = b['tool_use_id'];
        const callId =
          typeof rawTuid === 'string' && rawTuid ? rawTuid : undefined;
        if (text) {
          // 超长截断 + 中文标注（service.py:3664-3670）。
          const body =
            text.length > TOOL_RESULT_MAX_CHARS
              ? text.slice(0, TOOL_RESULT_MAX_CHARS) +
                `\n...(输出过长，已截断，共 ${text.length} 字符)`
              : text;
          const ev: AgentEvent = { type: 'tool_result', content: body };
          if (callId) ev.call_id = callId;
          // Edit structuredPatch：msg.tool_use_result.structuredPatch（user 消息顶层）
          // 序列化为 edit_patch JSON（service.py:3684-3691）。
          const tur = record['tool_use_result'];
          if (isRecord(tur)) {
            const patch = tur['structuredPatch'];
            if (Array.isArray(patch) && patch.length > 0) {
              try {
                ev.edit_patch = JSON.stringify(patch);
              } catch {
                // 序列化失败静默跳过（service.py:3690-3691 同口径）。
              }
            }
          }
          out.push(ev);
        }
      }
    }
    return out;
  }

  /** usage/session_id 盖章：仅首条（service.py:3481-3501）。 */
  private _stampCarriedFields(
    record: Record<string, unknown>,
    events: AgentEvent[],
  ): void {
    if (events.length === 0) return;
    const inner = record['message'] as Record<string, unknown> | undefined;
    // usage：inner.usage 优先，缺失退化顶层（service.py:3483-3488）；全名
    // cache_*_input_tokens → 短名 cache_*_tokens（daemon.ts:3564-3586 lift 映射口径，
    // 对齐 AgentEventUsage 字段名）。
    let usageRec: Record<string, unknown> | undefined = isRecord(inner?.['usage'])
      ? (inner!['usage'] as Record<string, unknown>)
      : undefined;
    if (!usageRec && isRecord(record['usage'])) {
      usageRec = record['usage'] as Record<string, unknown>;
    }
    const usage = usageToEventUsage(usageRec);
    const rawSid =
      (typeof record['session_id'] === 'string' && record['session_id']) ||
      (typeof inner?.['session_id'] === 'string' && inner!['session_id']) ||
      null;
    if (usage || rawSid) {
      const first = events[0]!;
      if (usage) first.usage = usage;
      if (rawSid) first.session_id = rawSid;
    }
  }

  /** 归属字段（service.py:3702-3711）：message 级，注入每条内容事件。 */
  private _attributionOf(
    record: Record<string, unknown>,
    parentToolUseId: string | null,
    msgDepth: number,
  ): Partial<Pick<AgentEvent, 'parent_tool_use_id' | 'subagent_type' | 'depth'>> | null {
    const attribution: Partial<
      Pick<AgentEvent, 'parent_tool_use_id' | 'subagent_type' | 'depth'>
    > = {};
    if (parentToolUseId) attribution.parent_tool_use_id = parentToolUseId;
    const rawSt = record['subagent_type'];
    if (typeof rawSt === 'string' && rawSt) attribution.subagent_type = rawSt;
    // depth 来自状态机（旧轨由 SessionManager 挂 msg.depth 后经 backend 落列，
    // session-manager.ts:4569；此处直接计算）。
    attribution.depth = msgDepth;
    return Object.keys(attribution).length > 0 ? attribution : null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 会话级信号（system 帧 + tool_use 派生；D-002@v1 status/subtype 事件化）
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * system 帧分派（移植 _onMessage 的 system 分支语义）：
   *   - init（主 agent）→ status/session_started（含 session_id；子代理 init 守卫
   *     丢弃，session-manager.ts:4668-4695 的 isSubagentInit 分支。fork 覆盖守卫
    *    （forkedInitPending）是 SessionManager 状态，本层不持有——事件恒发，消费侧
   *     沿用现有守卫）。
   *   - task_started/task_progress/task_updated → status/agent_task_status；
   *     task_notification → status/task_notification（session-manager.ts:4907-5307）；
   *   - thinking_tokens → status/thinking_tokens（D-005@v1 契约补遗）。
   *   - 其余（status/compact_boundary/local_command 等）→ 静默丢弃。
   */
  private _normalizeSystemMessage(
    record: Record<string, unknown>,
    parentToolUseId: string | null,
  ): AgentEvent[] {
    const subtype = record['subtype'];

    if (subtype === 'init') {
      const sid = record['session_id'];
      // 子代理 init 守卫：parent_tool_use_id 非空不得触发 session_started
      // （防覆盖主 session 的 resume key，session-manager.ts:4680-4681）。
      if (parentToolUseId != null) return [];
      if (typeof sid !== 'string' || !sid) return [];
      const metadata: Record<string, unknown> = {};
      if (typeof record['model'] === 'string') metadata['model'] = record['model'];
      if (typeof record['claude_code_version'] === 'string') {
        metadata['claude_code_version'] = record['claude_code_version'];
      }
      return [
        {
          type: 'status',
          subtype: 'session_started',
          content: '',
          session_id: sid,
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        },
      ];
    }

    if (
      subtype === 'task_started' ||
      subtype === 'task_progress' ||
      subtype === 'task_notification' ||
      subtype === 'task_updated'
    ) {
      return this._normalizeTaskMessage(record, subtype as string);
    }

    // thinking_tokens（SDKThinkingTokensMessage）：D-005@v1 契约补遗——产出
    // status/thinking_tokens 事件，对齐 legacy flush 的 [SYSTEM:thinking_tokens]
    // 行（session-manager.ts:5962-5971，content 为 estimated_tokens running
    // total 数值）。legacy 的 flush 窗口去重（值变化才落行）是落库行语义；status
    // 事件走 onSessionEvent 瞬时通道不落库，帧级直发。
    if (subtype === 'thinking_tokens') {
      const tokens = numOf(record['estimated_tokens']);
      if (tokens === undefined) return [];
      const delta = numOf(record['estimated_tokens_delta']);
      return [
        {
          type: 'status',
          subtype: 'thinking_tokens',
          content: String(tokens),
          metadata: {
            estimated_tokens: tokens,
            ...(delta !== undefined ? { estimated_tokens_delta: delta } : {}),
          },
        },
      ];
    }
    return [];
  }

  /** task_* system 帧事件化（session-manager.ts:4907-5307 的信号面，registry/节流/唤醒留消费侧）。 */
  private _normalizeTaskMessage(
    record: Record<string, unknown>,
    subtype: string,
  ): AgentEvent[] {
    const taskId = record['task_id'];
    if (typeof taskId !== 'string' || !taskId) return [];
    const toolUseId = strOf(record['tool_use_id']) || undefined;

    if (subtype === 'task_started') {
      // skip_transcript=true：ambient/housekeeping 任务，隐藏（session-manager.ts:4962-4964）。
      if (record['skip_transcript'] === true) return [];
      const description = strOf(record['description']);
      const subagentType = strOf(record['subagent_type']) || undefined;
      return [
        {
          type: 'status',
          subtype: 'agent_task_status',
          content: description,
          metadata: {
            task_id: taskId,
            task_name: description || '后台任务',
            status: 'running',
            ...(toolUseId ? { tool_use_id: toolUseId } : {}),
            ...(subagentType ? { subagent_type: subagentType } : {}),
          },
        },
      ];
    }

    if (subtype === 'task_progress') {
      const usage = isRecord(record['usage'])
        ? (record['usage'] as Record<string, unknown>)
        : undefined;
      const elapsedMs = numOf(usage?.['duration_ms']);
      const totalTokens = numOf(usage?.['total_tokens']);
      const toolUses = numOf(usage?.['tool_uses']);
      const lastToolName = strOf(record['last_tool_name']) || undefined;
      const summary = strOf(record['summary']) || undefined;
      const description = strOf(record['description']);
      const subagentType = strOf(record['subagent_type']) || undefined;
      return [
        {
          type: 'status',
          subtype: 'agent_task_status',
          content: summary ?? '',
          metadata: {
            task_id: taskId,
            task_name: description || '后台任务',
            status: 'running',
            ...(toolUseId ? { tool_use_id: toolUseId } : {}),
            ...(subagentType ? { subagent_type: subagentType } : {}),
            ...(lastToolName ? { last_tool_name: lastToolName } : {}),
            ...(summary ? { summary } : {}),
            ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
            ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
            ...(toolUses !== undefined ? { tool_uses: toolUses } : {}),
          },
        },
      ];
    }

    if (subtype === 'task_notification') {
      const rawStatus = record['status'];
      // 终态三值之外防御丢弃（session-manager.ts:5140-5147）。
      if (
        rawStatus !== 'completed' &&
        rawStatus !== 'failed' &&
        rawStatus !== 'stopped'
      ) {
        return [];
      }
      const usage = isRecord(record['usage'])
        ? (record['usage'] as Record<string, unknown>)
        : undefined;
      const elapsedMs = numOf(usage?.['duration_ms']);
      const summary = strOf(record['summary']);
      return [
        {
          type: 'status',
          subtype: 'task_notification',
          content: summary,
          metadata: {
            task_id: taskId,
            status: rawStatus,
            ...(toolUseId ? { tool_use_id: toolUseId } : {}),
            ...(summary ? { summary } : {}),
            ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
          },
        },
      ];
    }

    // task_updated：轻量信号——patch.status 出现才映射（其余字段变化不转发，
    // session-manager.ts:5273-5279 噪声控制）；六值 → 四值映射（:5285-5290）。
    const patch = isRecord(record['patch'])
      ? (record['patch'] as Record<string, unknown>)
      : undefined;
    const patchStatus = strOf(patch?.['status']) || undefined;
    if (!patchStatus) return [];
    const mapped =
      patchStatus === 'completed' || patchStatus === 'failed'
        ? patchStatus
        : patchStatus === 'killed'
          ? 'stopped'
          : 'running';
    const errorText = strOf(patch?.['error']) || undefined;
    return [
      {
        type: 'status',
        subtype: 'agent_task_status',
        content: '',
        metadata: {
          task_id: taskId,
          status: mapped,
          ...(errorText ? { summary: errorText } : {}),
        },
      },
    ];
  }

  /**
   * assistant tool_use 派生的会话信号（session-manager.ts:4584-4660）：
   *   - Bash → 注册运行中命令 + bash_status(running)；
   *   - EnterPlanMode/ExitPlanMode → plan_mode（现 kind plan_mode_entered）；
   *   - Task/Agent → agent_task_status(running)。
   * （runId 门控是 SessionManager 侧概念，本层无 runId，恒发。）
   */
  private _toolUseSessionSignals(blockList: unknown[]): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const item of blockList) {
      const b = item as Record<string, unknown>;
      if (!b || b['type'] !== 'tool_use') continue;
      const tId = b['id'];
      if (typeof tId !== 'string' || !tId) continue;
      const toolName = b['name'];
      if (typeof toolName !== 'string') continue;
      const toolInput = isRecord(b['input'])
        ? (b['input'] as Record<string, unknown>)
        : undefined;

      if (toolName === 'Bash') {
        const command = strOf(toolInput?.['command']);
        this.runningBash.set(tId, { command, startedAtMs: this.now() });
        events.push({
          type: 'status',
          subtype: 'bash_status',
          content: '',
          metadata: { command, status: 'running' },
        });
      } else if (toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode') {
        const objective = strOf(toolInput?.['objective']);
        const rawTasks = toolInput?.['tasks'];
        const tasks = Array.isArray(rawTasks)
          ? rawTasks.filter((t): t is string => typeof t === 'string')
          : [];
        const designSnippet = strOf(
          toolInput?.['design_snippet'] ?? toolInput?.['plan'],
        );
        events.push({
          type: 'status',
          subtype: 'plan_mode',
          content: '',
          metadata: {
            summary: {
              objective,
              tasks,
              ...(designSnippet ? { design_snippet: designSnippet } : {}),
            },
          },
        });
      } else if (toolName === 'Task' || toolName === 'Agent') {
        const taskId = strOf(toolInput?.['task_id']) || tId;
        const taskName =
          strOf(toolInput?.['description'] ?? toolInput?.['name']) || toolName;
        events.push({
          type: 'status',
          subtype: 'agent_task_status',
          content: '',
          metadata: { task_id: taskId, task_name: taskName, status: 'running' },
        });
      }
    }
    return events;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // partial 缓冲 / 节流 flush（移植 session-manager.ts:5629-5988）
  // ───────────────────────────────────────────────────────────────────────────

  /** 归属 parentKey（session-manager.ts:5424-5427）。 */
  private _parentKeyOf(record: Record<string, unknown>): string {
    const raw = record['parent_tool_use_id'];
    return typeof raw === 'string' && raw ? raw : 'main';
  }

  /** 取或建桶（session-manager.ts:5434-5470 懒建）。 */
  private _getOrCreateBucket(parentKey: string): PartialBucket {
    let buf = this.buckets.get(parentKey);
    if (!buf) {
      buf = {
        parentKey,
        thinking: '',
        assistant: '',
        timer: null,
        currentMessageId: null,
        currentSegmentId: null,
        currentAssistantSegmentId: null,
        flushedSegments: [],
        completedSegments: new Set<string>(),
        pendingUsage: null,
        flushedUsage: null,
        turnInputTokens: 0,
        turnOutputTokens: 0,
        sessionCacheReadTokens: 0,
        sessionCacheCreationTokens: 0,
        lastCallOutputTokens: 0,
        lastCallInputTokens: 0,
        lastCallCtxTokens: 0,
        lastCallCacheReadTokens: 0,
        lastCallCacheCreationTokens: 0,
      };
      this.buckets.set(parentKey, buf);
    }
    return buf;
  }

  /**
   * stream_event 缓冲（session-manager.ts:5629-5853 的事件化移植）：
   *   - message_start：记 message.id（segmentId 数据源）+ usage 起始值；
   *   - content_block_delta：thinking_delta/text_delta 累积（completedSegments
   *     late 守卫，:5734-5751）；
   *   - message_delta：usage 差分累加 → pendingUsage（:5759-5826）；
   *   - 其余（content_block_start/message_stop 等）：无显示内容跳过（:5716-5717）。
   *     message_stop 的边界 flush 由 normalizeMessage 调用方触发。
   * 首个 delta 启动节流定时器（:5836-5852）。
   */
  private _bufferPartial(record: Record<string, unknown>): void {
    const parentKey = this._parentKeyOf(record);
    const buf = this._getOrCreateBucket(parentKey);
    const event = record['event'] as Record<string, unknown> | undefined;
    if (!event || typeof event !== 'object') return;
    const evType = event['type'];

    if (evType === 'message_start') {
      const message = event['message'] as Record<string, unknown> | undefined;
      if (message && typeof message === 'object') {
        const mid = message['id'];
        if (typeof mid === 'string' && mid) {
          buf.currentMessageId = mid;
        }
        const startUsage = isRecord(message['usage'])
          ? (message['usage'] as Record<string, unknown>)
          : undefined;
        // input 累加（轮级）；cache 两维 replace 快照（session-manager.ts:5657-5680）。
        const startInput = numOf(startUsage?.['input_tokens']);
        if (startInput !== undefined) {
          buf.turnInputTokens += startInput;
        }
        const startCr = numOf(startUsage?.['cache_read_input_tokens']);
        if (startCr !== undefined) {
          buf.sessionCacheReadTokens = startCr;
        }
        const startCc = numOf(startUsage?.['cache_creation_input_tokens']);
        if (startCc !== undefined) {
          buf.sessionCacheCreationTokens = startCc;
        }
        // per-call output tracker 归零；input tracker 基线取 start 值
        // （GLM 兼容端点差分口径，session-manager.ts:5682-5690）。
        buf.lastCallOutputTokens = 0;
        buf.lastCallInputTokens = startInput ?? 0;
        // cache 两维 tracker 归零，main 桶以 start 值重建 + 计算本调用 ctx =
        // input + cache_read + cache_creation（上下文环分子，session-manager.ts
        // :5691-5714）。子代理桶不计算（恒 0——其上下文非会话主上下文）。
        buf.lastCallCacheReadTokens = 0;
        buf.lastCallCacheCreationTokens = 0;
        if (buf.parentKey === 'main') {
          const startCrV = startCr ?? 0;
          const startCcV = startCc ?? 0;
          buf.lastCallCtxTokens = (startInput ?? 0) + startCrV + startCcV;
          buf.lastCallCacheReadTokens = startCrV;
          buf.lastCallCacheCreationTokens = startCcV;
        }
      }
    } else if (evType === 'content_block_delta') {
      const delta = event['delta'] as Record<string, unknown> | undefined;
      if (delta && typeof delta === 'object') {
        const dtype = delta['type'];
        if (dtype === 'thinking_delta' && typeof delta['thinking'] === 'string') {
          const segId = this._resolveSegmentId(buf, 'thinking');
          // late partial 守卫：完整消息已覆盖该 segment → 直接丢弃（:5734-5737）。
          if (buf.completedSegments.has(segId)) return;
          buf.currentSegmentId = segId;
          buf.thinking += delta['thinking'];
        } else if (dtype === 'text_delta' && typeof delta['text'] === 'string') {
          const segId = this._resolveSegmentId(buf, 'text');
          if (buf.completedSegments.has(segId)) return;
          buf.currentAssistantSegmentId = segId;
          buf.assistant += delta['text'];
        }
      }
    } else if (evType === 'message_delta') {
      const u = isRecord(event['usage'])
        ? (event['usage'] as Record<string, unknown>)
        : undefined;
      if (u) {
        // output 差分累加（:5761-5767）。
        const callOut = numOf(u['output_tokens']) ?? 0;
        const outDelta = Math.max(0, callOut - buf.lastCallOutputTokens);
        buf.turnOutputTokens += outDelta;
        buf.lastCallOutputTokens = callOut;
        // input 差分累加（官方 Claude delta 不带 input，守卫不命中零影响；:5773-5778）。
        const callIn = numOf(u['input_tokens']);
        if (callIn !== undefined) {
          const inDelta = Math.max(0, callIn - buf.lastCallInputTokens);
          buf.turnInputTokens += inDelta;
          buf.lastCallInputTokens = callIn;
          // main 桶 ctx 同步加 input 差量（ctx 瞬时量，:5779-5783）。
          if (buf.parentKey === 'main') {
            buf.lastCallCtxTokens += inDelta;
          }
        }
        // cache 两维 replace 快照（:5793-5800）。
        const cr = numOf(u['cache_read_input_tokens']);
        if (cr !== undefined) {
          buf.sessionCacheReadTokens = cr;
        }
        const cc = numOf(u['cache_creation_input_tokens']);
        if (cc !== undefined) {
          buf.sessionCacheCreationTokens = cc;
        }
        // main 桶在 delta 携带 cache 时以「上次快照 ± cache 差量」重算本调用 ctx
        // （delta 不带 input_tokens，只能差分；:5801-5812）。子代理桶不重算。
        if (buf.parentKey === 'main' && (cr !== undefined || cc !== undefined)) {
          const prevCr = buf.lastCallCacheReadTokens;
          const prevCc = buf.lastCallCacheCreationTokens;
          const newCr = cr !== undefined ? cr : prevCr;
          const newCc = cc !== undefined ? cc : prevCc;
          buf.lastCallCacheReadTokens = newCr;
          buf.lastCallCacheCreationTokens = newCc;
          buf.lastCallCtxTokens =
            buf.lastCallCtxTokens - prevCr - prevCc + newCr + newCc;
        }
        // pendingUsage = 轮级 input/output + cache 快照 + main 桶 ctx_tokens
        // （:5817-5825；D-005@v1：ctx_tokens 随 partial flush 实时上报，SSE
        // summary 环分子对齐——子桶不含该键，消费侧缺键即跳过）。
        buf.pendingUsage = {
          input_tokens: buf.turnInputTokens,
          output_tokens: buf.turnOutputTokens,
          cache_read_tokens: buf.sessionCacheReadTokens,
          cache_creation_tokens: buf.sessionCacheCreationTokens,
          ...(buf.parentKey === 'main'
            ? { ctx_tokens: buf.lastCallCtxTokens }
            : {}),
        };
      }
    }

    // 节流定时器（:5836-5852）：首个 partial 启动，flush 清引用后由下次 delta 重建。
    if (buf.timer === null) {
      const parentKeyCapture = parentKey;
      buf.timer = setTimeout(() => {
        try {
          this._flushBucket(parentKeyCapture);
        } catch (err) {
          // flush 失败不崩会话，记日志继续（session-manager.ts:5841-5845 同口径）。
          // eslint-disable-next-line no-console
          console.error('[claude-events] partial flush failed', err);
        }
      }, this.flushIntervalMs);
      // unref 不阻止 node 退出（fake timers 下无此方法，duck-type 探测）。
      const t = buf.timer as unknown as { unref?: () => void };
      if (typeof t.unref === 'function') {
        t.unref();
      }
    }
  }

  /**
   * 拼稳定 segmentId（session-manager.ts:5540-5568 的事件化移植）：
   * `${parentKey}:${messageId}:${thinking|text}`；messageId 缺失退化
   * `${parentKey}:unknown:thinking`（旧轨 runKey 分支，归一化器无 runId 概念）。
   */
  private _resolveSegmentId(
    buf: PartialBucket,
    typeSegment: 'thinking' | 'text',
  ): string {
    const mid = buf.currentMessageId;
    if (mid) {
      return `${buf.parentKey}:${mid}:${typeSegment}`;
    }
    return `${buf.parentKey}:unknown:thinking`;
  }

  /**
   * flush 一个桶：累积 thinking/text → onPartialFlush 吐 partial 事件
   * （session-manager.ts:5864-5988 的事件化移植；旧轨 [THINKING]/[ASSISTANT] 文本
   * 行 + metadata.isPartial 提升为 is_partial:true 一等字段，segmentId → segment_id）。
   * usage 去重注入（D-003@v1：partial flush 事件实时携带）：至多附一条（thinking
   * 优先，否则 assistant）；无内容时发 usage-only 空事件（对齐旧轨空 content 行）。
   */
  private _flushBucket(parentKey: string): void {
    const buf = this.buckets.get(parentKey);
    if (!buf) return;
    // 先清 timer 引用，让下次 partial 能重建（自然节流，:5870-5871）。边界 flush
    // （message_stop / 完整消息）连带取消在飞定时器——本 flush 已覆盖其职责，
    // 避免晚到的空调用（对齐 _clearPartialBufferSync 的取消语义，:6073-6076）。
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }

    const thinking = buf.thinking;
    const assistant = buf.assistant;
    buf.thinking = '';
    buf.assistant = '';

    // usage 仅在 pendingUsage 变化时注入（cumulative 去重，:5895-5902）。
    const usageToFlush =
      buf.pendingUsage && !usageEqual(buf.pendingUsage, buf.flushedUsage)
        ? buf.pendingUsage
        : null;
    let usageAttached = false;

    if (thinking) {
      const segmentId =
        buf.currentSegmentId ?? this._resolveSegmentId(buf, 'thinking');
      const ev: AgentEvent = {
        type: 'thinking',
        content: thinking,
        is_partial: true,
        segment_id: segmentId,
      };
      if (usageToFlush && !usageAttached) {
        ev.usage = { ...usageToFlush };
        usageAttached = true;
      }
      buf.flushedSegments.push({ segmentId, kind: 'thinking' });
      this._emitPartial(ev);
      buf.currentSegmentId = null;
    }
    if (assistant) {
      const segmentId =
        buf.currentAssistantSegmentId ?? this._resolveSegmentId(buf, 'text');
      const ev: AgentEvent = {
        type: 'text',
        content: assistant,
        is_partial: true,
        segment_id: segmentId,
      };
      if (usageToFlush && !usageAttached) {
        ev.usage = { ...usageToFlush };
        usageAttached = true;
      }
      buf.flushedSegments.push({ segmentId, kind: 'assistant' });
      this._emitPartial(ev);
      buf.currentAssistantSegmentId = null;
    }
    // usage 未被任何内容事件携带 → 独立 usage-only 事件（content 空串，:5972-5983；
    // backend 对空 content 只提取 usage 不落日志行）。
    if (usageToFlush && !usageAttached) {
      this._emitPartial({ type: 'text', content: '', usage: { ...usageToFlush } });
    }
    if (usageToFlush) {
      buf.flushedUsage = buf.pendingUsage;
    }
  }

  /** onPartialFlush 回调包装：异常隔离（消费侧回调抛错不崩归一化器）。 */
  private _emitPartial(ev: AgentEvent): void {
    try {
      this.onPartialFlush(ev);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[claude-events] onPartialFlush callback failed', err);
    }
  }

  /**
   * sync 清桶 + 登记 completedSegments（session-manager.ts:6066-6103）：
   * 取消 pending timer、清内容与 usage 快照、记已完成 segment（late partial 守卫
   * 在本 turn 内持续生效）、清空 flushedSegments（override 已在展开时消费）、
   * 保留 currentMessageId（完整消息与 message_start 共享同一 id）。
   */
  private _clearBucketSync(
    parentKey: string,
    completedSegments: ReadonlySet<string>,
  ): void {
    const buf = this.buckets.get(parentKey);
    if (!buf) return;
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    buf.thinking = '';
    buf.assistant = '';
    buf.pendingUsage = null;
    buf.flushedUsage = null;
    for (const segId of completedSegments) {
      buf.completedSegments.add(segId);
    }
    buf.flushedSegments = [];
    buf.currentSegmentId = null;
    buf.currentAssistantSegmentId = null;
  }

  /**
   * 完整 assistant message 的 thinking/text block segmentId 提取
   * （session-manager.ts:5583-5617）：thinking 用 `${parentKey}:${mid}:thinking`
   * （mid 缺失退化 unknown）；text 仅 mid 存在时提取 `${parentKey}:${mid}:text`。
   */
  private _extractCompletedSegments(
    record: Record<string, unknown>,
    parentKey: string,
  ): Set<string> {
    const segments = new Set<string>();
    const inner = record['message'] as Record<string, unknown> | undefined;
    if (!inner || typeof inner !== 'object') return segments;
    const rawMid = inner['id'];
    const mid = typeof rawMid === 'string' && rawMid ? rawMid : null;
    const content = inner['content'];
    if (!Array.isArray(content)) return segments;
    for (const item of content) {
      const block = item as Record<string, unknown>;
      if (!block) continue;
      if (block['type'] === 'thinking') {
        segments.add(`${parentKey}:${mid ?? 'unknown'}:thinking`);
      } else if (block['type'] === 'text') {
        if (mid) {
          segments.add(`${parentKey}:${mid}:text`);
        }
      }
    }
    return segments;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 私有辅助（duck-type 读取，对齐 Python 侧 isinstance 防御口径）
// ───────────────────────────────────────────────────────────────────────────

/** 取 message.content 块数组（非对象/无 message → undefined）。 */
function contentBlocksOf(record: Record<string, unknown>): unknown[] | undefined {
  const inner = record['message'];
  if (!isRecord(inner)) return undefined;
  const blocks = inner['content'];
  return Array.isArray(blocks) ? (blocks as unknown[]) : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** String 化读取（null/undefined/非 str → ''，对齐 Python str(x or '')）。 */
function strOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

/** number 守卫读取（bool 排除，对齐 Python isinstance(x, int) and not bool）。 */
function numOf(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/**
 * SDK usage dict（Anthropic 全名 cache_*_input_tokens）→ AgentEventUsage
 * （短名 cache_*_tokens）。映射口径对齐 daemon.ts:3564-3586 的 usage lift。
 */
function usageToEventUsage(
  usage: Record<string, unknown> | undefined,
): AgentEventUsage | undefined {
  if (!usage) return undefined;
  const out: AgentEventUsage = {};
  const input = numOf(usage['input_tokens']);
  const output = numOf(usage['output_tokens']);
  const cr = numOf(usage['cache_read_input_tokens'] ?? usage['cache_read_tokens']);
  const cc = numOf(
    usage['cache_creation_input_tokens'] ?? usage['cache_creation_tokens'],
  );
  // ctx_tokens（D-005@v1）：API 原生 usage 无此字段（归一化器差分派生，仅
  // partial flush 携带）；守卫透传以兼容上游已派生形态。
  const ctx = numOf(usage['ctx_tokens']);
  if (input !== undefined) out.input_tokens = input;
  if (output !== undefined) out.output_tokens = output;
  if (cr !== undefined) out.cache_read_tokens = cr;
  if (cc !== undefined) out.cache_creation_tokens = cc;
  if (ctx !== undefined) out.ctx_tokens = ctx;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * usage 快照相等判定（session-manager.ts:6041-6052 _usageEqual）：比较 4 个
 * 累计/快照字段。**不含 ctx_tokens**（对齐现实现——ctx 是瞬时量，其变化不单独
 * 触发 flush，随任一基础字段变化搭车上报）。
 */
function usageEqual(a: AgentEventUsage | null, b: AgentEventUsage | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.input_tokens === b.input_tokens &&
    a.output_tokens === b.output_tokens &&
    a.cache_read_tokens === b.cache_read_tokens &&
    a.cache_creation_tokens === b.cache_creation_tokens
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 契约缺口记录
// ───────────────────────────────────────────────────────────────────────────
// 1. thinking_tokens / usage.ctx_tokens：task-03 实现时发现的契约缺口（原此处
//    登记为未决问题 1/2），已由 D-005@v1 契约补遗裁决并落地——
//    AgentStatusSubtype += 'thinking_tokens'（本文件产出 status/thinking_tokens
//    事件）、AgentEventUsage += ctx_tokens（本文件差分携带，仅 main 桶）。
// 2. session 级 token 累计（budget 聚合 sessionInput/OutputTokens）：属
//    SessionManager 预算职责（_checkBudgetCutoff 数据源），不随归一化器迁移。
