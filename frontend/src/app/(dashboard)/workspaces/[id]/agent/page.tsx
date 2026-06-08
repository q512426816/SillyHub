"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  getAgentRunLogs,
  killAgentRun,
  listAgentRuns,
  streamAgentRunLogs,
  submitAgentRunInput,
  type AgentRun,
  type AgentRunLogEntry,
} from "@/lib/agent";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  params: { id: string };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function calcDuration(run: AgentRun): string {
  if (run.status === "running" && run.started_at) {
    return formatDuration(Date.now() - new Date(run.started_at).getTime());
  }
  if (run.started_at && run.finished_at) {
    return formatDuration(
      new Date(run.finished_at).getTime() - new Date(run.started_at).getTime(),
    );
  }
  return "—";
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "..." : id;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type ToolCallEntry = {
  timestamp: string;
  tool: string;
  args: string;
  status: "allowed" | "pending";
  success: boolean;
};

function parseToolCallContent(raw: string): ToolCallEntry | null {
  try {
    const obj = JSON.parse(raw);
    return {
      timestamp: obj.timestamp ?? "",
      tool: obj.tool ?? obj.name ?? "unknown",
      args: obj.args ?? obj.arguments ?? "",
      status: obj.requires_approval ? "pending" : "allowed",
      success: obj.success !== false,
    };
  } catch {
    return null;
  }
}

function lineClass(line: string): string {
  if (line.startsWith("[TOOL_USE]")) return "text-blue-400";
  if (line.startsWith("[TOOL_RESULT]")) return "text-emerald-400";
  if (line.startsWith("[THINKING]")) return "text-zinc-500 italic";
  if (line.startsWith("[RESULT")) return "text-sky-300 font-medium";
  if (line.startsWith("[SYSTEM")) return "text-amber-400";
  if (line.startsWith("[ASSISTANT]")) return "text-zinc-300";
  return "text-zinc-400";
}

function renderConversationLog(content: string) {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        if (!line.trim()) return null;
        const tsMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/);
        const ts = tsMatch ? tsMatch[1] : null;
        const rest = tsMatch ? line.slice(tsMatch[0].length) : line;
        return (
          <div key={i} className={lineClass(rest)}>
            {ts && (
              <span className="text-zinc-600">[{ts}] </span>
            )}
            {rest}
          </div>
        );
      })}
    </>
  );
}

function levelTag(channel: string): {
  label: string;
  cls: string;
} {
  switch (channel) {
    case "tool_call":
      return { label: "TOOL", cls: "text-blue-400" };
    case "stderr":
      return { label: "WARN", cls: "text-amber-400" };
    case "pending_input":
      return { label: "PENDING", cls: "text-amber-300 font-medium" };
    case "user_input":
      return { label: "INPUT", cls: "text-sky-300 font-medium" };
    default:
      return { label: "INFO", cls: "text-zinc-500" };
  }
}

function isPendingReplied(
  logTimestamp: string,
  allLogs: AgentRunLogEntry[],
): boolean {
  return allLogs.some(
    (l) =>
      l.channel === "user_input" &&
      l.timestamp >= logTimestamp,
  );
}

