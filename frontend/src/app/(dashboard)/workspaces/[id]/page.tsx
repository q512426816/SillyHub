"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AgentLogViewer } from "@/components/agent-log-viewer";
import { AgentModelInput } from "@/components/AgentModelInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentProviderSelect } from "@/components/AgentProviderSelect";
import { WorkspaceDaemonSwitcher } from "@/components/workspace-daemon-switcher";
import { WorkspacePathFields } from "@/components/workspace-path-fields";
import { ApiError } from "@/lib/api";
import { getDaemonRuntime, type DaemonRuntimeRead } from "@/lib/daemon";
import { isDaemonClientWorkspace } from "@/lib/workspace-path";
import {
  listAgentRuns,
  submitAgentRunInput,
  type AgentRun,
  type AgentRunLogEntry,
  type AgentRunStatus,
} from "@/lib/agent";
import { AgentRunStreamClient, type StreamStatus } from "@/lib/agent-stream";
import { listComponents } from "@/lib/components";
import { listChanges } from "@/lib/changes";
import {
  bootstrapSpecWorkspace,
  generateProjects,
  getSpecWorkspace,
  importSpecWorkspace,
  syncSpecWorkspace,
  type SpecWorkspace,
} from "@/lib/spec-workspaces";
import { getRuntimeProgress } from "@/lib/runtime";
import { useSession } from "@/stores/session";
import {
  getWorkspace,
  updateWorkspace,
  type Workspace,
} from "@/lib/workspaces";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  params: { id: string };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SYNC_STATUS_VARIANT: Record<string, "success" | "warning" | "destructive"> = {
  clean: "success",
  dirty: "warning",
  conflicted: "destructive",
};

const SYNC_STATUS_LABEL: Record<string, string> = {
  clean: "已同步",
  dirty: "有变更未同步",
  conflicted: "存在冲突",
};

const STRATEGY_LABEL: Record<string, string> = {
  "platform-managed": "平台托管",
  "repo-mirrored": "仓库镜像",
  "repo-native": "仓库原生",
};

function statusToVariant(status: AgentRunStatus | null): "success" | "warning" | "destructive" | "outline" {
  switch (status) {
    case "completed": return "success";
    case "running": return "warning";
    case "failed":
    case "killed": return "destructive";
    default: return "outline";
  }
}

const BS_STATUS_LABEL: Record<string, string> = {
  completed: "成功",
  failed: "失败",
  killed: "已终止",
  running: "运行中",
  pending: "等待中",
};

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function bsRunStatus(run: AgentRun): { label: string; variant: "success" | "destructive" | "warning" | "outline" } {
  if (run.status === "completed" && run.post_scan_status === "failed_post_check") {
    return { label: "后置校验失败", variant: "warning" };
  }
  return { label: BS_STATUS_LABEL[run.status] ?? run.status, variant: statusToVariant(run.status) };
}


