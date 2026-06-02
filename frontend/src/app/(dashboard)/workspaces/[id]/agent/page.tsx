"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  getAgentRunLogs,
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(iso).toLocaleDateString();
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
  if (line.startsWith("[TOOL_USE]")) return "text-blue-600";
  if (line.startsWith("[TOOL_RESULT]")) return "text-emerald-700";
  if (line.startsWith("[THINKING]")) return "text-muted-foreground italic";
  if (line.startsWith("[RESULT")) return "text-primary font-medium";
  if (line.startsWith("[SYSTEM")) return "text-amber-600";
  if (line.startsWith("[ASSISTANT]")) return "";
  return "";
}

function renderConversationLog(content: string) {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        if (!line.trim()) return null;
        // Extract timestamp prefix like [09:45:34] if present
        const tsMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/);
        const ts = tsMatch ? tsMatch[1] : null;
        const rest = tsMatch ? line.slice(tsMatch[0].length) : line;
        return (
          <div key={i} className={lineClass(rest)}>
            {ts && (
              <span className="text-muted-foreground">[{ts}] </span>
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
      return { label: "TOOL", cls: "text-blue-600" };
    case "stderr":
      return { label: "WARN", cls: "text-amber-600" };
    case "pending_input":
      return { label: "PENDING", cls: "text-amber-700 font-medium" };
    case "user_input":
      return { label: "INPUT", cls: "text-blue-700 font-medium" };
    default:
      return { label: "INFO", cls: "text-muted-foreground" };
  }
}

/**
 * 判断一个 pending_input 日志是否已被回复。
 * 遍历所有日志，如果存在时间戳晚于该 pending_input 的 user_input，则视为已回复。
 */
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
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

  // ── Pending input / User guidance state ──
  // 指导输入状态：key 为 pending_input 日志条目的 id
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  // 提交中状态：key 为 pending_input 日志条目的 id
  const [submittingInputs, setSubmittingInputs] = useState<Record<string, boolean>>({});
  // 提交错误状态
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  // 已回复的 pending_input 条目 id 集合
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /* ---- Stream active logs via SSE (running) ---- */
  useEffect(() => {
    if (!activeRunId) return;

    // Only connect SSE for running agents; completed/failed use DB query
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
        // done: SSE closed, run likely completed — reload status from DB
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
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      {/* ---- Header ---- */}
      <header className="flex items-center justify-between">
        <div>
          <Link
            href={`/workspaces/${workspaceId}/components`}
            className="text-[11px] text-muted-foreground hover:underline"
          >
            &larr; 组件列表
          </Link>
          <h1 className="mt-0.5">Agent 控制台</h1>
        </div>
        <div className="flex items-center gap-3">
          {runningRuns.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {runningRuns.length} 运行中
            </div>
          )}
          <Button size="sm" onClick={() => void reload()}>
            刷新
          </Button>
        </div>
      </header>

      {/* ---- Error ---- */}
      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ---- Loading ---- */}
      {runs === null && (
        <p className="py-12 text-center text-xs text-muted-foreground">加载中...</p>
      )}

      {/* ---- Active Runs ---- */}
      {runs !== null && runningRuns.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-xs font-medium text-muted-foreground">活跃运行</p>
          <div className="grid grid-cols-2 gap-3">
            {runningRuns.map((run) => (
              <div
                key={run.id}
                className={`rounded-md border border-l-2 border-l-primary bg-card ${
                  activeRunId === run.id ? "ring-1 ring-primary/30" : ""
                }`}
              >
                {/* Card header */}
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-blue-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
                    </span>
                    <code className="text-[11px] font-mono">{shortId(run.id)}</code>
                    <Badge variant="warning">running</Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleSelectActive(run.id)}
                    >
                      Logs
                    </Button>
                    <Button size="sm" variant="destructive">
                      Stop
                    </Button>
                  </div>
                </div>

                {/* Key-value rows */}
                <div className="grid grid-cols-2 gap-px bg-border text-xs">
                  {[
                    ["Agent Type", run.agent_type],
                    [
                      "Task",
                      run.task_id ? (
                        <Link
                          href={`/workspaces/${workspaceId}/changes/-/tasks/${run.task_id}`}
                          className="text-primary hover:underline"
                        >
                          {shortId(run.task_id)}
                        </Link>
                      ) : (
                        "—"
                      ),
                    ],
                    ["Change", run.lease_id ? shortId(run.lease_id) : "—"],
                    ["Runtime", calcDuration(run)],
                    ["Cost", "$0.00"],
                  ].map(([label, value]) => (
                    <div key={label as string} className="bg-card px-3 py-1.5">
                      <span className="text-muted-foreground">{label as string}</span>
                      <span className="ml-2 font-medium">
                        {typeof value === "string" || typeof value === "number"
                          ? value
                          : value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Allowed Paths placeholder */}
                <div className="border-t px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Allowed Paths</p>
                  <code className="mt-0.5 block rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    src/**, tests/**
                  </code>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Tool Call Stream (active run selected) ---- */}
      {activeRunId && (
        <section className="rounded-md border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <code className="text-[11px] font-mono">{shortId(activeRunId)}</code>
              <span className="text-xs text-muted-foreground">Tool Call Stream</span>
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
                onClick={() => {
                  setActiveRunId(null);
                  setActiveLogs(null);
                }}
              >
                关闭
              </Button>
            </div>
          </div>

          <div
            ref={logContainerRef}
            className="max-h-[300px] overflow-auto"
          >
            {logsLoading ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                加载日志中...
              </p>
            ) : !activeLogs || activeLogs.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                暂无日志输出
              </p>
            ) : (
              <div className="divide-y">
                {activeLogs.map((log) => {
                  const tag = levelTag(log.channel);
                  return (
                    <div key={log.id}>
                      <div className="flex items-start gap-2 px-3 py-1.5">
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[11px] font-medium ${tag.cls}`}
                        >
                          [{tag.label}]
                        </span>
                        <span className="flex-1 break-all text-[11px]">
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
                              {tc.status === "pending" ? "待审批" : "allowed"}
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
                            <div className="px-3 pb-1.5">
                              <Badge variant="success">已回复</Badge>
                            </div>
                          );
                        }
                        return (
                          <div className="px-3 pb-1.5">
                            <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
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
                                className="text-xs h-7"
                              />
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => void handleSubmitInput(log.id, activeRunId)}
                                disabled={!inputValues[log.id]?.trim() || submittingInputs[log.id]}
                              >
                                {submittingInputs[log.id] ? "提交中..." : "提交指导"}
                              </Button>
                            </div>
                            {inputErrors[log.id] && (
                              <p className="text-xs text-destructive mt-1 px-3">{inputErrors[log.id]}</p>
                            )}
                          </div>
                        );
                      })()}
                      {/* user_input: 蓝色高亮展示 */}
                      {log.channel === "user_input" && (
                        <div className="px-3 pb-1.5">
                          <div className="ml-2 border-l-2 border-blue-400 pl-2 text-xs text-blue-800 bg-blue-50 rounded px-2 py-1">
                            [用户指导] {log.content_redacted}
                          </div>
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
        <section className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">已完成运行</p>
          <div className="rounded-md border bg-card">
            <table>
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Type</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Exit Code</th>
                  <th>Finished</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {completedRuns.map((run) => (
                  <>
                    <tr key={run.id}>
                      <td className="font-mono text-[11px]">{shortId(run.id)}</td>
                      <td className="text-xs">{run.agent_type}</td>
                      <td className="text-xs">
                        {run.task_id ? (
                          <Link
                            href={`/workspaces/${workspaceId}/changes/-/tasks/${run.task_id}`}
                            className="text-primary hover:underline"
                          >
                            {shortId(run.task_id)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <Badge
                          variant={
                            run.status === "completed"
                              ? "success"
                              : run.status === "failed"
                                ? "destructive"
                                : "warning"
                          }
                        >
                          {run.status === "completed"
                            ? "已完成"
                            : run.status === "failed"
                              ? "失败"
                              : "已终止"}
                        </Badge>
                      </td>
                      <td className="text-xs">{calcDuration(run)}</td>
                      <td className="font-mono text-[11px]">{run.exit_code ?? "—"}</td>
                      <td className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {run.finished_at ? timeAgo(run.finished_at) : "—"}
                      </td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleExpandLogs(run.id)}
                          disabled={expandedLogsLoading}
                        >
                          查看日志
                        </Button>
                      </td>
                    </tr>

                    {/* Inline log viewer for completed runs */}
                    {expandedRunId === run.id && (
                      <tr key={`${run.id}-logs`}>
                        <td colSpan={8} className="p-0">
                          <div className="border-t bg-muted/30">
                            <div className="flex items-center justify-between border-b px-3 py-1.5">
                              <div className="flex items-center gap-2">
                                <code className="text-[11px] font-mono">
                                  {shortId(run.id)}
                                </code>
                                <span className="text-[11px] text-muted-foreground">
                                  运行日志
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setExpandedRunId(null);
                                  setExpandedLogs(null);
                                }}
                              >
                                关闭
                              </Button>
                            </div>
                            <div className="max-h-[300px] overflow-auto">
                              {expandedLogsLoading ? (
                                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                                  加载日志中...
                                </p>
                              ) : !expandedLogs || expandedLogs.length === 0 ? (
                                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                                  无日志输出
                                </p>
                              ) : (
                                <pre className="px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap">
                                  {expandedLogs.map((log, i) => {
                                    if (log.channel === "stderr") {
                                      return (
                                        <div key={i} className="text-destructive">
                                          {log.content_redacted}
                                        </div>
                                      );
                                    }
                                    if (log.channel === "pending_input") {
                                      return (
                                        <div key={i} className="ml-2 border-l-2 border-amber-400 pl-2 text-amber-800 bg-amber-50 rounded px-2 py-1 not-italic">
                                          [待确认] {log.content_redacted}
                                        </div>
                                      );
                                    }
                                    if (log.channel === "user_input") {
                                      return (
                                        <div key={i} className="ml-2 border-l-2 border-blue-400 pl-2 text-blue-800 bg-blue-50 rounded px-2 py-1 not-italic">
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
                                </pre>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---- Empty state ---- */}
      {runs !== null && runs.length === 0 && (
        <div className="py-12 text-center text-xs text-muted-foreground">
          暂无 Agent 运行记录。在任务详情页启动 Agent 后会出现在这里。
        </div>
      )}
    </div>
  );
}
