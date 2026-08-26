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

import { useEffect, useState, type ComponentType } from "react";
import { Modal } from "antd";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";

import { apiFetch } from "@/lib/api";
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
import { OnlyofficePreviewer } from "./previewers/onlyoffice-previewer";

export interface FilePreviewTarget {
  fetch: () => Promise<Blob>;
  meta: {
    name: string;
    mime?: string | null;
    size?: number | null;
  };
  download?: () => void | Promise<void>;
  /**
   * 2026-08-26-onlyoffice-preview：office 家族文件的可选来源标识——携带时预览窗
   * 先尝试 OnlyOffice 高保真渲染（GET /api/preview/office-config），DS 未启用/
   * 失败自动回落本地渲染器（FR-02 降级链）。不携带 = 恒本地渲染（零回归）。
   */
  officeSource?: {
    source: "session_attachment" | "file";
    id: string;
  };
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

/** office 家族扩展名（DS 优先尝试集合，含旧格式 doc/xls/ppt）。 */
const OFFICE_EXTS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

interface OfficeConfigResp {
  ds_url: string;
  config: Record<string, unknown>;
}

/** office 家族 + 携带来源标识 → 尝试 DS（纯函数，供 hook 依赖序使用）。 */
function officeEligibleStatic(t: FilePreviewTarget | null): boolean {
  return Boolean(t?.officeSource && OFFICE_EXTS.has(extOf(t?.meta.name ?? "")));
}

export function FilePreviewModal({ target, open, onClose }: FilePreviewModalProps) {
  // ── OnlyOffice 前置尝试层（2026-08-26-onlyoffice-preview / FR-01/02）──
  const [officeCfg, setOfficeCfg] = useState<OfficeConfigResp | null>(null);
  const [officeFailed, setOfficeFailed] = useState(false);
  const officeEligible = officeEligibleStatic(target) && !officeFailed;

  // DS 路径不需要本地 blob（DS 容器自拉一次性 URL）；officeFailed 降级瞬间
  // fetcher 重新挂载拉取本地对象（useObjectUrl 依赖变化自然重跑）。
  const { blob, url, status, retry } = useObjectUrl(
    open && target && !officeEligible ? target.fetch : null,
  );

  useEffect(() => {
    setOfficeCfg(null);
    setOfficeFailed(false);
    if (!open || !officeEligibleStatic(target) || !target?.officeSource) return;
    let cancelled = false;
    // 预取 DS 配置：503（未启用）/任何失败 → officeFailed（降级本地渲染）。
    apiFetch<OfficeConfigResp>(
      `/api/preview/office-config?source=${target.officeSource.source}&id=${target.officeSource.id}`,
    )
      .then((resp) => {
        if (!cancelled) setOfficeCfg(resp);
      })
      .catch(() => {
        if (!cancelled) setOfficeFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // officeEligible 不进依赖（含 officeFailed 会自激振荡）；以静态资格 + 标识为锚。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.officeSource?.source, target?.officeSource?.id, target?.meta.name]);

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

    // OnlyOffice 高保真优先：配置就绪 → DS 渲染；预取中 → 轻加载态；失败 → 落回下方本地链。
    if (officeEligible && !officeFailed) {
      if (officeCfg) {
        return (
          <OnlyofficePreviewer
            blob={blob ?? new Blob()}
            url={url ?? ""}
            meta={target.meta}
            onDownload={handleDownload}
            officeConfig={officeCfg}
            onFallback={() => setOfficeFailed(true)}
          />
        );
      }
      return (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          <span className="ml-3 text-slate-500">正在准备高保真预览…</span>
        </div>
      );
    }

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
