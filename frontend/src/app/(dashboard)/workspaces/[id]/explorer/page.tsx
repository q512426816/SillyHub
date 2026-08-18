"use client";

/**
 * task-08：工作区文件浏览页（/workspaces/[id]/explorer）。
 *
 * 装配 FileExplorer + FilePreview 成左树右预览的 VSCode 式布局：
 * - 左侧固定宽栏（w-72）展示可滚动文件树
 * - 右侧 flex 预览区展示选中文件内容
 * - 页面持有 selectedPath 状态，联动两侧组件
 * - 首屏 tree 请求失败按 ApiError.status 分发三降级中文卡：
 *   502 daemon 离线 / 422 daemon 版本过旧 / 404 当前账号未绑定
 * - 工具栏含面包屑（当前路径/工作区根）与刷新按钮（ invalidate query cache + 重载树）
 *
 * 依据：tasks/task-08.md、prototype-workspace-file-browser.html、
 *       task-06 FileExplorer 契约、task-07 FilePreview 契约。
 */

import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { RefreshCw } from "lucide-react";

import { FileExplorer } from "@/components/explorer/file-explorer";
import { FilePreview } from "@/components/explorer/file-preview";
import { PageContainer, PageHeader } from "@/components/layout";
import { ApiError } from "@/lib/api";
import { explorerQueryKeys, useExplorerFile, useExplorerTree } from "@/lib/explorer";

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
      warning: "border-amber-200 bg-amber-50 text-amber-800",
      error: "border-red-200 bg-red-50 text-red-800",
      info: "border-blue-200 bg-blue-50 text-blue-800",
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

  // 其它错误：红条提示重试
  const messages = errors.map((e) => e.message).filter(Boolean);
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-red-50 px-4 py-3 text-sm text-destructive"
    >
      {messages.length > 0 ? messages.join("；") : "加载失败，请重试"}
    </div>
  );
}

export default function WorkspaceExplorerPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id ?? "";
  const queryClient = useQueryClient();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  /** 刷新时变更 key，强制 FileExplorer 重挂并重拉根层。 */
  const [explorerKey, setExplorerKey] = useState(0);

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

  return (
    <PageContainer size="full" className="gap-3">
      <PageHeader
        title="文件浏览"
        subtitle="浏览本机守护进程转发的工作区文件"
      />

      <ExplorerStatePanel treeError={treeError} fileError={fileError} />

      {!hasBlockingError && (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-border pb-2">
            <FileBreadcrumb path={selectedPath} />
            <Button
              size="small"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={handleRefresh}
            >
              刷新
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
            <div className="w-72 min-w-0 shrink-0 overflow-hidden rounded-md border">
              <FileExplorer
                key={explorerKey}
                workspaceId={workspaceId}
                onSelectFile={setSelectedPath}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden rounded-md border">
              <FilePreview workspaceId={workspaceId} filePath={selectedPath} />
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
