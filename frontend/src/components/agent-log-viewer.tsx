"use client";

import {
  AlertTriangle,
  CircleDot,
  Clock3,
  CornerDownRight,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Send,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ErrorBoundary } from "@/components/error-boundary";
import { AskUserDialogCard } from "@/components/ask-user-dialog-card";
import { PermissionApprovalCard } from "@/components/permission-approval-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SessionPermissionRequest } from "@/lib/daemon";
import { asString, cn } from "@/lib/utils";
import type { AgentRunLogEntry } from "@/lib/agent";

// New modules
export type { ToolCallEntry, ScanCheckResult, AgentLogInputControls } from "./agent-log/types";
export type { ProcessedLog } from "./agent-log/types";
export {
  COMMAND_COLLAPSE_LINES,
  COMMAND_COLLAPSE_CHARS,
  EMPTY_REPLIED_INPUTS,
  parseToolCallContent,
  parseScanCheckOutput,
  isPendingReplied,
  normalizeLogs,
  isThinkingContent,
  filterToolProtocolLines,
} from "./agent-log/normalize";
export { CopyButton, CollapsibleSection, ToolCallPreview, ToolResultCard } from "./agent-log/tool-renderers";

import {
  isPendingReplied,
  normalizeLogs,
  parseScanCheckOutput,
  parseToolCallContent,
  isThinkingContent,
  filterToolProtocolLines,
  EMPTY_REPLIED_INPUTS,
} from "./agent-log/normalize";
import { ToolCallPreview, CollapsibleSection, ToolResultCard } from "./agent-log/tool-renderers";
import type { AgentLogInputControls, ProcessedLog, ScanCheckResult } from "./agent-log/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * task-15 / FR-10 / D-002@v1：channel 着色强化（参照 prototype:32-38 着色方案）。
 *
 * - user_input 紫（紫边框 + 紫文字）—— 现有 sky 改 violet，强化"用户回合边界"语义
 * - thinking 灰（保持 zinc-600）
 * - assistant 亮黑（保持 zinc-900）
 * - tool 蓝（保持 blue-700）
 * - 成功 result 绿（保持 emerald-700）
 * - 失败 result 红（新增——TOOL_RESULT 行需根据 success 切色；renderLogLines 是纯文本
 *   无 success 信息，保持 emerald；AgentLogRow 的 tool 卡片徽标已单独处理失败红）
 */
function semanticLineClass(line: string): string {
  if (line.startsWith("[TOOL_USE]")) return "font-medium text-blue-700";
  if (line.startsWith("[TOOL_RESULT]")) return "font-medium text-emerald-700";
  if (line.startsWith("[THINKING]")) return "text-zinc-600";
  if (line.startsWith("[RESULT")) return "font-semibold text-sky-700";
  if (line.startsWith("[SYSTEM")) return "font-medium text-amber-800";
  if (line.startsWith("[ASSISTANT]")) return "text-zinc-900";
  return "text-zinc-800";
}

function logChannelMeta(channel: AgentRunLogEntry["channel"]): {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  badgeClass: string;
  rowClass: string;
} {
  switch (channel) {
    case "tool_call":
      return {
        label: "TOOL",
        Icon: Wrench,
        badgeClass: "border-blue-200 bg-blue-50 text-blue-700",
        rowClass: "bg-blue-50/30 hover:bg-blue-50/70",
      };
    case "stderr":
      return {
        label: "WARN",
        Icon: AlertTriangle,
        badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
        rowClass: "bg-amber-50/60 hover:bg-amber-50",
      };
    case "pending_input":
      return {
        label: "ASK",
        Icon: MessageSquareText,
        badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
        rowClass: "bg-amber-50/60 hover:bg-amber-50",
      };
    case "user_input":
      return {
        label: "REPLY",
        Icon: CornerDownRight,
        badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
        rowClass: "bg-violet-50/50 hover:bg-violet-50",
      };
    default:
      return {
        label: "INFO",
        Icon: CircleDot,
        badgeClass: "border-zinc-200 bg-white text-zinc-600",
        rowClass: "hover:bg-zinc-100/60",
      };
  }
}

