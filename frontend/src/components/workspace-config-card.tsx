"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AgentRunPanel } from "@/components/agent-run-panel";
import { WorkspaceAccessGuide } from "@/components/workspace-access-guide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/layout";
import { ApiError } from "@/lib/api";
import {
  type AgentRunStatus,
} from "@/lib/agent";
import { PROVIDER_META, type DaemonInstanceRead } from "@/lib/daemon";
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
import { scanGenerate, type Workspace } from "@/lib/workspaces";
import {
  isDaemonClientWorkspace,
  workspacePathSourceLabel,
  type WorkspacePathSource,
} from "@/lib/workspace-path";
import {
  fetchMyBinding,
  type MemberBindingView,
} from "@/lib/workspace-binding";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface WorkspaceConfigCardProps {
  workspace: Workspace;
  specWs: SpecWorkspace | null;
  myBinding: MemberBindingView | null;
  boundDaemon: DaemonInstanceRead | null;
  isOwner: boolean;
  onRefresh: () => void;
  /**
   * 工作区已扫描组件数（task-06 R-01：原 page.tsx 顶层共享 state，被「同步到服务器」
   * 按钮门禁与三态引导消费；Workspace 类型无此字段，故作可选 prop 由 page.tsx 注入。
   * 不传时按 0 处理。
   */
  componentCount?: number;
}

/* ------------------------------------------------------------------ */
/*  Constants (与 page.tsx 等价迁入)                                   */
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

const IMPORT_PHASE_LABEL: Record<ImportPhase, string> = {
  packing: "打包中",
  packed: "已打包",
  applying: "落盘中",
  reparsing_docs: "解析文档",
  reparsing_changes: "解析变更",
  done: "完成",
  error: "失败",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTs(raw: string | null): string {
  return raw ? new Date(raw).toLocaleString() : "---";
}

function statusToVariant(
  status: AgentRunStatus | null,
): "success" | "warning" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "success";
    case "running":
      return "warning";
    case "failed":
    case "killed":
      return "destructive";
    default:
      return "outline";
  }
}