/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WorkspaceDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [boundRuntime, setBoundRuntime] = useState<DaemonRuntimeRead | null>(null);
  const [specWs, setSpecWs] = useState<SpecWorkspace | null>(null);
  const [componentCount, setComponentCount] = useState<number>(0);
  const [activeChanges, setActiveChanges] = useState<number>(0);
  const [archivedChanges, setArchivedChanges] = useState<number>(0);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Bootstrap SSE state
  const [activeBootstrapRunId, setActiveBootstrapRunId] = useState<string | null>(null);
  const [lastBsRun, setLastBsRun] = useState<AgentRun | null>(null);
  const [bootstrapLogs, setBootstrapLogs] = useState<AgentRunLogEntry[]>([]);
  const [bootstrapStatus, setBootstrapStatus] = useState<AgentRunStatus | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bsInputValues, setBsInputValues] = useState<Record<string, string>>({});
  const [bsSubmittingInputs, setBsSubmittingInputs] = useState<Record<string, boolean>>({});
  const [bsRepliedInputs, setBsRepliedInputs] = useState<Set<string>>(new Set());
  const [bsInputErrors, setBsInputErrors] = useState<Record<string, string>>({});
  const [bootstrapStreamStatus, setBootstrapStreamStatus] = useState<StreamStatus>("disconnected");
  const [generatingProjects, setGeneratingProjects] = useState(false);
  // workspace 级默认 agent provider 编辑态（FR-01/FR-02，2026-06-14-agent-runtime-selection）
  const [defaultAgent, setDefaultAgent] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [savingDefaultAgent, setSavingDefaultAgent] = useState(false);

  const streamClientRef = useRef<AgentRunStreamClient | null>(null);

  const handleSaveDefaultAgent = async () => {
    if (!workspace) return;
    setSavingDefaultAgent(true);
    setPageError(null);
    try {
      const updated = await updateWorkspace(workspaceId, {
        default_agent: defaultAgent,
        default_model: defaultModel,
      });
      setWorkspace(updated);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "保存默认智能体失败");
    } finally {
      setSavingDefaultAgent(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [ws, sw, comps, active, archived, rt] = await Promise.all([
        getWorkspace(workspaceId),
        getSpecWorkspace(workspaceId).catch(() => null),
        listComponents(workspaceId).catch(() => ({ items: [], total: 0 })),
        listChanges(workspaceId, { location: "active" }).catch(() => ({ items: [], total: 0 })),
        listChanges(workspaceId, { location: "archive" }).catch(() => ({ items: [], total: 0 })),
        getRuntimeProgress(workspaceId).catch(() => null),
      ]);
      setWorkspace(ws);
      setDefaultAgent(ws.default_agent);
      setDefaultModel(ws.default_model);
      if (ws.path_source === "daemon-client" && ws.daemon_runtime_id) {
        const runtime = await getDaemonRuntime(ws.daemon_runtime_id).catch(() => null);
        setBoundRuntime(runtime);
      } else {
        setBoundRuntime(null);
      }
      setSpecWs(sw);
      setComponentCount(comps.total ?? comps.items?.length ?? 0);
      setActiveChanges(active.total ?? active.items?.length ?? 0);
      setArchivedChanges(archived.total ?? archived.items?.length ?? 0);
      setCurrentStage(rt?.current_stage ?? null);

      // Recover an in-progress Bootstrap/scan run (change_id == null) if any.
      const runs = await listAgentRuns(workspaceId).catch(() => [] as AgentRun[]);
      const bsRuns = runs
        .filter((r) => r.change_id == null)
        .sort((a, b) => {
          const ta = a.finished_at ?? a.started_at ?? "";
          const tb = b.finished_at ?? b.started_at ?? "";
          return +new Date(tb) - +new Date(ta);
        });
      const activeRun = bsRuns[0];

      if (
        activeRun &&
        (activeRun.status === "pending" || activeRun.status === "running") &&
        !streamClientRef.current &&
        activeBootstrapRunId !== activeRun.id
      ) {
        setActiveBootstrapRunId(activeRun.id);
        setBootstrapStatus(activeRun.status);
        setBootstrapLogs([]);
        connectBootstrapStream(activeRun.id);
      }

      // Save last finished Bootstrap run for display.
      const finished = bsRuns.find((r) =>
        ["completed", "failed", "killed"].includes(r.status),
      );
      setLastBsRun(finished ?? null);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载工作区失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      // Cleanup: close stream client on unmount
      streamClientRef.current?.disconnect();
      streamClientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  /* ---- SSE helpers ---- */

  function closeBootstrapStream() {
    streamClientRef.current?.disconnect();
    streamClientRef.current = null;
  }

  function closeBootstrapPanel() {
    closeBootstrapStream();
    setActiveBootstrapRunId(null);
    setBootstrapLogs([]);
    setBootstrapStatus(null);
    setBootstrapError(null);
    setBootstrapStreamStatus("disconnected");
    setBsInputValues({});
    setBsSubmittingInputs({});
    setBsRepliedInputs(new Set());
    setBsInputErrors({});
  }

  /**
   * Establish (or re-establish) the SSE stream for a Bootstrap/scan run.
   * Shared by handleBootstrap (fresh run) and load (recover in-progress run).
   * Always closes any existing connection first to guarantee a single stream.
   */
  function connectBootstrapStream(runId: string) {
    closeBootstrapStream();

    const client = new AgentRunStreamClient(workspaceId, runId);
    streamClientRef.current = client;

    client.onStatusChange((status: StreamStatus) => {
      setBootstrapStreamStatus(status);
      if (status === "error") {
        setBootstrapError("连接失败，请重试");
      }
    });

    client.onMessage((event) => {
      setBootstrapLogs((prev) => {
        if (event.log_id != null && prev.some((l) => l.id === event.log_id)) return prev;
        return [
          ...prev,
          {
            id: event.log_id ?? crypto.randomUUID(),
            run_id: runId,
            timestamp: event.timestamp,
            channel: event.channel,
            content_redacted: event.content,
          },
        ];
      });
    });

    client.onDone((data) => {
      if (data.status) {
        setBootstrapStatus(data.status as AgentRunStatus);
      }
      client.disconnect();
      void load();
    });

    const { accessToken } = useSession.getState();
    if (accessToken) {
      void client.connect(accessToken);
    } else {
      setBootstrapError("会话已失效，请重新登录后查看实时日志");
      streamClientRef.current = null;
    }
  }

  /* ---- Bootstrap handler ---- */

  async function handleBootstrap() {
    setBootstrapping(true);
    setPageError(null);
    closeBootstrapStream();
    setActiveBootstrapRunId(null);
    setBootstrapLogs([]);
    setBootstrapStatus(null);
    setBootstrapError(null);
    setBsInputValues({});
    setBsSubmittingInputs({});
    setBsRepliedInputs(new Set());
    setBsInputErrors({});

    try {
      const result = await bootstrapSpecWorkspace(workspaceId);
      setActiveBootstrapRunId(result.agent_run_id);
      setBootstrapStatus(result.status);
      connectBootstrapStream(result.agent_run_id);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "初始化失败");
    } finally {
      setBootstrapping(false);
    }
  }

  /* ---- Generate Projects handler ---- */

  async function handleGenerateProjects() {
    setGeneratingProjects(true);
    setPageError(null);
    try {
      const result = await generateProjects(workspaceId);
      if (result.reparse.created > 0) {
        void load();
      } else {
        setPageError("未生成新的项目组件（projects/*.yaml 可能已存在）");
      }
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "生成项目组件失败");
    } finally {
      setGeneratingProjects(false);
    }
  }

  /* ---- User input submission ---- */

  async function handleBsSubmitInput(logId: string) {
    if (!activeBootstrapRunId) return;
    const value = bsInputValues[logId]?.trim();
    if (!value) return;
    setBsSubmittingInputs((prev) => ({ ...prev, [logId]: true }));
    try {
      await submitAgentRunInput(workspaceId, activeBootstrapRunId, {
        content: value,
      });
      setBootstrapLogs((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          run_id: activeBootstrapRunId,
          timestamp: new Date().toISOString(),
          channel: "user_input" as const,
          content_redacted: value,
        },
      ]);
      setBsRepliedInputs((prev) => new Set(prev).add(logId));
      setBsInputValues((prev) => {
        const next = { ...prev };
        delete next[logId];
        return next;
      });
    } catch (err) {
      setBsInputErrors((prev) => ({
        ...prev,
        [logId]: err instanceof ApiError ? err.message : "提交输入失败",
      }));
    } finally {
      setBsSubmittingInputs((prev) => ({ ...prev, [logId]: false }));
    }
  }

  /* ---- Other handlers ---- */

  const handleSync = async () => {
    setSyncing(true);
    setPageError(null);
    try {
      const updated = await syncSpecWorkspace(workspaceId);
      setSpecWs(updated);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setPageError(null);
    try {
      const imported = await importSpecWorkspace(workspaceId);
      setSpecWs(imported);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const formatTs = (raw: string | null) =>
    raw ? new Date(raw).toLocaleString() : "---";

  if (loading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
        <p className="py-12 text-center text-xs text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
        <p className="py-12 text-center text-xs text-destructive">
          工作区不存在或加载失败。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-[11px] text-muted-foreground">
          <Link href="/workspaces" className="hover:underline">
            &larr; 工作区
          </Link>
        </p>
        <div className="mt-1 flex items-center gap-3">
          <h1>{workspace.name}</h1>
          <Badge variant={workspace.status === "active" ? "success" : "outline"}>
            {workspace.status}
          </Badge>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {workspace.slug}
        </p>
      </header>

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {/* Workspace basic info */}
      <section className="rounded-md border bg-card">
        <div className="border-b px-4 py-2.5">
          <h2 className="text-sm font-medium">基本信息</h2>
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1 px-4 py-3 text-xs">
          <WorkspacePathFields
            workspace={workspace}
            runtime={boundRuntime}
            linkRuntime
          />
          <dt className="text-muted-foreground">创建于</dt>
          <dd>{formatTs(workspace.created_at)}</dd>
          <dt className="text-muted-foreground">最后扫描</dt>
          <dd>{formatTs(workspace.last_scanned_at)}</dd>
        </dl>
        {/* ql-20260619-006：daemon-client workspace 改绑 daemon 入口 */}
        {isDaemonClientWorkspace(workspace) && (
          <div className="border-t px-4 py-2.5">
            <WorkspaceDaemonSwitcher
              workspaceId={workspaceId}
              currentRuntimeId={workspace.daemon_runtime_id}
              onChanged={() => void load()}
            />
          </div>
        )}
      </section>

      {/* Default Agent provider（FR-01/FR-02）*/}
      <section className="rounded-md border bg-card">
        <div className="border-b px-4 py-2.5">
          <h2 className="text-sm font-medium">默认智能体提供方</h2>
        </div>
        <div className="space-y-2.5 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            自动派发（阶段流转、scan-generate）且未显式指定 provider 时使用。留空则由守护进程默认决定。
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-[11px] text-muted-foreground">智能体提供方</label>
              <AgentProviderSelect
                value={defaultAgent}
                onChange={setDefaultAgent}
                includeDefault="未设置（由守护进程默认决定）"
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[11px] text-muted-foreground">智能体模型</label>
              <AgentModelInput
                value={defaultModel}
                onChange={setDefaultModel}
                placeholder="提供方默认值"
              />
            </div>
            <Button
              size="sm"
              onClick={handleSaveDefaultAgent}
              disabled={
                savingDefaultAgent ||
                (defaultAgent === workspace.default_agent &&
                  defaultModel === workspace.default_model)
              }
            >
              {savingDefaultAgent ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>
      </section>

      {/* Overview cards */}
      <section className="grid grid-cols-2 gap-px rounded-md border bg-border lg:grid-cols-4">
        <Link href={`/workspaces/${workspaceId}/components`} className="bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors">
          <p className="text-[11px] text-muted-foreground">项目组组件</p>
          <p className="text-sm font-semibold">{componentCount}</p>
        </Link>
        <Link href={`/workspaces/${workspaceId}/changes`} className="bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors">
          <p className="text-[11px] text-muted-foreground">进行中变更</p>
          <p className="text-sm font-semibold">{activeChanges}</p>
        </Link>
        <div className="bg-card px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">已归档变更</p>
          <p className="text-sm font-semibold">{archivedChanges}</p>
        </div>
        <Link href={`/workspaces/${workspaceId}/runtime`} className="bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors">
          <p className="text-[11px] text-muted-foreground">运行时阶段</p>
          <p className="text-sm font-semibold">{currentStage ?? "—"}</p>
        </Link>
      </section>

      {/* Spec Workspace info */}
      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-medium">规范管理（Spec Workspace）</h2>
          {specWs && (
            <div className="flex gap-2">
              {specWs.strategy === "platform-managed" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBootstrap}
                  disabled={bootstrapping || !!activeBootstrapRunId || syncing || importing}
                >
                  {bootstrapping
                    ? "初始化进行中…"
                    : activeBootstrapRunId
                      ? "初始化运行中…"
                      : "初始化"}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={handleSync}
                disabled={syncing || importing || bootstrapping}
              >
                {syncing ? "同步中…" : "同步"}
              </Button>
              {!specWs.repo_sillyspec_path && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleImport}
                  disabled={syncing || importing || bootstrapping}
                >
                  {importing ? "导入中…" : "导入"}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Bootstrap guidance for empty platform-managed spec roots */}
        {specWs && specWs.strategy === "platform-managed" && !bootstrapping && !activeBootstrapRunId && (
          <div className="mx-4 mt-3 mb-1 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <p className="font-medium">此工作区使用平台托管策略。</p>
            <p className="mt-0.5 text-blue-600">
              规范文件存储在独立的平台目录中，需要先初始化。点击上方
              <strong> 初始化 </strong>按钮使用 SillySpec CLI 初始化规范空间，或点击
              <strong> 导入 </strong>从代码仓库导入已有的 .sillyspec。
            </p>
          </div>
        )}

        {/* Last Bootstrap run result */}
        {!activeBootstrapRunId && lastBsRun && (() => {
            const bs = bsRunStatus(lastBsRun);
            return (
          <div className="mx-4 mt-3 mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
            <span className="text-muted-foreground">上次初始化</span>
            <Badge variant={bs.variant}>
              {bs.label}
            </Badge>
            <span className="text-muted-foreground">
              {lastBsRun.started_at ? formatTs(lastBsRun.started_at) : "—"}
            </span>
            {lastBsRun.duration_ms != null && (
              <span className="text-muted-foreground">耗时 {fmtDuration(lastBsRun.duration_ms)}</span>
            )}
            {lastBsRun.exit_code != null && lastBsRun.exit_code !== 0 && (
              <span className="text-destructive">exit_code={lastBsRun.exit_code}</span>
            )}
            <span className="font-mono text-zinc-400">{lastBsRun.id.slice(0, 8)}</span>
            {bs.variant === "success" && componentCount === 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateProjects}
                disabled={generatingProjects}
                className="ml-auto h-6 text-[11px]"
              >
                {generatingProjects ? "生成中..." : "生成项目组件"}
              </Button>
            )}
          </div>
            );
          })()}

        {/* Bootstrap SSE log panel — uses shared AgentLogViewer */}
        {activeBootstrapRunId && (
          <div className="mx-4 mt-3">
            <AgentLogViewer
              title="初始化运行"
              runId={activeBootstrapRunId}
              logs={bootstrapLogs}
              loading={false}
              emptyText="等待日志输出..."
              isLive={bootstrapStatus === "running" || bootstrapStatus === "pending"}
              summary={
                <Badge variant={statusToVariant(bootstrapStatus)}>
                  {bootstrapStatus ?? bootstrapStreamStatus}
                </Badge>
              }
              actions={
                <Button size="sm" variant="ghost" onClick={closeBootstrapPanel}>
                  关闭
                </Button>
              }
              inputControls={{
                inputValues: bsInputValues,
                submittingInputs: bsSubmittingInputs,
                inputErrors: bsInputErrors,
                repliedInputs: bsRepliedInputs,
                onChange: (logId, value) => setBsInputValues((prev) => ({ ...prev, [logId]: value })),
                onSubmit: handleBsSubmitInput,
              }}
            />
            {bootstrapError && (
              <p className="mt-2 text-xs text-destructive">{bootstrapError}</p>
            )}
          </div>
        )}

        {specWs ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 px-4 py-3 text-xs">
            <dt className="text-muted-foreground">策略</dt>
            <dd>
              <Badge variant="default">
                {STRATEGY_LABEL[specWs.strategy] ?? specWs.strategy}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">spec_root</dt>
            <dd className="truncate font-mono" title={specWs.spec_root}>
              {specWs.spec_root}
            </dd>
            <dt className="text-muted-foreground">同步状态</dt>
            <dd>
              <Badge variant={SYNC_STATUS_VARIANT[specWs.sync_status] ?? "outline"}>
                {SYNC_STATUS_LABEL[specWs.sync_status] ?? specWs.sync_status}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">profile 版本</dt>
            <dd className="font-mono">{specWs.profile_version}</dd>
            {specWs.repo_sillyspec_path && (
              <>
                <dt className="text-muted-foreground">仓库 .sillyspec</dt>
                <dd className="truncate font-mono" title={specWs.repo_sillyspec_path}>
                  {specWs.repo_sillyspec_path}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">最后同步</dt>
            <dd>{formatTs(specWs.last_synced_at)}</dd>
            <dt className="text-muted-foreground">创建于</dt>
            <dd>{formatTs(specWs.created_at)}</dd>
          </dl>
        ) : (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            当前工作区尚未关联 Spec Workspace。请通过创建流程设置规范策略。
          </div>
        )}
      </section>

      {/* Quick nav */}
      <section className="flex flex-wrap gap-2">
        {[
          { href: `/workspaces/${workspaceId}/components`, label: "项目组件" },
          { href: `/workspaces/${workspaceId}/changes`, label: "变更中心" },
          { href: `/workspaces/${workspaceId}/scan-docs`, label: "扫描文档" },
          { href: `/workspaces/${workspaceId}/runtime`, label: "运行时" },
          { href: `/workspaces/${workspaceId}/agent`, label: "智能体" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="inline-flex h-7 items-center rounded border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </section>
    </div>
  );
}
