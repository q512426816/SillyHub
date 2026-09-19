/**
 * `agent-log/parse-claude-code-jsonl.ts` —— claude-code 会话 JSONL 解析器（纯函数）。
 *
 * task-04（2026-09-19-tool-report-session-replay / FR-02 + FR-03 + D-003@v1 +
 * D-005@v1 + D-006@v1）：把 claude-code CLI 落盘的 `~/.claude/projects/<proj>/
 * <session>.jsonl` 逐行解析为对话流消息（NormalizedLogMessage[]）。该 format 现状
 * 走 unsupported 回落原文（D-006），本解析器补齐后由 task-06 注册进 registry——
 * **format 串注册键（task-06 对齐）：`claude-code-jsonl`**。
 *
 * 行格式（2026-09-19 本机真实会话实证，5 份 / 1795 assistant 行 / 982 tool_result 块）：
 *   - 行 type 全集：user / assistant / system / mode / attachment / last-prompt /
 *     queue-operation / file-history-snapshot / ai-title …；只处理 user / assistant，
 *     其余非对话行零段产出、计入 skippedLines（观测口径）但**不计坏行占比**；
 *   - user / assistant 行：`{type, message:{role, content, usage?}, isMeta?,
 *     timestamp, parentUuid, cwd, sessionId, version, …}`；行级 timestamp 即 ts；
 *   - assistant message.content 块数组：thinking（正文在 `thinking` 键，非 text）/
 *     text / tool_use（块键 {type,id,name,input}）；message.usage 字段名
 *     input_tokens / output_tokens / cache_read_input_tokens /
 *     cache_creation_input_tokens（实证 1419/1795 行非零；input=output=0 行不附着）；
 *   - user message.content：纯字符串（真人输入与 isMeta 注入）或块数组；数组行
 *     绝大多数为纯 tool_result 载体（块键 {tool_use_id,type,content,is_error}，
 *     content 为字符串 949 / text 块数组 33），少数为 text 块（isMeta 注入）。
 *
 * 归一化规则（design Phase 1.3 + D-003@v1）：
 *   - user 纯 tool_result 块 → tool_result 段（按 tool_use_id 与**前置** assistant
 *     tool_use 配对解析 tool_name 展示自包含；失配孤儿段照产保留 id）；不产
 *     user_input；mixed（text + tool_result 同行，未实证）两类段都产；
 *   - user 字符串 / text 块 → user_input 段（text 原文）；isMeta=true 或文本以注入
 *     前缀开头（【当前用户信息】、<command-name>、Caveat: ——R-06 白名单）→
 *     sender='system_event'；其余缺省 'human'（漏网保守归 human：错标系统事件会
 *     隐藏真人输入，代价不对称；实证 isMeta 字符串另有 <local-command-stdout>
 *     形态，观察到的样本均带 isMeta=true，已被 isMeta 覆盖不入白名单）；
 *   - assistant message.usage 五项映射（snake_case 四项 → camelCase +
 *     totalTokens=输入+输出）附着到该行**全部**段（usage 与段共享同调用）；
 *   - turn_id：会话文件级轮序——每条真人 user_input（sender 非 system_event）自增
 *     轮号，附着该行及其后各段直至下一条真人输入（D-005：claude-code 按真人 user
 *     切轮；首条真人输入前的段归 '0' 轮）；
 *   - totalUsage：全会话累计四项——同调用多段共享同一 usage，**按行（调用）去重
 *     求和**（直接按段求和会重复计数），无 usage / 0-0 行不计。
 *
 * 纯函数约束（对齐 parse-zcode-model-io.ts）：不读 env / 时钟 / 文件系统——content
 * 与 20MB 预算、200 段窗口、beforeSeq、超时 deadline、时钟函数全部参数注入（预算/
 * 窗口/超时常量复用 parse-zcode-model-io 导出值，口径单源）。错误不抛异常，status
 * 结构化分层：too_large（超预算，前置判定不进逐行解析）/ parse_error（坏行占比
 * >50% 或超时；坏行 = JSON 解析失败或 user/assistant 行结构不符，非对话行不计占比）
 * / parsed（messages 可能为空）。'unsupported' 判定归 registry 层（task-06）。
 *
 * @module agent-log/parse-claude-code-jsonl
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

/** tool_result 摘要截断：首 4KB（对齐 parse-zcode-model-io）。 */
const TOOL_RESULT_MAX_CHARS = 4096;

/**
 * R-06 注入前缀白名单：文本以任一前缀开头 → sender='system_event'。
 * 白名单外未识别注入保守归 human（错标系统事件会隐藏真人输入，代价不对称）。
 */
const INJECTION_PREFIXES: readonly string[] = ['【当前用户信息】', '<command-name>', 'Caveat:'];

// ── 类型定义 ─────────────────────────────────────────────────────────────────

