/**
 * `agent-log/parse-cursor-agent-transcript.ts` —— cursor-agent transcript
 * JSONL 解析器（纯函数）。
 *
 * task-05（2026-09-19-tool-report-session-replay / FR-02 + D-005@v1 + D-006@v1）：
 * 把 cursor-agent 落盘的 `~/.cursor/projects/<ctx>/agent-transcripts/<id>/<id>.jsonl`
 * 逐行解析为对话流消息（NormalizedLogMessage[]）。该数据源本机 96 份零上报，
 * 上报链路归 sillyspec 仓跨仓跟进（design Phase 4）；本解析器由 task-06 注册进
 * registry——**format 串注册键（task-06 对齐）：`cursor-agent-transcript-jsonl`**。
 *
 * spike-02 结论（2026-09-19 本机 C:/Users/qinyi/.cursor/projects/ 全量 96 份
 * transcript 只读枚举实证，2026-09-19-tool-report-session-replay R-02 前置核对）：
 *   - 行形状全集仅两类：对话行 `{role:'user'|'assistant', message:{content:[…]}}`
 *     与事件行 `{type:'turn_ended', status:'success'|'error', error?}`
 *     （89 个 turn_ended 事件分布在 82/96 份文件；其余 14 份无事件 → 整文件单轮兜底）；
 *   - content 块类型全集：`user:text`（205）/ `assistant:text`（1509）/
 *     `assistant:tool_use`（4271）——**tool_result 不落盘**（零样本），tool_use
 *     块不带 id 字段（0/4271，块键仅 {type,name,input}）→ tool_use 无法也不配对，
 *     不产任何 tool_result 段（前端「结果未记录」中性徽章兜底，不伪造结果）；
 *   - 顶层无 timestamp / 无 usage（token 不落盘）→ ts 恒 null、usage 恒不附着
 *     （字段缺省）、totalUsage 恒 null（前端「未知」兜底，不伪造 0）；
 *   - 真实 user text 常以 `<user_query>` / `<timestamp>` 等包裹/上下文标记开头
 *     （不在 R-06 白名单）→ 保守归 human（错标系统事件会隐藏真人输入，代价
 *     不对称）；白名单仅 <task-notification> / <system-reminder>。
 *
 * 归一化规则（design Phase 1.4 + D-003@v1 + D-005@v1）：
 *   - user text 块 → user_input 段（text 原文，sender 白名单前缀归 system_event，
 *     缺省 human）；assistant text 块 → reply 段；assistant tool_use 块 →
 *     tool_use 段（tool_use_id 恒 null——块不落盘 id；tool_input JSON.stringify
 *     首 2KB 摘要）；未知块类型防御式跳过；
 *   - turn_ended 事件行 → 轮边界（事件本身不产段）：轮号从 1 起，事件后各段归
 *     下一轮；无事件文件按整文件单轮（全部段 turn_id '1'）；
 *   - 全段 ts=null、usage 缺省；totalUsage=null。
 *
 * 纯函数约束与 status 分层（对齐 parse-zcode-model-io.ts / parse-claude-code-jsonl.ts）：
 * 不读 env / 时钟 / 文件系统——content 与 20MB 预算、200 段窗口、beforeSeq、超时
 * deadline、时钟函数全部参数注入（常量复用 parse-zcode-model-io 导出值，口径单源）。
 * too_large（超预算）/ parse_error（坏行占比 >50% 或超时；坏行 = JSON 解析失败或
 * spike-02 全集外形状）/ parsed。'unsupported' 判定归 registry 层（task-06）。
 *
 * @module agent-log/parse-cursor-agent-transcript
 */

import {
  DEFAULT_MAX_CONTENT_BYTES,
  DEFAULT_MAX_SEGMENTS,
  DEFAULT_PARSE_TIMEOUT_MS,
  type NormalizedLogMessage,
} from './parse-zcode-model-io.js';
import type { AgentLogMessagesResult } from './registry.js';

// ── 模块常量 ─────────────────────────────────────────────────────────────────

