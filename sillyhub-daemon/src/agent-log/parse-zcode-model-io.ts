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
 * task-02（2026-09-19-tool-report-session-replay / FR-02 + FR-03 + D-003@v1 +
 * D-004@v1）：行顶层 turnId / model / durationMs 与 response.usage 五项 token
 * 附着到该行产出的全部段（G 合并段 + 末行补产段共用同一份——同一次调用多段
 * 共享 usage 是预期，前端按调用去重聚合）；user_input 段正文以 <task-notification>
 * / <system-reminder> 开头 → sender='system_event'（其余缺省视为 'human' 不写，
 * 错标系统事件会隐藏真人输入——代价不对称，R-06 原则）；totalUsage 按「调用」
 * 去重累计（每个有效行的 usage 只计一次）随 parsed 结果返回，零 usage → null。
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

/**
 * 伪用户消息前缀（D-003@v1，2026-09-19 task-02）：user_input 段正文（system-reminder
 * 剥离后）以此开头 → sender='system_event'。task-notification 是后台任务完成通知
 * （无既有剥离常量，纯前缀判定）；system-reminder 是防御分支——成对块已被剥离
 * 不可见，带属性等形状漂移导致漏剥时由前缀兜底。其余段正文缺省不写 sender
 * （消费方视为 'human'）。
 */
const SYSTEM_EVENT_TEXT_PREFIXES: readonly string[] = ['<task-notification>', '<system-reminder>'];

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
  // —— 2026-09-19-tool-report-session-replay 契约扩展：以下五项全部可选，老
  //    daemon / 无数据源缺省（undefined / null，消费方按未知兜底）；字段附着
  //    逻辑归该变更 task-02~05，本模块类型先行钉死共用契约锚点，不提取。
  /**
   * user_input 段发送方：'human' 真人输入 / 'system_event' 系统注入
   * （task-notification、system-reminder 等自动消息）。仅 user_input 段
   * 有意义，其余 kind 不设；缺省视为 'human'。
   */
  sender?: 'human' | 'system_event';
  /** 所属轮次标识（zcode 顶层 turnId / cursor turn_ended 轮号 / claude-code 会话内轮序）。 */
  turn_id?: string | null;
  /** 该次调用的模型标识（如 "GLM-5.3"，zcode modelId）。 */
  model?: string | null;
  /** 该次调用耗时（毫秒，附着到其产出的段）。 */
  duration_ms?: number | null;
  /** 该次调用 token 用量（五项计数，全 number）；无数据源（如 cursor 不落盘）为 null。 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  } | null;
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
  /**
   * 全会话累计 token 用量（四项，D-004@v1）。按「调用」去重——每个有效行的
   * usage 只计一次（同一次调用产出的多段共享同一 usage，不按段重复计）；
   * 仅 status='parsed' 携带（parse_error / too_large 早退零新字段）；
   * 零 usage 数据 → null（不伪造 0，全局硬约束）。
   */
  totalUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  } | null;
}

// ── 内部形状 ─────────────────────────────────────────────────────────────────

/** 行级调用元数据四项取值（usage 剥掉可选层的非空内核——附着路径恒非 undefined）。 */
type CallUsage = NonNullable<NormalizedLogMessage['usage']>;

/**
 * 行级调用元数据（2026-09-19 task-02）：一行 model_io = 一次 API 调用，其顶层
 * turnId / model / durationMs 与 response.usage 五项附着到该行产出的全部段
 * （G 合并段 + 末行 response 补产段共用同一份）。结构校验失败逐项置 null。
 */
interface CallMeta {
  turn_id: string | null;
  model: string | null;
  duration_ms: number | null;
  usage: CallUsage | null;
}

/** 通过结构校验的一行 model_io 记录（坏行在此之前的所有变体都计 skippedLines）。 */
interface ModelIoLine {
  messageOffset: number;
  messages: unknown[];
  response: Record<string, unknown> | null;
  completedAt: string | null;
  meta: CallMeta;
}

/**
 * 全局数组 G 的槽位：消息 + 最后写入该槽的行 completedAt 与调用元数据
 * （后写覆盖取最新——ts 与 meta 同源同行，不漂移）。
 */
interface MergedSlot {
  message: unknown;
  ts: string | null;
  meta: CallMeta;
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