/** 解析选项：全部参数注入（纯函数不读 env/时钟/文件系统）。 */
export interface ClaudeCodeJsonlParseOptions {
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

/** totalUsage 四项累计器（按行去重后的调用级求和）。 */
interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** 未编号段（seq 在全量段产出后统一重编号）。 */
type UnnumberedSegment = Omit<NormalizedLogMessage, 'seq'>;

// ── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 解析 claude-code 会话 JSONL 内容为归一化对话消息（纯函数、异步）。
 *
 * 处理管线：预算前置判定 → 逐行 parse + 行分类（非对话行跳过计数 / user / assistant，
 * 每 500 行 yield + 超时检查）→ 坏行占比判定 → turn_id 轮序附着 + usage 透传与
 * 调用级累计 + tool_use_id→tool_name 配对表 → seq 重编号 → beforeSeq 切片 →
 * 段窗口截断。
 */
export async function parseClaudeCodeJsonlLog(
  content: string,
  options: ClaudeCodeJsonlParseOptions = {},
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
  // tool_use_id → tool_name 配对表（tool_result 载体行反查工具名，展示自包含）。
  const toolNamesById = new Map<string, string>();
  const totals: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let skippedLines = 0; // 坏行 + 非对话行（上报观测口径）
  let badLines = 0; // 坏行（仅此项参与 >50% parse_error 判定）
  let totalLines = 0;
  let turnCounter = 0; // 真人 user_input 自增轮号（0 = 首条真人输入前）

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
      badLines++;
      skippedLines++;
      continue;
    }
    if (!isRecord(parsed)) {
      badLines++;
      skippedLines++;
      continue;
    }
    const ts = typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
    const dialogType = parsed.type === 'user' || parsed.type === 'assistant' ? parsed.type : null;

    if (dialogType === null) {
      // 非对话行（mode/system/attachment/last-prompt/queue-operation/file-history-
      // snapshot/ai-title…）：零段产出，计入 skippedLines 观测但不计坏行占比
      // （快照类行可占大头的真实文件不能误判 parse_error）。
      skippedLines++;
    } else if (!isRecord(parsed.message)) {
      badLines++; // user/assistant 行缺 message 对象 → 结构不符
      skippedLines++;
    } else {
      const message = parsed.message;
      if (dialogType === 'assistant') {
        const produced = assistantSegments(message, ts);
        if (produced === null) {
          badLines++; // content 既非字符串也非数组
          skippedLines++;
        } else {
          const usage = extractUsage(message);
          if (usage !== null) {
            totals.inputTokens += usage.inputTokens;
            totals.outputTokens += usage.outputTokens;
            totals.cacheReadTokens += usage.cacheReadTokens;
            totals.cacheWriteTokens += usage.cacheWriteTokens;
          }
          const turnId = String(turnCounter);
          for (const segment of produced) {
            // usage 附着到该行全部段（同调用多段共享，不重复计数靠 totals 行级累加）。
            segments.push({ ...segment, turn_id: turnId, ...(usage !== null ? { usage } : {}) });
            if (segment.kind === 'tool_use' && segment.tool_use_id !== null && segment.tool_name !== null) {
              toolNamesById.set(segment.tool_use_id, segment.tool_name);
            }
          }
        }
      } else {
        const produced = userSegments(message, ts, parsed.isMeta === true, toolNamesById);
        if (produced === null) {
          badLines++; // content 既非字符串也非数组
          skippedLines++;
        } else {
          // 真人 user_input 自增轮号（D-005：按真人 user 切轮，system_event 不切）。
          const isHumanTurn =
            produced.some((s) => s.kind === 'user_input' && s.sender !== 'system_event');
          if (isHumanTurn) turnCounter++;
          const turnId = String(turnCounter);
          for (const segment of produced) segments.push({ ...segment, turn_id: turnId });
        }
      }
    }

    // 行级批处理：每 500 行 yield + 超时检查（对齐 parse-zcode-model-io）。
    if (totalLines % LINES_PER_BATCH === 0) {
      await yieldToEventLoop();
      if (now() > deadline) {
        return { status: 'parse_error', messages: [], truncated: false, totalSegments: 0, skippedLines };
      }
    }
  }

  // 坏行占比 >50% → parse_error 回落；恰好 50% 属可用。非对话行不进此判定。
  if (totalLines > 0 && badLines / totalLines > 0.5) {
    return { status: 'parse_error', messages: [], truncated: false, totalSegments: 0, skippedLines };
  }

  // seq 重编号（1 起全局序）→ beforeSeq 切片 → 段窗口（最近 maxSegments 段）。
  const numbered: NormalizedLogMessage[] = segments.map((segment, index) => ({ seq: index + 1, ...segment }));
  const sliced = beforeSeq !== null ? numbered.filter((m) => m.seq < beforeSeq) : numbered;
  const truncated = sliced.length > maxSegments;
  const messages = truncated ? sliced.slice(sliced.length - maxSegments) : sliced;

  return {
    status: 'parsed',
    messages,
    truncated,
    totalSegments: numbered.length,
    skippedLines,
    totalUsage: { ...totals },
  };
}