/** 守护进程本地缓存 ~ 三平台解释（design §5.5 / D-004@V1）。 */
const CACHE_ROOT_TOOLTIP =
  "守护进程在你电脑上缓存这个工作区文档的位置。`~` = 你的用户主目录（Windows: C:\\Users\\<你>；macOS/Linux: /home/<你>）";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function WorkspaceConfigCard(props: WorkspaceConfigCardProps): JSX.Element {
  const {
    workspace,
    specWs,
    myBinding,
    boundDaemon,
    isOwner,
    onRefresh,
    componentCount = 0,
  } = props;
  const workspaceId = workspace.id;

  /* ---- 派生值（design §7.3）---- */
  const runtimeRoot: string | null = specWs?.spec_root
    ? `${specWs.spec_root}/runtime`
    : null;
  const cacheRoot = `~/.sillyhub/daemon/specs/${workspaceId}`;
  const daemonClient = isDaemonClientWorkspace(workspace);
  const isServerLocal = workspace.path_source === "server-local";

  /* ---- 编辑表单展开 state ---- */
  const [editing, setEditing] = useState(false);

  /* ---- 操作按钮 state（task-06，与 page.tsx 等价迁入）---- */
  const [initing, setIniting] = useState(false);
  const [initSyncedAt, setInitSyncedAt] = useState<string | null>(
    myBinding?.init_synced_at ?? null,
  );
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "syncing" | "done" | "failed"
  >("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [activeScanRunId, setActiveScanRunId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<AgentRunStatus | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importPhase, setImportPhase] = useState<ImportPhase | null>(null);
  const [generatingProjects, setGeneratingProjects] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const initPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- 绑定初始化状态徽标随 prop 同步 ---- */
  useEffect(() => {
    setInitSyncedAt(myBinding?.init_synced_at ?? null);
  }, [myBinding?.init_synced_at]);

  /* ---- 卸载清理（task-06 / R-01）---- */
  useEffect(() => {
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
  }, []);

  /* ---- Init handler（D-002/D-009，与 page.tsx 等价）---- */
  async function handleInit(): Promise<void> {
    setIniting(true);
    setLocalError(null);
    try {
      await initDispatch(workspaceId);
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
            onRefresh();
          }
        } catch {
          // 轮询错误忽略，下一 tick 重试
        }
      }, 2000);
    } catch (err) {
      setLocalError(err instanceof ApiError ? err.message : "初始化失败");
      setIniting(false);
    }
  }

  /* ---- Sync Manual handler（D-012，与 page.tsx 等价含 5min 上限）---- */
  async function handleSyncManual(): Promise<void> {
    if (!specWs) return;
    setSyncStatus("syncing");
    setSyncError(null);
    setLocalError(null);
    try {
      const result = await syncManual(workspaceId);
      if (result.status === "done") {
        setSyncStatus("done");
        return;
      }
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
            onRefresh();
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

  /* ---- Scan handler（task-14 / D-006@v1 + D-003@V2 owner 门禁）---- */
  async function handleScan(): Promise<void> {
    // daemon-entity-binding 后稳定绑定键是 myBinding.daemon_id（守护进程实体）。
    // workspace.daemon_runtime_id 对新工作区恒为 NULL（绑定下沉到 per-member binding
    // 行，见 workspace-card.tsx:27 / workspace-path-fields.tsx:28 / api-types.ts:346 注释）；
    // myBinding.runtime_id 也不稳定（runtime 动态注册，常为 null）。扫描必须改用
    // daemon_id 派发，否则点击静默 return 无反应。backend scan-generate schema 同步接 daemon_id。
    const daemonId = myBinding?.daemon_id ?? null;
    if (!daemonId) {
      setLocalError("未绑定守护进程，无法扫描。请先在「我的接入」完成绑定。");
      return;
    }

    // D-003@V2：已扫过时弹确认（componentCount > 0）
    if (componentCount > 0) {
      const ok = window.confirm("该工作区已有扫描结果，是否重新扫描？");
      if (!ok) return;
    }

    setScanning(true);
    setLocalError(null);
    setActiveScanRunId(null);
    setScanStatus(null);
    setScanError(null);
    try {
      const result = await scanGenerate(
        workspace.root_path,
        workspace.default_agent ?? null,
        workspace.default_model ?? null,
        "daemon-client",
        null,
        specWs?.strategy,
        daemonId,
      );
      setActiveScanRunId(result.agent_run_id);
      setScanStatus("pending");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const confirmed = window.confirm("该工作区已有扫描结果，是否重新扫描？");
        if (confirmed) {
          setScanning(false);
          await handleScan();
          return;
        }
      }
      setLocalError(err instanceof ApiError ? err.message : "扫描失败");
    } finally {
      setScanning(false);
    }
  }

  /* ---- Import handler（SSE onProgress，与 page.tsx 等价）---- */
  async function handleImport(): Promise<void> {
    setImporting(true);
    setImportPhase("packing");
    setLocalError(null);
    try {
      await importSpecWorkspace(workspaceId, {
        onProgress: (phase) => setImportPhase(phase),
      });
      // done：刷新 specWs（page.tsx 顶层 specWs state）+ 变更中心
      // 改为 onRefresh 让 page.tsx 重新 load 共享 specWs，避免双源真相（design §5.1）
      await getSpecWorkspace(workspaceId).catch(() => null);
      onRefresh();
    } catch (err) {
      setLocalError(err instanceof ApiError ? err.message : "导入失败");
    } finally {
      setImporting(false);
      setImportPhase(null);
    }
  }

  /* ---- Generate Projects handler ---- */
  async function handleGenerateProjects(): Promise<void> {
    setGeneratingProjects(true);
    setLocalError(null);
    try {
      const result = await generateProjects(workspaceId);
      if (result.reparse.created > 0) {
        onRefresh();
      } else {
        setLocalError("未生成新的项目组件（projects/*.yaml 可能已存在）");
      }
    } catch (err) {
      setLocalError(
        err instanceof ApiError ? err.message : "生成项目组件失败",
      );
    } finally {
      setGeneratingProjects(false);
    }
  }

  /* ---- Scan panel callbacks（task-14 / D-006@v1）---- */
  const handleScanRunDone = useCallback(
    (status: string) => {
      setScanStatus(status as AgentRunStatus);
      onRefresh();
    },
    [onRefresh],
  );

  const closeScanPanel = useCallback(() => {
    setActiveScanRunId(null);
    setScanStatus(null);
    setScanError(null);
  }, []);

  const scanInterrupted =
    scanStatus === "failed" || scanStatus === "killed";

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  // 头部操作按钮（5 按钮，与 page.tsx 598-674 行条件等价）
  const headActions = specWs ? (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => void handleInit()}
        disabled={initing || !!activeScanRunId || scanning || importing}
      >
        {initing ? "初始化进行中…" : "初始化"}
      </Button>
      {daemonClient && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleScan()}
          disabled={
            !isOwner || !!activeScanRunId || scanning || importing || initing
          }
          title={!isOwner ? "仅 owner 可扫描" : undefined}
        >
          {scanning
            ? "派发中…"
            : activeScanRunId
              ? "扫描运行中…"
              : "扫描"}
        </Button>
      )}
      {initSyncedAt && componentCount > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleSyncManual()}
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
          onClick={() => void handleImport()}
          disabled={importing || initing}
        >
          {importing
            ? `${IMPORT_PHASE_LABEL[importPhase ?? "packing"]}…`
            : "导入"}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void handleGenerateProjects()}
        disabled={generatingProjects || importing || initing}
        title="根据 projects/*.yaml 生成项目组件"
      >
        {generatingProjects ? "生成中…" : "生成项目"}
      </Button>
    </div>
  ) : undefined;

  /* ---- 「我的接入」组绑定守护进程 dd（task-02 + task-05 server-local 分支）---- */
  const renderBoundDaemonDd = (): JSX.Element => {
    if (isServerLocal) {
      return (
        <span
          data-testid="server-local-no-daemon"
          className="text-muted-foreground"
        >
          服务器本地工作区，无需守护进程
        </span>
      );
    }
    if (!boundDaemon) {
      return <span className="text-muted-foreground">未绑定守护进程</span>;
    }
    const daemonLabel = boundDaemon.display_alias ?? boundDaemon.hostname;
    const providerLabels = boundDaemon.providers
      .map((p) => PROVIDER_META[p.provider]?.label ?? p.provider)
      .filter(Boolean);
    return (
      <span className="min-w-0">
        <span className="truncate align-middle" title={boundDaemon.id}>
          {daemonLabel}
        </span>
        {providerLabels.length > 0 && (
          <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
            {providerLabels.map((label) => (
              <Badge key={label} variant="outline" className="text-[10px]">
                {label}
              </Badge>
            ))}
          </span>
        )}
        <Badge
          variant={boundDaemon.status === "online" ? "success" : "outline"}
          className="ml-1.5 align-middle text-[10px]"
        >
          {boundDaemon.status === "online" ? "在线" : "离线"}
        </Badge>
      </span>
    );
  };

  /* ---- 「我的接入」组（task-02 + task-04 编辑 + task-05 未绑定/server-local）---- */
  const renderMyAccessGroup = (): JSX.Element => {
    // 未绑定：WorkspaceAccessGuide 首次模式（task-05）
    if (!myBinding) {
      return (
        <div className="space-y-3">
          <WorkspaceAccessGuide
            workspaceId={workspaceId}
            onConfigured={onRefresh}
          />
        </div>
      );
    }

    const pathSource = myBinding.path_source as WorkspacePathSource;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="outline"
            data-testid="config-edit-entry"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "收起" : "编辑我的接入"}
          </Button>
        </div>

        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
          <dt className="text-muted-foreground">绑定守护进程</dt>
          <dd>{renderBoundDaemonDd()}</dd>

          <dt className="text-muted-foreground">我的本地项目路径</dt>
          <dd className="truncate font-mono" title={myBinding.root_path}>
            {myBinding.root_path}
          </dd>

          <dt className="text-muted-foreground">路径来源</dt>
          <dd>
            <Badge variant={daemonClient ? "default" : "outline"}>
              {workspacePathSourceLabel(pathSource)}
            </Badge>
          </dd>

          <dt className="text-muted-foreground">接入初始化状态</dt>
          <dd>
            {myBinding.init_synced_at ? (
              <span className="inline-flex items-center gap-1.5">
                <Badge variant="success">已初始化</Badge>
                <span className="text-muted-foreground">
                  {formatTs(myBinding.init_synced_at)}
                  {myBinding.init_synced_spec_version != null
                    ? `（v${myBinding.init_synced_spec_version}）`
                    : ""}
                </span>
              </span>
            ) : (
              <Badge variant="warning">未初始化</Badge>
            )}
          </dd>

          <dt className="text-muted-foreground">上次接入同步</dt>
          <dd>{formatTs(myBinding.synced_at)}</dd>
        </dl>

        {/* task-04：编辑入口就地展开（非 Modal） */}
        {editing && (
          <WorkspaceAccessGuide
            workspaceId={workspaceId}
            onConfigured={() => {
              setEditing(false);
              onRefresh();
            }}
            initial={{
              daemon_id: myBinding.daemon_id ?? null,
              root_path: myBinding.root_path,
              path_source: myBinding.path_source,
            }}
          />
        )}
      </div>
    );
  };

  /* ---- 「工作区文档存储」组（task-03，R-07 不展示 spec_version）---- */
  const renderStorageGroup = (): JSX.Element => {
    if (!specWs) {
      return (
        <div className="py-6 text-center text-xs text-muted-foreground">
          当前工作区尚未关联 Spec Workspace。请通过创建流程设置规范策略。
        </div>
      );
    }
    return (
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
        <dt className="text-muted-foreground">服务器文档目录</dt>
        <dd className="truncate font-mono" title={specWs.spec_root}>
          {specWs.spec_root}
        </dd>

        {runtimeRoot && (
          <>
            <dt className="text-muted-foreground">runtime 目录</dt>
            <dd className="truncate font-mono" title={runtimeRoot}>
              {runtimeRoot}
            </dd>
          </>
        )}

        {!isServerLocal && (
          <>
            <dt className="text-muted-foreground" title={CACHE_ROOT_TOOLTIP}>
              守护进程本地缓存
            </dt>
            <dd
              className="truncate font-mono"
              title={`${cacheRoot}\n${CACHE_ROOT_TOOLTIP}`}
            >
              {cacheRoot}
            </dd>
          </>
        )}

        <dt className="text-muted-foreground">同步状态</dt>
        <dd>
          <Badge variant={SYNC_STATUS_VARIANT[specWs.sync_status] ?? "outline"}>
            {SYNC_STATUS_LABEL[specWs.sync_status] ?? specWs.sync_status}
          </Badge>
        </dd>

        <dt className="text-muted-foreground">上次文档同步</dt>
        <dd>{formatTs(specWs.last_synced_at)}</dd>

        <dt className="text-muted-foreground">spec 策略</dt>
        <dd>
          <Badge variant="default">
            {STRATEGY_LABEL[specWs.strategy] ?? specWs.strategy}
          </Badge>
        </dd>
      </dl>
    );
  };

  /* ---- 三态引导 + 状态反馈（与 page.tsx 678-751 行等价）---- */
  const renderGuidance = (): JSX.Element | null => {
    if (!specWs || initing) {
      // init 进行中反馈
      if (initing) {
        return (
          <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <p className="font-medium">初始化进行中...</p>
            <p className="mt-0.5 text-blue-600">
              正在将平台配置下发到本地项目目录并拉取文档缓存，请稍候...
            </p>
          </div>
        );
      }
      return null;
    }
    return (
      <>
        {!initSyncedAt &&
          (specWs.strategy === "platform-managed" ? (
            <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <p className="font-medium">此工作区尚未初始化。</p>
              <p className="mt-0.5 text-blue-600">
                点击上方<strong> 初始化 </strong>按钮，将平台配置下发到本地项目目录。
              </p>
            </div>
          ) : (
            <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <p className="font-medium">此工作区尚未扫描。</p>
              <p className="mt-0.5 text-blue-600">
                点击上方<strong> 扫描 </strong>按钮，将仓库中的规范文档读取到平台。
              </p>
            </div>
          ))}
        {/* 三态引导原用 componentCount（项目组件数）判断"有无扫描文档"是字段误用——
            DB 可能 1562 ScanDocument 但 componentCount=0（无 projects/*.yaml）误报"无扫描
            文档"。改用 specWs.last_synced_at（spec 同步过 = 扫描/reparse 落了 ScanDocument）。 */}
        {initSyncedAt && !specWs?.last_synced_at && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-medium">已初始化，但工作区尚无扫描文档。</p>
            <p className="mt-0.5 text-amber-600">
              请由 owner 点击<strong> 扫描 </strong>按钮生成规范文档。
            </p>
          </div>
        )}
        {initSyncedAt && !!specWs?.last_synced_at && (
          <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
            <p className="font-medium">工作区已就绪。</p>
            <p className="mt-0.5 text-green-600">规范文档已同步，可直接使用。</p>
          </div>
        )}
      </>
    );
  };

  /* ---- 同步状态反馈（与 page.tsx 730-751 等价）---- */
  const renderSyncFeedback = (): JSX.Element | null => {
    if (syncStatus === "syncing") {
      return (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <p className="font-medium">同步中...</p>
          <p className="mt-0.5 text-blue-600">
            正在将缓存变更推送到服务器，请稍候...
          </p>
        </div>
      );
    }
    if (syncStatus === "done") {
      return (
        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          <p className="font-medium">已同步。</p>
          <p className="mt-0.5 text-green-600">缓存变更已成功推送到服务器。</p>
        </div>
      );
    }
    if (syncStatus === "failed") {
      return (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-destructive">
          <p className="font-medium">同步失败。</p>
          {syncError && <p className="mt-0.5">{syncError}</p>}
        </div>
      );
    }
    return null;
  };

  return (
    <SectionCard
      title="我的工作区配置"
      extra={
        <>
          {localError && (
            <div className="mr-2 inline-block rounded border border-destructive/30 bg-red-50 px-2 py-1 text-[11px] text-destructive">
              {localError}
            </div>
          )}
          {headActions}
        </>
      }
    >
      {/* 三态引导 */}
      <div className="mb-3 space-y-2">
        {renderGuidance()}
        {renderSyncFeedback()}
      </div>

      {/* 扫描运行面板（task-14 / D-006@v1） */}
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
              <Badge
                variant={scanInterrupted ? "warning" : statusToVariant(scanStatus)}
              >
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleScan()}
              >
                重新扫描
              </Button>
            </div>
          )}
          {scanError && (
            <p className="mt-2 text-xs text-destructive">{scanError}</p>
          )}
        </div>
      )}

      {/* 「我的接入」组（per-member，task-02/04/05） */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
          我的接入
        </h3>
        {renderMyAccessGroup()}
      </div>

      {/* 「工作区文档存储」组（共享只读，task-03） */}
      <div>
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
          工作区文档存储
        </h3>
        {renderStorageGroup()}
      </div>
    </SectionCard>
  );
}
