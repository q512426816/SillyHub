"use client";

/**
 * PortalFileTreePanel / PortalFilePreviewPanel · 会话页三分屏的文件侧两壳
 * （2026-09-09-sessions-file-browser-three-pane task-01）。
 *
 * - D-001 纯组合薄壳：explorer 四端链路（backend 端点 / daemon RPC 代理 /
 *   lib/explorer 取数 / FileExplorer + FilePreview 渲染）原样复用，本文件零
 *   取数/渲染/下载逻辑——PortalFileTreePanel = 头部「← 返回会话」+「工作区文件」
 *   标题 + FileExplorer 直通（自带搜索/懒加载/错误态/刷新）；PortalFilePreviewPanel
 *   = 头部「✕」关闭 + filePath 路径文本 + FilePreview 直通（下载/全屏在其内部）。
 * - D-004 上下文防串档：workspaceId 由 portal 进文件模式时快照后传入（树不随
 *   选中变化闪跳）；预览列 {workspaceId, filePath} 生命周期独立，关列即整列卸载。
 * - D-005 左栏默认 320px 与现状一致：两栏宽度常量（默认/上下限 + localStorage
 *   key）在本文件集中导出，usePanelWidth/PanelResizer 接线归 task-03
 *   sessions-portal 装配层（本文件只导出不消费）。
 * - 外层容器与 SessionListPanel 左栏同款（flex h-full min-h-0 flex-col
 *   overflow-hidden rounded-lg border border-border bg-card），保证左栏
 *   「会话 ⇄ 文件」两模切换外观无跳变。
 *
 * 依据：design.md §5.C / §7、D-001/D-004/D-005 + tasks/task-01.md。
 */

import { Button } from "antd";
import { ArrowLeft, X } from "lucide-react";

import { FileExplorer } from "@/components/explorer/file-explorer";
import { FilePreview } from "@/components/explorer/file-preview";

export interface PortalFileTreePanelProps {
  /** 文件树目标工作区（portal 进文件模式时快照，D-004）。 */
  workspaceId: string;
  /** 「← 返回会话」按钮回调。 */
  onBack: () => void;
  /** 文件节点选中回调（FileExplorer 直通，入参为相对工作区根的 POSIX 路径）。 */
  onSelectFile: (path: string) => void;
}

export interface PortalFilePreviewPanelProps {
  /** 预览归属工作区（防跨工作区串档，D-004）。 */
  workspaceId: string;
  /** 预览文件相对工作区根的 POSIX 路径。 */
  filePath: string;
  /** 「✕」关闭整列回调。 */
  onClose: () => void;
}

// ── 宽度常量（task-03 sessions-portal 消费；本文件只导出不消费） ──────────

/** 左栏（会话列表 / 工作区文件树两模共用）宽度 localStorage key。 */
export const SESSIONS_LEFT_PANEL_WIDTH_LS_KEY = "sillyhub.sessions.leftPanelWidth";
/** 左栏默认宽度（px）——与现状 320px 固定一致（D-005）。 */
export const SESSIONS_LEFT_PANEL_WIDTH_DEFAULT = 320;
/** 左栏最小宽度（px）。 */
export const SESSIONS_LEFT_PANEL_WIDTH_MIN = 240;
/** 左栏最大宽度（px）。 */
export const SESSIONS_LEFT_PANEL_WIDTH_MAX = 560;

/** 右侧文件预览列宽度 localStorage key。 */
export const SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY = "sillyhub.sessions.filePreviewWidth";
/** 文件预览列默认宽度（px）。 */
export const SESSIONS_FILE_PREVIEW_WIDTH_DEFAULT = 480;
/** 文件预览列最小宽度（px）。 */
export const SESSIONS_FILE_PREVIEW_WIDTH_MIN = 320;
/** 文件预览列最大宽度（px）。 */
export const SESSIONS_FILE_PREVIEW_WIDTH_MAX = 860;

// ── 组件 ───────────────────────────────────────────────────────────────

/** 文件模式左栏：头部「← 返回会话」+「工作区文件」标题，主体 FileExplorer 直通。 */
export function PortalFileTreePanel({
  workspaceId,
  onBack,
  onSelectFile,
}: PortalFileTreePanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      {/* 头部：返回会话按钮 + 标题（SessionListPanel 左栏头部同款 px-3 py-2） */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <Button
          size="small"
          type="text"
          aria-label="返回会话"
          data-testid="sessions-files-back"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          返回会话
        </Button>
        <span className="text-sm font-semibold text-foreground">工作区文件</span>
      </div>

      {/* 主体：FileExplorer 直通（自带搜索/懒加载/错误态/刷新，壳内零包装逻辑） */}
      <div className="min-h-0 flex-1">
        <FileExplorer workspaceId={workspaceId} onSelectFile={onSelectFile} />
      </div>
    </div>
  );
}

/** 右侧文件预览列：头部「✕」关闭 + 文件路径，主体 FilePreview 直通。 */
export function PortalFilePreviewPanel({
  workspaceId,
  filePath,
  onClose,
}: PortalFilePreviewPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      {/* 头部：关闭按钮 + 相对工作区根路径（truncate + title 悬浮看全路径） */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <Button
          size="small"
          type="text"
          aria-label="关闭文件预览"
          data-testid="sessions-file-preview-close"
          onClick={onClose}
        >
          <X aria-hidden className="h-4 w-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={filePath}>
          {filePath}
        </span>
      </div>

      {/* 主体：FilePreview 直通（loading/错误/二进制降级/下载/全屏均在其内部） */}
      <div className="min-h-0 flex-1">
        <FilePreview workspaceId={workspaceId} filePath={filePath} />
      </div>
    </div>
  );
}
