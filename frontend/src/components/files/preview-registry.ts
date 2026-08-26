/**
 * preview-registry — 预览格式 → 渲染器匹配。
 *
 * 匹配优先级（FR-03）：blob.type（后端权威 media_type 透传）> meta.mime > 扩展名兜底。
 * 会话附件 marker 仅含 id/kind/name（无 mime），blob.type 是该入口唯一可靠来源
 * （Design Grill F-2）。
 *
 * 纯函数无副作用、不依赖 React、不 import 渲染器组件。
 *
 * 依据：design.md §5 + §7。
 */

export type RendererKey = "image" | "pdf" | "docx" | "xlsx" | "markdown" | "fallback";

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const MIME_MAP: Record<string, RendererKey> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/markdown": "markdown",
};

const EXT_MAP: Record<string, RendererKey> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
  pdf: "pdf",
  docx: "docx",
  // ql-20260826-013：Excel 取消在线渲染（xls/xlsx → fallback 下载引导）——
  // SheetJS 表格还原度差、OnlyOffice 已退役；预览弹窗内下载本机查看。
  md: "markdown", markdown: "markdown",
};

function matchByMime(mime: string): RendererKey | null {
  if (IMAGE_MIMES.has(mime)) return "image";
  return MIME_MAP[mime] ?? null;
}

function matchByExt(filename: string): RendererKey | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_MAP[filename.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * mime 传 blob.type ?? meta.mime（后端权威 media_type 优先）。
 * 会话附件 marker 无 mime 时 blob.type 是唯一可靠来源。
 */
export function matchRenderer(mime: string | null | undefined, filename: string): RendererKey {
  if (mime) {
    const byMime = matchByMime(mime);
    if (byMime) return byMime;
  }
  const byExt = matchByExt(filename);
  return byExt ?? "fallback";
}
