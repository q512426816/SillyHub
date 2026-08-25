"use client";

/**
 * FallbackPreviewer — 不支持格式的兜底渲染器。
 *
 * 对 pptx / zip / 其他无法在线预览的格式给出明确说明与下载引导（D-001@v1 取舍）。
 * 统一消费 PreviewerProps。
 */

import { DownloadOutlined } from "@ant-design/icons";

import { FileTypeIcon, formatFileSize } from "@/lib/file/utils";
import type { PreviewerProps } from "./index";

export function FallbackPreviewer({ meta, onDownload }: PreviewerProps) {
  const ext = meta.name.split(".").pop()?.toUpperCase() ?? "";
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <FileTypeIcon mime={meta.mime ?? ""} />
      </div>
      <div>
        <p className="text-base font-semibold text-slate-700">该格式暂不支持在线预览</p>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          {ext ? `${ext} 文件` : "该文件"}暂无高质量浏览器渲染方案，可下载后用本地 Office / WPS 打开。
          其余 Office 格式（docx / xlsx）已支持在线查看。
        </p>
      </div>
      <button
        type="button"
        onClick={onDownload}
        className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        <DownloadOutlined />
        下载文件
      </button>
      {meta.size != null && (
        <p className="text-xs text-slate-400">{formatFileSize(meta.size)}</p>
      )}
    </div>
  );
}