const STATUS_CONFIG: Record<string, { label: string; badge: "success" | "destructive" | "warning"; dot: string }> = {
  completed: { label: "已完成", badge: "success", dot: "bg-emerald-500" },
  failed: { label: "失败", badge: "destructive", dot: "bg-red-500" },
  killed: { label: "已终止", badge: "warning", dot: "bg-amber-500" },
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-xs font-medium">{children}</span>
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-xs font-semibold ${accent ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function AgentPage({ params }: Props) {
  const workspaceId = params.id;

  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeLogs, setActiveLogs] = useState<AgentRunLogEntry[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<AgentRunLogEntry[] | null>(null);
  const [expandedLogsLoading, setExpandedLogsLoading] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [submittingInputs, setSubmittingInputs] = useState<Record<string, boolean>>({});
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [repliedInputs, setRepliedInputs] = useState<Set<string>>(new Set());

  /* ---- Derived ---- */
  const runningRuns = useMemo(
    () => (runs ?? []).filter((r) => r.status === "running"),
    [runs],
  );
  const completedRuns = useMemo(
    () =>
      (runs ?? []).filter(
        (r) => r.status === "completed" || r.status === "failed" || r.status === "killed",
      ),
    [runs],
  );

  const activeToolCalls = useMemo(() => {
    if (!activeLogs) return [];
    return activeLogs
      .filter((l) => l.channel === "tool_call")
      .map((l) => parseToolCallContent(l.content_redacted))
      .filter(Boolean) as ToolCallEntry[];
  }, [activeLogs]);

  const toolSummary = useMemo(() => {
    const success = activeToolCalls.filter((t) => t.success && t.status === "allowed").length;
    const failed = activeToolCalls.filter((t) => !t.success).length;
    const pending = activeToolCalls.filter((t) => t.status === "pending").length;
    const pendingGuidance = activeLogs
      ? activeLogs.filter(
          (l) =>
            l.channel === "pending_input" &&
            !isPendingReplied(l.timestamp, activeLogs) &&
            !repliedInputs.has(l.id),
        ).length
      : 0;
    return { success, failed, pending, pendingGuidance };
  }, [activeToolCalls, activeLogs, repliedInputs]);

  /* ---- Load runs ---- */
  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await listAgentRuns(workspaceId);
      setRuns(list);
    } catch (err) {
      setRuns([]);
      setError(err instanceof ApiError ? err.message : "加载 Agent 运行记录失败");
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* ---- Auto-refresh while running ---- */
  useEffect(() => {
    if (runningRuns.length === 0) return;
    const timer = setInterval(() => void reload(), 5_000);
    return () => clearInterval(timer);
  }, [runningRuns.length, reload]);

  /* ---- Load active run logs ---- */
  const handleSelectActive = useCallback(
    async (runId: string) => {
      if (activeRunId === runId) {
        setActiveRunId(null);
        setActiveLogs(null);
        return;
      }
      setActiveRunId(runId);
      setLogsLoading(true);
      setActiveLogs(null);
      try {
        const logs = await getAgentRunLogs(workspaceId, runId);
        setActiveLogs(logs);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载日志失败");
      } finally {
        setLogsLoading(false);
      }
    },
    [activeRunId, workspaceId],
  );

  const handleKill = useCallback(
    async (runId: string) => {
      try {
        await killAgentRun(workspaceId, runId);
        reload();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "停止 Agent 失败");
      }
    },
    [workspaceId, reload],
  );

  /* ---- Stream active logs via SSE (running) ---- */
  useEffect(() => {
    if (!activeRunId) return;

    const run = runs?.find((r) => r.id === activeRunId);
    if (!run || run.status !== "running") return;

    const es = streamAgentRunLogs(
      workspaceId,
      activeRunId,
      (event) => {
        setActiveLogs((prev) => [
          ...(prev ?? []),
          {
            id: crypto.randomUUID(),
            run_id: activeRunId,
            timestamp: event.timestamp,
            channel: event.channel,
            content_redacted: event.content,
          },
        ]);
      },
      () => {
        void reload();
      },
    );

    return () => es.close();
  }, [activeRunId, workspaceId, runs, reload]);

  /* ---- Expand completed run logs ---- */
  const handleExpandLogs = useCallback(
    async (runId: string) => {
      if (expandedRunId === runId) {
        setExpandedRunId(null);
        setExpandedLogs(null);
        return;
      }
      setExpandedRunId(runId);
      setExpandedLogsLoading(true);
      setExpandedLogs(null);
      try {
        const logs = await getAgentRunLogs(workspaceId, runId);
        setExpandedLogs(logs);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载日志失败");
      } finally {
        setExpandedLogsLoading(false);
      }
    },
    [expandedRunId, workspaceId],
  );

  /* ---- Submit user guidance for pending_input ---- */
  const handleSubmitInput = useCallback(
    async (pendingLogId: string, runId: string) => {
      const content = inputValues[pendingLogId]?.trim();
      if (!content) return;

      setSubmittingInputs((prev) => ({ ...prev, [pendingLogId]: true }));
      setInputErrors((prev) => {
        const next = { ...prev };
        delete next[pendingLogId];
        return next;
      });

      try {
        const result = await submitAgentRunInput(workspaceId, runId, { content });
        if (result.accepted) {
          setRepliedInputs((prev) => new Set(prev).add(pendingLogId));
          setInputValues((prev) => {
            const next = { ...prev };
            delete next[pendingLogId];
            return next;
          });
        }
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "提交失败";
        setInputErrors((prev) => ({ ...prev, [pendingLogId]: msg }));
      } finally {
        setSubmittingInputs((prev) => ({ ...prev, [pendingLogId]: false }));
      }
    },
    [workspaceId, inputValues],
  );

  /* ---- Scroll log container ---- */
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [activeLogs]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      {/* ---- Header ---- */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-sm">
              &#x1F916;
            </span>
            Agent 控制台
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            监控和管理 Agent 运行任务、实时日志流和工具调用
          </p>
        </div>
        <div className="flex items-center gap-2">
          {runningRuns.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {runningRuns.length} 运行中
            </div>
          )}
          <Button size="sm" onClick={() => void reload()}>
            刷新
          </Button>
        </div>
      </header>

      {/* ---- Stats bar ---- */}
      {runs !== null && runs.length > 0 && (
        <div className="flex gap-2">
          <StatPill label="总计" value={String(runs.length)} />
          <StatPill label="运行中" value={String(runningRuns.length)} accent={runningRuns.length > 0 ? "text-emerald-400" : undefined} />
          <StatPill label="已完成" value={String(completedRuns.filter(r => r.status === "completed").length)} accent="text-emerald-400" />
          <StatPill label="失败" value={String(completedRuns.filter(r => r.status === "failed").length)} accent="text-red-400" />
        </div>
      )}

      {/* ---- Error ---- */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-red-50 px-4 py-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ---- Loading ---- */}
      {runs === null && (
        <div className="flex items-center justify-center py-20 text-xs text-muted-foreground">
          <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
          加载中...
        </div>
      )}

      {/* ---- Active Runs ---- */}
      {runs !== null && runningRuns.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">活跃运行</h2>
            <span className="text-[11px] text-muted-foreground">{runningRuns.length} 个</span>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {runningRuns.map((run) => (
              <div
                key={run.id}
                className={`overflow-hidden rounded-lg border bg-card transition-shadow ${
                  activeRunId === run.id ? "ring-2 ring-primary/30 shadow-md" : "hover:shadow-sm"
                }`}
              >
                {/* Card title bar */}
                <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-blue-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                    </span>
                    <code className="text-xs font-mono font-medium">{shortId(run.id)}</code>
                    <Badge variant="default">{run.agent_type}</Badge>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant={activeRunId === run.id ? "default" : "outline"}
                      onClick={() => void handleSelectActive(run.id)}
                    >
                      {activeRunId === run.id ? "关闭日志" : "查看日志"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleKill(run.id)}
                    >
                      终止
                    </Button>
                  </div>
                </div>

                {/* Metadata grid */}
                <div className="grid grid-cols-3 gap-4 px-4 py-3">
                  <MetaItem label="Task">
                    {run.task_id ? (
                      <Link
                        href={`/workspaces/${workspaceId}/changes/-/tasks/${run.task_id}`}
                        className="text-primary hover:underline"
                      >
                        {shortId(run.task_id)}
                      </Link>
                    ) : "—"}
                  </MetaItem>
                  <MetaItem label="运行时长">{calcDuration(run)}</MetaItem>
                  <MetaItem label="费用">
                    {run.total_cost_usd != null ? (
                      <span className="font-mono">${run.total_cost_usd.toFixed(4)}</span>
                    ) : "—"}
                  </MetaItem>
                  <MetaItem label="输入词元">
                    {run.input_tokens != null ? run.input_tokens.toLocaleString() : "—"}
                  </MetaItem>
                  <MetaItem label="输出词元">
                    {run.output_tokens != null ? run.output_tokens.toLocaleString() : "—"}
                  </MetaItem>
                  <MetaItem label="变更">
                    {run.lease_id ? shortId(run.lease_id) : "—"}
                  </MetaItem>
                  {run.post_scan_status && (
                    <MetaItem label="后置校验">
                      <Badge
                        variant={
                          run.post_scan_status === "success"
                            ? "success"
                            : run.post_scan_status === "failed_post_check"
                              ? "destructive"
                              : "warning"
                        }
                      >
                        {run.post_scan_status === "success"
                          ? "通过"
                          : run.post_scan_status === "failed_post_check"
                            ? "失败"
                            : "警告"}
                      </Badge>
                    </MetaItem>
                  )}
                  {run.is_resume && (
                    <MetaItem label="恢复">
                      从步骤 {run.resumed_from_step ?? "?"} 恢复
                    </MetaItem>
                  )}
                  {run.source_commit && (
                    <MetaItem label="提交" className="col-span-3">
                      <code className="text-xs">{run.source_commit.slice(0, 8)}</code>
                    </MetaItem>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Tool Call Stream / Log Viewer (active run selected) ---- */}
      {activeRunId && (
        <section className="overflow-hidden rounded-lg border">
          {/* Terminal header */}
          <div className="flex items-center justify-between bg-zinc-900 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
              </div>
              <code className="text-[11px] font-mono text-zinc-400">{shortId(activeRunId)}</code>
              <span className="text-[11px] text-zinc-600">|</span>
              <span className="text-[11px] text-zinc-500">实时日志</span>
            </div>
            <div className="flex items-center gap-2">
              {toolSummary.success > 0 && (
                <Badge variant="success">{toolSummary.success} 成功</Badge>
              )}
              {toolSummary.failed > 0 && (
                <Badge variant="destructive">{toolSummary.failed} 失败</Badge>
              )}
              {toolSummary.pending > 0 && (
                <Badge variant="warning">{toolSummary.pending} 待审批</Badge>
              )}
              {toolSummary.pendingGuidance > 0 && (
                <Badge variant="warning">{toolSummary.pendingGuidance} 待指导</Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                onClick={() => {
                  setActiveRunId(null);
                  setActiveLogs(null);
                }}
              >
                关闭
              </Button>
            </div>
          </div>

          {/* Terminal body */}
          <div
            ref={logContainerRef}
            className="max-h-[400px] overflow-auto bg-zinc-950 px-4 py-3 font-mono text-xs leading-5"
          >
            {logsLoading ? (
              <p className="py-8 text-center text-zinc-600">加载日志中...</p>
            ) : !activeLogs || activeLogs.length === 0 ? (
              <p className="py-8 text-center text-zinc-600">暂无日志输出</p>
            ) : (
              <div className="flex flex-col">
                {activeLogs.map((log) => {
                  const tag = levelTag(log.channel);
                  return (
                    <div key={log.id}>
                      <div className="flex items-start gap-2 py-0.5">
                        <span className="shrink-0 text-zinc-600">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={`shrink-0 font-medium ${tag.cls}`}>
                          [{tag.label}]
                        </span>
                        <span className="flex-1 break-all text-zinc-300">
                          {log.content_redacted}
                        </span>
                        {log.channel === "tool_call" && (() => {
                          const tc = parseToolCallContent(log.content_redacted);
                          if (!tc) return null;
                          return (
                            <Badge
                              variant={tc.status === "pending" ? "warning" : "success"}
                              className="shrink-0"
                            >
                              {tc.status === "pending" ? "待审批" : "已通过"}
                            </Badge>
                          );
                        })()}
                      </div>
                      {/* pending_input: 交互输入面板 */}
                      {log.channel === "pending_input" && (() => {
                        const isReplied = repliedInputs.has(log.id)
                          || isPendingReplied(log.timestamp, activeLogs);
                        if (isReplied) {
                          return (
                            <div className="ml-[120px] py-1">
                              <Badge variant="success">已回复</Badge>
                            </div>
                          );
                        }
                        return (
                          <div className="ml-[120px] py-1">
                            <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-950/40 px-3 py-2">
                              <Input
                                placeholder="输入指导文本..."
                                value={inputValues[log.id] ?? ""}
                                onChange={(e) =>
                                  setInputValues((prev) => ({
                                    ...prev,
                                    [log.id]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleSubmitInput(log.id, activeRunId);
                                  }
                                }}
                                disabled={submittingInputs[log.id]}
                                className="h-7 border-zinc-700 bg-zinc-900 text-xs text-zinc-200 placeholder:text-zinc-600"
                              />
                              <Button
                                size="sm"
                                onClick={() => void handleSubmitInput(log.id, activeRunId)}
                                disabled={!inputValues[log.id]?.trim() || submittingInputs[log.id]}
                              >
                                {submittingInputs[log.id] ? "提交中..." : "提交"}
                              </Button>
                            </div>
                            {inputErrors[log.id] && (
                              <p className="mt-1 text-xs text-red-400">{inputErrors[log.id]}</p>
                            )}
                          </div>
                        );
                      })()}
                      {/* user_input */}
                      {log.channel === "user_input" && (
                        <div className="ml-[120px] py-0.5">
                          <span className="rounded-md border-l-2 border-sky-400 bg-sky-950/40 px-2 py-0.5 text-xs text-sky-300">
                            {log.content_redacted}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---- Completed Runs ---- */}
      {runs !== null && completedRuns.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">历史运行</h2>
            <span className="text-[11px] text-muted-foreground">{completedRuns.length} 条记录</span>
          </div>
          <div className="overflow-hidden rounded-lg border bg-card">
            <table>
              <thead>
                <tr>
                  <th>运行 ID</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>后置校验</th>
                  <th>时长</th>
                  <th>费用</th>
                  <th>词元数</th>
                  <th>完成时间</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {completedRuns.map((run) => {
                  const sc = STATUS_CONFIG[run.status];
                  return (
                    <>
                      <tr key={run.id}>
                        <td>
                          <code className="text-[11px] font-mono text-primary">{shortId(run.id)}</code>
                        </td>
                        <td>
                          <Badge variant="outline" className="text-[10px]">{run.agent_type}</Badge>
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            {sc && <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />}
                            <Badge variant={sc?.badge ?? "outline"}>
                              {sc?.label ?? run.status}
                            </Badge>
                          </div>
                        </td>
                        <td>
                          {run.post_scan_status ? (
                            <Badge
                              variant={
                                run.post_scan_status === "success"
                                  ? "success"
                                  : run.post_scan_status === "failed_post_check"
                                    ? "destructive"
                                    : "warning"
                              }
                              className="text-[10px]"
                            >
                              {run.post_scan_status === "success"
                                ? "通过"
                                : run.post_scan_status === "failed_post_check"
                                  ? "失败"
                                  : "警告"}
                            </Badge>
                          ) : run.is_resume ? (
                            <Badge variant="outline" className="text-[10px]">
                              恢复 @{run.resumed_from_step ?? "?"}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="text-xs font-mono">{calcDuration(run)}</td>
                        <td className="text-xs font-mono">
                          {run.total_cost_usd != null ? `$${run.total_cost_usd.toFixed(4)}` : "—"}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {run.input_tokens != null || run.output_tokens != null ? (
                            <span>
                              {run.input_tokens != null ? `${(run.input_tokens / 1000).toFixed(1)}k` : "—"}
                              <span className="mx-0.5 text-zinc-300">/</span>
                              {run.output_tokens != null ? `${(run.output_tokens / 1000).toFixed(1)}k` : "—"}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="whitespace-nowrap text-xs text-muted-foreground">
                          {run.finished_at ? formatTime(run.finished_at) : "—"}
                        </td>
                        <td className="text-right">
                          <Button
                            size="sm"
                            variant={expandedRunId === run.id ? "default" : "outline"}
                            onClick={() => void handleExpandLogs(run.id)}
                            disabled={expandedLogsLoading}
                          >
                            {expandedRunId === run.id ? "关闭" : "日志"}
                          </Button>
                        </td>
                      </tr>

                      {/* Inline log viewer for completed runs */}
                      {expandedRunId === run.id && (
                        <tr key={`${run.id}-logs`}>
                          <td colSpan={9} className="p-0">
                            <div className="border-t">
                              {/* Usage summary */}
                              {(run.total_cost_usd != null || run.duration_ms != null || run.num_turns != null || run.input_tokens != null || run.output_tokens != null) && (
                                <div className="flex flex-wrap gap-3 border-b bg-muted/30 px-4 py-3">
                                  {run.total_cost_usd != null && (
                                    <StatPill label="费用" value={`$${run.total_cost_usd.toFixed(4)}`} accent="text-emerald-400" />
                                  )}
                                  {run.duration_ms != null && (
                                    <StatPill label="耗时" value={formatDuration(run.duration_ms)} />
                                  )}
                                  {run.duration_api_ms != null && (
                                    <StatPill label="API 耗时" value={formatDuration(run.duration_api_ms)} />
                                  )}
                                  {run.num_turns != null && (
                                    <StatPill label="轮次" value={String(run.num_turns)} />
                                  )}
                                  {run.input_tokens != null && (
                                    <StatPill label="输入" value={`${(run.input_tokens / 1000).toFixed(1)}k`} />
                                  )}
                                  {run.output_tokens != null && (
                                    <StatPill label="输出" value={`${(run.output_tokens / 1000).toFixed(1)}k`} />
                                  )}
                                </div>
                              )}
                              {/* Terminal-style log viewer */}
                              <div className="bg-zinc-950 px-4 py-3 font-mono text-xs leading-5">
                                <div className="mb-2 flex items-center gap-2 border-b border-zinc-800 pb-2">
                                  <div className="flex gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-red-500/80" />
                                    <span className="h-2 w-2 rounded-full bg-yellow-500/80" />
                                    <span className="h-2 w-2 rounded-full bg-green-500/80" />
                                  </div>
                                  <code className="text-[11px] text-zinc-500">{shortId(run.id)}</code>
                                  <span className="text-[11px] text-zinc-600">运行日志</span>
                                </div>
                                <div className="max-h-[300px] overflow-auto">
                                  {expandedLogsLoading ? (
                                    <p className="py-6 text-center text-zinc-600">加载日志中...</p>
                                  ) : !expandedLogs || expandedLogs.length === 0 ? (
                                    <p className="py-6 text-center text-zinc-600">无日志输出</p>
                                  ) : (
                                    <div className="flex flex-col">
                                      {expandedLogs.map((log, i) => {
                                        if (log.channel === "stderr") {
                                          return (
                                            <div key={i} className="text-red-400">
                                              {log.content_redacted}
                                            </div>
                                          );
                                        }
                                        if (log.channel === "pending_input") {
                                          return (
                                            <div key={i} className="ml-2 border-l-2 border-amber-500/50 pl-2 text-amber-300 not-italic">
                                              [待确认] {log.content_redacted}
                                            </div>
                                          );
                                        }
                                        if (log.channel === "user_input") {
                                          return (
                                            <div key={i} className="ml-2 border-l-2 border-sky-500/50 pl-2 text-sky-300 not-italic">
                                              [用户指导] {log.content_redacted}
                                            </div>
                                          );
                                        }
                                        return (
                                          <div key={i}>
                                            {renderConversationLog(log.content_redacted ?? "")}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---- Empty state ---- */}
      {runs !== null && runs.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-card py-16">
          <span className="text-3xl">&#x1F916;</span>
          <p className="text-sm text-muted-foreground">暂无 Agent 运行记录</p>
          <p className="text-xs text-muted-foreground/70">
            在任务详情页启动 Agent 后，运行记录会出现在这里
          </p>
        </div>
      )}
    </div>
  );
}
