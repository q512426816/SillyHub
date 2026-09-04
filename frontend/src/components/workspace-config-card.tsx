"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { WorkspaceAccessGuide } from "@/components/workspace-access-guide";
import { Badge } from "@/components/ui/badge";
import { Button, Modal, Progress, Radio, Tooltip } from "antd";
import { SectionCard } from "@/components/layout";
import { ApiError } from "@/lib/api";
import { PROVIDER_META, type DaemonInstanceRead } from "@/lib/daemon";
import { useNotify } from "@/lib/errors";
import {
  downloadSpecBundle,
  generateProjects,
  getSpecWorkspace,
  importSpecWorkspace,
  initDispatch,
  listPendingSync,
  syncManual,
  updateSpecWorkspace,
  type ImportPhase,
  type SpecStrategy,
  type SpecWorkspace,
} from "@/lib/spec-workspaces";
import { scanGenerate, type Workspace } from "@/lib/workspaces";
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

/** spec 策略可改值域（与创建对话框 workspace-scan-dialog.tsx 同文案口径）。 */
const STRATEGY_OPTIONS: ReadonlyArray<{ value: SpecStrategy; label: string }> = [
  { value: "platform-managed", label: "平台托管（默认，不碰源项目，从零扫描）" },
  { value: "repo-mirrored", label: "单次导入（复制源项目 .sillyspec 快照，不污染源项目）" },
  { value: "repo-native", label: "源项目即真理（软链接，扫描直接写源项目）" },
];

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
  return raw ? new Date(raw).toLocaleString("zh-CN") : "---";
}

/** 守护进程本地缓存 ~ 三平台解释（design §5.5 / D-004@V1）。 */
const CACHE_ROOT_TOOLTIP =
  "守护进程在你电脑上缓存这个工作区文档的位置。`~` = 你的用户主目录（Windows: C:\\Users\\<你>；macOS/Linux: /home/<你>）";

/**
 * 「下载文档包」快照语义文案（task-09，design §7.4 时机口径）：人拉=主动快照，
 * 非实时同步；daemon 机器拉维持现状（任务开始/会话开始按版本变化自动取新）。
 */