  // totalUsage 累计（D-004@v1）：按「调用」去重——每个有效行（= 一次 API 调用）
  // 的 usage 只计一次；无 usage 行跳过；hasAnyUsage 守卫零数据不伪造 0。
  let totalUsageInput = 0;
  let totalUsageOutput = 0;
  let totalUsageCacheRead = 0;
  let totalUsageCacheWrite = 0;
  let hasAnyUsage = false;

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
    // 行序天然保证后写覆盖取最新（R-06）。行级调用元数据随槽位同写（task-02）。
    for (let j = 0; j < modelIoLine.messages.length; j++) {
      const message = modelIoLine.messages[j];
      if (message === undefined) continue;
      slots[modelIoLine.messageOffset + j] = {
        message,
        ts: modelIoLine.completedAt,
        meta: modelIoLine.meta,
      };
    }
    lastValidLine = modelIoLine;
    // 该行（调用）的 usage 计一次——即使其消息窗口被后续行覆盖，token 已实际
    // 消耗仍计入全会话累计；被覆盖槽位的段元数据取最后写入行的（与 ts 同口径）。
    if (modelIoLine.meta.usage !== null) {
      hasAnyUsage = true;
      totalUsageInput += modelIoLine.meta.usage.inputTokens;
      totalUsageOutput += modelIoLine.meta.usage.outputTokens;
      totalUsageCacheRead += modelIoLine.meta.usage.cacheReadTokens;
      totalUsageCacheWrite += modelIoLine.meta.usage.cacheWriteTokens;
    }

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
      const produced = userSegments(message, slot.ts, slot.meta);
      segments.push(...produced);
    } else if (role === 'assistant') {
      const produced = assistantSegments(message, slot.ts, slot.meta);
      tailReplyTexts = produced.replyTexts;
      tailToolUseIds = produced.toolUseIds;
      segments.push(...produced.segments);
    } else if (role === 'tool') {
      segments.push(...toolSegments(message, slot.ts, slot.meta));
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

  // totalUsage（D-004@v1）：全量「调用」累计（窗口截断 / beforeSeq 切片无关——
  // 与 totalSegments 同为全量口径）；零 usage 数据 → null（不伪造 0，硬约束）。
  const totalUsage = hasAnyUsage
    ? {
        inputTokens: totalUsageInput,
        outputTokens: totalUsageOutput,
        cacheReadTokens: totalUsageCacheRead,
        cacheWriteTokens: totalUsageCacheWrite,
      }
    : null;

  return { status: 'parsed', messages, truncated, totalSegments: numbered.length, skippedLines, totalUsage };
}

// ── 行结构校验 ───────────────────────────────────────────────────────────────

/**
 * 校验并抽取一行 model_io：type=model_io、request 存在、messages 为数组、
 * messageOffset 为非负整数；顶层 turnId / model / durationMs 与 response.usage
 * 随行级调用元数据一并提取（结构校验缺失逐项置 null，task-02 / FR-02 + FR-03）。
 */
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
  const responseRecord = isRecord(response) ? response : null;
  const turnId = parsed.turnId;
  const durationMs = parsed.durationMs;
  const completedAt = parsed.completedAt;
  return {
    messageOffset,
    messages,
    response: responseRecord,
    completedAt: typeof completedAt === 'string' ? completedAt : null,
    meta: {
      turn_id: typeof turnId === 'string' ? turnId : null,
      model: extractModelId(parsed.model),
      duration_ms:
        typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : null,
      usage: extractUsage(responseRecord),
    },
  };
}

/**
 * 模型标识提取：顶层 model 实证为对象（`{"modelId":"GLM-5.3","providerId":…}`）
 * 取 modelId 字符串；字符串形态（老日志）直用；其余形状 null。
 */
function extractModelId(model: unknown): string | null {
  if (typeof model === 'string') return model;
  if (isRecord(model) && typeof model.modelId === 'string') return model.modelId;
  return null;
}

/**
 * response.usage 五项 token 提取（FR-03 / D-004@v1）。
 *
 * 结构校验：response / usage 非 record 或五项全缺 → null（零 usage 数据不伪造）；
 * record 存在但个别项缺失 / 非数按 0 计（部分上报的库形态不整段丢弃——缺项视为
 * 未上报的计数 0，与非数（undefined/NaN/Infinity）同口径）。
 */
