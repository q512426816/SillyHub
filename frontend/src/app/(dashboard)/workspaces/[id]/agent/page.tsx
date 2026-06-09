"use client";

import Link from "next/link";
import {
  Activity,
  Bot,
  CheckCircle2,
  Download,
  History,
  RefreshCw,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentLogViewer, isPendingReplied, parseToolCallContent, parseScanCheckOutput, type ToolCallEntry } from "@/components/agent-log-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
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
/*  Helpers (page-specific)                                            */
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

const STATUS_CONFIG: Record<string, { label: string; badge: "success" | "destructive" | "warning"; dot: string }> = {
  completed: { label: "已完成", badge: "success", dot: "bg-emerald-500" },
  failed: { label: "失败", badge: "destructive", dot: "bg-red-500" },
  killed: { label: "已终止", badge: "warning", dot: "bg-amber-500" },
};

function runStatusLabel(run: AgentRun): { label: string; badge: "success" | "destructive" | "warning" | "outline"; dot: string } {
  if (run.status === "completed" && run.post_scan_status === "failed_post_check") {
    return { label: "后置校验失败", badge: "warning", dot: "bg-amber-500" };
  }
  const cfg = STATUS_CONFIG[run.status];
  if (cfg) return cfg;
  return { label: run.status, badge: "outline" as const, dot: "bg-zinc-400" };
}

function extractRunSummary(logs: AgentRunLogEntry[] | null): string {
  if (!logs || logs.length === 0) return "";
  const stdoutLogs = logs.filter(l => l.channel === "stdout");
  const allText = stdoutLogs.map(l => l.content_redacted).join("\n");
  const scanCheck = parseScanCheckOutput(allText);
  if (scanCheck) {
    return `扫描自检${scanCheck.passed ? "通过" : "未通过"}：${scanCheck.scanDocs} 文档，${scanCheck.moduleCount} 模块`;
  }
  const bashCalls = logs
    .filter(l => l.channel === "tool_call")
    .map(l => parseToolCallContent(l.content_redacted))
    .filter(Boolean) as ToolCallEntry[];
  if (bashCalls.length > 0) {
    const toolNames = [...new Set(bashCalls.map(t => t.tool))];
    return `${bashCalls.length} 工具调用（${toolNames.join(", ")}）`;
  }
  return `${logs.length} 条日志`;
}

const postScanLabel: Record<string, string> = {
  success: "通过",
  failed_post_check: "失败",
  warning: "警告",
};

function postScanVariant(status: string): "success" | "destructive" | "warning" {
  if (status === "success") return "success";
  if (status === "failed_post_check") return "destructive";
  return "warning";
}

function isWorkspaceScanRun(run: AgentRun): boolean {
  return !run.task_id && !run.change_id && !run.lease_id && run.spec_strategy === "platform-managed";
}