const DOWNLOAD_BUNDLE_TOOLTIP =
  "下载文档包：把服务器当前的规范文档整树打包为 tar 下载（当前时刻快照，非实时同步）。守护进程会在任务开始/会话开始时按版本变化自动取最新，无需手动同步。";

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
  // FR-05：同步完成后的文件计数（轮询 done 时从 latest.files_total 存）。
  const [syncedFilesTotal, setSyncedFilesTotal] = useState<number | null>(null);
  // FR-06：同步过程中的进度（轮询 pending/claimed 时从 latest.files_total/processed 存）。
  const [syncProgress, setSyncProgress] = useState<{
    total: number | null;
    processed: number | null;
  }>({ total: null, processed: null });
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPhase, setImportPhase] = useState<ImportPhase | null>(null);
  const [generatingProjects, setGeneratingProjects] = useState(false);
  // task-09（FR-06/FR-08）：下载文档包独立 loading 态——即时 HTTP 拉流，
  // 不建 DaemonChangeWrite 任务、不轮询，与 syncManual/syncStatus 状态机完全独立。
  const [downloading, setDownloading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // spec 策略修改（ql-20260904-028-3cb5）：Modal 开合 + 草稿值 + 保存中态。
  // 策略是工作区级共享配置（影响 daemon 本地缓存布局），仅 owner 可改（对齐扫描门禁）；
  // 草稿在打开 Modal 时取当前策略，避免首渲染快照过期。
  const [strategyEditing, setStrategyEditing] = useState(false);
  const [strategyDraft, setStrategyDraft] = useState<SpecStrategy>("platform-managed");
  const [strategySaving, setStrategySaving] = useState(false);

  const initPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 第四批 code-quality：5min 轮询上限 timeout 句柄（卸载 + 自停时 clearTimeout，
  // 防卸载后 setTimeout 触发 setState + 闭包泄漏；init 对齐 sync 的 R-06）。
  const initDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const router = useRouter();
  // task-09：下载结果 toast（操作类走 useNotify，展示策略规范 design §5）。
  const notify = useNotify();

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
      // 第四批 code-quality：清 5min deadline timeout（防卸载后触发 setState）
      if (initDeadlineRef.current) {
        clearTimeout(initDeadlineRef.current);
        initDeadlineRef.current = null;
      }
      if (syncDeadlineRef.current) {
        clearTimeout(syncDeadlineRef.current);
        syncDeadlineRef.current = null;
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
            if (initDeadlineRef.current) {
              // 第四批：自停时清 deadline，避免卸载/重init 时孤儿 timeout
              clearTimeout(initDeadlineRef.current);
              initDeadlineRef.current = null;
            }
            setInitSyncedAt(syncedAt);
            setIniting(false);
            onRefresh();
          }
        } catch {
          // 轮询错误忽略，下一 tick 重试
        }
      }, 2000);
      // 第四批 code-quality（MED-1）：5min deadline 对齐 handleSyncManual R-06。
      // daemon 卡住 / init 静默失败（init_synced_at 永不到达）时停止无限轮询，
      // 否则用户停留配置页会每 2s 发一次 fetchMyBinding 直到卸载。
      initDeadlineRef.current = setTimeout(() => {
        setLocalError("初始化超时，请稍后重试");
        setIniting(false);
        if (initPollRef.current) {
          clearInterval(initPollRef.current);
          initPollRef.current = null;
        }
        initDeadlineRef.current = null;
      }, 5 * 60 * 1000);
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
          // FR-06：每次轮询更新过程进度（pending/claimed 期间 daemon 上报的 files_total/processed）
          if (latest) {
            setSyncProgress({
              total: latest.files_total ?? null,
              processed: latest.files_processed ?? null,
            });
          }
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
            // FR-05：存终态文件计数供 done 反馈框展示「已同步 N 个文件」。
            setSyncedFilesTotal(latest.files_total ?? null);
            if (syncPollRef.current) {
              clearInterval(syncPollRef.current);
              syncPollRef.current = null;
            }
            onRefresh();
          } else if (latest.status === "failed") {
            setSyncStatus("failed");
            // FR-01：透传后端真实失败原因（DaemonChangeWrite.error），非写死文案。
            // latest.error 为空（如 claim 超时 gc 未写 error）时兜底通用文案。
            setSyncError(latest.error ?? "同步到服务器失败");
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
      // 5min 上限（R-06）。第四批 code-quality（LOW-1）：句柄存 ref，卸载时 clearTimeout。
      syncDeadlineRef.current = setTimeout(() => {
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
        syncDeadlineRef.current = null;
      }, 5 * 60 * 1000);
    } catch (err) {
      setSyncStatus("failed");
      setSyncError(err instanceof ApiError ? err.message : "同步派发失败");
    }
  }

  /* ---- Download bundle handler（task-09 / FR-06 / FR-08，design §7.2/§7.4）---- */
  async function handleDownloadBundle(): Promise<void> {
    // specWs 为空时按钮本就不渲染；守卫兜底防误触。
    if (!specWs) return;
    setDownloading(true);
    try {
      const { specVersion } = await downloadSpecBundle(workspaceId);
      // R-07：快照版本号仅此 toast 一次性展示，不在配置卡常驻。
      notify.success(
        specVersion !== null
          ? `文档包已下载（快照版本 v${specVersion}）`
          : "文档包已下载",
      );
    } catch (err) {
      // 失败不静默：toast 错误信息（errMessage 取中文文案，网络失败有统一兜底）。
      notify.error(err, "下载文档包失败");
    } finally {
      setDownloading(false);
    }
  }

  /* ---- Strategy edit handler（ql-20260904-028-3cb5：spec 策略支持修改）---- */
  function openStrategyEdit(): void {
    if (!specWs) return;
    setStrategyDraft(specWs.strategy);
    setStrategyEditing(true);
  }

  async function handleStrategySave(): Promise<void> {
    if (!specWs || strategyDraft === specWs.strategy) return;
    setStrategySaving(true);
    try {
      await updateSpecWorkspace(workspaceId, { strategy: strategyDraft });
      setStrategyEditing(false);
      // 生效语义（调研结论）：backend dispatch/init 每次实时读库，新策略对后续任务
      // 即时生效；但 daemon 本地缓存布局（junction/首拷）只在下次无条件 pull 时重建
      // ——handleInitLease 是无条件 pull，故提示用户点「初始化」。
      notify.success("spec 策略已更新。建议点击「初始化」让新策略在本地缓存生效。");
      onRefresh();
    } catch (err) {
      notify.error(err, "修改 spec 策略失败");
    } finally {
      setStrategySaving(false);
    }
  }

  /* ---- Scan handler（task-14 / D-006@v1 + D-003@V2 owner 门禁）---- */
  async function handleScan(): Promise<void> {
    // daemon-entity-binding 后稳定绑定键是 myBinding.daemon_id（守护进程实体）。
    // myBinding.runtime_id 也不稳定（runtime 动态注册，常为 null）。扫描必须改用
    // daemon_id 派发，否则点击静默 return 无反应。backend scan-generate schema 同步接 daemon_id。
    const daemonId = myBinding?.daemon_id ?? null;
    if (!daemonId) {
      setLocalError("未绑定守护进程，无法扫描。请先在「我的接入」完成绑定。");
      return;
    }

    // D-003@V2：已扫过时弹确认（componentCount > 0）。FR-04 规范对齐：antd Modal.confirm
    // 替代浏览器原生 window.confirm（FRONTEND_PAGE_STYLE §11）。
    if (componentCount > 0) {
      const ok = await confirmRescan();
      if (!ok) return;
    }

    setScanning(true);
    setLocalError(null);
    try {
      const result = await scanGenerate(
        workspace.root_path,
        workspace.default_agent ?? null,
        workspace.default_model ?? null,
        specWs?.strategy,
        daemonId,
      );
      const sessionId = result.session_id;
      const target = sessionId
        ? `/workspaces/${workspace.id}/sessions?session=${sessionId}`
        : `/workspaces/${workspace.id}/sessions`;
      router.push(target);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const confirmed = await confirmRescan();
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

  /* ---- FR-04：antd Modal.confirm 二次确认（重新扫描），替代 window.confirm ---- */
  function confirmRescan(): Promise<boolean> {
    return new Promise((resolve) => {
      Modal.confirm({
        title: "重新扫描",
        content: "该工作区已有扫描结果，是否重新扫描？",
        okText: "重新扫描",
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
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

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  // 头部操作按钮（5 按钮，FR-02/03/04：antd Button + Tooltip 含义/disabled 原因 + loading）
  // antd disabled Button 默认不响应 hover → 用 <Tooltip><span>包裹</span></Tooltip> 让 disabled
  // 时也能显示原因。文案动词原形 + loading prop（FR-04，对齐 FRONTEND_PAGE_STYLE §5）。
  const busyReason = (): string | null => {
    if (initing) return "初始化进行中，请稍候";
    if (scanning) return "扫描进行中，请稍候";
    if (importing) return "导入进行中，请稍候";
    if (syncStatus === "syncing") return "同步进行中，请稍候";
    return null;
  };

  const headActions = specWs ? (
    <div className="flex flex-wrap gap-2">
      <Tooltip
        title={
          initing
            ? "初始化进行中，请稍候"
            : "初始化：将平台配置下发到你的本地项目目录并拉取文档缓存"
        }
      >
        <span>
          <Button onClick={() => void handleInit()} loading={initing} disabled={!!busyReason()}>
            初始化
          </Button>
        </span>
      </Tooltip>
      <Tooltip
        title={
          !isOwner
            ? "仅 owner 可扫描"
            : busyReason() ?? "扫描：把仓库的规范文档读取到平台"
        }
      >
        <span>
          <Button
            onClick={() => void handleScan()}
            loading={scanning}
            disabled={!isOwner || !!busyReason()}
          >
            扫描
          </Button>
        </span>
      </Tooltip>
      {initSyncedAt && componentCount > 0 && (
        <Tooltip
          title={
            syncStatus === "syncing"
              ? "同步进行中，请稍候"
              : "同步到服务器：把本地缓存的规范变更推送回服务器，供其他成员可见"
          }
        >
          <span>
            <Button
              onClick={() => void handleSyncManual()}
              loading={syncStatus === "syncing"}
              disabled={!!busyReason()}
            >
              {syncStatus === "done" ? "已同步" : "同步到服务器"}
            </Button>
          </span>
        </Tooltip>
      )}
      {/* task-09（FR-06）：下载=拉取方向，与「同步到服务器」（推送）语义成对； */}
      {/* 即时 HTTP 拉流独立 loading，不占 busyReason 互斥（不动同步既有行为）。 */}
      <Tooltip title={DOWNLOAD_BUNDLE_TOOLTIP}>
        <span>
          <Button
            onClick={() => void handleDownloadBundle()}
            loading={downloading}
          >
            下载文档包
          </Button>
        </span>
      </Tooltip>
      {!specWs.repo_sillyspec_path && (
        <Tooltip
          title={
            importing
              ? `${IMPORT_PHASE_LABEL[importPhase ?? "packing"]}，请稍候`
              : "导入：从仓库 .sillyspec 导入规范文档"
          }
        >
          <span>
            <Button
              onClick={() => void handleImport()}
              loading={importing}
              disabled={!!busyReason()}
            >
              导入
            </Button>
          </span>
        </Tooltip>
      )}
      <Tooltip
        title={
          generatingProjects
            ? "生成中，请稍候"
            : "根据 projects/*.yaml 生成项目组件"
        }
      >
        <span>
          <Button
            onClick={() => void handleGenerateProjects()}
            loading={generatingProjects}
            disabled={!!busyReason()}
          >
            生成项目
          </Button>
        </span>
      </Tooltip>
    </div>
  ) : undefined;

  /* ---- 「我的接入」组绑定守护进程 dd（task-02 + task-05）---- */
  const renderBoundDaemonDd = (): JSX.Element => {
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

  /* ---- 「我的接入」组（task-02 + task-04 编辑 + task-05 未绑定）---- */
  const renderMyAccessGroup = (): JSX.Element => {
    // 未绑定：WorkspaceAccessGuide 首次模式（task-05）
    if (!myBinding) {
      return (
        <div className="space-y-3">
          <WorkspaceAccessGuide
            workspaceId={workspaceId}
            onConfigured={onRefresh}
            defaultRootPath={workspace.root_path}
          />
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <Button
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

        <dt className="text-muted-foreground">同步状态</dt>
        <dd>
          <Badge variant={SYNC_STATUS_VARIANT[specWs.sync_status] ?? "outline"}>
            {SYNC_STATUS_LABEL[specWs.sync_status] ?? specWs.sync_status}
          </Badge>
        </dd>

        <dt className="text-muted-foreground">上次文档同步</dt>
        <dd>{formatTs(specWs.last_synced_at)}</dd>

        <dt className="text-muted-foreground">spec 策略</dt>
        <dd className="flex items-center gap-1.5">
          <Badge variant="default">
            {STRATEGY_LABEL[specWs.strategy] ?? specWs.strategy}
          </Badge>
          {isOwner && (
            <Tooltip title="修改 spec 同步策略。新策略对后续任务派发即时生效；本地缓存布局建议修改后点「初始化」重建。">
              <Button
                data-testid="strategy-edit-entry"
                size="small"
                onClick={openStrategyEdit}
              >
                修改
              </Button>
            </Tooltip>
          )}
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
          <div className="rounded border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
            <p className="font-medium">初始化进行中...</p>
            <p className="mt-0.5 text-brand-600">
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
            <div className="rounded border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
              <p className="font-medium">此工作区尚未初始化。</p>
              <p className="mt-0.5 text-brand-600">
                点击上方<strong> 初始化 </strong>按钮，将平台配置下发到本地项目目录。
              </p>
            </div>
          ) : (
            <div className="rounded border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
              <p className="font-medium">此工作区尚未扫描。</p>
              <p className="mt-0.5 text-brand-600">
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
        {importing && (
          <div className="rounded border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
            <p className="font-medium">导入进行中...</p>
            <p className="mt-0.5 text-brand-600">
              {IMPORT_PHASE_LABEL[importPhase ?? "packing"]}，正在从仓库读取规范文档，请稍候...
            </p>
          </div>
        )}
        {generatingProjects && (
          <div className="rounded border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
            <p className="font-medium">生成项目组件中...</p>
            <p className="mt-0.5 text-brand-600">
              正在根据 projects/*.yaml 生成项目组件，请稍候...
            </p>
          </div>
        )}
        {initSyncedAt && !!specWs?.last_synced_at && !importing && !generatingProjects && (
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
      // FR-06：过程进度。files_total 已知（daemon onWalkComplete/ops.length 上报后）显示
      // Progress 条 + N/M；未知（全量首同步 walkComplete 前）降级「打包中」阶段文案（BL-2）。
      const hasTotal = syncProgress.total !== null && syncProgress.total > 0;
      const processed = syncProgress.processed ?? 0;
      const total = syncProgress.total ?? 0;
      const percent = hasTotal ? Math.round((processed / total) * 100) : 0;
      return (
        <div className="rounded border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
          <p className="font-medium">同步中...</p>
          {hasTotal ? (
            <>
              <Progress percent={percent} size="small" />
              <p className="mt-0.5 text-brand-600">
                正在推送文件变更 {processed}/{syncProgress.total}，请稍候...
              </p>
            </>
          ) : (
            <p className="mt-0.5 text-brand-600">正在打包本地变更，请稍候...</p>
          )}
        </div>
      );
    }
    if (syncStatus === "done") {
      // FR-05：终态计数展示。files_total 为 null（上报失败/降级）时退化为通用文案。
      const countText =
        syncedFilesTotal !== null && syncedFilesTotal > 0
          ? `已成功推送 ${syncedFilesTotal} 个文件到服务器。`
          : "缓存变更已成功推送到服务器。";
      return (
        <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          <p className="font-medium">已同步。</p>
          <p className="mt-0.5 text-green-600">{countText}</p>
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

      {/* spec 策略修改 Modal（ql-20260904-028-3cb5，owner 门禁入口在存储组策略行） */}
      <Modal
        title="修改 spec 策略"
        open={strategyEditing}
        okText="保存"
        cancelText="取消"
        okButtonProps={{
          loading: strategySaving,
          disabled: !specWs || strategyDraft === specWs.strategy,
        }}
        onOk={() => void handleStrategySave()}
        onCancel={() => setStrategyEditing(false)}
        destroyOnHidden
      >
        <p className="mb-2 text-xs text-muted-foreground">
          源项目已有 .sillyspec 如何进入平台。新策略对后续任务派发即时生效；本地缓存布局建议保存后点击「初始化」重建。
        </p>
        <Radio.Group
          className="flex flex-col gap-1"
          value={strategyDraft}
          onChange={(e) => setStrategyDraft(e.target.value as SpecStrategy)}
        >
          {STRATEGY_OPTIONS.map((option) => (
            <Radio key={option.value} value={option.value}>
              <span className="text-xs">{option.label}</span>
            </Radio>
          ))}
        </Radio.Group>
        {strategyDraft === "repo-native" && (
          <p className="mt-2 text-[11px] text-amber-600">
            ⚠ 扫描产出会写入源项目 .sillyspec（若被 git 跟踪需自行 commit）。
          </p>
        )}
      </Modal>
    </SectionCard>
  );
}
