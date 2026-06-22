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
  /**
   * task-14 / FR-09 / D-002@v1：tool_use block 的稳定 id（toolu_xxx）。
   * 来自 task-13 在 tool_call JSON（task-runner.ts / run_sync/service.py）注入的
   * `tool_use_id` 字段（snake_case，对齐 Anthropic API）。前端用它做全局配对，
   * 替代原 ±3 索引窗口（normalize.ts:359-386）。缺失时前端退化到启发式。
   */
  toolUseId?: string;
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
  /**
   * ql-20260618-012：连续 [ASSISTANT] / 流式纯文本 stdout 合并后的 assistant 段落。
   */
  mergedAssistantContent?: string;
  /**
   * task-14 / FR-09：tool_use_id 全局关联字段。
   *
   * 来源：task-13 在 tool_call JSON emit 时注入 `tool_use_id`（snake_case）。
   * 前端 normalize 用它做全局配对（Map<toolUseId, idx>），替代原 ±3 索引窗口
   * （normalize.ts:359-386），让同一调用的 stdout [TOOL_USE] 与 tool_call JSON
   * 即使距离 > 3 也能合并为单张卡片。
   *
   * 退化：tool_use_id 缺失（旧 daemon / SDK 不提供 stable id）→ 回退 ±3 窗口
   * 启发式（tool 名匹配 + 时间戳邻近）。
   */
  toolUseId?: string;
  /**
   * task-14 / D1-D2：thinking segment 稳定 id（预留字段）。
   *
   * 预期来源：daemon stream-json.ts 的 thinking_delta 事件携带（task-11/12 信号）。
   * 同一 segmentId 的 partial 行（增量）与完整行（累积全文）按 mergeThinkingPiece
   * 归并规则去重。当前 daemon 未完全接通 segment_id，故本字段为预留，task-15
   * 渲染层可读取做 turn 分组。
   */
  segmentId?: string;
}
