import type { AgentRunLogEntry } from "@/lib/agent";
import { asString } from "@/lib/utils";
import type { ProcessedLog, ScanCheckResult, SemanticCategory, ToolCallEntry } from "./types";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const COMMAND_COLLAPSE_LINES = 5;
export const COMMAND_COLLAPSE_CHARS = 500;
export const EMPTY_REPLIED_INPUTS = new Set<string>();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function stringifyToolArgs(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function parseToolCallContent(raw: string | null | undefined): ToolCallEntry | null {
  // ql-20260616-002 / ql-20260620：上游 content_redacted 可为 null 或偶发非字符串类型，
  // 入口用 asString 归一化（null/undefined→""，number/object→String），避免下游 split 抛错。
  const safe = asString(raw);
  if (!safe) return null;
  try {
    const obj = JSON.parse(safe);
    const args = obj.args ?? obj.arguments ?? "";
    const toolName = obj.tool ?? obj.name ?? "unknown";
    // task-14 / FR-09：提取 tool_use_id（task-13 emit 的 snake_case 字段）。
    // 兼容 camelCase toolUseId（防御性，当前 daemon 用 snake_case）。
    const rawToolUseId = obj.tool_use_id ?? obj.toolUseId ?? obj.id;
    const toolUseId = typeof rawToolUseId === "string" && rawToolUseId ? rawToolUseId : undefined;
    return {
      timestamp: obj.timestamp ?? "",
      tool: toolName,
      args: stringifyToolArgs(args),
      status: obj.requires_approval ? "pending" : "allowed",
      success: obj.success !== false,
      description: typeof args === "object" && args !== null ? args.description : undefined,
      command: typeof args === "object" && args !== null ? args.command : undefined,
      rawArgs: args,
      toolUseId,
    };
  } catch {
    return null;
  }
}

export function parseScanCheckOutput(text: string): ScanCheckResult | null {
  const scanDocsMatch =
    text.match(/Scan\s*文档\s*\((\d+\/\d+)\)/i) ||
    text.match(/(\d+)\s*份\s*scan\s*文档/i);
  const moduleMatch =
    text.match(/(\d+)\s*个\s*模块/i) ||
    text.match(/(\d+)个模块/i);
  const flowMatch =
    text.match(/(\d+)\s*份\s*业务流程/i) ||
    text.match(/(\d+)\s*个\s*流程/i);
  const glossaryOk =
    /glossary\.md\s*\(.*?\)\s*✅/i.test(text) ||
    /术语表.*?✅/i.test(text) ||
    /glossary\.md\s*\(/i.test(text);
  const totalMatch =
    text.match(/(\d+)\s*份模块卡片/i) ||
    text.match(/总文件数[:\s]*(\d+)/i);
  const passed =
    (/全部通过|✅.*?通过|self\.check.*?pass/i.test(text) || /扫描完整性验证通过/i.test(text))
    && !/❌/.test(text.split("自检结果")[1] ?? text);

  if (!scanDocsMatch && !moduleMatch) return null;
  return {
    scanDocs: scanDocsMatch?.[1] ?? "?",
    moduleCount: moduleMatch?.[1] ?? "?",
    flowCount: flowMatch?.[1] ?? "0",
    glossary: glossaryOk,
    totalFiles: totalMatch?.[1] ?? "?",
    passed,
  };
}

export function isPendingReplied(
  logTimestamp: string,
  allLogs: AgentRunLogEntry[],
): boolean {
  return allLogs.some(
    (l) =>
      l.channel === "user_input" &&
      l.timestamp >= logTimestamp,
  );
}

/* ------------------------------------------------------------------ */
/*  Stdout [TOOL_USE] text-protocol parser                             */
/* ------------------------------------------------------------------ */

/**
 * Parse a stdout [TOOL_USE] line into a ToolCallEntry.
 * Format: [TOOL_USE] ToolName: {json} or [TOOL_USE] ToolName {json}
 */
function parseStdoutToolUse(content: string, logTimestamp: string): ToolCallEntry | null {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^\[TOOL_USE\]\s+(\w+)\s*[:]?\s*(.*)/);
    if (!match) return null; // first non-empty line must be TOOL_USE

    const toolName = match[1] ?? "unknown";
    const payload = (match[2] ?? "").trim();

    if (!payload) {
      return {
        timestamp: logTimestamp,
        tool: toolName,
        args: "",
        status: "allowed",
        success: true,
        rawArgs: {},
      };
    }

    try {
      const rawArgs = JSON.parse(payload);
      return {
        timestamp: logTimestamp,
        tool: toolName,
        args: stringifyToolArgs(rawArgs),
        status: "allowed",
        success: true,
        description: typeof rawArgs === "object" && rawArgs !== null ? rawArgs.description : undefined,
        command: typeof rawArgs === "object" && rawArgs !== null ? rawArgs.command : undefined,
        rawArgs,
      };
    } catch {
      return {
        timestamp: logTimestamp,
        tool: toolName,
        args: payload,
        status: "allowed",
        success: true,
        rawArgs: payload,
      };
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  TOOL_RESULT body extraction                                        */
/* ------------------------------------------------------------------ */

/** Extract full body from content containing [TOOL_RESULT] lines */
function extractToolResultBody(content: string): string {
  const lines = content.split("\n");
  const bodyLines: string[] = [];
  let started = false;

  for (const line of lines) {
    const toolResultMatch = line.match(/^\s*\[TOOL_RESULT\]\s*(.*)/);
    if (toolResultMatch && !started) {
      started = true;
      if (toolResultMatch[1]?.trim()) bodyLines.push(toolResultMatch[1]);
      continue;
    }

    if (started) {
      // Stop at other protocol prefixes
      if (/^\s*\[(TOOL_USE|THINKING|SYSTEM|ASSISTANT)\]/.test(line)) break;
      bodyLines.push(line);
    }
  }

  return bodyLines.join("\n").trim();
}

/** ql-20260622-003 / P1-2：两 log 时间戳毫秒差（end−start，负数归 0）。无效/缺失返回 undefined。 */
function diffLogMs(startLog: AgentRunLogEntry, endLog: AgentRunLogEntry): number | undefined {
  const startIso = startLog.timestamp;
  const endIso = endLog.timestamp;
  if (!startIso || !endIso) return undefined;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return Math.max(0, end - start);
}

/**
 * 合并 [TOOL_RESULT] body 到 tool 卡片，并预算 toolDurationMs。
 *
 * ql-20260622-003 / P1-2：耗时计算从 render 期（AgentLogRow.computeToolDurationMs 回查
 * allLogs，N×M）迁移至此。tool_use_id / tool 名 + 窗口配对已由主循环完成，sourceLog 是
 * 被合并的 result stdout log。守卫：
 * - sourceLog 非自身（[TOOL_USE]+[TOOL_RESULT] 同条 stdout 自合并保持 undefined，
 *   与原「找后续 result」行为一致）
 * - 首次设置（同卡多 result 取首条，对齐原「首条 result」语义）
 * - 仅 tool 卡片（channel=tool_call 或 parsedStdoutTool）
 */
function mergeToolResult(target: ProcessedLog, body: string, sourceLog?: AgentRunLogEntry) {
  if (!body) return;
  if (target.mergedToolResult) {
    target.mergedToolResult += "\n" + body;
  } else {
    target.mergedToolResult = body;
  }
  if (
    sourceLog &&
    sourceLog !== target.log &&
    target.toolDurationMs === undefined &&
    (target.log.channel === "tool_call" || target.parsedStdoutTool != null)
  ) {
    const duration = diffLogMs(target.log, sourceLog);
    if (duration !== undefined) target.toolDurationMs = duration;
  }
}

/**
 * ql-20260617-011 / ql-20260617-013：从 `[THINKING] <chunk>` 中提取 chunk 原文。
 *
 * daemon thinking_delta 节流后（ql-20260617-012），单条 stdout 的 chunk 可含
 * 换行（80 字符累积 / 120ms 时间窗口内的多个 delta 拼成）。
 * 去掉首行 `[THINKING] ` 前缀，返回剩余全部内容（含换行），让前端 normalize
 * 多条 chunk 拼接成完整段落。
 */
function extractThinkingText(content: string): string {
  // 用 [\s\S]* 匹配整段（含 \n），不只匹配首行。
  const match = content.match(/^\s*\[THINKING\]\s?([\s\S]*)$/);
  return match ? (match[1] ?? "") : "";
}

function extractAssistantText(content: string): string {
  const match = content.match(/^\s*\[ASSISTANT\]\s?([\s\S]*)$/);
  return match ? (match[1] ?? "") : "";
}

/** 合并流式 assistant 片段（支持 delta 追加、cumulative 全文去重、段落去重）。 */
export function mergeAssistantPiece(prev: string, piece: string): string {
  if (!prev) return piece;
  if (!piece) return prev;
  if (piece === prev) return prev;
  if (piece.startsWith(prev)) return piece;
  if (prev.startsWith(piece)) return prev;
  // 重复段落（partial 累积全文重发时常见）
  const pieceTrim = piece.trim();
  if (pieceTrim.length >= 8) {
    if (prev.includes(piece)) return prev;
    if (prev.split("\n").some((line) => line.trim() === pieceTrim)) return prev;
  }
  if (prev.trim().length >= 8 && piece.includes(prev)) return piece;
  const norm = (s: string) => s.replace(/\s+/g, "");
  const pieceNorm = norm(piece);
  const prevNorm = norm(prev);
  if (pieceNorm && prevNorm && (pieceNorm.startsWith(prevNorm) || prevNorm.startsWith(pieceNorm))) {
    return piece.length >= prev.length ? piece : prev;
  }
  // 完整句子/段落用换行分隔；短 token delta 直接拼接（cursor partial 已关闭，codex 仍可能走此路径）
  const looksLikeParagraph = (s: string) => {
    const t = s.trim();
    return t.length >= 24 || /[。！？.!?]\s*$/.test(t);
  };
  if (looksLikeParagraph(prev) && looksLikeParagraph(piece)) {
    const joiner = prev.endsWith("\n") ? "" : "\n";
    return prev + joiner + piece;
  }
  return prev + piece;
}

/**
 * task-14 / D1-D2 / FR-09：合并流式 thinking 片段。
 *
 * 场景（design.md §5.3 根因）：thinking 有两条独立 emit 路径。
 * - 路径 A（partial 增量）：daemon thinking_delta 节流切片 flush，每条 `[THINKING] <chunk>`。
 * - 路径 B（完整累积）：完整 assistant message 到达，backend `_extract_sdk_messages`
 *   展开全文 `[THINKING]`。路径 B 到达时，路径 A 的 partial 已 flush，导致同一 segment
 *   内容双份显示（partial 累积 + 完整段重发）。
 *
 * 归并规则（参照 mergeAssistantPiece:208-237，对 thinking 做同样防御）：
 * 1. piece === prev → 返回 prev（完全相同去重）
 * 2. piece.startsWith(prev) 且 piece 明显更长（完整段重发，D2 场景）→ 返回 piece。
 *    "明显更长"判定：piece 长度 > prev 长度，且 piece 含换行或去空白后多出 ≥ 8 字符，
 *    避免把短 delta（如 "实质" vs "实质2"）误判为前缀包含去重。
 * 3. prev.startsWith(piece) 且 prev 明显更长 → 返回 prev（对称场景）
 * 4. 其余按原序拼接（保留现有 delta 累积行为，ql-20260617-011）
 *
 * 与 mergeAssistantPiece 的差异：thinking delta 多为短 token 直接拼接（无换行分隔），
 * 短片段的 startsWith 是常见误判源（如 "实质" 是 "实质2" 的前缀但两者是独立 delta），
 * 故加"明显更长"阈值；只在真正完整段重发时去重。
 */
export function mergeThinkingPiece(prev: string, piece: string): string {
  if (!prev) return piece;
  if (!piece) return prev;
  if (piece === prev) return prev;
  // "明显更长"判定：piece 比 prev 长，且额外内容含换行或去空白后多出 ≥ 8 字符。
  // 短 delta（"实质" vs "实质2"差 1 字符）不触发，保留直接拼接。
  const looksLikeFullSegment = (longer: string, shorter: string): boolean => {
    if (longer.length <= shorter.length) return false;
    const norm = (s: string) => s.replace(/\s+/g, "");
    const longerNorm = norm(longer);
    const shorterNorm = norm(shorter);
    const extra = longerNorm.length - shorterNorm.length;
    if (extra >= 8) return true; // 明显更长（完整段覆盖多 partial）
    return longer.includes("\n") && extra >= 2; // 含换行 + 至少多 2 字符
  };
  if (piece.startsWith(prev) && looksLikeFullSegment(piece, prev)) return piece;
  if (prev.startsWith(piece) && looksLikeFullSegment(prev, piece)) return prev;
  // 增量 delta（无前缀关系或短片段）按原序直接拼接，还原 SSE 累积效果
  return prev + piece;
}

/* ------------------------------------------------------------------ */
/*  Run error detail (task-08 / FR-03 / D-002@v1)                      */
/* ------------------------------------------------------------------ */

/**
 * task-08 / FR-03：模型调用错误类型枚举（前端形态；三端同构 ModelError 协议
 * design §7.1）。从 run.error_detail.type 映射；非法/缺失 → "unknown"（兜底）。
 */
export type ModelErrorType =
  | "auth_failed"
  | "quota_exceeded"
  | "rate_limited"
  | "timeout"
  | "model_not_found"
  | "network"
  | "provider_error"
  | "unknown";

/**
 * task-08 / FR-03 / D-002@v1：运行错误日志项的结构化载荷（provides contract）。
 * task-09 RunErrorItem 据此渲染图标 / 文案 / hint / actions。
 */
export interface ErrorLogItem {
  type: ModelErrorType;
  code: string | null;
  message: string;
  retryable: boolean;
  hint: string | null;
  raw: string | null;
}

const MODEL_ERROR_TYPES: ReadonlySet<ModelErrorType> = new Set<ModelErrorType>([
  "auth_failed",
  "quota_exceeded",
  "rate_limited",
  "timeout",
  "model_not_found",
  "network",
  "provider_error",
  "unknown",
]);

function isModelErrorType(value: unknown): value is ModelErrorType {
  return typeof value === "string" && (MODEL_ERROR_TYPES as Set<string>).has(value);
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringOrDefault(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  return fallback;
}

/**
 * task-08：从 run.error_detail（task-07 透传的 OpenAPI 宽松字典
 * `{ [key: string]: unknown } | null`）安全提取结构化 ErrorLogItem。
 *
 * 缺字段用兜底，brownfield 不崩（design §9）：
 * - type：合法枚举校验，非法/缺失 → "unknown"
 * - retryable：仅严格 === true 才可重试（保守，不盲目建议重试）
 * - message：缺失 → "运行失败"
 *
 * ql-20260903-011：CLI 合成鉴权错误升级——daemon 对这类错误回传 type=unknown /
 * retryable=false（CLI 把远端 401 误报成本地未登录，raw 为
 * "Not logged in · Please run /login"）。raw 命中该特征即视为远端瞬时 401：
 * 升 type=auth_failed + retryable=true（引导出「重新发送」操作），message/hint
 * 换成事实性中文文案（后端已自动重投一次，见 run_sync
 * _maybe_autoretry_auth_transient_turn）；raw 原样保留供「查看详情」排查。
 */
export function buildErrorLogItem(
  errorDetail: { [key: string]: unknown } | null | undefined,
): ErrorLogItem | null {
  if (!errorDetail || typeof errorDetail !== "object") return null;
  const raw = asStringOrNull(errorDetail["raw"]);
  const isCliAuthTransient =
    raw !== null &&
    (/Not\s+logged\s+in/i.test(raw) || /Please\s+run\s+\/login/i.test(raw));
  if (isCliAuthTransient) {
    return {
      type: "auth_failed",
      code: asStringOrNull(errorDetail["code"]),
      message: "模型服务鉴权瞬时失败（远端返回 401）",
      retryable: true,
      hint: "平台已自动重试一次；若反复出现，请检查供应商密钥或稍后手动重发",
      raw,
    };
  }
  return {
    type: isModelErrorType(errorDetail["type"]) ? errorDetail["type"] : "unknown",
    code: asStringOrNull(errorDetail["code"]),
    message: asStringOrDefault(errorDetail["message"], "运行失败"),
    retryable: errorDetail["retryable"] === true,
    hint: asStringOrNull(errorDetail["hint"]),
    raw,
  };
}

/**
 * ql-20260831-004：调度层/系统层失败原因 → ErrorLogItem。
 *
 * 模型层错误走 buildErrorLogItem（error_detail），本函数兜 error_detail 为空的
 * 系统级失败（撞闸 / inject 过期 / lease 超时等）：原因文案来自 run 的
 * failure_summary（后端映射 output_redacted），缺失时按 error_code 映射中文，
 * 仍缺失返回 null（调用方走「运行失败（无详情）」既有兜底）。
 *
 * SESSION_LIMIT_REACHED 专项识别：daemon 原文是英文技术串，翻译成可操作提示
 * （结束旧会话 / 等额度释放），原文保留在 raw 供排查。
 */
export function buildSystemFailureItem(
  errorCode: string | null | undefined,
  failureSummary: string | null | undefined,
): ErrorLogItem | null {
  const summary =
    typeof failureSummary === "string" && failureSummary.trim() !== ""
      ? failureSummary
      : null;
  if (!summary) {
    // 无上报原因：按 error_code 给方向性文案，未知码不硬造（返回 null 走既有兜底）。
    const codeText: Record<string, string> = {
      interactive_inject_send_failed: "消息未能送达执行端执行，本轮自动失败",
      interactive_interrupted: "本轮对话被中断",
      interactive_failed: "本轮执行失败",
      interactive_unknown_status: "本轮执行异常终止",
    };
    const text = errorCode ? codeText[errorCode] : null;
    if (!text) return null;
    return {
      type: "unknown",
      code: errorCode ?? null,
      message: text,
      retryable: true,
      hint: null,
      raw: null,
    };
  }
  if (summary.includes("SESSION_LIMIT_REACHED")) {
    return {
      type: "unknown",
      code: errorCode ?? null,
      message: "新建会话被拒：该机器同时活跃的会话数已达上限",
      retryable: true,
      hint: "在会话列表结束部分旧会话后重试；不处理的话约 30 分钟后额度自动释放",
      raw: summary,
    };
  }
  return {
    type: "unknown",
    code: errorCode ?? null,
    message: summary,
    retryable: false,
    hint: null,
    raw: null,
  };
}

/**
 * task-08：识别 [ASSISTANT] 行是否为模型调用错误文本。
 *
 * daemon 把模型失败记为 `[ASSISTANT] API Error: Request rejected (429) · ...`
 * （design §1）。原缺陷 normalize:352 把所有 [ASSISTANT] 归 assistant，这条错误
 * 文本被当普通助手回复。此处用关键词识别，让 classifyLog 归 error 类。
 *
 * ql-20260903-011：claude CLI 把模型网关 401 合成的
 * `[ASSISTANT] Not logged in · Please run /login`（transcript 侧
 * model=<synthetic> / authentication_failed）同样识别——否则这条误导文案会被
 * 当作 agent 的正常回复渲染在时间线里（2026-09-03 会话 cb56fabf 事故形态）。
 */
export function isAssistantApiErrorText(content: string): boolean {
  const body = extractAssistantText(content) || content;
  return (
    /API\s*Error/i.test(body) ||
    /Request\s+rejected/i.test(body) ||
    /Not\s+logged\s+in/i.test(body) ||
    /Please\s+run\s+\/login/i.test(body)
  );
}

/**
 * task-08：合成结构化错误日志项（ProcessedLog）。追加在 processedLogs 末尾，
 * semanticCategory=error，errorLogItem 载荷供 task-09 渲染。hidden=false
 * （R-02：不进 NOISE 折叠白名单）。
 */
function makeErrorProcessedLog(item: ErrorLogItem): ProcessedLog {
  const syntheticLog: AgentRunLogEntry = {
    id: `error-detail-${item.type}`,
    run_id: "error-detail",
    // 占位 timestamp 放末尾（失败错误项出现在消息流最后）；new Date 兼容三端。
    timestamp: new Date().toISOString(),
    channel: "stderr",
    content_redacted: item.message,
  };
  return {
    log: syntheticLog,
    hidden: false,
    semanticCategory: "error",
    errorLogItem: item,
  };
}

// task-08：通过 TS module augmentation（declare module）给 ProcessedLog 附加
// errorLogItem 字段，不修改 types.ts（本任务 allowed_paths 仅 normalize.ts）。
// task-09/10 从 processedLogs[i].errorLogItem 读取结构化错误详情渲染 RunErrorItem。
declare module "./types" {
  interface ProcessedLog {
    errorLogItem?: ErrorLogItem;
  }
}

/* ------------------------------------------------------------------ */
/*  Log normalization                                                  */
/* ------------------------------------------------------------------ */

/**
 * 日志语义分类（viewer 中文标签 + 筛选用）。
 *
 * 区别于底层 channel（stdout/stderr/tool_call/...），语义分类面向用户：
 *   - user_input → user；pending_input → ask；tool_call → tool_call（tool_kind=ask
 *     的 AskUserQuestion 归 ask，ql-20260705-007）；stderr → error。
 *   - stdout 按文本协议前缀分：[TOOL_RESULT] → tool_result、[THINKING] → thinking、
 *     [ASSISTANT] → assistant、[SYSTEM → system、[RESULT → result。
 *   - 无协议前缀的纯文本 stdout → assistant（codex / json-rpc 流式 delta）。
 *   - 其余兜底 → log。
 *
 * viewer 据此渲染中文徽标并提供语义筛选，替代原 channel 二级筛选。
 */
export function classifyLog(
  channel: string,
  content: string,
  toolKind?: string | null,
): SemanticCategory {
  if (channel === "user_input") return "user";
  if (channel === "pending_input") return "ask";
  // ql-20260705-007 (C7)：AskUserQuestion（tool_kind=ask）归 ask 语义类，让"提问
  // 审批"筛选能匹配（之前一律归 tool_call 致 AskUserQuestion 看不到）。
  if (channel === "tool_call") {
    return toolKind === "ask" ? "ask" : "tool_call";
  }
  const text = content ?? "";
  if (text.includes("[TOOL_RESULT]")) return "tool_result";
  // 2026-07-09-agent-log-display-fix / FR-10：[TOOL_USE] stdout 行归 tool_call
  // （历史降级——新 daemon 不再发 stdout [TOOL_USE]，旧日志兼容）
  if (text.startsWith("[TOOL_USE]")) return "tool_call";
  if (text.startsWith("[THINKING]")) return "thinking";
  // task-08 / FR-03：[ASSISTANT] 开头但含模型调用错误特征（"API Error" /
  // "Request rejected"）不再归 assistant（design §1 原缺陷：错误被当助手回复）。
  if (text.startsWith("[ASSISTANT]")) {
    return isAssistantApiErrorText(text) ? "error" : "assistant";
  }
  if (text.startsWith("[SYSTEM")) return "system";
  if (text.startsWith("[RESULT")) return "result";
  if (channel === "stderr") return "error";
  // 纯文本 stdout（无协议前缀）→ assistant 流式文本（codex / json-rpc streaming）
  if (channel === "stdout" && text.length > 0 && !text.startsWith("[")) {
    return "assistant";
  }
  return "log";
}

/**
 * task-08 / FR-03：normalize 可选入参，携带 run 级错误信息（不属单条 log）。
 *
 * - errorDetail：run.error_detail（task-07 透传的 ModelError 序列化字典）；有值时
 *   在 processedLogs 末尾追加结构化 error 类日志项。
 * - runStatus：run.status；为 "failed" 且无 errorDetail 时，brownfield 兜底追加
 *   「运行失败（无详情）」error 项（design §9 / D-008）。
 *
 * 调用方不传（旧调用）→ 行为与历史完全一致（成功路径零回归）。task-10 集成时
 * 由 viewer 传入 run.error_detail / run.status。
 */
export interface NormalizeOptions {
  errorDetail?: { [key: string]: unknown } | null;
  runStatus?: string | null;
}

export function normalizeLogs(
  logs: AgentRunLogEntry[],
  options?: NormalizeOptions,
): ProcessedLog[] {
  // ql-20260620：归一化本身若因异常数据抛错，回退为逐条原样渲染，
  // 保证日志面板不整页崩（client-side exception）。
  try {
    return normalizeLogsImpl(logs, options);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[normalizeLogs] 归一化失败，回退为逐条原样渲染", err);
    return logs.map((log) => ({ log, hidden: false }));
  }
}

function normalizeLogsImpl(
  logs: AgentRunLogEntry[],
  options?: NormalizeOptions,
): ProcessedLog[] {
  // task-08：是否已具备结构化错误（error_detail 或 failed 兜底）。若有，则
  // [ASSISTANT] API Error 文本行将被结构化项取代（hidden，避免重复/误导）。
  const hasStructuredError =
    !!options?.errorDetail || options?.runStatus === "failed";

  // 2026-07-09-agent-log-display-fix / D-002@v2 原保留 [SYSTEM:thinking_tokens] 折叠显示；
  // ql-20260709-003 推翻为默认隐藏（用户反馈 token 估算意义不大、且穿插把 thinking 切碎）。
  // thinking_tokens 行在下方 stdout 分支 hidden + continue，且不重置 thinking 合并指针，
  // 让被它穿插的 thinking 连续合并成一段。其余日志照常进 normalize 分类渲染。
  const result: ProcessedLog[] = logs.map((log) => ({ log, hidden: false }));

  // 2026-07-09-agent-log-display-fix：interactive 路径消息级重复去重（治标）。
  // backend create_session + dispatch 两处写首 user_input（daemon/session/service.py:397
  // + agent/service.py:1564）+ assistant 双路径，导致同 channel+content 完全相同的
  // 消息重复落库（如 8cab695d interactive run）。这里按 (channel, content) 去重
  // （后条 hidden），不影响合法 delta 合并（delta 内容不同不命中）。
  // tool_use/tool_call 双写（不同 channel）靠下方 classifyLog [TOOL_USE]→tool_call + 配对。
  const dedupSeen = new Set<string>();
  for (const p of result) {
    if (p.hidden) continue;
    const key = `${p.log.channel}|${asString(p.log.content_redacted)}`;
    if (dedupSeen.has(key)) {
      p.hidden = true;
    } else {
      dedupSeen.add(key);
    }
  }

  let lastToolSourceIdx = -1;
  // ql-20260617-011：连续 [THINKING]-only stdout 合并到首条（SSE 追加效果）
  let lastThinkingIdx = -1;
  // ql-20260618-012：连续 [ASSISTANT] / 流式纯文本 stdout 合并
  let lastAssistantIdx = -1;

  // task-14 / FR-09 / D-002@v1：tool_use_id 全局配对索引。
  // task-13 在 tool_call JSON emit 时注入 tool_use_id（snake_case，非空时携带）。
  // stdout [TOOL_USE] 文本不带 id（submit_messages 不保留 metadata），故前端靠
  // "tool 名匹配 + 扩大窗口"把 stdout 合并到最近的带 id 的 tool_call JSON。
  //
  // 策略（两步）：
  // 1. 预扫描所有**带 tool_use_id**的 tool_call JSON：建 Map<toolUseId, idx>（按 id 去重）+
  //    Map<toolName, idx[]>（按名记录带 id 的 tool_call 位置，供 stdout 回查）。
  // 2. 单遍处理时，stdout [TOOL_USE] 在 result 数组中双向扫描最近的同 tool 名
  //    **带 id** tool_call（窗口 ±TOOL_PAIR_WINDOW），找到则合并。
  //
  // 退化（id 缺失 / 无带 id 的同 tool 名 tool_call）：保留原 ±3 窗口启发式
  // （lastToolSourceIdx），向后兼容旧 daemon 日志。
  const TOOL_PAIR_WINDOW = 20; // 扩大窗口上限，覆盖穿插多条 [ASSISTANT] 的场景
  const toolUseIdIndex = new Map<string, number>(); // tool_use_id → 首个 tool_call idx
  const toolNameIndex = new Map<string, number[]>(); // tool 名 → 带 id 的 tool_call idx
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i]!;
    if (log.channel !== "tool_call") continue;
    const parsed = parseToolCallContent(log.content_redacted);
    if (!parsed?.toolUseId) continue; // 只收录带 id 的（退化场景走 ±3）
    if (!toolUseIdIndex.has(parsed.toolUseId)) {
      toolUseIdIndex.set(parsed.toolUseId, i);
      const list = toolNameIndex.get(parsed.tool) ?? [];
      list.push(i);
      toolNameIndex.set(parsed.tool, list);
    }
  }

  for (let i = 0; i < logs.length; i++) {
    const current = result[i];
    if (!current) continue;

    // 设置语义分类（viewer 中文标签 + 语义筛选用）。
    // 对每条 processed log 都设置（含被合并 hidden 的条目——其本身不渲染，无副作用）。
    current.semanticCategory = classifyLog(
      current.log.channel,
      asString(current.log.content_redacted),
      current.log.tool_kind,
    );

    if (current.log.channel === "tool_call") {
      // task-14 / FR-09：解析 tool_use_id（task-13 注入），记入 ProcessedLog
      // 供 task-15 渲染层读取。同 id 重复 emit（daemon 重试/重放）时合并到首张。
      const parsed = parseToolCallContent(current.log.content_redacted);
      if (parsed?.toolUseId) {
        current.toolUseId = parsed.toolUseId;
        const firstIdx = toolUseIdIndex.get(parsed.toolUseId);
        if (firstIdx !== undefined && firstIdx !== i) {
          // 同 tool_use_id 已有首张 → 当前条 hidden（mergedToolResult 已由预扫描
          // 保证首张为准，后续重复条不渲染）。防御性合并 result body（若有）。
          current.hidden = true;
          continue;
        }
      }
      lastToolSourceIdx = i;
      lastThinkingIdx = -1;
      lastAssistantIdx = -1;
      continue;
    }

    if (current.log.channel !== "stdout") {
      lastThinkingIdx = -1;
      lastAssistantIdx = -1;
      continue;
    }

    // ql-20260616-002：后端 content_redacted 实际可为 null/undefined（schema str|None），
    // 前端类型声明成 string 是错的。SSE 流式 entry 可能瞬时为空 → 这里降级为 "" 避免
    // 后续 split/filter(l => l.trim()) 链对 null 抛 TypeError 让整页 Bootstrap Run 崩溃。
    const content = asString(current.log.content_redacted);
    const lines = content.split("\n");
    const nonEmpty = lines.filter((l) => l.trim());
    if (nonEmpty.length === 0) continue;

    // ql-20260709-003：[SYSTEM:thinking_tokens] 诊断行默认隐藏，且不打断 thinking
    // 连续合并。用户反馈：token 估算意义不大，且穿插在 thinking 之间把思考切成碎片
    // （本循环遇非 thinking-only 行会重置 lastThinkingIdx）。这里 hidden + continue
    // （不重置指针），让 thinking 跨越它连续合并成一段。普通 [SYSTEM:xxx] 仍会打断。
    if (/^\s*\[SYSTEM:thinking_tokens\]/.test(content)) {
      current.hidden = true;
      continue;
    }

    // ql-20260617-011：连续 [THINKING]-only stdout 合并到上一条（追加显示）
    // daemon 每个 thinking_delta 推一条 log，前端不合并会成独立卡片刷屏。
    // 合并方式：提取每行的 thinking token（去掉 `[THINKING] ` 前缀），按原序
    // 直接拼接（无分隔符），还原 SSE 累积效果。
    // 中间出现任何非 [THINKING] 行（[SYSTEM]/[ASSISTANT]/[TOOL_*]/普通 stdout）
    // 都会断开连续性，下次 [THINKING] 重新起始一个块。
    if (isThinkingOnly(content)) {
      const piece = extractThinkingText(content);
      if (lastThinkingIdx >= 0) {
        const target = result[lastThinkingIdx];
        if (target) {
          const prev = target.mergedThinkingContent
            ?? extractThinkingText(asString(target.log.content_redacted));
          // task-14 / D2：用 mergeThinkingPiece 归并（前缀包含去重），避免完整段
          // 重发时与 partial 累积双份拼接（旧 prev + piece 直接拼接的 bug）。
          target.mergedThinkingContent = mergeThinkingPiece(prev, piece);
        }
        current.hidden = true;
        continue;
      }
      // 首条 thinking：直接设置 mergedThinkingContent，渲染时跳过 [THINKING] 前缀
      current.mergedThinkingContent = piece;
      lastThinkingIdx = i;
      continue;
    }
    lastThinkingIdx = -1;

    // task-08 / FR-03：[ASSISTANT] API Error 文本行不并入 assistant 合并。
    // design §1 原缺陷：此类错误文本被 mergeAssistantPiece 吞成普通助手回复。
    // - 有结构化错误（error_detail / failed 兜底）→ hidden（结构化项取代，避免重复）
    // - 无结构化错误 → 保留为独立 error 类项（classifyLog 已标 semanticCategory=error）
    if (isAssistantOnly(content) && isAssistantApiErrorText(content)) {
      if (hasStructuredError) {
        current.hidden = true;
      }
      lastAssistantIdx = -1;
      continue;
    }

    // ql-20260618-012：连续 [ASSISTANT] stdout 合并（cursor partial / 历史日志兜底）
    if (isAssistantOnly(content)) {
      const piece = extractAssistantText(content);
      if (lastAssistantIdx >= 0) {
        const target = result[lastAssistantIdx];
        if (target) {
          const prev = target.mergedAssistantContent
            ?? extractAssistantText(asString(target.log.content_redacted));
          target.mergedAssistantContent = mergeAssistantPiece(prev, piece);
        }
        current.hidden = true;
        continue;
      }
      current.mergedAssistantContent = piece;
      lastAssistantIdx = i;
      continue;
    }

    // ql-20260618-012：codex 等 streaming delta（无前缀纯文本）也合并
    if (isPlainStreamingStdout(content)) {
      const piece = content;
      if (lastAssistantIdx >= 0) {
        const target = result[lastAssistantIdx];
        if (target) {
          const prev = target.mergedAssistantContent
            ?? asString(target.log.content_redacted);
          target.mergedAssistantContent = mergeAssistantPiece(prev, piece);
        }
        current.hidden = true;
        continue;
      }
      current.mergedAssistantContent = piece;
      lastAssistantIdx = i;
      continue;
    }
    lastAssistantIdx = -1;

    const hasToolUse = nonEmpty.some((l) => l.trim().startsWith("[TOOL_USE]"));
    const hasToolResult = nonEmpty.some((l) => l.trim().startsWith("[TOOL_RESULT]"));

    // ── [TOOL_USE] handling ──
    if (hasToolUse) {
      // task-14 / FR-09：先尝试全局配对（tool 名匹配 + 扩大窗口）。
      // task-13 emit 顺序：stdout [TOOL_USE] 在前、tool_call JSON 紧随（相邻），
      // 但 daemon 中间穿插其他日志（[ASSISTANT]/[SYSTEM]）时距离可能 > 3。
      // 故用 toolNameIndex 双向扫描最近的同 tool 名 tool_call，窗口扩大到 TOOL_PAIR_WINDOW。
      const parsedStdout = parseStdoutToolUse(content, current.log.timestamp);
      const stdoutToolName = parsedStdout?.tool;

      // 查找匹配的 tool_call idx（带 id 优先，其次同 tool 名最近邻）
      let matchedToolCallIdx = -1;
      if (stdoutToolName) {
        const candidates = toolNameIndex.get(stdoutToolName) ?? [];
        // 双向找距离 i 最近的 tool_call idx，且距离 ≤ TOOL_PAIR_WINDOW
        let bestDist = Infinity;
        for (const candIdx of candidates) {
          const dist = Math.abs(candIdx - i);
          if (dist <= TOOL_PAIR_WINDOW && dist < bestDist) {
            bestDist = dist;
            matchedToolCallIdx = candIdx;
          }
        }
      }

      if (matchedToolCallIdx >= 0 && matchedToolCallIdx !== i) {
        // 合并到匹配的 tool_call 卡片
        const tc = result[matchedToolCallIdx];
        if (tc) {
          // 把 tool_use_id 透传给卡片（若 tool_call 解析时已设则不覆盖）
          if (!tc.toolUseId && tc.log.channel === "tool_call") {
            const parsedTc = parseToolCallContent(tc.log.content_redacted);
            if (parsedTc?.toolUseId) tc.toolUseId = parsedTc.toolUseId;
          }
          if (hasToolResult) {
            mergeToolResult(tc, extractToolResultBody(content), current.log);
          }
        }
        current.hidden = true;
        continue;
      }

      // 退化：原 ±3 窗口启发式（task_use_id 缺失 / 无同 tool 名 tool_call 时兜底）
      const nearToolCall = lastToolSourceIdx >= 0
        && result[lastToolSourceIdx]?.log.channel === "tool_call"
        && i > lastToolSourceIdx
        && i <= lastToolSourceIdx + 3;

      if (nearToolCall) {
        // Duplicate of tool_call → merge TOOL_RESULT if present, then hide
        if (hasToolResult) {
          const body = extractToolResultBody(content);
          const tc = result[lastToolSourceIdx];
          if (tc) mergeToolResult(tc, body, current.log);
        }
        current.hidden = true;
        continue;
      }

      if (parsedStdout) {
        current.parsedStdoutTool = parsedStdout;
        lastToolSourceIdx = i;
        if (hasToolResult) {
          mergeToolResult(current, extractToolResultBody(content), current.log);
        }
        continue;
      }
    }

    // ── [TOOL_RESULT] handling (no TOOL_USE) ──
    if (!hasToolUse && hasToolResult) {
      const body = extractToolResultBody(content);
      // task-05 / D-007：优先按 parent_tool_use_id 精确配对（新日志 daemon 带 id）
      const resultToolUseId = current.log.parent_tool_use_id ?? undefined;
      let matchedIdx = -1;
      if (resultToolUseId) {
        const candidate = toolUseIdIndex.get(resultToolUseId);
        if (candidate !== undefined) matchedIdx = candidate;
      }
      if (matchedIdx >= 0 && result[matchedIdx]) {
        // 精确配对命中：合并到对应 tool_call 卡片
        mergeToolResult(result[matchedIdx]!, body, current.log);
        current.hidden = true;
      } else if (lastToolSourceIdx >= 0) {
        // 退化：合并到最近 tool source（旧日志/id 缺失）
        const tc = result[lastToolSourceIdx];
        if (tc) mergeToolResult(tc, body, current.log);
        current.hidden = true;
      } else {
        // Orphan TOOL_RESULT — standalone rendering
        if (body) {
          current.parsedToolResult = body;
        }
      }
    }
  }

  // task-08 / FR-03 / D-002@v1：在常规归一化后追加结构化 error 类日志项。
  // errorDetail 有值 → 结构化项；failed 无 errorDetail → brownfield 兜底项
  // （「运行失败（无详情）」）。两者 hidden=false（R-02：不进 NOISE 折叠白名单），
  // semanticCategory=error。errorDetail 缺失且非 failed → 不追加（成功路径零回归）。
  const errorItem = buildErrorLogItem(options?.errorDetail);
  if (errorItem) {
    result.push(makeErrorProcessedLog(errorItem));
  } else if (options?.runStatus === "failed") {
    result.push(
      makeErrorProcessedLog({
        type: "unknown",
        code: null,
        message: "运行失败（无详情）",
        retryable: false,
        hint: null,
        raw: null,
      }),
    );
  }

  return result;
}

/** Check if stdout content is thinking/system diagnostic lines (不含纯 assistant)。 */
export function isThinkingContent(content: string): boolean {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return false;
  if (lines.every((l) => /^\s*\[ASSISTANT\]/.test(l))) return false;
  return lines.every(
    (l) =>
      /^\s*\[THINKING\]/.test(l) ||
      /^\s*\[SYSTEM/.test(l) ||
      /^\s*\[ASSISTANT\]/.test(l),
  );
}

/**
 * ql-20260617-011 / ql-20260617-013：Check if stdout content is a [THINKING] chunk.
 *
 * daemon 推送格式：每条 stdout 的首行必为 `[THINKING] <text>`，但 chunk 内部
 * 可含换行（80 字符 / 120ms 累积的多个 delta 拼成，含原文换行符）。
 * 所以只检查首行是否 [THINKING] 前缀即可识别（不再要求每行都是 [THINKING]）。
 *
 * 比 isThinkingContent 严格——[SYSTEM]/[ASSISTANT] 行不视为 thinking chunk，
 * 用于 normalize 合并：只有 [THINKING] chunk 才追加合并到上一条。
 */
export function isThinkingOnly(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith("[THINKING]");
}

/** ql-20260618-012：单条 stdout 是否仅为 [ASSISTANT] 片段。 */
export function isAssistantOnly(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith("[ASSISTANT]");
}

/** ql-20260618-012：流式 delta 纯文本（无协议前缀），用于 codex/json-rpc streaming。 */
export function isPlainStreamingStdout(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed) return false;
  return !/^\[(ASSISTANT|THINKING|TOOL_|SYSTEM|RESULT)/.test(trimmed);
}

/** Filter all protocol-prefixed lines from content for default rendering */
export function filterToolProtocolLines(content: string): string {
  return content
    .split("\n")
    .filter((l) => {
      const trimmed = l.trim();
      return trimmed.length > 0
        && !trimmed.startsWith("[TOOL_USE]")
        && !trimmed.startsWith("[TOOL_RESULT]")
        && !trimmed.startsWith("[THINKING]")
        && !trimmed.startsWith("[SYSTEM")
        && !trimmed.startsWith("[ASSISTANT]");
    })
    .join("\n");
}