// ── 行段产出（真实块形状，实证键集）─────────────────────────────────────────

/**
 * assistant 行 → thinking / reply / tool_use 段。
 * @returns null = content 形状不符（坏行）；空数组 = 合法空行（如空 content）。
 */
function assistantSegments(message: Record<string, unknown>, ts: string | null): UnnumberedSegment[] | null {
  const content = message.content;
  // 实测 assistant content 恒为块数组；字符串形状防御式兼容（非空产 reply）。
  if (typeof content === 'string') {
    return content.trim() === '' ? [] : [makeSegment('reply', ts, { text: content })];
  }
  if (!Array.isArray(content)) return null;

  const out: UnnumberedSegment[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    // thinking 块正文在 `thinking` 键（实证块键 {type,thinking,signature}）。
    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim() !== '') {
      out.push(makeSegment('thinking', ts, { text: block.thinking }));
    } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      out.push(makeSegment('reply', ts, { text: block.text }));
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      out.push(
        makeSegment('tool_use', ts, {
          tool_name: block.name,
          tool_use_id: typeof block.id === 'string' ? block.id : null,
          tool_input: summarizeToolInput(block.input),
        }),
      );
    }
    // 未知块类型防御式跳过（实证全集 thinking/text/tool_use）。
  }
  return out;
}

/**
 * user 行 → user_input / tool_result 段。
 * - 纯字符串 / 含 text 块 → user_input（text 原文 + sender 归一）；
 * - tool_result 块 → tool_result 段（配对表反查 tool_name，失配孤儿保留 id）。
 * @returns null = content 形状不符（坏行）；空数组 = 合法空行。
 */
function userSegments(
  message: Record<string, unknown>,
  ts: string | null,
  isMeta: boolean,
  toolNamesById: Map<string, string>,
): UnnumberedSegment[] | null {
  const content = message.content;
  if (typeof content === 'string') {
    if (content.trim() === '') return [];
    return [makeSegment('user_input', ts, { text: content, sender: userSender(content, isMeta) })];
  }
  if (!Array.isArray(content)) return null;

  const out: UnnumberedSegment[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'tool_result') {
      const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
      out.push(
        makeSegment('tool_result', ts, {
          tool_name: toolUseId !== null ? (toolNamesById.get(toolUseId) ?? null) : null,
          tool_use_id: toolUseId,
          tool_result: toolResultText(block.content),
          is_error: typeof block.is_error === 'boolean' ? block.is_error : null,
        }),
      );
    } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      out.push(makeSegment('user_input', ts, { text: block.text, sender: userSender(block.text, isMeta) }));
    }
    // 其余块类型（实证 user 行仅 tool_result/text 两种）防御式跳过。
  }
  return out;
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/** sender 归一：isMeta 或 R-06 白名单前缀 → system_event；其余保守归 human。 */
function userSender(text: string, isMeta: boolean): 'human' | 'system_event' {
  if (isMeta) return 'system_event';
  if (INJECTION_PREFIXES.some((prefix) => text.startsWith(prefix))) return 'system_event';
  return 'human';
}

/**
 * 抽取 assistant message.usage 并五项映射（snake_case → camelCase +
 * totalTokens=输入+输出）；无 usage 对象或 input=output=0（实证 376/1795 行）返回
 * null —— 不附着（前端按未知兜底）。
 */
function extractUsage(message: Record<string, unknown>): NonNullable<NormalizedLogMessage['usage']> | null {
  const usage = message.usage;
  if (!isRecord(usage)) return null;
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
  if (input === 0 && output === 0) return null;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    cacheReadTokens: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0,
    cacheWriteTokens: typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0,
  };
}

/** 构造未编号段：未显式给出的字段一律 null；sender 仅 user_input 段显式携带。 */
function makeSegment(
  kind: NormalizedLogMessage['kind'],
  ts: string | null,
  fields: Partial<
    Pick<
      NormalizedLogMessage,
      'text' | 'tool_name' | 'tool_use_id' | 'tool_input' | 'tool_result' | 'is_error' | 'sender'
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

/**
 * tool_result 摘要：字符串首 4KB；text 块数组按序拼接 text 字段（实证 33/982 行
 * 此形态）；其余形状 JSON 序列化兜底；首 4KB 截断。
 */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, TOOL_RESULT_MAX_CHARS);
  if (Array.isArray(content)) {
    return content
      .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
      .join('')
      .slice(0, TOOL_RESULT_MAX_CHARS);
  }
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