function pendingMetric(run: AgentRun, kind: "cost" | "usage" = "usage"): string {
  if (run.status !== "running") return "—";
  return kind === "cost" ? "完成后结算" : "等待用量";
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function MetaItem({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 flex flex-col gap-0.5", className)}>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate text-xs font-medium">{children}</span>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "running" | "success" | "danger";
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-white text-slate-700",
    running: "border-sky-200 bg-sky-50 text-sky-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    danger: "border-red-200 bg-red-50 text-red-700",
  }[tone];

  return (
    <div className={cn("flex min-h-20 items-center justify-between rounded-md border px-4 py-3", toneClass)}>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold leading-none text-foreground">{value}</p>
      </div>
      <Icon className="h-5 w-5 shrink-0 opacity-75" />
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-semibold text-foreground", accent)}>{value}</span>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  meta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  meta?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold">{title}</h2>
      {meta && <span className="text-[11px] text-muted-foreground">{meta}</span>}
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
      const confirmed = window.confirm(
        `确认终止 Agent ${shortId(runId)}？\n\n终止会停止当前进程，已产生的费用和词元会尽量保留。`,
      );
      if (!confirmed) return;
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
        window.setTimeout(() => void reload(), 1_500);
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
    <div className="flex min-w-0 max-w-full flex-col gap-5 px-4 py-5 sm:px-6">
      {/* ---- Header ---- */}
      <header className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-card text-primary">
              <Bot className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1>Agent 控制台</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                当前工作区运行记录、实时日志与人工指导入口
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {runningRuns.length > 0 && (
            <div className="flex h-8 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {runningRuns.length} 个运行中
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            刷新
          </Button>
        </div>
      </header>

      {/* ---- Stats bar ---- */}
      {runs !== null && runs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="总运行" value={String(runs.length)} icon={History} />
          <SummaryCard label="运行中" value={String(runningRuns.length)} icon={Activity} tone={runningRuns.length > 0 ? "running" : "neutral"} />
          <SummaryCard label="已完成" value={String(completedRuns.filter(r => r.status === "completed").length)} icon={CheckCircle2} tone="success" />
          <SummaryCard label="失败" value={String(completedRuns.filter(r => r.status === "failed").length)} icon={XCircle} tone={completedRuns.some(r => r.status === "failed") ? "danger" : "neutral"} />
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
        <div className="flex items-center justify-center rounded-md border bg-card py-20 text-xs text-muted-foreground">
          <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
          加载中...
        </div>
      )}

      {/* ---- Active Runs ---- */}
      {runs !== null && runningRuns.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle icon={Activity} title="活跃运行" meta={`${runningRuns.length} 个`} />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {runningRuns.map((run) => (
              <div
                key={run.id}
                className={cn(
                  "overflow-hidden rounded-md border bg-card transition-colors",
                  activeRunId === run.id ? "border-primary/40 bg-primary/[0.02]" : "hover:border-primary/25",
                )}
              >
                {/* Card title bar */}
                <div className="flex flex-col gap-3 border-b bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-blue-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                    </span>
                    <code className="truncate font-mono text-xs font-medium">{shortId(run.id)}</code>
                    <Badge variant="default" className="shrink-0">{run.agent_type}</Badge>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant={activeRunId === run.id ? "default" : "outline"}
                      onClick={() => void handleSelectActive(run.id)}
                    >
                      <Terminal className="mr-1.5 h-3.5 w-3.5" />
                      {activeRunId === run.id ? "关闭日志" : "查看日志"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleKill(run.id)}
                    >
                      <Square className="mr-1.5 h-3 w-3" />
                      终止
                    </Button>
                  </div>
                </div>

                {/* Metadata grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 md:grid-cols-3">
                  <MetaItem label="Task">
                    {run.task_id ? (
                      <Link
                        href={`/workspaces/${workspaceId}/changes/-/tasks/${run.task_id}`}
                        className="text-primary hover:underline"
                      >
                        {shortId(run.task_id)}
                      </Link>
                    ) : isWorkspaceScanRun(run) ? (
                      <Badge variant="outline" className="text-[10px]">
                        工作区扫描
                      </Badge>
                    ) : "—"}
                  </MetaItem>
                  <MetaItem label="运行时长">{calcDuration(run)}</MetaItem>
                  <MetaItem label="费用">
                    {run.total_cost_usd != null ? (
                      <span className="font-mono">${run.total_cost_usd.toFixed(4)}</span>
                    ) : pendingMetric(run, "cost")}
                  </MetaItem>
                  <MetaItem label="输入词元">
                    {run.input_tokens != null ? run.input_tokens.toLocaleString() : pendingMetric(run)}
                  </MetaItem>
                  <MetaItem label="输出词元">
                    {run.output_tokens != null ? run.output_tokens.toLocaleString() : pendingMetric(run)}
                  </MetaItem>
                  <MetaItem label="变更">
                    {run.change_id ? (
                      <Link
                        href={`/workspaces/${workspaceId}/changes/${run.change_id}`}
                        className="text-primary hover:underline"
                      >
                        {shortId(run.change_id)}
                      </Link>
                    ) : isWorkspaceScanRun(run) ? (
                      run.status === "running" ? "扫描生成中" : "平台扫描"
                    ) : run.lease_id ? (
                      `租约 ${shortId(run.lease_id)}`
                    ) : "—"}
                  </MetaItem>
                  {run.post_scan_status && (
                    <MetaItem label="后置校验">
                      <Badge variant={postScanVariant(run.post_scan_status)}>
                        {postScanLabel[run.post_scan_status] ?? run.post_scan_status}
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
        <section className="min-w-0">
          <AgentLogViewer
            title="实时日志"
            runId={activeRunId}
            logs={activeLogs}
            loading={logsLoading}
            emptyText="暂无日志输出"
            isLive
            containerRef={logContainerRef}
            summary={
              <>
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
              </>
            }
            actions={
              <Button
                size="sm"
                variant="ghost"
                className="text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                onClick={() => {
                  setActiveRunId(null);
                  setActiveLogs(null);
                }}
              >
                关闭
              </Button>
            }
            inputControls={{
              inputValues,
              submittingInputs,
              inputErrors,
              repliedInputs,
              onChange: (logId, value) =>
                setInputValues((prev) => ({
                  ...prev,
                  [logId]: value,
                })),
              onSubmit: (logId) => void handleSubmitInput(logId, activeRunId),
            }}
          />
        </section>
      )}

      {/* ---- Completed Runs ---- */}
      {runs !== null && completedRuns.length > 0 && (
        <section className="flex min-w-0 flex-col gap-3">
          <SectionTitle icon={History} title="历史运行" meta={`${completedRuns.length} 条记录`} />
          <div className="min-w-0 max-w-full overflow-hidden rounded-md border bg-card">
            <div className="w-full max-w-full overflow-x-auto">
            <table className="min-w-[1140px]">
              <thead>
                <tr>
                  <th>运行 ID</th>
                  <th>类型</th>
                  <th>Task</th>
                  <th>状态</th>
                  <th>结果摘要</th>
                  <th>时长</th>
                  <th>费用</th>
                  <th>词元数</th>
                  <th>退出码</th>
                  <th>完成时间</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {completedRuns.map((run) => {
                  const sl = runStatusLabel(run);
                  return (
                    <>
                      <tr key={run.id} className={expandedRunId === run.id ? "bg-muted/20" : undefined}>
                        <td>
                          <code className="font-mono text-[11px] text-primary">{shortId(run.id)}</code>
                        </td>
                        <td>
                          <Badge variant="outline" className="text-[10px]">{run.agent_type}</Badge>
                        </td>
                        <td className="text-xs">
                          {run.task_id ? (
                            <Link
                              href={`/workspaces/${workspaceId}/changes/-/tasks/${run.task_id}`}
                              className="text-primary hover:underline"
                            >
                              {shortId(run.task_id)}
                            </Link>
                          ) : isWorkspaceScanRun(run) ? (
                            <Badge variant="outline" className="text-[10px]">
                              工作区扫描
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${sl.dot}`} />
                            <Badge variant={sl.badge}>
                              {sl.label}
                            </Badge>
                          </div>
                        </td>
                        <td className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {expandedLogs && expandedRunId === run.id
                            ? extractRunSummary(expandedLogs)
                            : run.post_scan_status
                              ? postScanLabel[run.post_scan_status] ?? run.post_scan_status
                              : run.is_resume
                                ? `恢复 @${run.resumed_from_step ?? "?"}`
                                : "—"}
                        </td>
                        <td className="font-mono text-xs">{calcDuration(run)}</td>
                        <td className="font-mono text-xs">
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
                        <td className="font-mono text-[11px]">{run.exit_code ?? "—"}</td>
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
                            <Terminal className="mr-1.5 h-3.5 w-3.5" />
                            {expandedRunId === run.id ? "关闭" : "日志"}
                          </Button>
                        </td>
                      </tr>

                      {expandedRunId === run.id && (
                        <tr key={`${run.id}-logs`}>
                          <td colSpan={11} className="p-0">
                            <div className="border-t">
                              {(run.total_cost_usd != null || run.duration_ms != null || run.num_turns != null || run.input_tokens != null || run.output_tokens != null) && (
                                <div className="flex flex-wrap gap-2 border-b bg-muted/30 px-4 py-3">
                                  {run.total_cost_usd != null && (
                                    <StatPill label="费用" value={`$${run.total_cost_usd.toFixed(4)}`} accent="text-emerald-600" />
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
                              <AgentLogViewer
                                title="运行日志"
                                runId={run.id}
                                logs={expandedLogs}
                                loading={expandedLogsLoading}
                                emptyText="无日志输出"
                                maxHeightClass="max-h-[480px]"
                                compact
                                variant="embedded"
                                actions={
                                  expandedLogs && expandedLogs.length > 0 ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                                      onClick={() => {
                                        const text = expandedLogs.map(l =>
                                          `[${new Date(l.timestamp).toISOString()}] [${l.channel}] ${l.content_redacted}`
                                        ).join("\n");
                                        const blob = new Blob([text], { type: "text/plain" });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = `agent-run-${run.id.slice(0, 8)}.log`;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                      }}
                                    >
                                      <Download className="mr-1 h-3 w-3" />
                                      下载
                                    </Button>
                                  ) : undefined
                                }
                              />
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
          </div>
        </section>
      )}

      {/* ---- Empty state ---- */}
      {runs !== null && runs.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-md border bg-card py-16">
          <span className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted/40 text-primary">
            <Bot className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium">暂无 Agent 运行记录</p>
          <p className="text-xs text-muted-foreground">
            在任务详情页启动 Agent 后，运行记录会出现在这里
          </p>
        </div>
      )}
    </div>
  );
}