/** 行级批处理粒度：每 500 行 yield 一次事件循环（对齐 parse-zcode-model-io）。 */
const LINES_PER_BATCH = 500;

/** tool_input 摘要截断：JSON.stringify 后首 2KB（对齐 parse-zcode-model-io）。 */
const TOOL_INPUT_MAX_CHARS = 2048;

/**
 * user text 注入前缀白名单（R-06）：以任一前缀开头 → sender='system_event'；
 * 白名单外（含实证的 <user_query>/<timestamp> 形态）保守归 human。
 */
const INJECTION_PREFIXES: readonly string[] = ['<task-notification>', '<system-reminder>'];

// ── 类型定义 ─────────────────────────────────────────────────────────────────

/** 解析选项：全部参数注入（纯函数不读 env/时钟/文件系统）。 */
export interface CursorAgentTranscriptParseOptions {
  /** 内容预算上限（字节），默认 20MB（复用 parse-zcode-model-io 常量）。 */
  maxContentBytes?: number;
  /** 段窗口大小，默认 200。 */
  maxSegments?: number;
  /** 「加载更早」切片键：非 null 时按 seq < beforeSeq 过滤后再套窗口。 */
  beforeSeq?: number | null;
  /** 超时保护毫秒数，默认 5s。 */
  timeoutMs?: number;
  /** 时钟函数（默认 Date.now），注入以便测试零 mock 地驱动超时。 */
  now?: () => number;
}

/** 未编号段（seq 在全量段产出后统一重编号）。 */
type UnnumberedSegment = Omit<NormalizedLogMessage, 'seq'>;

// ── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 解析 cursor-agent transcript JSONL 内容为归一化对话消息（纯函数、异步）。
 *
 * 处理管线：预算前置判定 → 逐行 parse + 行分类（turn_ended 事件切轮 / user /
 * assistant，每 500 行 yield + 超时检查）→ 坏行占比判定 → turn_id 轮序附着 →
 * seq 重编号 → beforeSeq 切片 → 段窗口截断。
 */
export async function parseCursorAgentTranscriptLog(
  content: string,
  options: CursorAgentTranscriptParseOptions = {},
): Promise<AgentLogMessagesResult> {
  // 20MB 预算前置判定：超限直接 too_large，不进入逐行解析。
  const maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  if (Buffer.byteLength(content, 'utf8') > maxContentBytes) {
    return { status: 'too_large', messages: [], truncated: false, totalSegments: 0, skippedLines: 0 };
  }

  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const beforeSeq = options.beforeSeq ?? null;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS);

  // BOM 容错 + 逐行（trim 兼容 CRLF 尾随 \r）。
  const normalized = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const rawLines = normalized.split('\n');

  const segments: UnnumberedSegment[] = [];
  let skippedLines = 0; // 坏行计数（本格式无非对话行类别）
  let totalLines = 0;
  let turnCounter = 1; // 轮号从 1 起；turn_ended 后自增；无事件文件恒 1（单轮兜底）

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw === undefined) break;
    const line = raw.trim();
    // 空白行不计坏行、不计占比分母。
    if (line === '') continue;
    totalLines++;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skippedLines++;
      continue;
    }
    if (!isRecord(parsed)) {
      skippedLines++;
      continue;
    }

    if (parsed.type === 'turn_ended') {
      // 轮边界（D-005）：事件本身不产段，其后各段归下一轮；status/error 不进输出契约。
      turnCounter++;
    } else if (parsed.role === 'user' || parsed.role === 'assistant') {
      const message = parsed.message;
      if (!isRecord(message) || !Array.isArray(message.content)) {
        skippedLines++; // 对话行 message/content 形状不符 → 坏行
      } else {
        const produced =
          parsed.role === 'user' ? userSegments(message.content) : assistantSegments(message.content);
        const turnId = String(turnCounter);
        for (const segment of produced) segments.push({ ...segment, turn_id: turnId });
      }
    } else {
      // spike-02 全集外形状（无 type 无 role / 未知 type）→ 坏行。
      skippedLines++;
    }

    // 行级批处理：每 500 行 yield + 超时检查（对齐 parse-zcode-model-io）。
    if (totalLines % LINES_PER_BATCH === 0) {
      await yieldToEventLoop();
      if (now() > deadline) {
        return { status: 'parse_error', messages: [], truncated: false, totalSegments: 0, skippedLines };
      }
    }
  }

  // 坏行占比 >50% → parse_error 回落；恰好 50% 属可用。
  if (totalLines > 0 && skippedLines / totalLines > 0.5) {
    return { status: 'parse_error', messages: [], truncated: false, totalSegments: 0, skippedLines };
  }

  // seq 重编号（1 起全局序）→ beforeSeq 切片 → 段窗口（最近 maxSegments 段）。
  const numbered: NormalizedLogMessage[] = segments.map((segment, index) => ({ seq: index + 1, ...segment }));
  const sliced = beforeSeq !== null ? numbered.filter((m) => m.seq < beforeSeq) : numbered;
  const truncated = sliced.length > maxSegments;
  const messages = truncated ? sliced.slice(sliced.length - maxSegments) : sliced;

  // usage 不落盘（spike-02）：totalUsage 恒 null（前端「未知」兜底，不伪造 0）。
  return { status: 'parsed', messages, truncated, totalSegments: numbered.length, skippedLines, totalUsage: null };
}

