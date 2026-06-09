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

export function parseToolCallContent(raw: string): ToolCallEntry | null {
  try {
    const obj = JSON.parse(raw);
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

/** Check if content's first non-empty line starts with [TOOL_USE] */
function startsWithToolUse(content: string): boolean {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.startsWith("[TOOL_USE]");
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  TOOL_RESULT merge helper                                           */
/* ------------------------------------------------------------------ */

function mergeToolResult(target: ProcessedLog, toolResultLines: string[]) {
  const resultContent = toolResultLines
    .map((l) => l.replace(/^\s*\[TOOL_RESULT\]\s*/, ""))
    .filter((l) => l.trim())
    .join("\n");

  if (resultContent) {
    if (target.mergedToolResult) {
      target.mergedToolResult += "\n" + resultContent;
    } else {
      target.mergedToolResult = resultContent;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Log normalization                                                  */
/* ------------------------------------------------------------------ */

export function normalizeLogs(logs: AgentRunLogEntry[]): ProcessedLog[] {
  const result: ProcessedLog[] = logs.map((log) => ({ log, hidden: false }));
  // Tracks index of last tool source (channel=tool_call OR parsed stdout [TOOL_USE])
  let lastToolSourceIdx = -1;

  for (let i = 0; i < logs.length; i++) {
    const current = result[i];
    if (!current) continue;

    // Track channel=tool_call as tool source
    if (current.log.channel === "tool_call") {
      lastToolSourceIdx = i;
      continue;
    }

    if (current.log.channel !== "stdout") continue;

    const content = current.log.content_redacted;
    const lines = content.split("\n");
    const nonEmpty = lines.filter((l) => l.trim());
    if (nonEmpty.length === 0) continue;

    const toolUseLines = nonEmpty.filter((l) => l.trim().startsWith("[TOOL_USE]"));
    const toolResultLines = nonEmpty.filter((l) => l.trim().startsWith("[TOOL_RESULT]"));
    const otherLines = nonEmpty.filter(
      (l) => !l.trim().startsWith("[TOOL_USE]") && !l.trim().startsWith("[TOOL_RESULT]"),
    );

    const hasToolUse = toolUseLines.length > 0;
    const hasToolResult = toolResultLines.length > 0;

    // ── [TOOL_USE] handling ──
    if (hasToolUse) {
      // Check for nearby channel=tool_call to deduplicate
      const nearToolCall = lastToolSourceIdx >= 0
        && result[lastToolSourceIdx]?.log.channel === "tool_call"
        && i > lastToolSourceIdx
        && i <= lastToolSourceIdx + 3;

      if (nearToolCall) {
        // Duplicate of tool_call → merge TOOL_RESULT if present, then hide
        if (hasToolResult) {
          const tc = result[lastToolSourceIdx];
          if (tc) mergeToolResult(tc, toolResultLines);
        }
        current.hidden = true;
        continue;
      }

      // No nearby tool_call → parse [TOOL_USE] as standalone tool event
      const parsed = parseStdoutToolUse(content, current.log.timestamp);
      if (parsed) {
        current.parsedStdoutTool = parsed;
        lastToolSourceIdx = i;

        // Merge TOOL_RESULT from the same entry
        if (hasToolResult) {
          mergeToolResult(current, toolResultLines);
        }

        // If content is only TOOL_USE + TOOL_RESULT, skip further processing
        if (otherLines.length === 0) continue;
        // Otherwise fall through — otherLines will be rendered alongside the tool card
      }
    }

    // ── [TOOL_RESULT] only (no TOOL_USE) → merge into last tool source ──
    if (!hasToolUse && hasToolResult && lastToolSourceIdx >= 0) {
      const tc = result[lastToolSourceIdx];
      if (tc) mergeToolResult(tc, toolResultLines);

      // Hide if only TOOL_RESULT lines
      if (otherLines.length === 0) {
        current.hidden = true;
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

/** Filter [TOOL_USE] and [TOOL_RESULT] lines from content for default rendering */
export function filterToolProtocolLines(content: string): string {
  return content
    .split("\n")
    .filter((l) => {
      const trimmed = l.trim();
      return trimmed.length > 0
        && !trimmed.startsWith("[TOOL_USE]")
        && !trimmed.startsWith("[TOOL_RESULT]");
    })
    .join("\n");
}
