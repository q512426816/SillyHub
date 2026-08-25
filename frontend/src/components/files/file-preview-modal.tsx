"use client";

/**
 * FilePreviewModal — 统一文件预览弹窗壳。
 *
 * antd Modal（FRONTEND_PAGE_STYLE.md §6：弹窗不用 Drawer），标题栏含 FileTypeIcon +
 * 文件名 + 大小/MIME + 下载 + 关闭；body 经 useObjectUrl 拉 blob 后按 matchRenderer
 * 分发到六渲染器。内置 loading spinner / error 重试态（R-07）。
 *
 * 依据：design.md §5 数据流 + §7 接口定义。
 */

import type { ComponentType } from "react";
import { Modal } from "antd";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";

import { FileTypeIcon, formatFileSize } from "@/lib/file/utils";
import { useObjectUrl } from "./use-object-url";
import { matchRenderer } from "./preview-registry";
import {
  ImagePreviewer,
  PdfPreviewer,
  DocxPreviewer,
  XlsxPreviewer,
  MarkdownPreviewer,
  FallbackPreviewer,
  type PreviewerProps,
} from "./previewers";

export interface FilePreviewTarget {
  fetch: () => Promise<Blob>;
  meta: {
    name: string;
    mime?: string | null;
    size?: number | null;
  };
  download?: () => void | Promise<void>;
}

export interface FilePreviewModalProps {
  target: FilePreviewTarget | null;
  open: boolean;
  onClose: () => void;
}

const RENDERER_MAP: Record<string, ComponentType<PreviewerProps>> = {
  image: ImagePreviewer,
  pdf: PdfPreviewer,
  docx: DocxPreviewer,
  xlsx: XlsxPreviewer,
  markdown: MarkdownPreviewer,
  fallback: FallbackPreviewer,
};

export function FilePreviewModal({ target, open, onClose }: FilePreviewModalProps) {
  const { blob, url, status, retry } = useObjectUrl(open && target ? target.fetch : null);

  const handleDownload = () => {
    if (target?.download) {
      void target.download();
    } else if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = target?.meta.name ?? "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const renderBody = () => {
    if (!target) return null;

    if (status === "loading") {
      return (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          <span className="ml-3 text-slate-500">正在加载文件…</span>
        </div>
      );
    }

    if (status === "error") {
      return (
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">文件已失效或被清理</p>
          <p className="max-w-md text-xs text-slate-500">
            附件可能已被删除或草稿已过期。可尝试重新加载，或关闭后重新上传。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={retry}
              className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
            >
              <ReloadOutlined />
              重新加载
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              关闭
            </button>
          </div>
        </div>
      );
    }

    if (!blob || !url) return null;

    const rendererKey = matchRenderer(blob.type ?? target.meta.mime, target.meta.name);
    const Renderer = RENDERER_MAP[rendererKey] ?? FallbackPreviewer;

    return (
      <Renderer
        blob={blob}
        url={url}
        meta={target.meta}
        onDownload={handleDownload}
      />
    );
  };

  const mimeLabel = target?.meta.mime?.split("/").pop()?.toUpperCase() ?? "";
  const sizeLabel = target?.meta.size != null ? formatFileSize(target.meta.size) : "";
  const metaText = [mimeLabel, sizeLabel].filter(Boolean).join(" · ");

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(960px, 94vw)"
      styles={{ body: { padding: 0 } }}
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <FileTypeIcon mime={target?.meta.mime ?? ""} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800" title={target?.meta.name}>
              {target?.meta.name}
            </div>
            {metaText && <div className="font-mono text-[11px] text-slate-500">{metaText}</div>}
          </div>
        </div>
      }
    >
      <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
          aria-label={`下载 ${target?.meta.name}`}
        >
          <DownloadOutlined />
          下载
        </button>
      </div>
      <div className="max-h-[calc(100vh-220px)] overflow-auto">{renderBody()}</div>
    </Modal>
  );
}
