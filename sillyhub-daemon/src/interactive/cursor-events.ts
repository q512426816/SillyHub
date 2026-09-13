// src/interactive/cursor-events.ts
// 2026-09-08-cursor-interactive-session task-03 / design.md Wave 1 / FR-03 / D-001@v1。
//
// normalizeCursorFrame：cursor-agent `-p --output-format stream-json` stdout
// NDJSON 帧（已 JSON.parse 的单帧对象）→ AgentEvent[]（v2 统一契约，types.ts）
// 的**无状态纯函数**归一化器。先例：codex toAgentEvent 无状态映射表 +
// pi-events 纯函数风格（chatId / 跨帧缓冲状态归 task-04 CursorDriver，本函数
// 唯一可选跨帧计数是 thinking 段号，经第二参 ctx 由 driver 持有注入；缺省
// 调用零状态可用）。
//
// ── 帧形状依据（唯一权威来源）──────────────────────────────────────────────
//   task-01 实测记录：changes/2026-09-08-cursor-interactive-session/
//   spike-cursor-frames.md（真实帧型清单表）；fixture 锚点：
//   tests/fixtures/cursor/*.ndjson（turn1-fresh 8帧 / turn2-resume 6帧 /
//   create-chat-probe 12帧 / tool-use-probe 16帧 / probe-trust-only 14帧 /
//   probe-no-flags 1帧——最后一帧是 probe_capture 探针记录、非 cursor 帧，
//   走未知帧降级桶）。
//   关键实测结论：cursor 帧**并非** claude stream-json 同构子集——
//   thinking / tool_call 走顶层独立帧（非 assistant content 块），
//   usage 字段为 camelCase（inputTokens 等），不能复用 claude 的
//   content-block 遍历路径。
//
// ── 映射表（design.md Wave 1 实测修正版，逐行锚定）────────────────────────
//   | cursor 帧 | AgentEvent 产出 | 依据 |
//   |---|---|---|
//   | system/init（7键：session_id/model/permissionMode/apiKeySource/cwd） | status + subtype='session_started'，session_id 一等字段携带；model/permissionMode 进 metadata | spike 帧型表行1；fixture turn1-fresh 第1帧 |
//   | user（每轮回显用户 prompt，claude 仅 tool_result 时发 user 帧） | []（忽略，不透传——透传会重复渲染用户消息） | spike 帧型表行2；design 映射表行2 |
//   | assistant message.content 文本块（实测仅 {type:text,text}，无 tool_use 块） | text（逐块完整事件） | spike 帧型表行3；fixture turn1-fresh 第7帧 |
//   | thinking 顶层帧 subtype=delta（增量 text） | thinking（is_partial=true + segment_id 流式段） | spike 帧型表行4；fixture turn1-fresh 第3-5帧 |
//   | thinking 顶层帧 subtype=completed（无 text） | []（吸收；经 ctx 递增段号，下一段 thinking 用新 segment_id） | spike 帧型表行4；fixture turn1-fresh 第6帧 |
//   | tool_call 顶层帧 subtype=started（call_id / tool_call 判别联合 / model_call_id） | tool_use（tool_name=判别联合键如 shellToolCall 原生保留不重命名；call_id 一等字段配对；content=入参 JSON） | spike 帧型表行5；fixture tool-use-probe 第9帧 / probe-trust-only 第7帧 |
//   | tool_call 顶层帧 subtype=completed（result.success.{exitCode,stdout,stderr,executionTime,path,linesAdded,...}） | tool_result（call_id 与 started 同值配对；stdout/stderr 进 content；success 其余字段原生进 metadata） | spike 帧型表行5；fixture tool-use-probe 第10帧 / probe-trust-only 第8帧 |
//   | result（subtype=success；duration_ms/is_error/result/session_id/request_id/usage camelCase） | turn_result + usage 四字段短名映射 + session_id | spike 帧型表行6；fixture turn1-fresh 第8帧 |
//   | connection（reconnecting/reconnected）/ retry（starting）传输层帧 | []（忽略，传输层） | spike 帧型表行7-8；fixture tool-use-probe 第3-5帧 |
//   | 未知帧型（如 probe_capture 探针记录） | status + subtype='task_notification' 降级桶（content=原 type；metadata.original_event_type + 原字段全量保留）——fail-safe 不丢不抛 | design 映射表末行；codex toAgentEvent #9 / pi-events degradeUnknown 同款；fixture probe-no-flags 第1帧 |
//
//   usage camelCase → 短名映射（spike 设计影响 #1）：
//     inputTokens→input_tokens / outputTokens→output_tokens /
//     cacheReadTokens→cache_read_tokens / cacheWriteTokens→cache_creation_tokens。
//     非 number 字段不设值（不伪造 0）；ctx_tokens = inputTokens + cacheReadTokens
//     + cacheWriteTokens 净值三和（fixture 跨轮连续性验证）。
//
// ── 行为约定 ──────────────────────────────────────────────────────────────
//   - 每条产出事件过 safeParseAgentEvent（agent-event-schema.ts）：校验失败
//     丢弃该条 + console.warn 定位（不抛——归一化器 fail-safe，单行坏数据
//     不阻断事件流）；调用方拿到的全部是 schema 合法事件。
//   - 入口防御：null / 数字 / 字符串 / 数组 / 缺 type / 坏对象 → [] 不抛
//     （畸形行 warn 归 driver 层职责，见任务卡 constraints）。
//   - type='status' 恒带闭合枚举 subtype（schema superRefine 强制）。
//   - 注意：tool_call.call_id 字符串内含字面 \n（task-01 实测），下游按
//     call_id 拼接/分行逻辑不得按行拆分（spike 设计影响 #5，记录在案）。
//   - 不实现 stderr→error 嗅探（driver 层职责归 task-04，见任务卡）。

