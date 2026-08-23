/**
 * `agent-log/parse-zcode-model-io.ts` —— zcode model-io JSONL 解析器（纯函数）。
 *
 * task-01（2026-08-23-agent-log-conversation-view / FR-01 + FR-02）：把 zcode CLI
 * 落盘的 `~/.zcode/cli/rollout/model-io-*.jsonl` 逐行解析为对话流消息
 * （NormalizedLogMessage[]，KB 级），供 task-02 的 host_fs.read_agent_log_messages
 * RPC 与前端对话化渲染消费，替代 256KB 原文尾部直出口径。
 *
 * 格式事实（design §5.1，两份真实日志逐行实证）：
 *   - 每行 `{type:'model_io', request:{messages[], messageOffset, messagesKind, …},
 *     response:{text, toolCalls[], …}, completedAt, …}` 是一次完整 API 请求记录；
 *   - messagesKind 实测 full / delta / tail 三值，但合并规则统一（D-006 裁决一）：
 *     全局数组 G 上 `G[messageOffset + i] = messages[i]` 绝对 offset 对齐覆盖，
 *     代码无 messagesKind 分支；行序后写覆盖取最新（R-06 未实证假设按此处理）；
 *   - 消息形状：user content 纯字符串（可内嵌 <system-reminder> 块）；assistant
 *     content 为块数组（text / reasoning 两种）或空字符串，工具调用在消息级
 *     toolCalls[{id,name,input}]（不是 content 块）；tool 消息级
 *     {toolCallId, toolName, isError, content:纯字符串}；role=system 跳过；
 *   - response 双源裁决（Grill B1.4）：G 为历史权威，每行 response 的输出会出现
 *     在后续行的窗口里，仅末行 response 永远进不了任何窗口 → 补产段
 *     （text→reply、toolCalls→tool_use），补产前与 G 尾部 assistant 段同文去重。
 *
 * 纯函数约束（task-01 constraints）：不读 env / 时钟 / 文件系统——content 字符串
 * 与 20MB 预算、200 段窗口、beforeSeq、超时 deadline、时钟函数全部参数注入
 * （默认值模块常量），fixture 单测零 mock。错误不抛异常，以 status 结构化分层：
 *   - too_large：content 超预算（R-02），前置判定不进入逐行解析；
 *   - parse_error：坏行占比 >50%（R-01）或超时（R-02）；
 *   - parsed：其余（messages 可能为空）。
 *
 * 非目标：'unsupported' 判定是解析器注册表（task-02 registry）的职责；
 * not_found/forbidden 走 host-fs-handler 的 RpcError 通道，本模块不 import
 * RpcError/ws-client（错误只走 status 分层）。
 *
 * @module agent-log/parse-zcode-model-io
 */

// ── 模块常量（默认值，全部可经 options 注入覆盖）──────────────────────────────

/** 内容预算上限：20MB（R-02）。超限直接 too_large，不进入逐行解析。 */
export const DEFAULT_MAX_CONTENT_BYTES = 20 * 1024 * 1024;

/** 段窗口大小：单次下发最近 200 段（FR-05）。 */
export const DEFAULT_MAX_SEGMENTS = 200;

/** 解析超时保护：5s（R-02）。超时 → parse_error 回落。 */
export const DEFAULT_PARSE_TIMEOUT_MS = 5000;

/** 行级批处理粒度：每 500 行 yield 一次事件循环（防 20MB 内大文件长阻塞）。 */
const LINES_PER_BATCH = 500;

/** tool_input 摘要截断：JSON.stringify 后首 2KB（design §7.1）。 */
const TOOL_INPUT_MAX_CHARS = 2048;

/** tool_result 摘要截断：首 4KB（design §7.1）。 */
const TOOL_RESULT_MAX_CHARS = 4096;

