"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  streamAgentRunLogs,
  submitAgentRunInput,
  type AgentRunLogEntry,
  type AgentRunStatus,
  type StreamLogEvent,
} from "@/lib/agent";
import { listComponents } from "@/lib/components";
import { listChanges } from "@/lib/changes";
import {
  bootstrapSpecWorkspace,
  getSpecWorkspace,
  importSpecWorkspace,
  syncSpecWorkspace,
  type SpecWorkspace,
} from "@/lib/spec-workspaces";
import { getRuntimeProgress } from "@/lib/runtime";
import {
  getWorkspace,
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

function channelLabel(channel: string): string {
  switch (channel) {
    case "stdout": return "INFO";
    case "stderr": return "WARN";
    case "tool_call": return "TOOL";
    case "pending_input": return "INPUT";
    case "user_input": return "USER";
    default: return channel.toUpperCase();
  }
}

function channelTagCls(channel: string): string {
  switch (channel) {
    case "stderr": return "text-amber-600";
    case "tool_call": return "text-blue-600";
    case "pending_input": return "text-amber-700";
    case "user_input": return "text-emerald-700";
    default: return "text-muted-foreground";
  }
}

function statusToVariant(status: AgentRunStatus | null): "success" | "warning" | "destructive" | "outline" {
  switch (status) {
    case "completed": return "success";
    case "running": return "warning";
    case "failed":
    case "killed": return "destructive";
    default: return "outline";
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WorkspaceDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
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
  const [bootstrapLogs, setBootstrapLogs] = useState<AgentRunLogEntry[]>([]);
  const [bootstrapStatus, setBootstrapStatus] = useState<AgentRunStatus | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [pendingInputPrompt, setPendingInputPrompt] = useState<string | null>(null);
  const [userInputText, setUserInputText] = useState("");
  const [submittingInput, setSubmittingInput] = useState(false);

  const bootstrapEsRef = useRef<EventSource | null>(null);

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
      setSpecWs(sw);
      setComponentCount(comps.total ?? comps.items?.length ?? 0);
      setActiveChanges(active.total ?? active.items?.length ?? 0);
      setArchivedChanges(archived.total ?? archived.items?.length ?? 0);
      setCurrentStage(rt?.current_stage ?? null);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载工作区失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      // Cleanup: close EventSource on unmount without modifying state
      bootstrapEsRef.current?.close();
      bootstrapEsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  /* ---- SSE helpers ---- */

  function closeBootstrapStream() {
    bootstrapEsRef.current?.close();
    bootstrapEsRef.current = null;
  }

  function closeBootstrapPanel() {
    closeBootstrapStream();
    setActiveBootstrapRunId(null);
    setBootstrapLogs([]);
    setBootstrapStatus(null);
    setBootstrapError(null);
    setPendingInputPrompt(null);
  }

  /* ---- Bootstrap handler ---- */

  async function handleBootstrap() {
    setBootstrapping(true);
    setPageError(null);
    // Close old connection and reset state
    closeBootstrapStream();
    setActiveBootstrapRunId(null);
    setBootstrapLogs([]);
    setBootstrapStatus(null);
    setBootstrapError(null);
    setPendingInputPrompt(null);

    try {
      const result = await bootstrapSpecWorkspace(workspaceId);
      setActiveBootstrapRunId(result.agent_run_id);
      setBootstrapStatus(result.status);

      // Dedup key helper
      const logKey = (log: { timestamp: string; channel: string; content: string }) =>
        `${result.agent_run_id}|${log.timestamp}|${log.channel}|${log.content}`;

      // Connect SSE immediately
      const es = streamAgentRunLogs(
        workspaceId,
        result.agent_run_id,
        (event: StreamLogEvent) => {
          const incomingKey = logKey(event);
          setBootstrapLogs((prev) => {
            // Dedup: skip if same key already exists
            if (prev.some((l) => logKey({ timestamp: l.timestamp, channel: l.channel, content: l.content_redacted }) === incomingKey)) {
              return prev;
            }
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                run_id: result.agent_run_id,
                timestamp: event.timestamp,
                channel: event.channel,
                content_redacted: event.content,
              },
            ];
          });
          // Handle pending_input channel
          if (event.channel === "pending_input") {
            setPendingInputPrompt(event.content || "");
          }
        },
        () => {
          // onDone: run reached terminal state
          setBootstrapStatus("completed");
          closeBootstrapStream();
          void load(); // Refresh SpecWorkspace status
        },
        (err: Error) => {
          // onError
          setBootstrapError(err.message);
          closeBootstrapStream();
        },
      );
      bootstrapEsRef.current = es;
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "初始化失败");
    } finally {
      setBootstrapping(false);
    }
  }

  /* ---- User input submission ---- */

  async function handleSubmitInput() {
    if (!activeBootstrapRunId || !userInputText.trim()) return;
    setSubmittingInput(true);
    try {
      await submitAgentRunInput(workspaceId, activeBootstrapRunId, {
        content: userInputText.trim(),
      });
      // Append user_input log to panel
      setBootstrapLogs((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          run_id: activeBootstrapRunId,
          timestamp: new Date().toISOString(),
          channel: "user_input" as const,
          content_redacted: userInputText.trim(),
        },
      ]);
      setUserInputText("");
      setPendingInputPrompt(null);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "提交输入失败");
      // Keep input text and prompt visible for retry
    } finally {
      setSubmittingInput(false);
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
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
      <header>
        <p className="text-[11px] text-muted-foreground">
          <Link href="/workspaces" className="hover:underline">
            &larr; Workspaces
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
          <dt className="text-muted-foreground">root_path</dt>
          <dd className="truncate font-mono" title={workspace.root_path}>
            {workspace.root_path}
          </dd>
          <dt className="text-muted-foreground">创建于</dt>
          <dd>{formatTs(workspace.created_at)}</dd>
          <dt className="text-muted-foreground">最后扫描</dt>
          <dd>{formatTs(workspace.last_scanned_at)}</dd>
        </dl>
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
          <h2 className="text-sm font-medium">规范管理 (Spec Workspace)</h2>
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
                    ? "初始化中..."
                    : activeBootstrapRunId
                      ? "Bootstrap 运行中..."
                      : "Bootstrap"}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={handleSync}
                disabled={syncing || importing || bootstrapping}
              >
                {syncing ? "同步中..." : "Sync"}
              </Button>
              {!specWs.repo_sillyspec_path && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleImport}
                  disabled={syncing || importing || bootstrapping}
                >
                  {importing ? "导入中..." : "Import"}
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
              <strong> Bootstrap </strong>按钮使用 SillySpec CLI 初始化规范空间，或点击
              <strong> Import </strong>从代码仓库导入已有的 .sillyspec。
            </p>
          </div>
        )}

        {/* Bootstrap SSE log panel */}
        {activeBootstrapRunId && (
          <div className="mx-4 mt-3 rounded border bg-muted/40">
            {/* Panel title bar */}
            <div className="flex items-center justify-between border-b px-3 py-1.5">
              <div className="flex items-center gap-2">
                <code className="text-[11px] font-mono">
                  Bootstrap Run: {activeBootstrapRunId.length > 8 ? activeBootstrapRunId.slice(0, 8) + "..." : activeBootstrapRunId}
                </code>
                <Badge variant={statusToVariant(bootstrapStatus)}>
                  {bootstrapStatus ?? "connecting"}
                </Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={closeBootstrapPanel}>
                关闭
              </Button>
            </div>

            {/* Log area */}
            <div className="max-h-[300px] overflow-auto">
              {bootstrapLogs.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  等待日志输出...
                </p>
              ) : (
                <div className="divide-y">
                  {bootstrapLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2 px-3 py-1.5">
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={`shrink-0 font-mono text-[11px] font-medium ${channelTagCls(log.channel)}`}>
                        [{channelLabel(log.channel)}]
                      </span>
                      <span className="flex-1 break-all text-[11px]">
                        {log.content_redacted}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* User input area (shown when pending_input event received) */}
            {pendingInputPrompt !== null && (
              <div className="border-t px-3 py-2">
                <p className="text-xs text-amber-700 font-medium mb-1">
                  Agent 请求指导{pendingInputPrompt ? `: ${pendingInputPrompt}` : ""}
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 rounded border bg-background px-2 py-1 text-xs"
                    placeholder="输入指导..."
                    value={userInputText}
                    onChange={(e) => setUserInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !submittingInput) handleSubmitInput();
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!userInputText.trim() || submittingInput}
                    onClick={handleSubmitInput}
                  >
                    {submittingInput ? "提交中..." : "提交"}
                  </Button>
                </div>
              </div>
            )}

            {/* Error display */}
            {bootstrapError && (
              <div className="border-t px-3 py-2 text-xs text-destructive">
                {bootstrapError}
              </div>
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
          { href: `/workspaces/${workspaceId}/agent`, label: "Agent" },
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
    </main>
  );
}
