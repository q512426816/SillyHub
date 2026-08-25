"use client";

/**
 * FileMessageCard — 聊天流文件卡片（task-08 / 2026-08-23-agent-file-upload-mcp /
 * FR-01 / D-001@v1）。
 *
 * agent 经 sillyhub-file MCP 上传文件的呈现件：TurnSegment file 段（session-log-
 * assembler 同变更 task-08）经 SegmentView 路由进来；批任务 run 详情「产出文件」区
 * （task-09）直接复用。两形态（视觉基准 prototype-agent-file-upload-mcp.html 的
 * .file-thumb / .file-card）：
 *   - 图片 mime（isImageMime）：缩略图卡片——FileImage preview 模式（JWT blob 拉取，
 *     可点击放大）约 220px 宽 + 名称/大小 + 下载链接；
 *   - 其余：通用卡片——FileTypeIcon + 名称/描述 + formatFileSize + 下载按钮。
 *
 * 纯展示 memo 组件纪律（对齐 turn-segment-views.tsx constraints）：只消费 props，
 * 不读 SSE / store / 本地时钟（时间取自 props 的 log timestamp）；下载统一
 * downloadFile(fileId, name)（fetch Blob 带 JWT）；颜色走主题 token / brand-* 语义
 * 阶（FRONTEND_PAGE_STYLE.md §0.5），不硬编码 hex；antd 仅经 FileImage / FileTypeIcon
 * 间接使用（本文件不直接引 antd）。
 */

import { memo, useState } from "react";

import { FileImage } from "@/components/file-image";
import { downloadFile, fetchFileBlob } from "@/lib/file/api";
import { FileTypeIcon, formatFileSize, isImageMime } from "@/lib/file/utils";
import { FilePreviewModal } from "@/components/files/file-preview-modal";
import { cn } from "@/lib/utils";

export interface FileMessageCardProps {
  /** 文件 id（File 表主键；图片 blob 与下载均经此）。 */
  fileId: string;
  /** 原始文件名（下载保存名）。 */
  name: string;
  /** 文件大小（字节，formatFileSize 展示）。 */
  size: number;
  /** MIME（isImageMime 判定缩略图/通用形态）。 */
  mime: string;
  /** 上传描述（agent 填写的说明；可空，空不渲染描述行）。 */
  description?: string | null;
  /** 上传时间（log timestamp，ms）——展示走 toLocaleString 显式传 zh-CN；缺省不显示。 */
  ts?: number | null;
  className?: string;
}

/** 大小（+ 可选时间）元信息：formatFileSize；ts 非空时以「 · 」追加 zh-CN 本地时间。 */
function fileMetaText(size: number, ts: number | null | undefined): string {
  const sizeText = formatFileSize(size);
  if (ts == null) return sizeText;
  return `${sizeText} · ${new Date(ts).toLocaleString("zh-CN")}`;
}

/** 图片形态（原型 .file-thumb）：220px 缩略图（FileImage preview 可放大）+ 名称/大小 + 下载链接。 */
function FileThumbCard({ fileId, name, size, ts, className }: FileMessageCardProps) {
  const meta = fileMetaText(size, ts);
  return (
    <div
      className={cn("w-fit self-start rounded-xl border bg-card p-1 shadow-sm", className)}
      title={name}
    >
      <FileImage
        id={fileId}
        alt={name}
        preview
        className="block h-[140px] w-[220px] rounded-lg object-cover"
      />
      <div className="flex items-center justify-between gap-3 px-1.5 pb-1 pt-1.5">
        <span className="min-w-0 truncate text-xs font-medium text-foreground">
          {name}
          <span className="ml-1.5 whitespace-nowrap font-mono text-[11px] font-normal text-muted-foreground">
            {meta}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void downloadFile(fileId, name)}
          className="shrink-0 cursor-pointer text-xs text-brand-600 hover:text-brand-700 hover:underline"
          aria-label={`下载 ${name}`}
        >
          下载 ⭳
        </button>
      </div>
    </div>
  );
}

/** 通用形态（原型 .file-card）：FileTypeIcon + 名称/描述 + 大小 + 下载按钮；主体可点击弹预览。 */
function FilePlainCard({
  fileId,
  name,
  size,
  mime,
  description,
  ts,
  className,
}: FileMessageCardProps) {
  const desc = description?.trim();
  const meta = fileMetaText(size, ts);
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    void downloadFile(fileId, name);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setPreviewOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPreviewOpen(true);
          }
        }}
        className={cn(
          "flex w-full items-center gap-3 self-start rounded-xl border bg-card px-3 py-2.5 shadow-sm text-left transition-colors hover:border-brand-300 hover:shadow-md cursor-pointer",
          className,
        )}
        title={`${name}（点击在线预览）`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50">
          <FileTypeIcon mime={mime} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground" title={name}>
            {name}
          </div>
          {desc && (
            <div className="truncate text-[11.5px] text-muted-foreground" title={desc}>
              {desc}
            </div>
          )}
        </div>
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
          {meta}
        </span>
        <button
          type="button"
          onClick={handleDownload}
          className="shrink-0 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
          aria-label={`下载 ${name}`}
        >
          下载 ⭳
        </button>
      </div>
      <FilePreviewModal
        target={{
          fetch: () => fetchFileBlob(fileId),
          meta: { name, mime, size },
          download: () => downloadFile(fileId, name),
        }}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}

/**
 * 文件消息卡片统一入口：按 mime 分流两形态。memo 浅比较（装配器 path-copy 保证
 * 未触及段引用稳定，FR-06 渲染经济性）。
 */
export const FileMessageCard = memo(function FileMessageCard(props: FileMessageCardProps) {
  return isImageMime(props.mime) ? <FileThumbCard {...props} /> : <FilePlainCard {...props} />;
});

export default FileMessageCard;