/** user content 内成对的 <system-reminder>…</system-reminder> 块（非贪婪全剥）。 */
const SYSTEM_REMINDER_BLOCK_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** 未闭合的 <system-reminder>（CLI 截断等）：从标签起整段丢弃，防内容泄漏（R-04）。 */
const UNCLOSED_SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*$/;

// ── 类型定义（design §7.1，与 backend schema 字段逐字对齐 snake_case）────────

/** 归一化消息段——解析器输出契约（task-01 provides，task-02/前端消费）。 */
export interface NormalizedLogMessage {
  /** 全局段序（1 起编；「加载更早」beforeSeq 切片键；窗口空洞跳过后重编号）。 */
  seq: number;
  kind: 'user_input' | 'reply' | 'thinking' | 'tool_use' | 'tool_result';
  /** user_input / reply / thinking 正文。 */
  text: string | null;
  /** 工具名（tool_use；tool_result 附带所属工具名，展示自包含）。 */
  tool_name: string | null;
  /** tool_use 与 tool_result 配对键（消息级 toolCalls[].id / toolCallId）。 */
  tool_use_id: string | null;
  /** JSON.stringify(input) 摘要（首 2KB 截断）。 */
  tool_input: string | null;
  /** 结果文本摘要（首 4KB 截断）。 */
  tool_result: string | null;
  /** tool_result 专用错误标记。 */
  is_error: boolean | null;
  /** 所属行 completedAt（ISO 字符串；行缺失该字段时为 null）。 */
  ts: string | null;
}

/** 段类型别名。 */
export type NormalizedLogMessageKind = NormalizedLogMessage['kind'];

/** 解析结果 status（'unsupported' 由 task-02 registry 层叠加，非本函数职责）。 */
export type ZcodeModelIoParseStatus = 'parsed' | 'parse_error' | 'too_large';

/** 解析选项：全部参数注入（纯函数不读 env/时钟/文件系统）。 */
export interface ZcodeModelIoParseOptions {
  /** 内容预算上限（字节），默认 20MB。 */
  maxContentBytes?: number;
  /** 段窗口大小，默认 200（FR-05）。 */
  maxSegments?: number;
  /** 「加载更早」切片键：非 null 时按 seq < beforeSeq 过滤后再套窗口。 */
  beforeSeq?: number | null;
  /** 超时保护毫秒数，默认 5s（R-02）。 */
  timeoutMs?: number;
  /** 时钟函数（默认 Date.now），注入以便测试零 mock 地驱动超时。 */
  now?: () => number;
}

/** 解析结果（外层 camelCase 对齐 design §7.1 RPC 返回形状；messages 内层 snake_case）。 */
export interface ZcodeModelIoParseResult {
  status: ZcodeModelIoParseStatus;
  /** 仅 status=parsed 非空。 */
  messages: NormalizedLogMessage[];
  /** 切片（beforeSeq）后段数超窗口 → true，同时截最近 maxSegments 段。 */
  truncated: boolean;
  /** 全量段总数（窗口截断前、beforeSeq 切片前的总数）。 */
  totalSegments: number;
  /** 坏行计数（JSON.parse 失败 / 结构不符；空行不计）。 */
  skippedLines: number;
}

// ── 内部形状 ─────────────────────────────────────────────────────────────────

/** 通过结构校验的一行 model_io 记录（坏行在此之前的所有变体都计 skippedLines）。 */
interface ModelIoLine {
  messageOffset: number;
  messages: unknown[];
  response: Record<string, unknown> | null;
  completedAt: string | null;
}

/** 全局数组 G 的槽位：消息 + 最后写入该槽的行 completedAt（后写覆盖取最新）。 */
interface MergedSlot {
  message: unknown;
  ts: string | null;
}

/** 未编号段（seq 在 G 遍历完成后统一重编号）。 */
type UnnumberedSegment = Omit<NormalizedLogMessage, 'seq'>;

// ── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 解析 zcode model-io JSONL 内容为归一化对话消息（纯函数、异步）。
 *
 * 处理管线：预算前置判定 → 逐行 parse + 结构校验（坏行跳过计数）→ 统一 offset
 * 对齐合并进 G（每 500 行 yield + 超时检查）→ 坏行占比判定 → 遍历 G 产段 +
 * seq 重编号 → 末行 response 补尾去重 → beforeSeq 切片 → 段窗口截断。
 */
export async function parseZcodeModelIoLog(
  content: string,
  options: ZcodeModelIoParseOptions = {},
): Promise<ZcodeModelIoParseResult> {
  const maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  // 20MB 预算前置判定（R-02）：超限直接 too_large，不进入逐行解析。
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

  const slots: Array<MergedSlot | undefined> = [];
  let skippedLines = 0;
  let totalLines = 0;
  let lastValidLine: ModelIoLine | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw === undefined) break;
    const line = raw.trim();
    // 空白行（文件尾换行 / 中段空行）不计坏行、不计占比分母。
    if (line === '') continue;
    totalLines++;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skippedLines++;
      continue;
    }
    const modelIoLine = extractModelIoLine(parsed);
    if (modelIoLine === null) {
      skippedLines++;
      continue;
    }

    // 统一 offset 对齐合并（D-006 裁决一）：full（offset=0 完整前缀）/ delta
    //（offset>0 增量，len=0 合法）/ tail（滑动尾部）三种窗口同一条规则——
    // G[messageOffset + i] = messages[i]，绝对 offset 对齐覆盖，无 kind 分支；
    // 行序天然保证后写覆盖取最新（R-06）。
    for (let j = 0; j < modelIoLine.messages.length; j++) {
      const message = modelIoLine.messages[j];
      if (message === undefined) continue;
      slots[modelIoLine.messageOffset + j] = { message, ts: modelIoLine.completedAt };
    }
    lastValidLine = modelIoLine;

    // 行级批处理：每 500 行 yield + 超时检查（R-02，防 20MB 内大文件阻塞事件循环）。
    if (totalLines % LINES_PER_BATCH === 0) {
      await yieldToEventLoop();
      if (now() > deadline) {
        return { status: 'parse_error', messages: [], truncated: false, totalSegments: 0, skippedLines };
      }
    }
  }

  // 坏行占比 >50% → parse_error 回落（R-01）；恰好 50% 属可用（跳过坏行不中断）。
  if (totalLines > 0 && skippedLines / totalLines > 0.5) {
    return { status: 'parse_error', messages: [], truncated: false, totalSegments: 0, skippedLines };
  }

  // 遍历 G 产段（按 index 升序，跳过空洞 index——窗口未覆盖区，R-03）。
  const segments: UnnumberedSegment[] = [];
  // G 尾部 assistant 段的同文比对集（末行 response 补尾去重用，Grill B1.4）：
  // 始终指向 G 中最后一条 assistant 消息产出的 reply 文本 / tool_use id。
  let tailReplyTexts: string[] = [];
  let tailToolUseIds: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot === undefined) continue; // 窗口空洞
    const message = slot.message;
    if (!isRecord(message)) continue; // 窗口内非 object 条目防御式跳过
    const role = message.role;
    if (role === 'user') {
      const produced = userSegments(message, slot.ts);
      segments.push(...produced);
    } else if (role === 'assistant') {
      const produced = assistantSegments(message, slot.ts);
      tailReplyTexts = produced.replyTexts;
      tailToolUseIds = produced.toolUseIds;
      segments.push(...produced.segments);
    } else if (role === 'tool') {
      segments.push(...toolSegments(message, slot.ts));
    }
    // role=system 与未知 role：跳过不产段（R-04 铁律 / R-01 防御式）。
  }

  // 末行 response 补尾去重：仅最后一个有效行的 response 补产段（G 为历史权威，
  // 中间行 response 会出现在后续行窗口里，不在此补产）。
  if (lastValidLine !== null) {
    segments.push(...responseSupplementSegments(lastValidLine, tailReplyTexts, tailToolUseIds));
  }

  // seq 重编号（1 起全局序；空洞消息跳过后连续）。
  const numbered: NormalizedLogMessage[] = segments.map((segment, index) => ({ seq: index + 1, ...segment }));

  // beforeSeq 切片（R-07 无状态重解析口径）→ 段窗口（最近 maxSegments 段，FR-05）。
  const sliced = beforeSeq !== null ? numbered.filter((m) => m.seq < beforeSeq) : numbered;
  const truncated = sliced.length > maxSegments;
  const messages = truncated ? sliced.slice(sliced.length - maxSegments) : sliced;

  return { status: 'parsed', messages, truncated, totalSegments: numbered.length, skippedLines };
}

