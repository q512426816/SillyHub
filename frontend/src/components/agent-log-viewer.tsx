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
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
        badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
        rowClass: "bg-sky-50/50 hover:bg-sky-50",
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

function formatLogClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function renderLogLines(content: string) {
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
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

  // ql-20260616-002：后端 content_redacted 可为 null,所有依赖处统一降级为 ""。
  const contentSafe = log.content_redacted ?? "";

  // Check if stdout is thinking-only content
  const isThinking = log.channel === "stdout" && isThinkingContent(contentSafe);

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
            />
          </div>
        ) : processedLog.parsedStdoutTool ? (
          /* stdout [TOOL_USE] parsed as tool event → specialized renderer */
          <div className="font-mono [overflow-wrap:anywhere]">
            <ToolCallPreview
              entry={processedLog.parsedStdoutTool}
              mergedResult={processedLog.mergedToolResult}
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
          /* ql-20260617-011：纯 [THINKING] delta 合并后渲染为完整段落；
             [SYSTEM] 折叠块与 assistant 分开显示。 */
          <div className="font-mono [overflow-wrap:anywhere]">
            {processedLog.mergedThinkingContent != null ? (
              <CollapsibleSection title="思考">
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
  containerRef,
  summary,
  actions,
  inputControls,
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
  containerRef?: React.RefObject<HTMLDivElement>;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  inputControls?: AgentLogInputControls;
}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const scrollRef = containerRef ?? internalRef;
  const [fullscreen, setFullscreen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  // Normalize raw logs → ProcessedLog[]
  const processedLogs = normalizeLogs(logs ?? []);

  // Apply channel filter to normalized (non-hidden) entries
  const visibleLogs = processedLogs.filter((p) => !p.hidden);
  const filteredLogs = activeFilters.size > 0
    ? visibleLogs.filter((p) => activeFilters.has(p.log.channel))
    : visibleLogs;

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
          {channelFilters.map((f) => (
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
          {activeFilters.size > 0 && (
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
        ) : filteredLogs.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-zinc-600">
            {visibleLogs.length === 0 ? emptyText : "无匹配日志"}
          </p>
        ) : (
          <div className="min-w-0 max-w-full divide-y divide-zinc-200">
            {filteredLogs.map((plog) => (
              <AgentLogRow
                key={plog.log.id}
                processedLog={plog}
                allLogs={processedLogs}
                compact={compact}
                inputControls={inputControls}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
