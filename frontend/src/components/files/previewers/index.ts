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
}

export { ImagePreviewer } from "./image-previewer";
export { PdfPreviewer } from "./pdf-previewer";
export { FallbackPreviewer } from "./fallback-previewer";
export { DocxPreviewer } from "./docx-previewer";
export { XlsxPreviewer } from "./xlsx-previewer";
export { MarkdownPreviewer } from "./markdown-previewer";
