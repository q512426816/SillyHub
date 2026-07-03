"use client";

import Link from "next/link";
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  History,
  RefreshCw,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AgentLogViewer, parseToolCallContent, parseScanCheckOutput, type ToolCallEntry } from "@/components/agent-log-viewer";
import { AgentRunPanel } from "@/components/agent-run-panel";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  formatRunProviderLabel,
  getAgentRunLogs,
  killAgentRun,
  type AgentRun,
  type AgentRunLogEntry,
} from "@/lib/agent";
import { useAgentRuns } from "@/lib/use-agent-runs";
import { PROVIDER_META, listDaemonRuntimes, type DaemonRuntimeRead } from "@/lib/daemon";
import { getWorkspace, scanGenerate, type Workspace } from "@/lib/workspaces";
import { fetchMyBinding, type MemberBindingView } from "@/lib/workspace-binding";

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
  // ql-20260702-002：pending 单列"排队中"（琥珀），让排队态可见，区别于 running 蓝脉动。
  pending: { label: "排队中", badge: "warning", dot: "bg-amber-500" },
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

function postScanKind(status: string): "success" | "error" | "warning" {
  if (status === "success") return "success";
  if (status === "failed_post_check") return "error";
  return "warning";
}

function runStatusKind(run: AgentRun): "success" | "error" | "warning" | "neutral" {
  if (run.status === "completed" && run.post_scan_status === "failed_post_check") {
    return "warning";
  }
  if (run.status === "completed") return "success";
  if (run.status === "failed") return "error";
  if (run.status === "killed") return "warning";
  // ql-20260702-002：pending 防御性分支（pending 不进历史表格，但避免 fallback 显示原始串）。
  if (run.status === "pending") return "warning";
  return "neutral";
}

function isWorkspaceScanRun(run: AgentRun): boolean {
  return !run.task_id && !run.change_id && !run.lease_id && run.spec_strategy === "platform-managed";
}

