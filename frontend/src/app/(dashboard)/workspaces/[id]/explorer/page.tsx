"use client";

/**
 * task-08：工作区文件浏览页（/workspaces/[id]/explorer）。
 *
 * 装配 FileExplorer + FilePreview 成左树右预览的 VSCode 式布局：
 * - 页面高度锚定视口（h-[calc(100vh-64px)]，TopBar h-16），树与预览区内部滚动，
 *   页面本体不随内容整体滚动（ql-20260818-010-f551）
 * - 左侧文件树栏默认 320px（旧版 w-60=240px 偏窄），夹持拖拽把手可在
 *   200~640px 间调整宽度，双击把手复位；宽度记忆到 localStorage（ql-20260821-008-fade）
 * - 右侧 flex 预览区展示选中文件内容
 * - 页面持有 selectedPath 状态，联动两侧组件
 * - 首屏 tree 请求失败按 ApiError.status 分发三降级中文卡：
 *   502 daemon 离线 / 422 daemon 版本过旧 / 404 当前账号未绑定
 * - 工具栏含面包屑（当前路径/工作区根）与刷新按钮（ invalidate query cache + 重载树）
 *
 * 依据：tasks/task-08.md、prototype-workspace-file-browser.html、
 *       task-06 FileExplorer 契约、task-07 FilePreview 契约。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { FileExplorer } from "@/components/explorer/file-explorer";
import { FilePreview } from "@/components/explorer/file-preview";
import { PageContainer, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ApiError } from "@/lib/api";
import { explorerQueryKeys, useExplorerFile, useExplorerTree } from "@/lib/explorer";

/** 左栏（文件树）宽度：默认值与拖拽范围（px）。 */
const TREE_PANEL_DEFAULT_W = 320;
const TREE_PANEL_MIN_W = 200;
const TREE_PANEL_MAX_W = 640;
/** 宽度记忆 key（仅本地浏览器，与 sillyhub-theme 同款命名风格）。 */
const TREE_PANEL_WIDTH_KEY = "sillyhub-explorer-tree-width";

/** 宽度读入：非法/越界值回退默认（clamp 防手改 localStorage 打爆布局）。 */
function clampTreeWidth(w: number): number {
  return Math.min(TREE_PANEL_MAX_W, Math.max(TREE_PANEL_MIN_W, w));
}

function loadTreeWidth(): number {
  if (typeof window === "undefined") return TREE_PANEL_DEFAULT_W;
  try {
    const raw = Number.parseInt(window.localStorage.getItem(TREE_PANEL_WIDTH_KEY) ?? "", 10);
    return Number.isFinite(raw) ? clampTreeWidth(raw) : TREE_PANEL_DEFAULT_W;
  } catch {
    return TREE_PANEL_DEFAULT_W;
  }
}

/** 左栏宽度拖拽把手：夹在树与预览区之间，左右拖调宽、双击复位、←/→ 键微调。
 *  window 级 pointermove/pointerup 监听（不用 setPointerCapture——jsdom 无实现，
 *  测试走 fireEvent(window) 同路径）；监听只挂一次，回调经 ref 转发取最新。 */
function TreePanelResizer({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (_w: number) => void;
}) {
  /** 拖拽中锚点 {按下时指针 x, 按下时栏宽}；null = 未在拖拽。 */
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  /** 最新回调（effect 空依赖时取闭包外的最新值）。 */
  const onChangeRef = useRef(onWidthChange);
  useEffect(() => {
    onChangeRef.current = onWidthChange;
  }, [onWidthChange]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      onChangeRef.current(clampTreeWidth(st.startW + e.clientX - st.startX));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整文件树宽度"
      aria-valuenow={width}
      aria-valuemin={TREE_PANEL_MIN_W}
      aria-valuemax={TREE_PANEL_MAX_W}
      data-testid="explorer-tree-resizer"
      tabIndex={0}
      className="w-1.5 shrink-0 cursor-col-resize rounded bg-transparent transition-colors hover:bg-border focus-visible:bg-border"
      onPointerDown={(e) => {
        e.preventDefault();
        dragRef.current = { startX: e.clientX, startW: width };
        document.body.style.userSelect = "none";
      }}
      onDoubleClick={() => onWidthChange(TREE_PANEL_DEFAULT_W)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onWidthChange(clampTreeWidth(width - 16));
        else if (e.key === "ArrowRight") onWidthChange(clampTreeWidth(width + 16));
      }}
    />
  );
}

/** 面包屑：未选中显示「工作区根」，选中后显示 工作区根 / a / b。 */
function FileBreadcrumb({ path }: { path: string | null }) {
  const parts = useMemo(() => {
    if (!path) return [];
    return path.split("/").filter(Boolean);
  }, [path]);

  return (
    <div className="flex min-w-0 items-center gap-1 text-xs">
      <span className="shrink-0 font-medium text-foreground">工作区根</span>
      {parts.map((part, idx) => (
        // eslint-disable-next-line react/no-array-index-key
        <span key={idx} className="flex min-w-0 items-center gap-1">
          <span className="text-muted-foreground">/</span>
          <span className="truncate font-medium text-foreground" title={part}>
            {part}
          </span>
        </span>
      ))}
    </div>
  );
}

