"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  CornerDownRight,
  MessageSquareText,
  Send,
  Wrench,
} from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AgentRunLogEntry } from "@/lib/agent";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const COMMAND_COLLAPSE_LINES = 5;
export const COMMAND_COLLAPSE_CHARS = 500;
export const EMPTY_REPLIED_INPUTS = new Set<string>();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

function stringifyToolArgs(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function semanticLineClass(line: string): string {
  if (line.startsWith("[TOOL_USE]")) return "text-blue-400";
  if (line.startsWith("[TOOL_RESULT]")) return "text-emerald-400";
  if (line.startsWith("[THINKING]")) return "text-zinc-500";
  if (line.startsWith("[RESULT")) return "text-sky-300 font-medium";
  if (line.startsWith("[SYSTEM")) return "text-amber-400";
  if (line.startsWith("[ASSISTANT]")) return "text-zinc-300";
  return "text-zinc-400";
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
        badgeClass: "border-blue-500/30 bg-blue-500/10 text-blue-300",
        rowClass: "hover:bg-blue-500/[0.04]",
      };
    case "stderr":
      return {
        label: "WARN",
        Icon: AlertTriangle,
        badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-300",
        rowClass: "bg-amber-500/[0.03] hover:bg-amber-500/[0.07]",
      };
    case "pending_input":
      return {
        label: "ASK",
        Icon: MessageSquareText,
        badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-300",
        rowClass: "bg-amber-500/[0.04] hover:bg-amber-500/[0.08]",
      };
    case "user_input":
      return {
        label: "REPLY",
        Icon: CornerDownRight,
        badgeClass: "border-sky-500/30 bg-sky-500/10 text-sky-300",
        rowClass: "bg-sky-500/[0.03] hover:bg-sky-500/[0.07]",
      };
    default:
      return {
        label: "INFO",
        Icon: CircleDot,
        badgeClass: "border-zinc-700 bg-zinc-900 text-zinc-400",
        rowClass: "hover:bg-white/[0.03]",
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
            {ts && <span className="mr-1 text-zinc-600">[{ts}]</span>}
            <span>{rest}</span>
          </div>
        );
      })}
    </div>
  );
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

export function parseScanCheckOutput(text: string): ScanCheckResult | null {
  const scanDocsMatch = text.match(/Scan\s*文档\s*\((\d+\/\d+)\)/i) || text.match(/scan.*?(\d+\/\d+)/i);
  const moduleMatch = text.match(/(\d+)\s*个?\s*模块/i) || text.match(/module.*?(\d+)/i);
  const flowMatch = text.match(/(\d+)\s*个?\s*流程/i) || text.match(/flow.*?(\d+)/i);
  const glossaryOk = /glossary.*?存在/i.test(text) || /glossary\.md.*?✅/i.test(text);
  const totalMatch = text.match(/总文件数[:\s]*(\d+)/i) || text.match(/total.*?(\d+)/i);
  const passed = /全部通过|✅.*?通过|self.check.*?pass/i.test(text) && !/❌/.test(text.split("自检结果")[1] ?? text);

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

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      title={label}
    >
      <Copy className="h-2.5 w-2.5" />
      {copied ? "已复制" : label}
    </button>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

function BashToolPreview({ entry }: { entry: ToolCallEntry }) {
  const desc = entry.description;
  const cmd = entry.command ?? "";
  const cmdLines = cmd.split("\n");
  const cmdTooLong = cmdLines.length > COMMAND_COLLAPSE_LINES || cmd.length > COMMAND_COLLAPSE_CHARS;
  const firstLine = cmdLines[0] ?? "";
  const title = desc || (cmd ? firstLine.slice(0, 80) + (firstLine.length > 80 ? "..." : "") : entry.tool);

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">Bash</span>
        <span className="min-w-0 break-words text-xs text-zinc-200 [overflow-wrap:anywhere]">{title}</span>
        <span
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
            entry.status === "pending"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
              : entry.success
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-300",
          )}
        >
          {entry.status === "pending" ? "待审批" : entry.success ? "已通过" : "失败"}
        </span>
      </div>
      {cmd && (
        <div>
          {cmdTooLong ? (
            <CollapsibleSection title="执行命令">
              <div className="relative">
                <pre className="max-w-full whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-black/30 px-2 py-1 text-[11px] leading-5 text-zinc-400 [overflow-wrap:anywhere]">
                  {cmd}
                </pre>
                <div className="mt-1">
                  <CopyButton text={cmd} label="复制命令" />
                </div>
              </div>
            </CollapsibleSection>
          ) : (
            <div>
              <pre className="max-w-full whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-black/20 px-2 py-1 text-[11px] leading-5 text-zinc-400 [overflow-wrap:anywhere]">
                {cmd}
              </pre>
              <div className="mt-1">
                <CopyButton text={cmd} label="复制命令" />
              </div>
            </div>
          )}
        </div>
      )}
      <CollapsibleSection title="原始数据">
        <pre className="max-w-full whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-black/20 px-2 py-1 text-[10px] leading-4 text-zinc-500 [overflow-wrap:anywhere]">
          {entry.args}
        </pre>
      </CollapsibleSection>
    </div>
  );
}

