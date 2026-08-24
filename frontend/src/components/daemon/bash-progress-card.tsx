"use client";

/**
 * task-07（2026-08-24-platform-session-feedback-fix / FR-01 / D-002@v1）：
 * Bash 命令进度卡片。
 *
 * 接收 bash_status 与 bash_chunk 事件聚合后的状态 props，展示命令行、执行状态、
 * 退出码、运行时长与 stdout/stderr 输出片段。running 态显示 spinner；
 * completed/failed 显示退出码徽标与 elapsedMs。输出超过阈值默认折叠。
 *
 * 组件纯展示，不发起 SSE / HTTP 请求；is_final=true 的 chunk 到达时停止 spinner。
 * 颜色走品牌/状态语义阶与 shadow token，适配 AI-Native 双主题。
 */

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Loader2, Terminal, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BashChunkItem {
  channel: "stdout" | "stderr";
  content: string;
  is_final?: boolean;
}

export interface BashProgressCardProps {
  command: string;
  status: "running" | "completed" | "failed";
  exitCode?: number | null;
  elapsedMs?: number | null;
  chunks?: BashChunkItem[];
}

const OUTPUT_COLLAPSE_THRESHOLD = 24;

function formatElapsed(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "";
  const total = Math.max(0, Math.round(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(total / 60))}:${p(total % 60)}.${String(
    Math.floor((ms % 1000) / 100),
  ).padStart(1, "0")}`;
}

function statusIcon(status: BashProgressCardProps["status"]) {
  switch (status) {
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    case "completed":
      return <Check className="h-3.5 w-3.5" />;
    case "failed":
      return <X className="h-3.5 w-3.5" />;
  }
}

function statusClasses(status: BashProgressCardProps["status"]) {
  switch (status) {
    case "running":
      return "bg-brand-100 text-brand-700";
    case "completed":
      return "bg-success/15 text-success";
    case "failed":
      return "bg-error/15 text-error";
  }
}

function effectiveStatus(
  status: BashProgressCardProps["status"],
  isRunning: boolean,
): BashProgressCardProps["status"] {
  if (isRunning) return "running";
  if (status === "failed") return "failed";
  return "completed";
}

export function BashProgressCard({
  command,
  status,
  exitCode,
  elapsedMs,
  chunks = [],
}: BashProgressCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const isRunning = status === "running" && !chunks.some((c) => c.is_final);

  const stdout = useMemo(
    () => chunks.filter((c) => c.channel === "stdout").map((c) => c.content).join(""),
    [chunks],
  );
  const stderr = useMemo(
    () => chunks.filter((c) => c.channel === "stderr").map((c) => c.content).join(""),
    [chunks],
  );

  const combinedLines = useMemo(() => {
    const merged: { channel: "stdout" | "stderr"; text: string }[] = [];
    for (const chunk of chunks) {
      const lines = chunk.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (i > 0) {
          merged.push({ channel: chunk.channel, text: "\n" });
        }
        if (line || i < lines.length - 1 || chunk.content.endsWith("\n")) {
          merged.push({ channel: chunk.channel, text: line });
        }
      }
    }
    return merged;
  }, [chunks]);

  const outputLineCount = combinedLines.filter((l) => l.text === "\n").length + 1;
  const shouldCollapse = outputLineCount > OUTPUT_COLLAPSE_THRESHOLD && !expanded;
  const visibleLines = shouldCollapse
    ? combinedLines.slice(0, Math.max(0, OUTPUT_COLLAPSE_THRESHOLD - 1))
    : combinedLines;

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article
      className="overflow-hidden rounded-md border bg-card shadow-sm"
      data-testid="bash-progress-card"
      data-status={status}
    >
      <header className="flex items-start justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded",
              statusClasses(effectiveStatus(status, isRunning)),
            )}
          >
            {statusIcon(effectiveStatus(status, isRunning))}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">Bash</span>
              {status !== "running" && exitCode !== undefined && exitCode !== null && (
                <Badge
                  variant={status === "failed" ? "destructive" : "default"}
                  className="px-1.5 py-0 text-[10px]"
                >
                  exit {exitCode}
                </Badge>
              )}
              {isRunning && (
                <span className="rounded bg-brand-100 px-1.5 py-0 text-[10px] font-medium text-brand-700">
                  running
                </span>
              )}
            </div>
            {elapsedMs != null && (
              <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                elapsed {formatElapsed(elapsedMs)}
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="space-y-2 px-3 py-2">
        <div className="relative">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/40 px-2 py-1.5 pr-8 font-mono text-[11px] leading-relaxed text-foreground">
            <code>{command}</code>
          </pre>
          <button
            type="button"
            onClick={() => void handleCopyCommand()}
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="复制命令"
            aria-label="复制命令"
          >
            {copied ? (
              <Check className="h-3 w-3 text-success" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>

        {(stdout || stderr) && (
          <div className="rounded border bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="flex items-center justify-between border-b bg-muted/20 px-2 py-1">
              <div className="flex items-center gap-1.5">
                <Terminal className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground">输出</span>
                {stderr && (
                  <span className="rounded bg-error/10 px-1 text-[10px] text-error">
                    stderr
                  </span>
                )}
              </div>
              {outputLineCount > OUTPUT_COLLAPSE_THRESHOLD && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 gap-0.5 px-1 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="h-3 w-3" /> 收起
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" /> 展开全部
                    </>
                  )}
                </Button>
              )}
            </div>
            <pre className="max-h-64 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
              <code>
                {visibleLines.map((line, idx) => (
                  <span
                    key={idx}
                    className={cn(
                      "block",
                      line.channel === "stderr"
                        ? "text-error"
                        : "text-foreground",
                    )}
                  >
                    {line.text}
                  </span>
                ))}
                {shouldCollapse && (
                  <span className="block text-muted-foreground">…</span>
                )}
              </code>
            </pre>
          </div>
        )}
      </div>
    </article>
  );
}