// ── 行结构校验 ───────────────────────────────────────────────────────────────

/** 校验并抽取一行 model_io：type=model_io、request 存在、messages 为数组、messageOffset 为非负整数。 */
function extractModelIoLine(parsed: unknown): ModelIoLine | null {
  if (!isRecord(parsed)) return null;
  if (parsed.type !== 'model_io') return null;
  const request = parsed.request;
  if (!isRecord(request)) return null;
  const messages = request.messages;
  if (!Array.isArray(messages)) return null;
  const messageOffset = request.messageOffset;
  if (
    typeof messageOffset !== 'number' ||
    !Number.isInteger(messageOffset) ||
    messageOffset < 0
  ) {
    return null;
  }
  const response = parsed.response;
  const completedAt = parsed.completedAt;
  return {
    messageOffset,
    messages,
    response: isRecord(response) ? response : null,
    completedAt: typeof completedAt === 'string' ? completedAt : null,
  };
}

// ── 段产出（真实消息形状，design §5.1）───────────────────────────────────────

/** user 消息 → user_input 段（剥 <system-reminder> 块后非空才产出，R-04）。 */
function userSegments(message: Record<string, unknown>, ts: string | null): UnnumberedSegment[] {
  const content = message.content;
  // 实测 user content 恒为纯字符串；形状漂移防御式跳过（R-01，不产段不中断）。
  if (typeof content !== 'string') return [];
  const stripped = stripSystemReminderBlocks(content);
  if (stripped.trim() === '') return []; // 剥后为空整消息丢弃（R-04：绝不渲染成用户气泡）
  return [makeSegment('user_input', ts, { text: stripped.trim() })];
}

/** assistant 消息 → thinking / reply / tool_use 段 + 尾部同文比对集。 */
function assistantSegments(
  message: Record<string, unknown>,
  ts: string | null,
): { segments: UnnumberedSegment[]; replyTexts: string[]; toolUseIds: string[] } {
  const segments: UnnumberedSegment[] = [];
  const replyTexts: string[] = [];
  const toolUseIds: string[] = [];

  // content 两种真实形状：块数组（text / reasoning 两种块）或字符串（含空串，
  // 纯工具调用轮次的 assistant 消息 content 为 ''）。
  const content = message.content;
  if (typeof content === 'string') {
    if (content.trim() !== '') {
      segments.push(makeSegment('reply', ts, { text: content }));
      replyTexts.push(content);
    }
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        segments.push(makeSegment('reply', ts, { text: block.text }));
        replyTexts.push(block.text);
      } else if (
        block.type === 'reasoning' &&
        typeof block.text === 'string' &&
        block.text.trim() !== ''
      ) {
        segments.push(makeSegment('thinking', ts, { text: block.text }));
      }
      // 未知块类型防御式跳过（R-01）。
    }
  }

  // 工具调用在消息级 toolCalls[{id,name,input}]（不是 content 块，§5.1 实证）。
  const toolCalls = message.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      if (!isRecord(call) || typeof call.name !== 'string') continue;
      const id = typeof call.id === 'string' ? call.id : null;
      segments.push(
        makeSegment('tool_use', ts, {
          tool_name: call.name,
          tool_use_id: id,
          tool_input: summarizeToolInput(call.input),
        }),
      );
      if (id !== null) toolUseIds.push(id);
    }
  }

  return { segments, replyTexts, toolUseIds };
}

