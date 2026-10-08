/**
 * previewers 统一出口：PreviewerProps 类型 + 各渲染器组件。
 *
 * 共享断言面：新增导出须同一变更内补齐枚举式 vi.mock("../previewers") 的
 * 桩——onlyoffice-preview.test.tsx 与 file-preview-modal.test.tsx 两处，缺
 * 导出整套件收集炸（testing-gotchas「共享断言面」⑤）。
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
// ql-20260917-004：json/patch/text 三类结构化渲染器（固定结构产物可视化 +
// .log 等文本文件全屏预览，此前落 fallback 下载卡片）
export { JsonPreviewer } from "./json-previewer";
export { PatchPreviewer } from "./patch-previewer";
export { TextPreviewer } from "./text-previewer";
// 2026-09-29-change-detail-timeline-files-polish：jsonl 逐行结构化渲染器
// （watcher-events.jsonl 专用表格 + 通用逐行树，此前落 fallback）
export { JsonlPreviewer } from "./jsonl-previewer";