function pendingMetric(run: AgentRun, kind: "cost" | "usage" = "usage"): string {
  if (run.status !== "running") return "—";
  // ql-20260617-003：Claude CLI stream-json 中间 assistant 事件 usage 永远是 {0, 0}，
  // 真实 token 数只在最终 result 事件才有。所以执行期间无法显示累加值，明确告知用户
  // "执行中（完成后统计）"，避免显示假 "0"。
  return kind === "cost" ? "完成后结算" : "执行中…";
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

  // task-09（2026-07-01-react-query-migration）：react-query 接管 list 获取 + 条件轮询。
  const { runs, isLoading, error: listError, refetch } = useAgentRuns(workspaceId);
  const [actionError, setActionError] = useState<string | null>(null);
  const reload = useCallback(() => { setActionError(null); void refetch(); }, [refetch]);
  const error = actionError ?? listError?.message ?? null;
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<AgentRunLogEntry[] | null>(null);
  const [expandedLogsLoading, setExpandedLogsLoading] = useState(false);

  // ql-20260617-002：UI 优化 — 历史记录的状态筛选 + 分页。
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "failed" | "killed">("all");
  const HISTORY_PAGE_SIZE = 10;
  const [historyPage, setHistoryPage] = useState(1);

  /* ---- task-12 / D-005：provider 单次覆盖状态 ---- */
  const [workspaceData, setWorkspaceData] = useState<Workspace | null>(null);
  const [myBinding, setMyBinding] = useState<MemberBindingView | null>(null);
  const [allRuntimes, setAllRuntimes] = useState<DaemonRuntimeRead[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(true);

  /* ---- 获取 workspace / binding / daemon runtimes ---- */
  useEffect(() => {
    let active = true;
    async function loadFormData() {
      setFormLoading(true);
      try {
        const [ws, binding, runtimes] = await Promise.all([
          getWorkspace(workspaceId).catch(() => null),
          fetchMyBinding(workspaceId).catch(() => null),
          listDaemonRuntimes().catch(() => [] as DaemonRuntimeRead[]),
        ]);
        if (!active) return;
        setWorkspaceData(ws);
        setMyBinding(binding);
        setAllRuntimes(runtimes);
        // 默认回填 workspace.default_agent（D-005 回填但不持久化）
        setSelectedProvider(ws?.default_agent ?? null);
        setSelectedModel("");
      } catch {
        // 静默，不阻塞页面渲染
      } finally {
        if (active) setFormLoading(false);
      }
    }
    void loadFormData();
    return () => { active = false; };
  }, [workspaceId]);

  /* ---- 该绑定 daemon 的在线 provider 列表 ---- */
  const onlineProviders = useMemo(() => {
    if (!myBinding?.daemon_id) return [] as string[];
    return Array.from(
      new Set(
        allRuntimes
          .filter(
            (r) =>
              r.daemon_instance_id === myBinding.daemon_id &&
              r.status === "online" &&
              r.provider,
          )
          .map((r) => r.provider as string),
      ),
    );
  }, [myBinding, allRuntimes]);

  /* ---- provider 可用性校验 ---- */
  const providerEnabled = useMemo(() => {
    if (!selectedProvider) return true; // null = 跟随默认，放行给后端兜底
    return onlineProviders.includes(selectedProvider);
  }, [selectedProvider, onlineProviders]);

  /* ---- 启动扫描 ---- */
  const handleDispatch = useCallback(async () => {
    if (!workspaceData?.root_path) return;
    setDispatching(true);
    setDispatchError(null);
    try {
      await scanGenerate(
        workspaceData.root_path,
        selectedProvider, // 单次覆盖（D-005），不写回 workspace.default_agent
        selectedModel || null,
        "daemon-client",
        workspaceData.daemon_runtime_id,
        undefined,
      );
      void refetch();
    } catch (err) {
      setDispatchError(err instanceof ApiError ? err.message : "启动智能体运行失败");
    } finally {
      setDispatching(false);
    }
  }, [workspaceData, selectedProvider, selectedModel, refetch]);

  /* ---- Derived ---- */
  const runningRuns = useMemo(
    () => {
      const list = runs.filter((r) => r.status === "running");
      // ql-20260617-002：活跃运行按 started_at 升序（先启动的在前），null 兜底用 created_at。
      return list.sort((a, b) => {
        const ta = new Date(a.started_at ?? a.created_at).getTime();
        const tb = new Date(b.started_at ?? b.created_at).getTime();
        return ta - tb;
      });
    },
    [runs],
  );
  // ql-20260702-002：pending run 单列派生（原 runningRuns/completedRuns 都过滤掉 pending，
  // 导致"总运行"=runs.length 含 pending 但列表不可见）。排队中按 created_at 升序。
  const pendingRuns = useMemo(
    () =>
      runs
        .filter((r) => r.status === "pending")
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [runs],
  );
  // 活跃面板 = 排队 + 运行中（排队在前）；两者都是"未结束、用户需关注"。
  const activeRuns = useMemo(() => [...pendingRuns, ...runningRuns], [pendingRuns, runningRuns]);
  const completedRuns = useMemo(
    () => {
      // ql-20260617-002：按 finished_at 降序（最近结束的在前），started_at 为 null 时
      // 兜底 created_at，避免 pending run 排到表头。后端按 started_at 排但前端做兜底。
      const list = runs.filter(
        (r) => r.status === "completed" || r.status === "failed" || r.status === "killed",
      );
      const sorted = list.sort((a, b) => {
        const ta = new Date(a.finished_at ?? a.started_at ?? a.created_at).getTime();
        const tb = new Date(b.finished_at ?? b.started_at ?? b.created_at).getTime();
        return tb - ta;
      });
      return sorted;
    },
    [runs],
  );
  const filteredCompletedRuns = useMemo(
    () => completedRuns.filter((r) => statusFilter === "all" || r.status === statusFilter),
    [completedRuns, statusFilter],
  );
  const totalHistoryPages = Math.max(1, Math.ceil(filteredCompletedRuns.length / HISTORY_PAGE_SIZE));
  // 过滤条件变化时如果当前页超出范围，重置到第 1 页。
  const safeHistoryPage = Math.min(historyPage, totalHistoryPages);
  const pagedCompletedRuns = useMemo(
    () => filteredCompletedRuns.slice(
      (safeHistoryPage - 1) * HISTORY_PAGE_SIZE,
      safeHistoryPage * HISTORY_PAGE_SIZE,
    ),
    [filteredCompletedRuns, safeHistoryPage],
  );

  /* ---- Load + auto-refresh (task-09: react-query mount-fetch + refetchInterval) ---- */

  /* ---- Load active run logs ----
   * task-06：活跃 run 日志流 + 历史 prefetch 由 <AgentRunPanel> 内的
   * useAgentRunStream 接管；此处仅切换 activeRunId，panel 自动挂载并连 SSE。
   */
  const handleSelectActive = useCallback(
    (runId: string) => {
      if (activeRunId === runId) {
        setActiveRunId(null);
        return;
      }
      setActiveRunId(runId);
    },
    [activeRunId],
  );

  const handleKill = useCallback(
    async (runId: string) => {
      const confirmed = window.confirm(
        `确认终止智能体 ${shortId(runId)}？\n\n终止会停止当前进程，已产生的费用和词元会尽量保留。`,
      );
      if (!confirmed) return;
      try {
        await killAgentRun(workspaceId, runId);
        reload();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : "停止智能体失败");
      }
    },
    [workspaceId, reload],
  );

  /* ---- Active run state ----
   * task-06：原活跃 run SSE useEffect 已删，活跃 run 日志流由
   * <AgentRunPanel> 内的 useAgentRunStream hook 接管（design §5.1 分层）。
   */
  const isActiveRun = useMemo(
    () => {
      if (!activeRunId) return false;
      const run = runs.find((r) => r.id === activeRunId);
      return run?.status === "running" ?? false;
    },
    [activeRunId, runs],
  );

  // task-06：done 回调等价原 :412-415（reload 两次）；用 useCallback 避免触发 panel 重连（R-01）。
  const handleActiveRunDone = useCallback(
    (_status: string) => {
      void reload();
      window.setTimeout(() => void reload(), 1_500);
    },
    [reload],
  );

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
        setActionError(err instanceof ApiError ? err.message : "加载日志失败");
      } finally {
        setExpandedLogsLoading(false);
      }
    },
    [expandedRunId, workspaceId],
  );

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <PageContainer>
      {/* ---- Header ---- */}
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-card text-primary">
              <Bot className="h-4 w-4" />
            </span>
            <span>智能体控制台</span>
          </span>
        }
        subtitle="当前工作区运行记录、实时日志与人工指导入口"
        actions={
          <>
            {runningRuns.length > 0 && (
              <div className="flex h-8 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {runningRuns.length} 个运行中
              </div>
            )}
            {/* ql-20260702-002：排队中角标（琥珀），提示有 pending run 等待 daemon 接管。 */}
            {pendingRuns.length > 0 && (
              <div className="flex h-8 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-700">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                </span>
                {pendingRuns.length} 个排队中
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => void reload()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              刷新
            </Button>
          </>
        }
      />

      {/* ---- task-12 / D-005：Provider 单次覆盖「新运行」表单 ---- */}
      {!formLoading && (
        <SectionCard title="新运行">
          <div className="flex flex-wrap items-end gap-3">
            {/* Provider 选择 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">智能体提供方</label>
              <select
                value={selectedProvider ?? ""}
                onChange={(e) => setSelectedProvider(e.target.value === "" ? null : e.target.value)}
                className="h-8 rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              >
                <option value="">
                  {workspaceData?.default_agent
                    ? `跟随工作区默认（${PROVIDER_META[workspaceData.default_agent]?.label ?? workspaceData.default_agent}）`
                    : "跟随工作区默认（未设置）"}
                </option>
                {onlineProviders.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_META[p]?.label ?? p}
                  </option>
                ))}
                {/* D-005：selectedProvider 指向离线 provider → 追加渲染并标注（离线） */}
                {selectedProvider &&
                  !onlineProviders.includes(selectedProvider) && (
                    <option value={selectedProvider}>
                      {PROVIDER_META[selectedProvider]?.label ?? selectedProvider}（离线）
                    </option>
                  )}
              </select>
            </div>
            {/* Model 输入 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">智能体模型</label>
              <input
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="留空使用默认模型"
                className="h-8 rounded border border-input bg-background px-2.5 text-xs focus:border-ring focus:outline-none min-w-[200px]"
              />
            </div>
            {/* 启动按钮 */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground opacity-0">操作</label>
              <Button
                size="sm"
                onClick={() => void handleDispatch()}
                disabled={
                  dispatching ||
                  !myBinding?.daemon_id ||
                  (!providerEnabled && selectedProvider !== null) ||
                  !workspaceData?.root_path
                }
              >
                <Bot className="mr-1.5 h-3.5 w-3.5" />
                {dispatching ? "启动中..." : "启动扫描"}
              </Button>
            </div>
          </div>

          {/* 校验提示 */}
          {selectedProvider && !providerEnabled && (
            <p className="mt-2 text-xs text-destructive">
              该守护进程未启用 {PROVIDER_META[selectedProvider]?.label ?? selectedProvider}
            </p>
          )}
          {!myBinding?.daemon_id && workspaceData?.path_source === "daemon-client" && (
            <p className="mt-2 text-xs text-amber-600">
              请先在工作区设置中绑定守护进程
            </p>
          )}
          {dispatchError && (
            <p className="mt-2 text-xs text-destructive">{dispatchError}</p>
          )}
        </SectionCard>
      )}

      {/* ---- Stats bar ---- */}
      {!isLoading && runs.length > 0 && (
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
      {isLoading && (
        <div className="flex items-center justify-center rounded-md border bg-card py-20 text-xs text-muted-foreground">
          <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
          加载中...
        </div>
      )}

      {/* ---- Active Runs ---- */}
      {!isLoading && activeRuns.length > 0 && (
        <section className="flex min-w-0 flex-col gap-3">
          <SectionTitle icon={Activity} title="活跃运行" meta={`${activeRuns.length} 个`} />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {activeRuns.map((run) => (
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
                      {run.status === "running" ? (
                        <>
                          <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-blue-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                        </>
                      ) : (
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                      )}
                    </span>
                    <code className="truncate font-mono text-xs font-medium">{shortId(run.id)}</code>
                    <Badge variant="default" className="shrink-0">{formatRunProviderLabel(run)}</Badge>
                    {run.status === "pending" && (
                      <Badge variant="warning" className="shrink-0">排队中</Badge>
                    )}
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
                  <MetaItem label="任务">
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
                    {run.input_tokens != null && run.input_tokens > 0
                      ? run.input_tokens.toLocaleString()
                      : pendingMetric(run)}
                  </MetaItem>
                  <MetaItem label="输出词元">
                    {run.output_tokens != null && run.output_tokens > 0
                      ? run.output_tokens.toLocaleString()
                      : pendingMetric(run)}
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
                      <StatusBadge kind={postScanKind(run.post_scan_status)}>
                        {postScanLabel[run.post_scan_status] ?? run.post_scan_status}
                      </StatusBadge>
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

      {/* ---- Tool Call Stream / Log Viewer (active run selected) ----
       * task-06：活跃 run 日志 + input + 权限卡片统一由 <AgentRunPanel> 承担
       * （panel 内部 useAgentRunStream hook 连 SSE / prefetch 历史 / 管 input）。
       */}
      {activeRunId && (
        <section className="min-w-0">
          <AgentRunPanel
            workspaceId={workspaceId}
            runId={activeRunId}
            isActive={isActiveRun}
            title="实时日志"
            emptyText="暂无日志输出"
            isLive
            onDone={handleActiveRunDone}
            onClose={() => setActiveRunId(null)}
          />
        </section>
      )}

      {/* ---- Completed Runs ---- */}
      {!isLoading && completedRuns.length > 0 && (
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SectionTitle icon={History} title="历史运行" meta={`${filteredCompletedRuns.length} / ${completedRuns.length} 条`} />
            {/* ql-20260617-002：状态过滤，减少长列表视觉负担 */}
            <div className="flex items-center gap-1 rounded-md border bg-card p-0.5 text-xs">
              <Filter className="ml-1.5 mr-0.5 h-3 w-3 text-muted-foreground" />
              {(["all", "completed", "failed", "killed"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setStatusFilter(s); setHistoryPage(1); }}
                  className={cn(
                    "whitespace-nowrap rounded px-2 py-1 font-medium transition-colors",
                    statusFilter === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {s === "all" ? "全部" : s === "completed" ? "已完成" : s === "failed" ? "失败" : "已终止"}
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-0 overflow-hidden rounded-md border bg-card">
            <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1220px] border-collapse text-left">
              <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">运行 ID</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">类型</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">任务</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">状态</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">结果摘要</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">时长</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">费用</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">词元数</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">退出码</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">完成时间</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {pagedCompletedRuns.map((run) => {
                  const sl = runStatusLabel(run);
                  return (
                    <>
                      <tr key={run.id} className={cn("border-b transition-colors hover:bg-muted/20", expandedRunId === run.id && "bg-muted/20")}>
                        <td className="whitespace-nowrap px-3 py-2">
                          <code className="font-mono text-[11px] text-primary">{shortId(run.id)}</code>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">{formatRunProviderLabel(run)}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
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
                        <td className="whitespace-nowrap px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${sl.dot}`} />
                            <StatusBadge kind={runStatusKind(run)}>
                              {sl.label}
                            </StatusBadge>
                          </div>
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2 text-xs text-muted-foreground">
                          {expandedLogs && expandedRunId === run.id
                            ? extractRunSummary(expandedLogs)
                            : run.post_scan_status
                              ? postScanLabel[run.post_scan_status] ?? run.post_scan_status
                              : run.is_resume
                                ? `恢复 @${run.resumed_from_step ?? "?"}`
                                : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{calcDuration(run)}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                          {run.total_cost_usd != null ? `$${run.total_cost_usd.toFixed(4)}` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {run.input_tokens != null || run.output_tokens != null ? (
                            <span>
                              {run.input_tokens != null ? `${(run.input_tokens / 1000).toFixed(1)}k` : "—"}
                              <span className="mx-0.5 text-zinc-300">/</span>
                              {run.output_tokens != null ? `${(run.output_tokens / 1000).toFixed(1)}k` : "—"}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px]">{run.exit_code ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {run.finished_at ? formatTime(run.finished_at) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
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
            {/* ql-20260617-002：分页控件 */}
            {totalHistoryPages > 1 && (
              <div className="flex items-center justify-between border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  第 {(safeHistoryPage - 1) * HISTORY_PAGE_SIZE + 1} - {Math.min(safeHistoryPage * HISTORY_PAGE_SIZE, filteredCompletedRuns.length)} 条 / 共 {filteredCompletedRuns.length} 条
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={safeHistoryPage <= 1}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="px-2 font-medium text-foreground">
                    {safeHistoryPage} / {totalHistoryPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={safeHistoryPage >= totalHistoryPages}
                    onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---- Empty state ---- */}
      {!isLoading && runs.length === 0 && (
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-12">
            <span className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted/40 text-primary">
              <Bot className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">暂无智能体运行记录</p>
            <p className="text-xs text-muted-foreground">
              在任务详情页启动智能体后，运行记录会出现在这里
            </p>
          </div>
        </SectionCard>
      )}
    </PageContainer>
  );
}