/** 三降级状态卡 + 通用错误条。
 *
 * 同时存在多个错误时，按 502 / 422 / 404 优先级只显示最具体的一张卡，
 * 避免多卡堆叠；其余错误合并为红条提示重试。
 */
function ExplorerStatePanel({
  treeError,
  fileError,
}: {
  treeError: ApiError | null;
  fileError: ApiError | null;
}) {
  const errors = useMemo(
    () => [treeError, fileError].filter((e): e is ApiError => e instanceof ApiError),
    [treeError, fileError],
  );

  if (errors.length === 0) return null;

  // 优先级：502 > 422 > 404
  const priorityOrder = [502, 422, 404];
  const cardError = priorityOrder
    .map((status) => errors.find((e) => e.status === status))
    .find((e) => e != null);

  if (cardError) {
    let title: string;
    let description: string;
    let tone: "warning" | "error" | "info";
    switch (cardError.status) {
      case 502:
        title = "守护进程离线";
        description = "本机守护进程离线，无法浏览工作区文件。请启动 daemon 后刷新。";
        tone = "warning";
        break;
      case 422:
        title = "守护进程版本过旧";
        description = "本机 daemon 版本过旧，不支持文件浏览，请升级 daemon。";
        tone = "warning";
        break;
      case 404:
        title = "未绑定工作区";
        description = "当前账号未绑定本机工作区，请先到「成员」页完成绑定。";
        tone = "info";
        break;
      default:
        return null;
    }

    const toneClasses = {
      warning: "border-warning/30 bg-warning/10 text-warning",
      error: "border-error/30 bg-error/10 text-error",
      info: "border-info/30 bg-info/10 text-info",
    }[tone];

    return (
      <div className="flex flex-1 items-center justify-center p-6" role="status">
        <div
          className={`w-full max-w-md rounded-lg border p-6 text-center shadow-sm ${toneClasses}`}
        >
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-2 text-xs opacity-90">{description}</p>
        </div>
      </div>
    );
  }

  // 其它错误：红条提示重试（ErrorBanner 容器 role=alert，测试断言依赖）
  const messages = errors.map((e) => e.message).filter(Boolean);
  return (
    <ErrorBanner
      message={messages.length > 0 ? messages.join("；") : "加载失败，请重试"}
    />
  );
}

export default function WorkspaceExplorerPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id ?? "";
  const queryClient = useQueryClient();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  /** 刷新时变更 key，强制 FileExplorer 重挂并重拉根层。 */
  const [explorerKey, setExplorerKey] = useState(0);
  /** 左栏（文件树）宽度：默认 320px，拖拽/键盘调整 200~640px，记忆到 localStorage。 */
  const [treeWidth, setTreeWidth] = useState(loadTreeWidth);

  /** 宽度变更统一入口（拖拽 move / 双击复位 / 方向键微调）：改状态 + 落 localStorage。 */
  const handleTreeWidthChange = useCallback((w: number) => {
    setTreeWidth(w);
    try {
      window.localStorage.setItem(TREE_PANEL_WIDTH_KEY, String(w));
    } catch {
      // 隐私模式等 localStorage 不可用时静默降级：宽度仅本次会话内生效
    }
  }, []);

  const treeQuery = useExplorerTree(workspaceId, "");
  const fileQuery = useExplorerFile(workspaceId, selectedPath);

  const treeError = treeQuery.error instanceof ApiError ? treeQuery.error : null;
  const fileError = fileQuery.error instanceof ApiError ? fileQuery.error : null;

  const hasBlockingError = [treeError, fileError].some(
    (e) => e != null && [502, 422, 404].includes(e.status),
  );

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: explorerQueryKeys.tree(workspaceId, ""),
    });
    queryClient.invalidateQueries({
      queryKey: explorerQueryKeys.file(workspaceId, selectedPath ?? ""),
    });
    setExplorerKey((k) => k + 1);
  }, [queryClient, workspaceId, selectedPath]);

  // 视口高度锚定（TopBar h-16=64px）：页面本体不滚动，
  // 树与预览区各自内部滚动；overflow-hidden 兜住 min-h-screen 布局链外的溢出。
  return (
    <PageContainer size="full" className="h-[calc(100vh-64px)] gap-3 overflow-hidden">
      <PageHeader
        title="文件浏览"
        subtitle="浏览本机守护进程转发的工作区文件"
      />

      <ExplorerStatePanel treeError={treeError} fileError={fileError} />

      {!hasBlockingError && (
        <>
          <div className="flex flex-none flex-wrap items-center gap-3 border-b border-border pb-2">
            <div className="min-w-0 flex-1">
              <FileBreadcrumb path={selectedPath} />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="flex-none gap-1.5"
              onClick={handleRefresh}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              刷新
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
            <div
              data-testid="explorer-tree-panel"
              className="min-w-0 shrink-0 overflow-hidden rounded-md border"
              style={{ width: `${treeWidth}px` }}
            >
              <FileExplorer
                key={explorerKey}
                workspaceId={workspaceId}
                onSelectFile={setSelectedPath}
              />
            </div>
            <TreePanelResizer width={treeWidth} onWidthChange={handleTreeWidthChange} />
            <div className="min-w-0 flex-1 overflow-hidden rounded-md border">
              <FilePreview workspaceId={workspaceId} filePath={selectedPath} />
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
