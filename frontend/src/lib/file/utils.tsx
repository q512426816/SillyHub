/**
 * file 前端共享工具：MIME 判定 / 类型图标 / 大小格式化。
 * FileUpload / FileViewer 共用（D-005 纯前端 MIME 判定）。
 */

import {
  FileExcelOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileZipOutlined,
} from "@ant-design/icons";

const IMAGE_MIME = /^image\//;

export function isImageMime(mime: string): boolean {
  return IMAGE_MIME.test(mime);
}

export function FileTypeIcon({ mime }: { mime: string }) {
  const cls = "text-lg";
  if (mime.includes("pdf"))
    return <FilePdfOutlined className={cls} style={{ color: "#dc2626" }} />;
  if (mime.includes("word") || mime.includes("msword"))
    return <FileWordOutlined className={cls} style={{ color: "#2563eb" }} />;
  if (mime.includes("sheet") || mime.includes("excel"))
    return <FileExcelOutlined className={cls} style={{ color: "#059669" }} />;
  if (mime.includes("zip"))
    return <FileZipOutlined className={cls} style={{ color: "#64748b" }} />;
  return <FileOutlined className={cls} style={{ color: "#64748b" }} />;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