/* ------------------------------------------------------------------ */
/*  Turn grouping + tool duration (task-15 / FR-10)                    */
/* ------------------------------------------------------------------ */

/**
 * task-15 / FR-10 / D-002@v1：按 user_input / 完整 assistant 消息边界切分 turn。
 *
 * 一个 turn = [user_input?] + thinking段 + assistant 文本 + 其触发的 tool_use/result 集合。
 *
 * 切分规则（design.md §5.4 第 2 点）：
 * - 遇到 channel=user_input → 开启新 turn（用户发言边界）
 * - 遇到 mergedAssistantContent 非空（完整 assistant 消息，normalize 已合并流式 delta）：
 *   - 当前 turn 还没有 assistant 内容（通常紧跟 user_input）→ 归入当前 turn
 *     （构成 user_input + assistant + 其后 tool 的完整回合）
 *   - 当前 turn 已有 assistant 内容 → 开启新 turn（agent 自述新回合，无 user_input）
 * - tool_call / parsedStdoutTool / parsedToolResult / mergedToolResult / mergedThinkingContent
 *   → 归入当前 turn（assistant 触发的工具调用与思考）
 * - 其他 stdout / stderr / pending_input → 归入当前 turn（回合内的过程日志）
 *
 * 边界（task-15 边界 1/7）：
 * - 空 filteredLogs（用户过滤后无日志）→ 返回 []，由上层空态分支兜底
 * - 过滤后无边界（如只剩 tool_call）→ 全部归 1 个 turn（task-15 边界 7）
 */