function GenericToolPreview({ entry }: { entry: ToolCallEntry }) {
  const isBash = entry.tool === "Bash" || entry.tool === "bash";
  if (isBash) return <BashToolPreview entry={entry} />;

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-words font-semibold text-blue-200 [overflow-wrap:anywhere]">
          {entry.tool}
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
            entry.status === "pending"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
              : entry.success
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-300",
          )}
        >
          {entry.status === "pending" ? "待审批" : entry.success ? "已通过" : "失败"}
        </span>
      </div>
      {entry.args && (
        <CollapsibleSection
          title="参数"
          defaultOpen={entry.args.length < 300}
        >
          <pre className="max-w-full whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-black/20 px-2 py-1 text-[11px] leading-5 text-zinc-400 [overflow-wrap:anywhere]">
            {entry.args}
          </pre>
        </CollapsibleSection>
      )}
    </div>
  );
}

function ToolCallPreview({ entry }: { entry: ToolCallEntry }) {
  const isBash = entry.tool === "Bash" || entry.tool === "bash";
  if (isBash) return <BashToolPreview entry={entry} />;
  return <GenericToolPreview entry={entry} />;
}

function ScanCheckSummaryCard({ result }: { result: ScanCheckResult }) {
  return (
    <div className="mt-1 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold">
        {result.passed ? (
          <span className="text-emerald-400">✓ 扫描自检通过</span>
        ) : (
          <span className="text-red-400">✗ 扫描自检未通过</span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
        <span>文档 <span className="text-zinc-200">{result.scanDocs}</span></span>
        <span>模块 <span className="text-zinc-200">{result.moduleCount}</span></span>
        <span>流程 <span className="text-zinc-200">{result.flowCount}</span></span>
        <span>术语表 <span className={result.glossary ? "text-emerald-400" : "text-red-400"}>{result.glossary ? "✓" : "✗"}</span></span>
        <span>总文件 <span className="text-zinc-200">{result.totalFiles}</span></span>
      </div>
    </div>
  );
}

export function AgentLogRow({
  log,
  logs,
  compact,
  inputControls,
}: {
  log: AgentRunLogEntry;
  logs: AgentRunLogEntry[];
  compact?: boolean;
  inputControls?: AgentLogInputControls;
}) {
  const meta = logChannelMeta(log.channel);
  const toolCall = log.channel === "tool_call"
    ? parseToolCallContent(log.content_redacted)
    : null;
  const repliedInputs = inputControls?.repliedInputs ?? EMPTY_REPLIED_INPUTS;
  const isReplied = log.channel === "pending_input"
    && (repliedInputs.has(log.id) || isPendingReplied(log.timestamp, logs));
  const canReply = log.channel === "pending_input" && inputControls && !isReplied;
  const value = inputControls?.inputValues[log.id] ?? "";
  const submitting = inputControls?.submittingInputs[log.id] ?? false;
  const inputError = inputControls?.inputErrors[log.id];
  const Icon = meta.Icon;

  return (
    <div
      className={cn(
        "grid min-w-0 max-w-full grid-cols-[58px_74px_minmax(0,1fr)] gap-2 px-3 py-2 transition-colors sm:grid-cols-[76px_84px_minmax(0,1fr)]",
        compact ? "text-[11px] leading-5" : "text-xs leading-5",
        meta.rowClass,
      )}
    >
      <span className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[11px] text-zinc-600">
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
        <div
          className={cn(
            "min-w-0 max-w-full whitespace-pre-wrap break-words font-mono [overflow-wrap:anywhere]",
            log.channel === "stderr" ? "text-amber-200" : "text-zinc-300",
          )}
        >
          {toolCall ? <ToolCallPreview entry={toolCall} /> : (() => {
            const scanCheck = log.channel === "stdout" ? parseScanCheckOutput(log.content_redacted) : null;
            return (
              <>
                {scanCheck && <ScanCheckSummaryCard result={scanCheck} />}
                <div className={scanCheck ? "mt-1" : ""}>
                  {renderLogLines(log.content_redacted)}
                </div>
              </>
            );
          })()}
        </div>

        {log.channel === "pending_input" && (
          <div className="mt-2 min-w-0 max-w-full">
            {isReplied ? (
              <span className="inline-flex items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300">
                已回复
              </span>
            ) : canReply ? (
              <>
                <div className="flex min-w-0 max-w-full flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-950/30 px-2.5 py-2 sm:flex-row">
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
                    className="h-8 min-w-0 border-zinc-700 bg-zinc-900 text-xs text-zinc-200 placeholder:text-zinc-600"
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
                  <p className="mt-1 text-xs text-red-300">{inputError}</p>
                )}
              </>
            ) : (
              <span className="inline-flex items-center rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300">
                等待用户指导
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
  const logEntries = logs ?? [];

  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-hidden bg-zinc-950 text-zinc-300",
        variant === "panel" && "rounded-md border border-zinc-800 shadow-sm",
      )}
    >
      <div className={cn(
        "flex flex-col gap-2 border-b border-zinc-800 bg-zinc-950 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        compact && "px-3 py-2",
      )}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium text-zinc-200">{title}</span>
          <code className="truncate font-mono text-[11px] text-zinc-500">{runId.length > 8 ? runId.slice(0, 8) + "..." : runId}</code>
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              LIVE
            </span>
          )}
        </div>
        {(summary || actions) && (
          <div className="flex flex-wrap items-center gap-2">
            {summary}
            {actions}
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        className={cn(
          "min-w-0 max-w-full overflow-y-auto overflow-x-hidden font-mono",
          maxHeightClass,
        )}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-xs text-zinc-500">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
            加载日志中...
          </div>
        ) : logEntries.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-zinc-600">{emptyText}</p>
        ) : (
          <div className="min-w-0 max-w-full divide-y divide-zinc-900/90">
            {logEntries.map((log) => (
              <AgentLogRow
                key={log.id}
                log={log}
                logs={logEntries}
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
