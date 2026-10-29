/**
 * zcode-events.ts —— ZCode app-server 通知 → AgentEvent 归一化器（纯函数，无 IO）。
 *
 * 2026-10-15-zcode-engine-appserver task-03（D-005）。
 *
 * 内容通道事实（2026-10-15 实测钉板：session/subscribe deliveryKind=
 * 'desktop-continuous' 后服务端推送 `session/event` 通知）：
 *   - 顶层 `type` ∈ {session.titleUpdated, turn.started, session.updated,
 *     model.streaming, turn.completed}；
 *   - **文本内容流在 `session/event` 的 `model.streaming`**：payload
 *     {assistantMessageId, delta, done, kind ∈ {text_delta, reasoning_delta}}——
 *     text_delta → text 增量 / reasoning_delta → thinking 增量；
 *   - `v4/telemetry/event` 的 stream.chunk 仅携带 chunkLength（遥测），不含文本
 *     ——内容不从这里取（实测排除）；
 *   - `turn.completed` 携带 usage {inputTokens, outputTokens, cacheReadTokens,
 *     cacheWriteTokens, totalTokens} + duration(ms) + response（整段最终文本）；
 *   - `state.updated`（独立通知）携带模型目录 {model.available[].ref.
 *     {providerId,modelId}, contextWindow, reasoning.levels}——驱动缓存为
 *     getThinkingLevels/setModel 数据源。
 *
 * 归一化语义对照先例：
 *   - 流式 delta 直通不合并、无 is_partial（pi-events.ts 同款：逐 delta 直接
 *     产 text 事件，SessionManager 轮内拼接）；
 *   - 轮收尾产单个 `turn_result` 事件（交互式链路统一用 turn_result，types.ts
 *     AgentEventType 注释；codex complete 别名的语义等价物），usage 走一等
 *     字段（session-manager/usage.ts:102 直接消费 ev.usage）；response 整段
 *     文本进 metadata.response 作流式丢块兜底（不 override，防双投递）；
 *   - 未知 type/kind 安全忽略（fail-soft，不抛错不丢后续事件）。
 */

import type { AgentEvent, AgentEventUsage } from '../types.js';
import type { ZcodeNotification } from '../adapters/zcode-envelope.js';

/** session/event 通知的载荷面（实测形状，宽松收窄——未知字段忽略）。 */
export interface ZcodeSessionEventParams {
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly seq?: number;
  readonly type?: string;
  readonly payload?: Record<string, unknown>;
}

/**
 * 心跳增量信号出参（2026-10-29-engine-live-perception / FR-01，spike 结论见
 * change spike-notes.md）：`v4/telemetry/event` kind=tool_input_delta（工具参数
 * 流式增量）的字符量——归一化器纯函数无状态，经 stateCarrier 出参透传，驱动
 * 层累计节流后发 onHeartbeat。usage.delta 载荷形态未钉板（真机样本遗留），
 * 本轮不消费——fail-soft 取不到字段即无信号，前端回落现状。
 */
export interface ZcodeHeartbeatDelta {
  /** 本条 tool_input_delta 的字符增量（载荷宽松提取，字段缺失=无信号）。 */
  chars: number;
}

/** state.updated 提取出的模型目录条目（getThinkingLevels/setModel 数据源）。 */
export interface ZcodeModelCatalogEntry {
  readonly providerId: string;
  readonly modelId: string;
  readonly label?: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly reasoningLevels?: readonly string[];
  /** 引擎自报默认档（reasoning.defaultLevel；setModel 需带 reasoningLevel 时优先取此值）。 */
  readonly reasoningDefaultLevel?: string;
}

/** state.updated 提取出的会话快照（驱动缓存消费）。 */
export interface ZcodeStateSnapshot {
  /** 会话状态补丁（state.updated patch.status）。 */
  status?: string;
  modelCatalog?: readonly ZcodeModelCatalogEntry[];
  currentModel?: { providerId?: string; modelId?: string } | null;
}

/**
 * 归一化 session/event / state.updated 通知为 AgentEvent[]。
 *
 * @param notification 信封层解出的通知（method + params）
 * @param stateOut 可选出参：state.updated 提取的模型目录/状态写回此处（驱动缓存）；
 *   v4/telemetry tool_input_delta 的心跳字符增量写 `stateOut.heartbeatDelta`
 * @returns 0..N 个 AgentEvent（观察面通知产出 0 个）
 */
