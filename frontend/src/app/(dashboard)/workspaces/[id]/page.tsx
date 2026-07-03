"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AgentRunPanel } from "@/components/agent-run-panel";
import { AgentModelInput } from "@/components/AgentModelInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { WorkspaceDaemonSwitcher } from "@/components/workspace-daemon-switcher";
import { WorkspacePathFields } from "@/components/workspace-path-fields";
import { ApiError } from "@/lib/api";
import { getDaemonRuntime, listDaemonRuntimes, PROVIDER_META, type DaemonRuntimeRead } from "@/lib/daemon";
import { isDaemonClientWorkspace } from "@/lib/workspace-path";
import {
  type AgentRunStatus,
} from "@/lib/agent";
import { listComponents } from "@/lib/components";
import { listChanges } from "@/lib/changes";
import {
  generateProjects,
  getSpecWorkspace,
  importSpecWorkspace,
  initDispatch,
  listPendingSync,
  syncManual,
  type ImportPhase,
  type SpecWorkspace,
} from "@/lib/spec-workspaces";
import { getRuntimeProgress } from "@/lib/runtime";
import {
  getWorkspace,
  scanGenerate,
  updateWorkspace,
  type Workspace,
} from "@/lib/workspaces";
import { fetchMyBinding, type MemberBindingView } from "@/lib/workspace-binding";
import { useSession } from "@/stores/session";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  params: { id: string };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SYNC_STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  pending: "outline",
  clean: "success",
  dirty: "warning",
  conflicted: "destructive",
};

