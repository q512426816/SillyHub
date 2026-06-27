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

/**
 * 日志语义分类（viewer 中文标签 + 筛选用）。
 *
 * 区别于底层 channel（stdout/stderr/tool_call/...），面向用户的分类：
 * 由 normalize.ts `classifyLog` 把每条 raw log 映射到此枚举，
 * viewer 据此渲染中文徽标并提供语义筛选（替代原 channel 二级筛选）。
 */
export type SemanticCategory =
  | "user"
  | "ask"
  | "assistant"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "system"
  | "result"
  | "error"
  | "log";

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
   * ql-20260622-003 / P1-2：tool 卡片执行耗时（tool_call emit → [TOOL_RESULT] emit 毫秒差）。
   *
   * 迁移自 render 期 computeToolDurationMs（原在 AgentLogRow 每次 render 回查 allLogs，
   * N×M 复杂度）。normalize 阶段在 mergeToolResult 配对 [TOOL_RESULT] 时基于
   * tool_use_id / tool 名配对结果预算：start=卡片 log.timestamp，end=被合并 result
   * stdout 的 log.timestamp，存 Math.max(0, end-start)。首次配对设置（同卡多 result
   * 取首条，与原"首条 result"语义一致）。
   *
   * 退化：自合并（[TOOL_USE]+[TOOL_RESULT] 同条 stdout）/ 进行中（无 result）/
   * 时间戳缺失 → undefined，StatusBadge 只显示状态图标不显示秒数。
   */
  toolDurationMs?: number;
  /**
   * task-14 / D1-D2：thinking segment 稳定 id（预留字段）。
   *
   * 预期来源：daemon stream-json.ts 的 thinking_delta 事件携带（task-11/12 信号）。
   * 同一 segmentId 的 partial 行（增量）与完整行（累积全文）按 mergeThinkingPiece
   * 归并规则去重。当前 daemon 未完全接通 segment_id，故本字段为预留，task-15
   * 渲染层可读取做 turn 分组。
   */
  segmentId?: string;
  /**
   * 语义分类（中文徽标 + 语义筛选用），由 normalize.classifyLog 在归一化阶段设置。
   * 替代原 channel 维度的 logChannelMeta：viewer 据此返回中文标签与着色。
   * 缺失时 viewer 兜底为 "log"。
   */
  semanticCategory?: SemanticCategory;
}