// ── 行段产出（真实块形状，spike-02 实证键集）────────────────────────────────

/** user 行 content 块数组 → user_input 段（text 原文 + sender 归一；仅 text 块产出）。 */
function userSegments(content: unknown[]): UnnumberedSegment[] {
  const out: UnnumberedSegment[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const text = block.text;
    if (block.type === 'text' && typeof text === 'string' && text.trim() !== '') {
      const sender: 'human' | 'system_event' = INJECTION_PREFIXES.some((prefix) => text.startsWith(prefix))
        ? 'system_event'
        : 'human';
      out.push(makeSegment('user_input', { text, sender }));
    }
    // 其余块类型（实证 user 行仅 text）防御式跳过。
  }
  return out;
}

/** assistant 行 content 块数组 → reply / tool_use 段。 */
function assistantSegments(content: unknown[]): UnnumberedSegment[] {
  const out: UnnumberedSegment[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const text = block.text;
    if (block.type === 'text' && typeof text === 'string' && text.trim() !== '') {
      out.push(makeSegment('reply', { text }));
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      // tool_use 块不带 id（spike-02：0/4271）→ tool_use_id 恒 null，无法配对也不产
      // tool_result 段（结果不落盘，前端「结果未记录」兜底）。
      out.push(
        makeSegment('tool_use', {
          tool_name: block.name,
          tool_input: summarizeToolInput(block.input),
        }),
      );
    }
    // 其余块类型（实证 assistant 行仅 text/tool_use）防御式跳过。
  }
  return out;
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 构造未编号段：ts 恒 null（本格式不落盘时间戳，按行序即时间序）；未显式给出的
 * 字段一律 null；sender 仅 user_input 段显式携带。
 */
function makeSegment(
  kind: NormalizedLogMessage['kind'],
  fields: Partial<Pick<NormalizedLogMessage, 'text' | 'tool_name' | 'tool_use_id' | 'tool_input' | 'sender'>> = {},
): UnnumberedSegment {
  return {
    kind,
    text: fields.text ?? null,
    tool_name: fields.tool_name ?? null,
    tool_use_id: fields.tool_use_id ?? null,
    tool_input: fields.tool_input ?? null,
    tool_result: null,
    is_error: null,
    ts: null,
    ...(fields.sender !== undefined ? { sender: fields.sender } : {}),
  };
}

/** tool input 摘要：JSON.stringify 后首 2KB 截断（对齐 parse-zcode-model-io）。 */
function summarizeToolInput(input: unknown): string {
  try {
    return (JSON.stringify(input) ?? '').slice(0, TOOL_INPUT_MAX_CHARS);
  } catch {
    return String(input).slice(0, TOOL_INPUT_MAX_CHARS);
  }
}

/** unknown 收窄为 Record（JSON 行/消息/块校验基础）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 让出事件循环一个宏任务周期（行级批处理用）。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