const SYNC_STATUS_LABEL: Record<string, string> = {
  pending: "待同步",
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

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
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
  const [myBinding, setMyBinding] = useState<MemberBindingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importPhase, setImportPhase] = useState<ImportPhase | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // daemon-client scan 状态（task-14 / D-006@v1）：详情页扫描入口
  const [activeScanRunId, setActiveScanRunId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<AgentRunStatus | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [generatingProjects, setGeneratingProjects] = useState(false);
  // task-08 / D-002/D-009：init dispatch 状态
  const [initSyncedAt, setInitSyncedAt] = useState<string | null>(null);
  const [initing, setIniting] = useState(false);
  const initPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // task-14 / D-012：同步到服务器状态机
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "done" | "failed">("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // workspace 级默认 agent provider 编辑态（FR-01/FR-02，2026-06-14-agent-runtime-selection）
  const [defaultAgent, setDefaultAgent] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [savingDefaultAgent, setSavingDefaultAgent] = useState(false);
  // task-11 / daemon-entity-binding：当前绑定守护进程的在线 provider 列表
  const [boundDaemonProviders, setBoundDaemonProviders] = useState<string[]>([]);
  // ql-20260630-001：scan 进入 failed/killed 视为"未完成·可重扫"（守护进程重启等中断），
  // 不以冷冰冰终态失败——scan 幂等，直接给重新扫描入口，对齐"像会话一样继续"。
  const scanInterrupted = scanStatus === "failed" || scanStatus === "killed";
  // task-08 / D-003@V2：owner 门禁
  const isOwner = (() => {
    const ownerId = workspace?.owner?.user_id;
    const currentUserId = useSession.getState().user?.id;
    if (!ownerId || !currentUserId) return true; // 无 owner / 无会话时放行
    return ownerId === currentUserId;
  })();

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

      // task-08 / D-002：获取当前成员 binding 以判定 init 状态
      const binding = await fetchMyBinding(workspaceId).catch(() => null);
      setMyBinding(binding);
      setInitSyncedAt(binding?.init_synced_at ?? null);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载工作区失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // 初始化轮询清理（task-08 / D-002/D-009）
    return () => {
      if (initPollRef.current) {
        clearInterval(initPollRef.current);
        initPollRef.current = null;
      }
      if (syncPollRef.current) {
        clearInterval(syncPollRef.current);
        syncPollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  /* ----  task-11 / daemon-entity-binding：根据绑定 daemon 获取在线 provider 列表 ---- */
  useEffect(() => {
    if (!myBinding?.daemon_id) {
      setBoundDaemonProviders([]);
      return;
    }
    let active = true;
    listDaemonRuntimes()
      .then((runtimes) => {
        if (!active) return;
        const filtered = runtimes.filter(
          (r) =>
            r.daemon_instance_id === myBinding.daemon_id &&
            r.status === "online" &&
            r.provider,
        );
        const providers = Array.from(
          new Set(filtered.map((r) => r.provider as string)),
        );
        setBoundDaemonProviders(providers);
      })
      .catch(() => {
        if (active) setBoundDaemonProviders([]);
      });
    return () => {
      active = false;
    };
  }, [myBinding?.daemon_id]);

  /* ---- Scan panel callbacks（task-14 / D-006@v1）---- */
  const handleScanRunDone = useCallback((status: string) => {
    setScanStatus(status as AgentRunStatus);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const closeScanPanel = useCallback(() => {
    setActiveScanRunId(null);
    setScanStatus(null);
    setScanError(null);
  }, []);

  /* ---- Init handler（D-002/D-009，task-08）---- */

  async function handleInit() {
    setIniting(true);
    setPageError(null);
    try {
      await initDispatch(workspaceId);
      // 轮询 fetchMyBinding 直到 init_synced_at 非空
      initPollRef.current = setInterval(async () => {
        if (document.hidden) return; // visibilitychange 暂停（D-005）
        try {
          const binding = await fetchMyBinding(workspaceId);
          const syncedAt = binding?.init_synced_at ?? null;
          if (syncedAt) {
            if (initPollRef.current) {
              clearInterval(initPollRef.current);
              initPollRef.current = null;
            }
            setInitSyncedAt(syncedAt);
            setIniting(false);
            void load();
          }
        } catch {
          // 轮询错误忽略，下一 tick 重试
        }
      }, 2000);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "初始化失败");
      setIniting(false);
    }
  }

  /* ---- Sync Manual handler（D-012，task-14）---- */

  async function handleSyncManual() {
    if (!specWs) return;
    setSyncStatus("syncing");
    setSyncError(null);
    setPageError(null);
    try {
      const result = await syncManual(workspaceId);
      if (result.status === "done") {
        setSyncStatus("done");
        return;
      }
      // pending → 轮询
      syncPollRef.current = setInterval(async () => {
        if (document.hidden) return;
        try {
          const items = await listPendingSync(workspaceId);
          const latest = items[0];
          if (!latest) {
            setSyncStatus("done");
            if (syncPollRef.current) {
              clearInterval(syncPollRef.current);
              syncPollRef.current = null;
            }
            return;
          }
          if (latest.status === "done") {
            setSyncStatus("done");
            if (syncPollRef.current) {
              clearInterval(syncPollRef.current);
              syncPollRef.current = null;
            }
            void load();
          } else if (latest.status === "failed") {
            setSyncStatus("failed");
            setSyncError("同步到服务器失败");
            if (syncPollRef.current) {
              clearInterval(syncPollRef.current);
              syncPollRef.current = null;
            }
          }
          // pending/claimed/in_progress → 继续轮询
        } catch {
          // 轮询错误忽略，下一 tick 重试
        }
      }, 2000);
      // 5min 上限（R-06）
      setTimeout(() => {
        setSyncStatus((s) => {
          if (s === "syncing") {
            setSyncError("仍在排队，请稍后再试");
            return "failed";
          }
          return s;
        });
        if (syncPollRef.current) {
          clearInterval(syncPollRef.current);
          syncPollRef.current = null;
        }
      }, 5 * 60 * 1000);
    } catch (err) {
      setSyncStatus("failed");
      setSyncError(err instanceof ApiError ? err.message : "同步派发失败");
    }
  }

  /* ---- Scan handler（task-14 / D-006@v1 + task-08 D-003@V2）---- */
  async function handleScan() {
    if (!workspace?.daemon_runtime_id) return;

    // D-003@V2：已扫过时弹确认
    if (componentCount > 0) {
      const ok = window.confirm("该工作区已有扫描结果，是否重新扫描？");
      if (!ok) return;
    }

    setScanning(true);
    setPageError(null);
    setActiveScanRunId(null);
    setScanStatus(null);
    setScanError(null);
    try {
      const result = await scanGenerate(
        workspace.root_path,
        workspace.default_agent ?? null,
        workspace.default_model ?? null,
        "daemon-client",
        workspace.daemon_runtime_id,
        specWs?.strategy,
      );
      setActiveScanRunId(result.agent_run_id);
      setScanStatus("pending");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const confirmed = window.confirm("该工作区已有扫描结果，是否重新扫描？");
        if (confirmed) {
          // 用户确认后重试；此轮已释放 scanning 锁，re-invoke 即可
          setScanning(false);
          await handleScan();
          return;
        }
      }
      setPageError(err instanceof ApiError ? err.message : "扫描失败");
    } finally {
      setScanning(false);
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

  /* ---- Other handlers ---- */

  const handleImport = async () => {
    setImporting(true);
    setImportPhase("packing");
    setPageError(null);
    try {
      await importSpecWorkspace(workspaceId, {
        onProgress: (phase) => setImportPhase(phase),
      });
      // done：刷新 spec_ws + 变更中心（changes 入 Change 表后立即显示）
      setSpecWs(await getSpecWorkspace(workspaceId));
      void load();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "导入失败");
    } finally {
      setImporting(false);
      setImportPhase(null);
    }
  };

  const formatTs = (raw: string | null) =>
    raw ? new Date(raw).toLocaleString() : "---";

  if (loading) {
    return (
      <PageContainer size="full">
        <p className="py-12 text-center text-xs text-muted-foreground">加载中...</p>
      </PageContainer>
    );
  }

  if (!workspace) {
    return (
      <PageContainer size="full">
        <p className="py-12 text-center text-xs text-destructive">
          工作区不存在或加载失败。
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="full">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {workspace.name}
            <Badge variant={workspace.status === "active" ? "success" : "outline"}>
              {workspace.status}
            </Badge>
          </span>
        }
        subtitle={<span className="font-mono">{workspace.slug}</span>}
        actions={
          <Link href="/workspaces" className="text-[11px] text-muted-foreground hover:underline">
            &larr; 工作区
          </Link>
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {/* Workspace basic info */}
      <SectionCard title="基本信息">
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-xs">
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
          <div className="mt-3 border-t pt-2.5">
            <WorkspaceDaemonSwitcher
              workspaceId={workspaceId}
              currentBinding={myBinding!}
              onChanged={() => void load()}
            />
          </div>
        )}
      </SectionCard>

      {/* Default Agent provider（FR-01/FR-02 / daemon-entity-binding task-11）*/}
      <SectionCard title="默认智能体提供方">
        <div className="space-y-2.5">
          <p className="text-xs text-muted-foreground">
            自动派发（阶段流转、scan-generate）且未显式指定 provider 时使用。留空则由守护进程默认决定。
          </p>
          {myBinding?.daemon_id ? (
            boundDaemonProviders.length > 0 ? (
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-muted-foreground">智能体提供方</label>
                  <select
                    value={defaultAgent ?? ""}
                    onChange={(e) => setDefaultAgent(e.target.value === "" ? null : e.target.value)}
                    className="h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
                  >
                    <option value="">未设置（由守护进程默认决定）</option>
                    {boundDaemonProviders.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_META[p]?.label ?? p}
                      </option>
                    ))}
                    {defaultAgent && !boundDaemonProviders.includes(defaultAgent) && (
                      <option value={defaultAgent}>
                        {PROVIDER_META[defaultAgent]?.label ?? defaultAgent}（离线）
                      </option>
                    )}
                  </select>
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
            ) : (
              <p className="text-xs text-muted-foreground">
                当前绑定的守护进程无在线智能体提供方，请先确认守护进程已启用。
              </p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              请先绑定守护进程。
            </p>
          )}
        </div>
      </SectionCard>

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
      <SectionCard
        title="规范管理（Spec Workspace）"
        extra={
          specWs ? (
            <div className="flex gap-2">
              {/* task-08 / D-002：初始化按钮（platform-managed → init dispatch） */}
              {specWs.strategy === "platform-managed" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleInit}
                  disabled={initing || !!activeScanRunId || scanning || importing}
                >
                  {initing ? "初始化进行中…" : "初始化"}
                </Button>
              )}
              {/* task-14 / D-006@v1：daemon-client 详情页扫描入口；task-08 D-003@V2 owner 门禁 */}
              {isDaemonClientWorkspace(workspace) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleScan}
                  disabled={!isOwner || !!activeScanRunId || scanning || importing || initing}
                  title={!isOwner ? "仅 owner 可扫描" : undefined}
                >
                  {scanning
                    ? "派发中…"
                    : activeScanRunId
                      ? "扫描运行中…"
                      : "扫描"}
                </Button>
              )}
              {/* task-14 / D-012：就绪态「同步到服务器」按钮 */}
              {initSyncedAt && componentCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSyncManual}
                  disabled={
                    syncStatus === "syncing" ||
                    initing ||
                    !!activeScanRunId ||
                    scanning ||
                    importing
                  }
                >
                  {syncStatus === "syncing"
                    ? "同步中…"
                    : syncStatus === "done"
                      ? "已同步"
                      : "同步到服务器"}
                </Button>
              )}
              {!specWs.repo_sillyspec_path && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleImport}
                  disabled={importing || initing}
                >
                  {importing
                    ? `${
                        {
                          packing: "打包中",
                          packed: "已打包",
                          applying: "落盘中",
                          reparsing_docs: "解析文档",
                          reparsing_changes: "解析变更",
                          done: "完成",
                          error: "失败",
                        }[importPhase ?? "packing"]
                      }…`
                    : "导入"}
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {/* task-08 / D-002/D-005/D-003@V2：三态引导 */}
        {specWs && !initing && (
          <>
            {!initSyncedAt && (
              /* 未初始化：文案按 spec 策略区分，避免承诺一个不会出现的按钮 */
              specWs.strategy === "platform-managed" ? (
                <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <p className="font-medium">此工作区尚未初始化。</p>
                  <p className="mt-0.5 text-blue-600">
                    点击上方<strong> 初始化 </strong>按钮，将平台配置下发到本地项目目录。
                  </p>
                </div>
              ) : (
                <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <p className="font-medium">此工作区尚未扫描。</p>
                  <p className="mt-0.5 text-blue-600">
                    点击上方<strong> 扫描 </strong>按钮，将仓库中的规范文档读取到平台。
                  </p>
                </div>
              )
            )}
            {initSyncedAt && componentCount === 0 && (
              /* 已初始化·未扫描 */
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p className="font-medium">已初始化，但工作区尚无扫描文档。</p>
                <p className="mt-0.5 text-amber-600">
                  请由 owner 点击<strong> 扫描 </strong>按钮生成规范文档。
                </p>
              </div>
            )}
            {initSyncedAt && componentCount > 0 && (
              /* 就绪 */
              <div className="mb-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                <p className="font-medium">工作区已就绪。</p>
                <p className="mt-0.5 text-green-600">
                  规范文档已同步，可直接使用。
                </p>
              </div>
            )}
          </>
        )}

        {/* Init 进行中反馈 */}
        {initing && (
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <p className="font-medium">初始化进行中...</p>
            <p className="mt-0.5 text-blue-600">
              正在将平台配置下发到本地项目目录并拉取文档缓存，请稍候...
            </p>
          </div>
        )}

        {/* task-14 / D-012：同步到服务器状态反馈 */}
        {syncStatus === "syncing" && (
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <p className="font-medium">同步中...</p>
            <p className="mt-0.5 text-blue-600">
              正在将缓存变更推送到服务器，请稍候...
            </p>
          </div>
        )}
        {syncStatus === "done" && (
          <div className="mb-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
            <p className="font-medium">已同步。</p>
            <p className="mt-0.5 text-green-600">
              缓存变更已成功推送到服务器。
            </p>
          </div>
        )}
        {syncStatus === "failed" && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-destructive">
            <p className="font-medium">同步失败。</p>
            {syncError && <p className="mt-0.5">{syncError}</p>}
          </div>
        )}

        {/* task-14 / D-006@v1：daemon-client 扫描运行面板 */}
        {activeScanRunId && (
          <div className="mb-3">
            <AgentRunPanel
              workspaceId={workspaceId}
              runId={activeScanRunId}
              isActive={scanStatus === "running" || scanStatus === "pending"}
              title="扫描运行"
              emptyText="等待日志输出..."
              isLive={scanStatus === "running" || scanStatus === "pending"}
              summary={
                <Badge variant={scanInterrupted ? "warning" : statusToVariant(scanStatus)}>
                  {scanInterrupted ? "未完成" : (scanStatus ?? "等待中")}
                </Badge>
              }
              onClose={closeScanPanel}
              onDone={handleScanRunDone}
            />
            {scanInterrupted && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
                <span className="text-warning">
                  上次扫描未完成（守护进程可能重启），可重新扫描。
                </span>
                <Button size="sm" variant="outline" onClick={() => void handleScan()}>
                  重新扫描
                </Button>
              </div>
            )}
            {scanError && (
              <p className="mt-2 text-xs text-destructive">{scanError}</p>
            )}
          </div>
        )}

        {specWs ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
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
          <div className="py-6 text-center text-xs text-muted-foreground">
            当前工作区尚未关联 Spec Workspace。请通过创建流程设置规范策略。
          </div>
        )}
      </SectionCard>

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
    </PageContainer>
  );
}