/** tool 消息 → tool_result 段（消息级 toolCallId/toolName/isError/content 键集）。 */
function toolSegments(message: Record<string, unknown>, ts: string | null): UnnumberedSegment[] {
  const toolCallId = message.toolCallId;
  const toolName = message.toolName;
  const isError = message.isError;
  return [
    makeSegment('tool_result', ts, {
      tool_name: typeof toolName === 'string' ? toolName : null,
      tool_use_id: typeof toolCallId === 'string' ? toolCallId : null,
      tool_result: toolResultText(message.content),
      is_error: typeof isError === 'boolean' ? isError : null,
    }),
  ];
}

/** 末行 response 补尾（text→reply、toolCalls→tool_use），与 G 尾部 assistant 段同文去重。 */
function responseSupplementSegments(
  lastLine: ModelIoLine,
  tailReplyTexts: string[],
  tailToolUseIds: string[],
): UnnumberedSegment[] {
  if (lastLine.response === null) return [];
  const segments: UnnumberedSegment[] = [];

  const text = lastLine.response.text;
  if (typeof text === 'string' && text.trim() !== '' && !tailReplyTexts.includes(text)) {
    segments.push(makeSegment('reply', lastLine.completedAt, { text }));
  }

  const toolCalls = lastLine.response.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      if (!isRecord(call) || typeof call.name !== 'string') continue;
      const id = typeof call.id === 'string' ? call.id : null;
      if (id !== null && tailToolUseIds.includes(id)) continue; // 同 id 同文去重
      segments.push(
        makeSegment('tool_use', lastLine.completedAt, {
          tool_name: call.name,
          tool_use_id: id,
          tool_input: summarizeToolInput(call.input),
        }),
      );
    }
  }

  return segments;
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/** 构造未编号段：未显式给出的字段一律 null（九字段齐全，snake_case）。 */
function makeSegment(
  kind: NormalizedLogMessageKind,
  ts: string | null,
  fields: Partial<
    Pick<
      NormalizedLogMessage,
      'text' | 'tool_name' | 'tool_use_id' | 'tool_input' | 'tool_result' | 'is_error'
    >
  > = {},
): UnnumberedSegment {
  return {
    kind,
    text: fields.text ?? null,
    tool_name: fields.tool_name ?? null,
    tool_use_id: fields.tool_use_id ?? null,
    tool_input: fields.tool_input ?? null,
    tool_result: fields.tool_result ?? null,
    is_error: fields.is_error ?? null,
    ts,
  };
}

/** 剥离 user content 内全部 <system-reminder> 块；未闭合标签从标签起整段丢弃（R-04）。 */
function stripSystemReminderBlocks(content: string): string {
  return content.replace(SYSTEM_REMINDER_BLOCK_RE, '').replace(UNCLOSED_SYSTEM_REMINDER_RE, '');
}

/** tool input 摘要：JSON.stringify 后首 2KB 截断（design §7.1）。 */
function summarizeToolInput(input: unknown): string {
  try {
    return (JSON.stringify(input) ?? '').slice(0, TOOL_INPUT_MAX_CHARS);
  } catch {
    // 循环引用等异常形状兜底（JSONL 来源理论上不会出现，防御式不抛）。
    return String(input).slice(0, TOOL_INPUT_MAX_CHARS);
  }
}

/** tool result 摘要：字符串 content 首 4KB 截断；非字符串形状（漂移）JSON 序列化兜底。 */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, TOOL_RESULT_MAX_CHARS);
  if (content === null || content === undefined) return '';
  try {
    return (JSON.stringify(content) ?? '').slice(0, TOOL_RESULT_MAX_CHARS);
  } catch {
    return String(content).slice(0, TOOL_RESULT_MAX_CHARS);
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
