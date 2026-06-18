import type { AgentRunLogEntry } from "@/lib/agent";
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
  // ql-20260616-002：上游 content_redacted 可为 null（后端 schema str|None），入口降级。
  const safe = raw ?? "";
  if (!safe) return null;
  try {
    const obj = JSON.parse(safe);
    const args = obj.args ?? obj.arguments ?? "";
    const toolName = obj.tool ?? obj.name ?? "unknown";
    return {
      timestamp: obj.timestamp ?? "",
      tool: toolName,
      args: stringifyToolArgs(args),
      status: obj.requires_approval ? "pending" : "allowed",
      success: obj.success !== false,
      description: typeof args === "object" && args !== null ? args.description : undefined,
      command: typeof args === "object" && args !== null ? args.command : undefined,
      rawArgs: args,
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

/* ------------------------------------------------------------------ */
/*  Log normalization                                                  */
/* ------------------------------------------------------------------ */

export function normalizeLogs(logs: AgentRunLogEntry[]): ProcessedLog[] {
  const result: ProcessedLog[] = logs.map((log) => ({ log, hidden: false }));
  let lastToolSourceIdx = -1;
  // ql-20260617-011：连续 [THINKING]-only stdout 合并到首条（SSE 追加效果）
  let lastThinkingIdx = -1;
  // ql-20260618-012：连续 [ASSISTANT] / 流式纯文本 stdout 合并
  let lastAssistantIdx = -1;

  for (let i = 0; i < logs.length; i++) {
    const current = result[i];
    if (!current) continue;

    if (current.log.channel === "tool_call") {
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
    const content = current.log.content_redacted ?? "";
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
            ?? extractThinkingText(target.log.content_redacted ?? "");
          target.mergedThinkingContent = prev + piece;
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
            ?? extractAssistantText(target.log.content_redacted ?? "");
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
            ?? (target.log.content_redacted ?? "");
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

      const parsed = parseStdoutToolUse(content, current.log.timestamp);
      if (parsed) {
        current.parsedStdoutTool = parsed;
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
