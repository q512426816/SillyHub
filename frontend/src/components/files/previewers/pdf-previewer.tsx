"use client";

/**
 * PdfPreviewer — PDF 渲染器。
 *
 * iframe 内嵌 objectURL，走浏览器原生 PDF 视图器（缩放/翻页/打印）。
 * 零新依赖（D-003@v1）。统一消费 PreviewerProps。
 */

import type { PreviewerProps } from "./index";

export function PdfPreviewer({ url }: PreviewerProps) {
  return (
    <div className="h-full min-h-[560px] w-full">
      <iframe
        src={url}
        className="h-full w-full rounded-lg border border-border"
        title="PDF 预览"
      />
    </div>
  );
}
