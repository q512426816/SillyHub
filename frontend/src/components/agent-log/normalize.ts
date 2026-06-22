import type { AgentRunLogEntry } from "@/lib/agent";
import { asString } from "@/lib/utils";
import type { ProcessedLog, ScanCheckResult, ToolCallEntry } from "./types";

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

function mergeToolResult(target: ProcessedLog, body: string) {
  if (!body) return;
  if (target.mergedToolResult) {
    target.mergedToolResult += "\n" + body;
  } else {
    target.mergedToolResult = body;
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
 *    "明显更长"判定：piece 长度 > prev 长度，且 piece 含换行或去空白后多出 ≥ 4 字符，
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
  // "明显更长"判定：piece 比 prev 长，且额外内容含换行或去空白后多出 ≥ 4 字符。
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
/*  Log normalization                                                  */
/* ------------------------------------------------------------------ */

export function normalizeLogs(logs: AgentRunLogEntry[]): ProcessedLog[] {
  // ql-20260620：归一化本身若因异常数据抛错，回退为逐条原样渲染，
  // 保证日志面板不整页崩（client-side exception）。
  try {
    return normalizeLogsImpl(logs);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[normalizeLogs] 归一化失败，回退为逐条原样渲染", err);
    return logs.map((log) => ({ log, hidden: false }));
  }
}

function normalizeLogsImpl(logs: AgentRunLogEntry[]): ProcessedLog[] {
  // ql-20260620：过滤 daemon 已知的低价值高频 system 日志（旧 daemon 仍会推送）。
  const NOISE_PREFIXES = ["[SYSTEM:thinking_tokens]"];
  const filtered = logs.filter((log) => {
    const c = asString(log.content_redacted);
    return !NOISE_PREFIXES.some((p) => c.startsWith(p));
  });
  const result: ProcessedLog[] = filtered.map((log) => ({ log, hidden: false }));
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
            mergeToolResult(tc, extractToolResultBody(content));
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
          if (tc) mergeToolResult(tc, body);
        }
        current.hidden = true;
        continue;
      }

      if (parsedStdout) {
        current.parsedStdoutTool = parsedStdout;
        lastToolSourceIdx = i;
        if (hasToolResult) {
          mergeToolResult(current, extractToolResultBody(content));
        }
        continue;
      }
    }

    // ── [TOOL_RESULT] handling (no TOOL_USE) ──
    if (!hasToolUse && hasToolResult) {
      const body = extractToolResultBody(content);

      if (lastToolSourceIdx >= 0) {
        // Merge into previous tool source
        const tc = result[lastToolSourceIdx];
        if (tc) mergeToolResult(tc, body);
        current.hidden = true;
      } else {
        // Orphan TOOL_RESULT — standalone rendering
        if (body) {
          current.parsedToolResult = body;
        }
        // Don't hide — rendered as ToolResultCard
      }
    }
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