import { safeParseAgentEvent } from '../agent-event-schema.js';
import type { AgentEvent, AgentEventUsage } from '../types.js';
import { ctxTokensFromNetInput } from './usage-ctx.js';

/**
 * 可选跨帧上下文（driver 持有，per-session 注入）。
 *
 * 唯一用途：thinking 流段号计数——一段 thinking 由若干 delta 帧 +
 * 一个 completed 帧组成，同段共享 segment_id（cursor:thinking:<n>），
 * completed 到达时段号 +1（下一段起新 segment）。缺省调用（不传 ctx）
 * 退化为恒定 segment 0，功能可用（单段场景 / 测试直调）。
 */
export interface CursorNormalizeCtx {
  thinkingSegment?: number;
}

/** 已知顶层帧型集合（词表真源 = 文件头映射表 + fixture 实测）。 */
const KNOWN_FRAME_TYPES: ReadonlySet<string> = new Set([
  'system',
  'user',
  'assistant',
  'thinking',
  'tool_call',
  'result',
  'connection',
  'retry',
]);

/**
 * 归一化一帧 cursor stream-json（已 parse 的对象，宽收 unknown）。
 *
 * @param frame 单帧 JSON.parse 结果（坏 JSON 由 driver 分帧层拦截，此处
 *              仍对非对象/缺字段做入口防御）
 * @param ctx   可选跨帧上下文（thinking 段号计数，driver 持有；缺省零状态可用）
 * @returns 0..N 条 AgentEvent（全部已过 safeParseAgentEvent）
 */