export function normalizeZcodeNotification(
  notification: ZcodeNotification,
  stateOut?: {
    snapshot?: ZcodeStateSnapshot;
    heartbeatDelta?: ZcodeHeartbeatDelta;
  },
): AgentEvent[] {
  const params = (notification.params ?? {}) as Record<string, unknown>;

  if (notification.method === 'session/event') {
    return normalizeSessionEvent(params as ZcodeSessionEventParams);
  }
  if (notification.method === 'state.updated') {
    const snapshot = extractStateSnapshot(params);
    if (stateOut) stateOut.snapshot = snapshot;
    return []; // 状态快照不产出消息事件（观察面）
  }
  if (notification.method === 'v4/telemetry/event') {
    // 2026-10-29-engine-live-perception（FR-01）：kind=tool_input_delta（工具参数
    // 流式增量，2026-10-15 四轮实测钉板的 kind 枚举成员）→ 心跳字符增量出参；
    // 其余 kind（stream.chunk 文本/思考已有 session/event 内容流、tool_call/
    // tool.lifecycle/usage.delta/turn.* 各有归属）不产出——不重复不伪造。
    const payload = isRecord(params['payload']) ? params['payload'] : undefined;
    const kind = payload ? String(payload['kind'] ?? '') : '';
    if (kind === 'tool_input_delta' && payload) {
      const chars = extractHeartbeatChars(payload);
      if (chars > 0 && stateOut) {
        stateOut.heartbeatDelta = { chars };
      }
    }
    return [];
  }
  // computer-use / process/* 等其余遥测通道：内容不在其中（实测），
  // turn 边界以 session/event 的 turn.completed 为权威——忽略。
  return [];
}

/** tool_input_delta 载荷宽松提取字符增量（候选字段名，取不到返回 0=无信号）。 */
function extractHeartbeatChars(payload: Record<string, unknown>): number {
  const candidates: unknown[] = [
    payload['length'],
    payload['chars'],
    payload['inputLength'],
    isRecord(payload['delta'])
      ? (payload['delta'] as Record<string, unknown>)['length']
      : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
  }
  return 0;
}

/** Record 守卫（宽松收窄用）。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// ---------------------------------------------------------------------------
// session/event 归一化
// ---------------------------------------------------------------------------

function normalizeSessionEvent(params: ZcodeSessionEventParams): AgentEvent[] {
  const type = params.type ?? '';
  const payload = params.payload ?? {};
  const base = {
    session_id: params.sessionId,
    metadata: {
      zcodeTurnId: params.turnId,
      zcodeSeq: params.seq,
    } as Record<string, unknown>,
  };

  switch (type) {
    case 'model.streaming': {
      const kind = String(payload.kind ?? '');
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      if (delta === '') return [];
      const meta: Record<string, unknown> = {
        ...base.metadata,
        source: 'model_streaming',
        streaming: true,
      };
      if (typeof payload.assistantMessageId === 'string') {
        meta.assistantMessageId = payload.assistantMessageId;
      }
      if (kind === 'reasoning_delta') {
        return [{ ...base, type: 'thinking' as const, content: delta, metadata: meta }];
      }
      // text_delta（含未知 kind 的文本面——宽松直通 text 通道）
      return [{ ...base, type: 'text' as const, content: delta, metadata: meta }];
    }

    case 'turn.completed': {
      const usage = extractUsage(payload.usage, payload.duration);
      const meta: Record<string, unknown> = { ...base.metadata, source: 'turn_completed' };
      if (typeof payload.response === 'string' && payload.response !== '') {
        meta.response = payload.response;
      }
      if (typeof payload.resultType === 'string') {
        meta.turn_status = payload.resultType;
      }
      // 单事件收尾：turn_result + 一等 usage（response 进 metadata 作兜底，
      // 不 override——流式 delta 已投递，双投递由消费侧按 metadata.response 对账）
      return [{ ...base, type: 'turn_result' as const, content: '', usage, metadata: meta }];
    }

    case 'turn.failed': {
      // 2026-10-15 实测（provider 业务错误如 429 额度用尽）：session/event
      // type='turn.failed' 携带 payload.error{type, code, message, attribution
      // {source, reason, retryable, errorPhase...}}——轮必须收敛，否则驱动
      // 永久挂起（e2e 冒烟 120s 超时实证：无此映射时该 type 落入 default 被
      // 忽略，turn 永不收敛）。产出：error 事件（message 供驱动 pendingTurnError
      // 兜底）+ turn_result 失败收尾（驱动 finishTurn 收敛路径）。
      const errObj = (payload.error ?? {}) as Record<string, unknown>;
      const message =
        typeof errObj.message === 'string' && errObj.message !== ''
          ? errObj.message
          : 'zcode 轮失败（引擎未附 message）';
      const errMeta: Record<string, unknown> = { ...base.metadata, source: 'turn_failed' };
      if (typeof errObj.code === 'string' || typeof errObj.code === 'number') {
        errMeta.error_code = errObj.code;
      }
      if (typeof errObj.type === 'string') errMeta.error_type = errObj.type;
      if (typeof errObj.attribution === 'object' && errObj.attribution !== null) {
        errMeta.attribution = errObj.attribution;
      }
      return [
        { ...base, type: 'error' as const, content: message, metadata: errMeta },
        {
          ...base,
          type: 'turn_result' as const,
          content: '',
          metadata: { ...base.metadata, source: 'turn_failed', turn_status: 'failed' },
        },
      ];
    }

    case 'turn.started':
    case 'session.updated':
    case 'session.titleUpdated':
    default:
      // 观察面（轮开始/标题/会话统计）：turn 生命周期由驱动 consume 循环管理，
      // 不产出消息事件。
      return [];
  }
}

// ---------------------------------------------------------------------------
// usage 提取（turn.completed 载荷 → AgentEventUsage）
// ---------------------------------------------------------------------------

function extractUsage(
  raw: unknown,
  durationMs: unknown,
): AgentEventUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const u = raw as Record<string, unknown>;
  const usage: AgentEventUsage = {};
  let any = false;
  if (typeof u.inputTokens === 'number') {
    usage.input_tokens = u.inputTokens;
    any = true;
  }
  if (typeof u.outputTokens === 'number') {
    usage.output_tokens = u.outputTokens;
    any = true;
  }
  if (typeof u.cacheReadTokens === 'number') {
    usage.cache_read_tokens = u.cacheReadTokens;
    any = true;
  }
  if (typeof u.cacheWriteTokens === 'number') {
    usage.cache_creation_tokens = u.cacheWriteTokens;
    any = true;
  }
  if (typeof u.totalTokens === 'number') {
    // ctx 环分子（types.ts AgentEventUsage.ctx_tokens 契约：input+cache 量和）
    usage.ctx_tokens = u.totalTokens;
    any = true;
  }
  if (typeof durationMs === 'number') {
    usage.api_duration_ms = durationMs;
    any = true;
  }
  return any ? usage : undefined;
}

// ---------------------------------------------------------------------------
// state.updated 快照提取
// ---------------------------------------------------------------------------

/**
 * reasoning levels 双形态提取（实测抓包为 {value:"low"} 对象数组；兼容纯字符串
 * 数组形态）——getThinkingLevels 档位表数据源。
 */
