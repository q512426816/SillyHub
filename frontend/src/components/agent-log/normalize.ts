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

/* ------------------------------------------------------------------ */
/*  Log normalization                                                  */
/* ------------------------------------------------------------------ */

export function normalizeLogs(logs: AgentRunLogEntry[]): ProcessedLog[] {
  const result: ProcessedLog[] = logs.map((log) => ({ log, hidden: false }));
  let lastToolSourceIdx = -1;

  for (let i = 0; i < logs.length; i++) {
    const current = result[i];
    if (!current) continue;

    if (current.log.channel === "tool_call") {
      lastToolSourceIdx = i;
      continue;
    }

    if (current.log.channel !== "stdout") continue;

    // ql-20260616-002：后端 content_redacted 实际可为 null/undefined（schema str|None），
    // 前端类型声明成 string 是错的。SSE 流式 entry 可能瞬时为空 → 这里降级为 "" 避免
    // 后续 split/filter(l => l.trim()) 链对 null 抛 TypeError 让整页 Bootstrap Run 崩溃。
    const content = current.log.content_redacted ?? "";
    const lines = content.split("\n");
    const nonEmpty = lines.filter((l) => l.trim());
    if (nonEmpty.length === 0) continue;

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

/** Check if stdout content contains only thinking/system/assistant lines */
export function isThinkingContent(content: string): boolean {
  const lines = content.split("\n").filter((l) => l.trim());
  return (
    lines.length > 0 &&
    lines.every(
      (l) =>
        /^\s*\[THINKING\]/.test(l) ||
        /^\s*\[SYSTEM/.test(l) ||
        /^\s*\[ASSISTANT\]/.test(l),
    )
  );
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