export function normalizeCursorFrame(
  frame: unknown,
  ctx?: CursorNormalizeCtx,
): AgentEvent[] {
  // 入口防御：非 plain object / 无 string type → []（不抛，映射表外无归处）
  if (!isRecord(frame)) return [];
  const frameType = typeof frame.type === 'string' ? frame.type : '';
  if (!frameType) return [];

  let out: AgentEvent[];
  if (!KNOWN_FRAME_TYPES.has(frameType)) {
    out = [degradeUnknown(frameType, frame)];
  } else {
    switch (frameType) {
      case 'system':
        out = handleSystem(frame);
        break;
      case 'user':
        // 每轮回显用户 prompt——忽略不透传（防重复渲染，design 映射表行2）
        out = [];
        break;
      case 'assistant':
        out = handleAssistant(frame);
        break;
      case 'thinking':
        out = handleThinking(frame, ctx);
        break;
      case 'tool_call':
        out = handleToolCall(frame);
        break;
      case 'result':
        out = handleResult(frame);
        break;
      case 'connection':
      case 'retry':
        // 传输层帧（reconnecting/reconnected/starting）——忽略
        out = [];
        break;
      default:
        out = [];
        break;
    }
  }

  // 全部产出过 schema：失败丢弃 + warn 不抛（验收项：调用方只见合法事件）
  return out.filter((ev) => {
    const r = safeParseAgentEvent(ev);
    if (!r.success) {
      console.warn(
        `[cursor-events] drop invalid event: ${JSON.stringify(r.error.issues)} on ${JSON.stringify(ev)}`,
      );
      return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 各帧型 handler（模块级私有，纯函数）
// ─────────────────────────────────────────────────────────────────────────────

/** system/init → status/session_started（session_id 一等字段；模型等进 metadata）。 */
function handleSystem(frame: Record<string, unknown>): AgentEvent[] {
  // 仅 init 子型承载会话启动信号；其他 system 子型（未观测）防御性忽略
  if (frame.subtype !== 'init') return [];
  const ev: AgentEvent = {
    type: 'status',
    subtype: 'session_started',
    content: '',
  };
  if (typeof frame.session_id === 'string' && frame.session_id) {
    ev.session_id = frame.session_id;
  }
  const metadata: Record<string, unknown> = {};
  if (typeof frame.model === 'string') metadata.model = frame.model;
  if (typeof frame.permissionMode === 'string') {
    metadata.permission_mode = frame.permissionMode;
  }
  if (typeof frame.apiKeySource === 'string') {
    metadata.api_key_source = frame.apiKeySource;
  }
  if (Object.keys(metadata).length > 0) ev.metadata = metadata;
  return [ev];
}

/** assistant → text（message.content 逐 {type:text,text} 块；实测无其他块型）。 */
function handleAssistant(frame: Record<string, unknown>): AgentEvent[] {
  const message = isRecord(frame.message) ? frame.message : null;
  if (!message || !Array.isArray(message.content)) return [];
  const out: AgentEvent[] = [];
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    if (!block.text) continue;
    out.push({ type: 'text', content: block.text });
  }
  return out;
}

/**
 * thinking 顶层帧：delta → thinking（is_partial+segment_id 流式）；
 * completed → []（吸收，并经 ctx 递增段号——下一段 thinking 用新 segment_id）。
 */
function handleThinking(
  frame: Record<string, unknown>,
  ctx?: CursorNormalizeCtx,
): AgentEvent[] {
  if (frame.subtype === 'completed') {
    // 段收尾：driver 持有 ctx 时推进段号（缺省调用零状态，不影响返回值）
    if (ctx) ctx.thinkingSegment = (ctx.thinkingSegment ?? 0) + 1;
    return [];
  }
  if (frame.subtype !== 'delta') return [];
  const text = typeof frame.text === 'string' ? frame.text : '';
  if (!text) return [];
  const seg = ctx?.thinkingSegment ?? 0;
  return [{
    type: 'thinking',
    content: text,
    is_partial: true,
    segment_id: `cursor:thinking:${seg}`,
  }];
}

/**
 * tool_call 顶层帧：started → tool_use / completed → tool_result。
 *
 * tool_call 字段是判别联合对象：判别键（如 shellToolCall / editToolCall）
 * 的值携带 args（started）与 result.success（completed）；同级还有
 * hookAdditionalContexts / toolCallId / startedAtMs 等伴随字段（非判别键，
 * 值非 record 或键名不以 ToolCall 结尾，提取时排除）。
 */
function handleToolCall(frame: Record<string, unknown>): AgentEvent[] {
  const callId = typeof frame.call_id === 'string' ? frame.call_id : '';
  const union = isRecord(frame.tool_call) ? frame.tool_call : null;
  const toolName = union ? extractToolName(union) : 'unknown';
  const body = union && toolName !== 'unknown' && isRecord(union[toolName])
    ? (union[toolName] as Record<string, unknown>)
    : {};

  if (frame.subtype === 'started') {
    const args = isRecord(body.args) ? body.args : {};
    const metadata: Record<string, unknown> = { tool_input: args };
    if (typeof frame.model_call_id === 'string') {
      metadata.model_call_id = frame.model_call_id;
    }
    return [{
      type: 'tool_use',
      content: JSON.stringify(args),
      tool_name: toolName,
      call_id: callId,
      metadata,
    }];
  }

  if (frame.subtype === 'completed') {
    const result = isRecord(body.result) ? body.result : {};
    const success = isRecord(result.success) ? result.success : {};
    // stdout/stderr 进 content（design 映射表行6）；两者皆无时回退
    // success.message（editToolCall 实测形态：path/linesAdded/message 无
    // stdout/stderr，fixture probe-trust-only 第8帧）——不留空 content。
    const stdout = typeof success.stdout === 'string' ? success.stdout : '';
    const stderr = typeof success.stderr === 'string' ? success.stderr : '';
    let content = [stdout, stderr].filter((s) => s !== '').join('\n');
    if (!content && typeof success.message === 'string') {
      content = success.message;
    }
    // success 其余字段原生进 metadata（exitCode/executionTime/path/
    // linesAdded/diffString 等，键名保留 camelCase 原样——spike 实测形状）
    const metadata: Record<string, unknown> = { tool_output: content };
    for (const [k, v] of Object.entries(success)) {
      if (k === 'stdout' || k === 'stderr' || k === 'message') continue;
      metadata[k] = v;
    }
    // shell 类 exitCode 非零浮出 is_error（pi-events handleToolEnd 同款口径；
    // 不改会话终态，仅元数据）
    if (typeof success.exitCode === 'number' && success.exitCode !== 0) {
      metadata.is_error = true;
    }
    if (typeof frame.model_call_id === 'string') {
      metadata.model_call_id = frame.model_call_id;
    }
    return [{
      type: 'tool_result',
      content,
      tool_name: toolName,
      call_id: callId,
      metadata,
    }];
  }

  // 其他 tool_call 子型（未观测）防御性忽略
  return [];
}

/**
 * result 帧 → turn_result + usage 四字段短名映射 + session_id。
 * content = result 文本（fixture 实测与最终 assistant 文本一致）。
 * usage 非 number 字段不设值（不伪造 0，任务卡验收口径）。
 */
function handleResult(frame: Record<string, unknown>): AgentEvent[] {
  const ev: AgentEvent = {
    type: 'turn_result',
    content: typeof frame.result === 'string' ? frame.result : '',
  };
  if (typeof frame.session_id === 'string' && frame.session_id) {
    ev.session_id = frame.session_id;
  }
  if (isRecord(frame.usage)) {
    const usage = mapUsage(frame.usage);
    if (usage) ev.usage = usage;
  }
  const metadata: Record<string, unknown> = {};
  if (typeof frame.is_error === 'boolean') metadata.is_error = frame.is_error;
  if (typeof frame.duration_ms === 'number') metadata.duration_ms = frame.duration_ms;
  if (typeof frame.request_id === 'string') metadata.request_id = frame.request_id;
  if (Object.keys(metadata).length > 0) ev.metadata = metadata;
  return [ev];
}

/**
 * usage camelCase → AgentEventUsage 短名映射（spike 设计影响 #1）：
 *   inputTokens→input_tokens / outputTokens→output_tokens /
 *   cacheReadTokens→cache_read_tokens / cacheWriteTokens→cache_creation_tokens。
 * 非 number（含 NaN/Infinity）字段不设值不伪造 0；全无效时返回 undefined
 * （不挂空 usage 对象）。
 * ctx_tokens = input + cacheRead + cacheWrite 净值三和（ctxTokensFromNetInput
 * 共享 helper，复用已过校验的短名值）：任一有效分量存在即派生（缺失按 0 计）、
 * 三分量全缺 → 不携带 ctx_tokens 键（与 pi numOr0 恒派生口径相反，设计两口径
 * 并列成立）。output_tokens 不进 ctx（ctx 为输入侧三分量和）。
 */
function mapUsage(raw: Record<string, unknown>): AgentEventUsage | undefined {
  const usage: AgentEventUsage = {};
  const pairs: Array<[string, keyof AgentEventUsage]> = [
    ['inputTokens', 'input_tokens'],
    ['outputTokens', 'output_tokens'],
    ['cacheReadTokens', 'cache_read_tokens'],
    ['cacheWriteTokens', 'cache_creation_tokens'],
  ];
  let any = false;
  for (const [from, to] of pairs) {
    const v = raw[from];
    if (typeof v === 'number' && Number.isFinite(v)) {
      usage[to] = v;
      any = true;
    }
  }
  // ctx 派生只消费已校验短名值（不读原始 raw 字段绕过校验）：全缺 → undefined
  // 不携带（非伪造 0 守卫口径不变）。
  const ctx = ctxTokensFromNetInput(
    usage.input_tokens,
    usage.cache_read_tokens,
    usage.cache_creation_tokens,
  );
  if (ctx !== undefined) usage.ctx_tokens = ctx;
  return any ? usage : undefined;
}

/**
 * 未知帧型降级（fail-safe 不丢不抛）：status/task_notification 桶。
 * 形状对齐 codex toAgentEvent #9 / pi-events degradeUnknown 先例：
 * content=原 type；metadata.original_event_type + 原帧其余字段全量平铺。
 * （schema superRefine 强制 status 必带闭合枚举 subtype；task_notification
 * 走瞬时通道不污染持久化。）
 */
function degradeUnknown(
  frameType: string,
  frame: Record<string, unknown>,
): AgentEvent {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frame)) {
    if (k !== 'type') rest[k] = v;
  }
  return {
    type: 'status',
    subtype: 'task_notification',
    content: frameType,
    metadata: { original_event_type: frameType, ...rest },
  };
}

/**
 * 从 tool_call 判别联合对象提取判别键（工具名，原生保留不重命名）。
 * 判别键 = 键名以 'ToolCall' 结尾且值为 record 的第一个键
 * （shellToolCall/editToolCall 等；同级 hookAdditionalContexts 为数组、
 * toolCallId/startedAtMs 为字符串，均被条件排除）。找不到回退 'unknown'。
 */
function extractToolName(union: Record<string, unknown>): string {
  for (const [k, v] of Object.entries(union)) {
    if (k.endsWith('ToolCall') && isRecord(v)) return k;
  }
  return 'unknown';
}

/** 类型守卫：值是非 null 的 plain object（非数组）。pi-events 同款。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
