/**
 * previewers 统一出口：PreviewerProps 类型 + 各渲染器组件。
 */

export interface PreviewerProps {
  blob: Blob;
  url: string;
  meta: {
    name: string;
    mime?: string | null;
    size?: number | null;
  };
  onDownload?: () => void | Promise<void>;
  /**
   * 撑满容器高度（全屏弹窗态）：true 时渲染器根容器用 h-full 系高度类替换
   * 固定高；false / 缺省时维持现状固定高（既有弹窗入口零回归）。
   */
  fill?: boolean;
}

export { ImagePreviewer } from "./image-previewer";
export { PdfPreviewer } from "./pdf-previewer";
export { FallbackPreviewer } from "./fallback-previewer";
export { DocxPreviewer } from "./docx-previewer";
export { XlsxPreviewer } from "./xlsx-previewer";
export { MarkdownPreviewer } from "./markdown-previewer";
export { HtmlPreviewer } from "./html-previewer";
