/**
 * Shared types for Agent log normalization and rendering.
 */

export type ToolCallEntry = {
  timestamp: string;
  tool: string;
  args: string;
  status: "allowed" | "pending";
  success: boolean;
  description?: string;
  command?: string;
  rawArgs: unknown;
};

export type ScanCheckResult = {
  scanDocs: string;
  moduleCount: string;
  flowCount: string;
  glossary: boolean;
  totalFiles: string;
  passed: boolean;
};

export type AgentLogInputControls = {
  inputValues: Record<string, string>;
  submittingInputs: Record<string, boolean>;
  inputErrors: Record<string, string>;
  repliedInputs: Set<string>;
  onChange: (_logId: string, _value: string) => void;
  onSubmit: (_logId: string) => void;
};

export interface ProcessedLog {
  /** Original log entry */
  log: import("@/lib/agent").AgentRunLogEntry;
  /** Whether to skip rendering this entry entirely */
  hidden: boolean;
  /** [TOOL_RESULT] content merged from subsequent stdout entries */
  mergedToolResult?: string;
  /** Parsed tool info from stdout [TOOL_USE] line (when no channel=tool_call exists) */
  parsedStdoutTool?: ToolCallEntry;
  /** Orphan [TOOL_RESULT] body (no preceding tool source to merge into) */
  parsedToolResult?: string;
  /**
   * ql-20260617-011：连续 [THINKING] 行追加合并到首条的累积内容。
   * daemon 每个 thinking_delta 推一条 log → 前端不合并会成独立卡片刷屏。
   * 合并后只渲染首条，content 是所有 thinking 行 join("\n")，实现 SSE 风格追加。
   */
  mergedThinkingContent?: string;
}
