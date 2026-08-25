"use client";

/**
 * PdfPreviewer — PDF 渲染器。
 *
 * iframe 内嵌 objectURL，走浏览器原生 PDF 视图器（缩放/翻页/打印）。
 * 零新依赖（D-003@v1）。统一消费 PreviewerProps。
 *
 * ql-20260825-005：高度改固定视口高（h-[70vh]）——Modal body 是
 * max-h + overflow-auto 容器，height:100% 在高度 auto 的父链上解析不了
 * （iframe 塌成 ~150px 默认高）。
 */

import type { PreviewerProps } from "./index";

export function PdfPreviewer({ url }: PreviewerProps) {
  return (
    <div className="h-[70vh] w-full">
      <iframe
        src={url}
        className="h-full w-full rounded-lg border border-border"
        title="PDF 预览"
      />
    </div>
  );
}