function extractReasoningLevels(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const l of raw) {
    if (typeof l === 'string') {
      out.push(l);
    } else if (typeof l === 'object' && l !== null) {
      const v = (l as Record<string, unknown>)['value'];
      if (typeof v === 'string') out.push(v);
    }
  }
  return out;
}

function extractStateSnapshot(params: Record<string, unknown>): ZcodeStateSnapshot {  const patch = (params.patch ?? {}) as Record<string, unknown>;
  const snapshot: ZcodeStateSnapshot = {};
  if (typeof patch.status === 'string') snapshot.status = patch.status;

  const model = (patch.model ?? {}) as Record<string, unknown>;
  if (Array.isArray(model.available)) {
    const catalog: ZcodeModelCatalogEntry[] = [];
    for (const entry of model.available) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const ref = (e.ref ?? {}) as Record<string, unknown>;
      if (typeof ref.providerId !== 'string' || typeof ref.modelId !== 'string') continue;
      const reasoning = (e.reasoning ?? {}) as Record<string, unknown>;
      catalog.push({
        providerId: ref.providerId,
        modelId: ref.modelId,
        label: typeof e.label === 'string' ? e.label : undefined,
        contextWindow: typeof e.contextWindow === 'number' ? e.contextWindow : undefined,
        maxOutputTokens:
          typeof e.maxOutputTokens === 'number' ? e.maxOutputTokens : undefined,
        reasoningLevels: extractReasoningLevels(reasoning.levels),
        reasoningDefaultLevel:
          typeof reasoning.defaultLevel === 'string' ? reasoning.defaultLevel : undefined,
      });
    }
    snapshot.modelCatalog = catalog;
  }
  const current = (model.current ?? null) as Record<string, unknown> | null;
  if (current && typeof current === 'object') {
    snapshot.currentModel = {
      providerId: typeof current.providerId === 'string' ? current.providerId : undefined,
      modelId: typeof current.modelId === 'string' ? current.modelId : undefined,
    };
  }
  return snapshot;
}