export function groupIntoTurns(logs: ProcessedLog[]): ProcessedLog[][] {
  const turns: ProcessedLog[][] = [];
  let current: ProcessedLog[] = [];
  let currentHasAssistant = false;
  for (const p of logs) {
    const isUserInput = p.log.channel === "user_input";
    const isAssistantMsg = p.mergedAssistantContent != null
      && p.mergedAssistantContent.trim().length > 0;
    // user_input 总是开新 turn；assistant 仅在当前 turn 已有 assistant 时才开新 turn
    const isTurnBoundary = (isUserInput || (isAssistantMsg && currentHasAssistant))
      && current.length > 0;
    if (isTurnBoundary) {
      turns.push(current);
      current = [];
      currentHasAssistant = false;
    }
    if (isAssistantMsg) currentHasAssistant = true;
    current.push(p);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

/**
 * task-15 / FR-10：thinking 折叠摘要（单行截断）。
 *
 * 参照 prototype:66 `.thinking-summary` 的 `text-overflow: ellipsis`：折叠态只展示
 * 首 60 字符（去换行 + trim）+"..."。展开后 CollapsibleSection 渲染 children 完整内容。
 *
 * 边界（task-15 边界 2）：超长截断；短内容（< 60）原样返回不带 "..."。
 */
function thinkingSummary(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat;
  return flat.slice(0, 60) + "...";
}

function formatLogClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function renderLogLines(content: string) {
  // ql-20260620：入口归一化，防非字符串 content 让 .split 抛错。
  const text = asString(content);
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return <span className="text-zinc-600">空输出</span>;

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const tsMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/);
        const ts = tsMatch ? tsMatch[1] : null;
        const rest = tsMatch ? line.slice(tsMatch[0].length) : line;
        return (
          <div key={`${i}-${rest.slice(0, 16)}`} className={semanticLineClass(rest)}>
            {ts && <span className="mr-1 text-zinc-500">[{ts}]</span>}
            <span>{rest}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ScanCheckSummaryCard                                               */
/* ------------------------------------------------------------------ */

function ScanCheckSummaryCard({ result }: { result: ScanCheckResult }) {
  return (
    <div className="mt-1 rounded-md border border-zinc-200 bg-white px-2.5 py-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold">
        {result.passed ? (
          <span className="text-emerald-700">✓ 扫描自检通过</span>
        ) : (
          <span className="text-red-700">✗ 扫描自检未通过</span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-600">
        <span>文档 <span className="text-zinc-800">{result.scanDocs}</span></span>
        <span>模块 <span className="text-zinc-800">{result.moduleCount}</span></span>
        <span>流程 <span className="text-zinc-800">{result.flowCount}</span></span>
        <span>术语表 <span className={result.glossary ? "text-emerald-700" : "text-red-700"}>{result.glossary ? "✓" : "✗"}</span></span>
        <span>总文件 <span className="text-zinc-800">{result.totalFiles}</span></span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AgentLogRow                                                        */
/* ------------------------------------------------------------------ */

export function AgentLogRow({
  processedLog,
  allLogs,
  compact,
  inputControls,
}: {
  processedLog: ProcessedLog;
  allLogs: ProcessedLog[];
  compact?: boolean;
  inputControls?: AgentLogInputControls;
}) {
  const log = processedLog.log;
  const meta = logChannelMeta(log.channel);
  const toolCall = log.channel === "tool_call"
    ? parseToolCallContent(log.content_redacted)
    : null;
  const repliedInputs = inputControls?.repliedInputs ?? EMPTY_REPLIED_INPUTS;
  const isReplied = log.channel === "pending_input"
    && (repliedInputs.has(log.id) || isPendingReplied(log.timestamp, allLogs.map((p) => p.log)));
  const canReply = log.channel === "pending_input" && inputControls && !isReplied;
  const value = inputControls?.inputValues[log.id] ?? "";
  const submitting = inputControls?.submittingInputs[log.id] ?? false;
  const inputError = inputControls?.inputErrors[log.id];
  const Icon = meta.Icon;

  // ql-20260616-002 / ql-20260620：后端 content_redacted 可为 null 或偶发非字符串，
  // 用 asString 统一降级（null/undefined→""，number/object→String），避免下游 split 崩。
  const contentSafe = asString(log.content_redacted);

  // ql-20260626-001 / bug1：thinking 判定与 normalize 对齐（修多行思考裸露成 INFO）。
  // normalize isThinkingOnly（normalize.ts:594）只看首行 [THINKING] 即设
  // mergedThinkingContent；原 isThinkingContent 要求每行都是 [THINKING]/[SYSTEM]/
  // [ASSISTANT]，对含换行的多行思考（如引用 postcheck-result.json 的输出）返回 false，
  // 导致已标记的思考走默认 renderLogLines 裸露成 INFO 文本（DB 实证 run 6dc3a8d7
  // 16:31:53 思考行 "overall_status: completed_with_warnings - The ONLY warning is"）。
  // 修复：凡 mergedThinkingContent != null 即视为 thinking 走折叠分支，与 normalize 对齐。
  const isThinking = log.channel === "stdout"
    && (processedLog.mergedThinkingContent != null || isThinkingContent(contentSafe));

  // task-15 / FR-10：tool 卡片耗时（tool_use→result 时间戳差）。
  // 仅 tool_call / parsedStdoutTool 卡片计算，其他 channel 不需要。
  const isToolCard = Boolean(toolCall || processedLog.parsedStdoutTool);
  // ql-20260622-003 / P1-2：耗时由 normalize 阶段预算（见 normalize.ts mergeToolResult），
  // render 直接读 processedLog.toolDurationMs，去掉 render 期 allLogs 回查（原 N×M）。
  const toolDurationMs = isToolCard ? processedLog.toolDurationMs : undefined;

  return (
    <div
      className={cn(
        "grid min-w-0 max-w-full grid-cols-[58px_74px_minmax(0,1fr)] gap-2 px-3 py-2 transition-colors sm:grid-cols-[76px_84px_minmax(0,1fr)]",
        compact ? "text-[11px] leading-5" : "text-xs leading-5",
        meta.rowClass,
        isThinking && "opacity-80",
      )}
    >
      <span className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[11px] text-zinc-500">
        <Clock3 className="hidden h-3 w-3 shrink-0 sm:block" />
        <span className="truncate">{formatLogClock(log.timestamp)}</span>
      </span>
      <span
        className={cn(
          "mt-0.5 inline-flex h-5 w-[68px] shrink-0 items-center gap-1 rounded border px-1.5 text-[10px] font-semibold",
          meta.badgeClass,
        )}
      >
        <Icon className="h-3 w-3 shrink-0" />
        {meta.label}
      </span>
      <div className="min-w-0 max-w-full">
        {/* channel=tool_call → specialized renderer */}
        {toolCall ? (
          <div className="font-mono [overflow-wrap:anywhere]">
            <ToolCallPreview
              entry={toolCall}
              mergedResult={processedLog.mergedToolResult}
              durationMs={toolDurationMs}
            />
          </div>
        ) : processedLog.parsedStdoutTool ? (
          /* stdout [TOOL_USE] parsed as tool event → specialized renderer */
          <div className="font-mono [overflow-wrap:anywhere]">
            <ToolCallPreview
              entry={processedLog.parsedStdoutTool}
              mergedResult={processedLog.mergedToolResult}
              durationMs={toolDurationMs}
            />
          </div>
        ) : processedLog.parsedToolResult ? (
          /* Orphan [TOOL_RESULT] → standalone ToolResultCard */
          <div className="font-mono [overflow-wrap:anywhere]">
            <ToolResultCard body={processedLog.parsedToolResult} />
          </div>
        ) : processedLog.mergedAssistantContent != null ? (
          <div className="min-w-0 max-w-full whitespace-pre-wrap break-words font-mono text-zinc-800 [overflow-wrap:anywhere]">
            {processedLog.mergedAssistantContent}
          </div>
        ) : isThinking ? (
          /* ql-20260617-011 + task-15 / FR-10：纯 [THINKING] delta 合并后渲染为完整段落。
             task-15：thinking 默认折叠成单行摘要（60 字符 + "..."），点击展开全文。
             参照 prototype:62-69 `.thinking-toggle/.thinking-summary`。
             [SYSTEM] 折叠块保持原样（defaultOpen=true，非 thinking 内容）。 */
          <div className="font-mono [overflow-wrap:anywhere]">
            {processedLog.mergedThinkingContent != null ? (
              <CollapsibleSection
                title="思考"
                defaultOpen={false}
                summary={thinkingSummary(processedLog.mergedThinkingContent)}
              >
                <div className="whitespace-pre-wrap break-words text-zinc-600">
                  {processedLog.mergedThinkingContent}
                </div>
              </CollapsibleSection>
            ) : (
              <CollapsibleSection title="系统">
                {renderLogLines(contentSafe)}
              </CollapsibleSection>
            )}
          </div>
        ) : (
          /* Default rendering — filter out all protocol lines */
          <div
            className={cn(
              "min-w-0 max-w-full whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]",
              log.channel === "stderr" ? "font-medium text-amber-800" : "text-zinc-800",
            )}
          >
            {(() => {
              const scanCheck = log.channel === "stdout" ? parseScanCheckOutput(contentSafe) : null;
              const filteredContent = log.channel === "stdout"
                ? filterToolProtocolLines(contentSafe)
                : contentSafe;
              const hasContent = filteredContent.trim().length > 0;
              return (
                <>
                  {scanCheck && <ScanCheckSummaryCard result={scanCheck} />}
                  {hasContent && (
                    <div className={scanCheck ? "mt-1" : ""}>
                      {renderLogLines(filteredContent)}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Pending input controls */}
        {log.channel === "pending_input" && (
          <div className="mt-2 min-w-0 max-w-full">
            {isReplied ? (
              <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                已回复
              </span>
            ) : canReply ? (
              <>
                <div className="flex min-w-0 max-w-full flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 sm:flex-row">
                  <Input
                    placeholder="输入指导文本..."
                    value={value}
                    onChange={(e) => inputControls.onChange(log.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        inputControls.onSubmit(log.id);
                      }
                    }}
                    disabled={submitting}
                    className="h-8 min-w-0 border-zinc-200 bg-white text-xs text-zinc-800 placeholder:text-zinc-400"
                  />
                  <Button
                    size="sm"
                    onClick={() => inputControls.onSubmit(log.id)}
                    disabled={!value.trim() || submitting}
                    className="h-8 shrink-0"
                  >
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                    {submitting ? "提交中" : "提交"}
                  </Button>
                </div>
                {inputError && (
                  <p className="mt-1 text-xs text-red-700">{inputError}</p>
                )}
              </>
            ) : (
              <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
                等待用户指导
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TurnBlock (task-15 / FR-10)                                        */
/* ------------------------------------------------------------------ */

/**
 * task-15 / FR-10 / D-002@v1：单个 turn 的渲染容器。
 *
 * - turn-head：Turn N + 时间范围（turn 内首末时间戳 "HH:MM:SS → HH:MM:SS"），
 *   参照 prototype:151-155 `.turn-head/.turn-num/.turn-ts`。
 * - turn-body：按顺序渲染各 AgentLogRow（thinking 折叠、tool 卡片、assistant、user_input）。
 *
 * 兼容（task-15 实现要求 §4）：
 * - compact：turn-head 简化（不显示时间范围，只 Turn N）
 * - embedded（variant="embedded"）：turn 边框弱化（无 border，仅底部 divider）
 */
function TurnBlock({
  turnLogs,
  turnIdx,
  compact,
  embedded,
  inputControls,
  allLogs,
}: {
  turnLogs: ProcessedLog[];
  turnIdx: number;
  compact?: boolean;
  embedded?: boolean;
  inputControls?: AgentLogInputControls;
  allLogs: ProcessedLog[];
}): JSX.Element {
  if (turnLogs.length === 0) return <></>;

  const timestamps = turnLogs
    .map((p) => p.log.timestamp)
    .filter((ts): ts is string => Boolean(ts));
  const firstTs = timestamps[0];
  const lastTs = timestamps[timestamps.length - 1];
  const showTimeRange = !compact && firstTs && lastTs && firstTs !== lastTs;
  const timeRangeText = showTimeRange
    ? `${formatLogClock(firstTs!)} → ${formatLogClock(lastTs!)}`
    : firstTs && !compact
      ? formatLogClock(firstTs)
      : null;

  return (
    <div
      className={cn(
        "min-w-0",
        embedded
          ? "border-b border-zinc-100 last:border-b-0"
          : "rounded-md border border-zinc-200 bg-white",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5",
          embedded ? "bg-transparent" : "border-b border-zinc-100 bg-zinc-50/70",
        )}
      >
        <span className="inline-flex items-center rounded bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">
          Turn {turnIdx + 1}
        </span>
        {timeRangeText && (
          <span className="text-[10px] text-zinc-400">{timeRangeText}</span>
        )}
      </div>
      <div className="min-w-0 divide-y divide-zinc-100">
        {turnLogs.map((plog) => (
          // 保留单条 AgentLogRow 的 ErrorBoundary 隔离（task-15 边界 5 双层隔离）：
          // 某条日志渲染失败不影响同 turn 其他条目。
          <ErrorBoundary
            key={plog.log.id}
            label="agent-log-row"
            fallback={() => (
              <div className="px-3 py-2 text-[11px] text-red-600/70">
                该条日志渲染失败
              </div>
            )}
          >
            <AgentLogRow
              processedLog={plog}
              allLogs={allLogs}
              compact={compact}
              inputControls={inputControls}
            />
          </ErrorBoundary>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AgentLogViewer                                                     */
/* ------------------------------------------------------------------ */

export function AgentLogViewer({
  title,
  runId,
  logs,
  loading,
  emptyText,
  maxHeightClass = "max-h-[720px]",
  compact,
  variant = "panel",
  isLive,
  defaultViewMode = "conversation",
  containerRef,
  summary,
  actions,
  inputControls,
  permissionRequests,
  onPermissionResolved,
}: {
  title: string;
  runId: string;
  logs: AgentRunLogEntry[] | null;
  loading: boolean;
  emptyText: string;
  maxHeightClass?: string;
  compact?: boolean;
  variant?: "panel" | "embedded";
  isLive?: boolean;
  /**
   * ql-20260626-001 / bug2：默认视图模式。
   * - conversation（默认）：只显 agent 接收（user_input）+ 答复（assistant/pending_input）
   * - all：全显（含 thinking / tool / 系统摘要），保留原 channel 二级筛选
   */
  defaultViewMode?: "conversation" | "all";
  containerRef?: React.RefObject<HTMLDivElement>;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  inputControls?: AgentLogInputControls;
  /**
   * ql-20260621：待决策的 permission_request 列表（Claude Code AskUserQuestion
   * 触发的远程人审）。父组件订阅 run SSE 的 permission_request / permission_resolved
   * 事件维护此列表；本组件在 ASK 区渲染审批卡片，卡片内部自调 respondSessionPermission。
   */
  permissionRequests?: SessionPermissionRequest[];
  /** 卡片决策/超时后被父组件移除时触发（同步本地 permissionRequests 状态）。 */
  onPermissionResolved?: (requestId: string, decision: "allow" | "deny") => void;
}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const scrollRef = containerRef ?? internalRef;
  const [fullscreen, setFullscreen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  // ql-20260626-001 / bug2：视图模式（对话默认 / 全部），单选 tab。恢复 ql-20260625-003
  // 丢失的"默认只显 agent 接收+答复、不默认展示工具调用"诉求（该 quicklog 改动从未
  // commit 进 main，agent-log-viewer.tsx 最近 commit 是 6-23 c1e30256）。
  const [viewMode, setViewMode] = useState<"conversation" | "all">(defaultViewMode);

  // ql-20260622-003 / P1-1：normalize + 过滤 + turn 分组全部 memo，依赖 logs 引用 /
  // activeFilters，避免大日志列表每次 render 全量重算（normalize O(N)、turn 分组 O(N)）。
  const processedLogs = useMemo(() => normalizeLogs(logs ?? []), [logs]);
  const visibleLogs = useMemo(
    () => processedLogs.filter((p) => !p.hidden),
    [processedLogs],
  );
  // ql-20260626-001 / bug2：对话视图过滤——只保留 agent 接收（user_input）+ agent 答复
  // （mergedAssistantContent / pending_input 提问），隐藏 thinking / tool_call / 系统
  // 摘要 stdout。全部视图维持原 channel 二级筛选（activeFilters）。
  const isConversationLog = useCallback(
    (p: ProcessedLog) =>
      p.log.channel === "user_input"
      || p.log.channel === "pending_input"
      || p.mergedAssistantContent != null,
    [],
  );
  const filteredLogs = useMemo(() => {
    if (viewMode === "conversation") {
      return visibleLogs.filter(isConversationLog);
    }
    return activeFilters.size > 0
      ? visibleLogs.filter((p) => activeFilters.has(p.log.channel))
      : visibleLogs;
  }, [visibleLogs, viewMode, activeFilters, isConversationLog]);
  const turns = useMemo(() => groupIntoTurns(filteredLogs), [filteredLogs]);

  // ql-20260621：审批卡片随 ASK 通道展示——无过滤或 ASK(pending_input) 过滤时可见。
  // 卡片是阻塞 agent 的紧急人审，单卡交互由 PermissionApprovalCard 自洽
  // （自调 respondSessionPermission + onResolved 回父组件移除）。
  const hasPermissionCards =
    !!permissionRequests &&
    permissionRequests.length > 0 &&
    // ql-20260626-001 / bug2：对话视图始终展示审批/提问卡片（pending_input 是对话一部分）；
    // 全部视图维持原 activeFilters 判定。
    (viewMode === "conversation" || activeFilters.size === 0 || activeFilters.has("pending_input"));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredLogs.length, scrollRef]);

  useEffect(() => {
    if (fullscreen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [fullscreen]);

  const channelFilters = [
    { key: "stdout", label: "INFO" },
    { key: "tool_call", label: "TOOL" },
    { key: "stderr", label: "WARN" },
    { key: "pending_input", label: "ASK" },
    { key: "user_input", label: "REPLY" },
  ];

  function toggleFilter(key: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden bg-white text-zinc-800",
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col"
          : "max-w-full",
        !fullscreen && variant === "panel" && "rounded-md border border-zinc-200 shadow-sm",
      )}
    >
      <div className={cn(
        "flex flex-col gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        compact && "px-3 py-2",
      )}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium text-zinc-800">{title}</span>
          <code className="truncate font-mono text-[11px] text-zinc-500">{runId.length > 8 ? runId.slice(0, 8) + "..." : runId}</code>
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              LIVE
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* ql-20260626-001 / bug2：视图 tab（对话默认 / 全部），单选 */}
          <div className="flex items-center gap-0.5 rounded border border-zinc-200 bg-zinc-50 p-0.5">
            {(["conversation", "all"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={cn(
                  "inline-flex h-5 items-center rounded px-2 text-[10px] font-semibold transition-colors",
                  viewMode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-zinc-600 hover:text-zinc-900",
                )}
              >
                {m === "conversation" ? "对话" : "全部"}
              </button>
            ))}
          </div>
          {/* 全部视图下保留 channel 二级筛选（原 5 按钮） */}
          {viewMode === "all" && channelFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => toggleFilter(f.key)}
              className={cn(
                "inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-semibold transition-colors",
                activeFilters.has(f.key)
                  ? "border-blue-500/40 bg-blue-500/15 text-blue-700"
                  : "border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900",
              )}
            >
              {f.label}
            </button>
          ))}
          {viewMode === "all" && activeFilters.size > 0 && (
            <button
              onClick={() => setActiveFilters(new Set())}
              className="text-[10px] text-zinc-500 hover:text-zinc-800"
            >
              清除
            </button>
          )}
          {summary}
          {actions}
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            title={fullscreen ? "退出全屏" : "全屏"}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={cn(
          "min-w-0 overflow-y-auto overflow-x-hidden font-mono",
          fullscreen ? "flex-1" : "max-w-full",
          !fullscreen && maxHeightClass,
        )}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-xs text-zinc-500">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
            加载日志中...
          </div>
        ) : filteredLogs.length === 0 && !hasPermissionCards ? (
          <p className="px-4 py-10 text-center text-xs text-zinc-600">
            {visibleLogs.length === 0
              ? emptyText
              : viewMode === "conversation"
                ? "暂无对话消息（工具调用/思考已隐藏，切到「全部」查看完整日志）"
                : "无匹配日志"}
          </p>
        ) : (
          <>
            {/* ql-20260621：ASK 区审批卡片——Claude Code AskUserQuestion 远程人审。
                无 timestamp 不进日志流，由父组件订阅 permission_request SSE 维护此列表。 */}
            {hasPermissionCards && permissionRequests && (
              <div className="sticky top-0 z-10 space-y-2 border-b border-amber-300 bg-amber-50/95 px-3 py-2 backdrop-blur-sm shadow-sm">
                {permissionRequests.map((req) =>
                  req.dialog_kind ? (
                    <ErrorBoundary
                      key={req.request_id}
                      label="ask-user-dialog-card"
                      fallback={() => (
                        <div className="text-[11px] text-red-600/70">
                          提问卡片渲染失败
                        </div>
                      )}
                    >
                      <AskUserDialogCard
                        request={req}
                        onResolved={onPermissionResolved}
                      />
                    </ErrorBoundary>
                  ) : (
                    <ErrorBoundary
                      key={req.request_id}
                      label="permission-approval-card"
                      fallback={() => (
                        <div className="text-[11px] text-red-600/70">
                          审批卡片渲染失败
                        </div>
                      )}
                    >
                      <PermissionApprovalCard
                        request={req}
                        onResolved={onPermissionResolved}
                      />
                    </ErrorBoundary>
                  ),
                )}
              </div>
            )}
            {filteredLogs.length > 0 && (
              <div className="min-w-0 max-w-full space-y-2 p-2">
                {turns.map((turnLogs, turnIdx) => (
                  // task-15 / FR-10：turn 分组渲染——单 turn 渲染失败不影响其他 turn
                  // （ErrorBoundary 双层隔离：外层 turn 级，内层 row 级见 TurnBlock）。
                  <ErrorBoundary
                    key={`turn-${turnIdx}`}
                    label="agent-log-turn"
                    fallback={() => (
                      <div className="px-3 py-2 text-[11px] text-red-600/70">
                        该 turn 渲染失败
                      </div>
                    )}
                  >
                    <TurnBlock
                      turnLogs={turnLogs}
                      turnIdx={turnIdx}
                      compact={compact}
                      embedded={variant === "embedded"}
                      inputControls={inputControls}
                      allLogs={processedLogs}
                    />
                  </ErrorBoundary>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