function extractUsage(response: Record<string, unknown> | null): CallUsage | null {
  if (response === null) return null;
  const usage = response.usage;
  if (!isRecord(usage)) return null;
  const hasAnyToken = USAGE_TOKEN_KEYS.some((key) => typeof usage[key] === 'number');
  if (!hasAnyToken) return null;
  const token = (key: UsageTokenKey): number => {
    const value = usage[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return {
    inputTokens: token('inputTokens'),
    outputTokens: token('outputTokens'),
    totalTokens: token('totalTokens'),
    cacheReadTokens: token('cacheReadTokens'),
    cacheWriteTokens: token('cacheWriteTokens'),
  };
}

/** usage 五项键名（提取与缺项校验共用一份，防两处漂移）。 */
const USAGE_TOKEN_KEYS = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
] as const;

/** usage 键名联合类型。 */
type UsageTokenKey = (typeof USAGE_TOKEN_KEYS)[number];

// ── 段产出（真实消息形状，design §5.1）───────────────────────────────────────

/**
 * user 消息 → user_input 段（剥 <system-reminder> 块后非空才产出，R-04）。
 * 段正文以系统注入前缀开头 → sender='system_event'（D-003@v1）；其余缺省不写
 * （视为 'human'——错标系统事件会隐藏真人输入，代价不对称）。
 */
function userSegments(
  message: Record<string, unknown>,
  ts: string | null,
  meta: CallMeta,
): UnnumberedSegment[] {
  const content = message.content;
  // 实测 user content 恒为纯字符串；形状漂移防御式跳过（R-01，不产段不中断）。
  if (typeof content !== 'string') return [];
  const stripped = stripSystemReminderBlocks(content);
  if (stripped.trim() === '') return []; // 剥后为空整消息丢弃（R-04：绝不渲染成用户气泡）
  const text = stripped.trim();
  const sender = isSystemEventText(text) ? ('system_event' as const) : undefined;
  return [makeSegment('user_input', ts, meta, { text }, sender)];
}

/** assistant 消息 → thinking / reply / tool_use 段 + 尾部同文比对集。 */
function assistantSegments(
  message: Record<string, unknown>,
  ts: string | null,
  meta: CallMeta,
): { segments: UnnumberedSegment[]; replyTexts: string[]; toolUseIds: string[] } {
  const segments: UnnumberedSegment[] = [];
  const replyTexts: string[] = [];
  const toolUseIds: string[] = [];

  // content 两种真实形状：块数组（text / reasoning 两种块）或字符串（含空串，
  // 纯工具调用轮次的 assistant 消息 content 为 ''）。
  const content = message.content;
  if (typeof content === 'string') {
    if (content.trim() !== '') {
      segments.push(makeSegment('reply', ts, meta, { text: content }));
      replyTexts.push(content);
    }
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        segments.push(makeSegment('reply', ts, meta, { text: block.text }));
        replyTexts.push(block.text);
      } else if (
        block.type === 'reasoning' &&
        typeof block.text === 'string' &&
        block.text.trim() !== ''
      ) {
        segments.push(makeSegment('thinking', ts, meta, { text: block.text }));
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
        makeSegment('tool_use', ts, meta, {
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
function toolSegments(
  message: Record<string, unknown>,
  ts: string | null,
  meta: CallMeta,
): UnnumberedSegment[] {
  const toolCallId = message.toolCallId;
  const toolName = message.toolName;
  const isError = message.isError;
  return [
    makeSegment('tool_result', ts, meta, {
      tool_name: typeof toolName === 'string' ? toolName : null,
      tool_use_id: typeof toolCallId === 'string' ? toolCallId : null,
      tool_result: toolResultText(message.content),
      is_error: typeof isError === 'boolean' ? isError : null,
    }),
  ];
}

/**
 * 末行 response 补尾（text→reply、toolCalls→tool_use），与 G 尾部 assistant 段同文
 * 去重。补产段带末行（= 该次调用）的 turn_id/model/duration_ms/usage（task-02）。
 */
function responseSupplementSegments(
  lastLine: ModelIoLine,
  tailReplyTexts: string[],
  tailToolUseIds: string[],
): UnnumberedSegment[] {
  if (lastLine.response === null) return [];
  const segments: UnnumberedSegment[] = [];

  const text = lastLine.response.text;
  if (typeof text === 'string' && text.trim() !== '' && !tailReplyTexts.includes(text)) {
    segments.push(makeSegment('reply', lastLine.completedAt, lastLine.meta, { text }));
  }

  const toolCalls = lastLine.response.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      if (!isRecord(call) || typeof call.name !== 'string') continue;
      const id = typeof call.id === 'string' ? call.id : null;
      if (id !== null && tailToolUseIds.includes(id)) continue; // 同 id 同文去重
      segments.push(
        makeSegment('tool_use', lastLine.completedAt, lastLine.meta, {
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

/**
 * 构造未编号段：未显式给出的字段一律 null（九字段齐全，snake_case）；行级调用
 * 元数据四项（turn_id/model/duration_ms/usage）随段附着（task-02，老形状行 null）；
 * sender 仅 user_input 系统事件段写（其余缺省不写，视为 'human'）。
 */
function makeSegment(
  kind: NormalizedLogMessageKind,
  ts: string | null,
  meta: CallMeta,
  fields: Partial<
    Pick<
      NormalizedLogMessage,
      'text' | 'tool_name' | 'tool_use_id' | 'tool_input' | 'tool_result' | 'is_error'
    >
  > = {},
  sender?: 'system_event',
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
    ...(sender !== undefined ? { sender } : {}),
    turn_id: meta.turn_id,
    model: meta.model,
    duration_ms: meta.duration_ms,
    usage: meta.usage,
  };
}

/** 段正文是否以系统注入前缀（task-notification / system-reminder）开头（D-003@v1）。 */
function isSystemEventText(text: string): boolean {
  return SYSTEM_EVENT_TEXT_PREFIXES.some((prefix) => text.startsWith(prefix));
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
