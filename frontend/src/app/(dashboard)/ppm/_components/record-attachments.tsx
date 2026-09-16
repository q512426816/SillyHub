"use client";

/**
 * RecordAttachments — 执行记录表行内紧凑附件展示（表格专用）。
 *
 * 与 {@link FileViewer} 的区别：FileViewer 为「任务/问题信息」区设计（大缩略图
 * 网格 + 文档卡片行，块级，宽度由内容撑开）；本组件为表格单元格设计——配
 * ``table-fixed`` 固定列宽后，图片用 ~40px 小缩略图横排换行，文档用「图标 +
 * 文件名」chip 单行截断 + 下载小图标，行内紧凑，附件再多只增加行高，不再
 * 挤压时间/说明列。
 *
 * 复用 file-center 底层 API（``fetchFileMetaBatch`` / ``isImageMime`` /
 * ``FileTypeIcon`` / ``FileImage`` / ``downloadFile``），仅展示形态不同。
 */
import { useEffect, useMemo, useState } from "react";
import { Image, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";

import {
  downloadFile,
  fetchFileMetaBatch,
  type FileMetaResp,
} from "@/lib/file/api";
import { FileImage } from "@/components/file-image";
import { FileTypeIcon, formatFileSize, isImageMime } from "@/lib/file/utils";

const { Link } = Typography;

export interface RecordAttachmentsProps {
  /** 文件 id 列表。 */
  fileIds?: string[];
}

export function RecordAttachments({ fileIds = [] }: RecordAttachmentsProps) {
  const ids = useMemo(() => (Array.isArray(fileIds) ? fileIds : []), [fileIds]);
  const [metas, setMetas] = useState<FileMetaResp[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ids.length) {
      setMetas([]);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    fetchFileMetaBatch(ids)
      .then((list) => {
        if (!cancelled) {
          setMetas(list);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ids]);

  if (!ids.length) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (!loaded) {
    return <span className="text-xs text-muted-foreground">加载中…</span>;
  }

  const images = metas.filter((m) => isImageMime(m.mime_type));
  const files = metas.filter((m) => !isImageMime(m.mime_type));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {images.length > 0 && (
        <Image.PreviewGroup>
          {images.map((m) => (
            <FileImage
              key={m.id}
              id={m.id}
              alt={m.original_name}
              className="h-10 w-10 flex-none rounded border border-border object-cover"
              preview
              previewMask="预览"
            />
          ))}
        </Image.PreviewGroup>
      )}
      {files.map((m) => (
        <span
          key={m.id}
          className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5"
          title={`${m.original_name}（${formatFileSize(m.size)}）`}
        >
          <span className="flex-none text-muted-foreground">
            <FileTypeIcon mime={m.mime_type} />
          </span>
          <span className="max-w-[7rem] truncate text-xs">{m.original_name}</span>
          <Link
            className="flex-none text-muted-foreground"
            aria-label={`下载 ${m.original_name}`}
            onClick={(e) => {
              e.preventDefault();
              void downloadFile(m.id, m.original_name);
            }}
          >
            <DownloadOutlined />
          </Link>
        </span>
      ))}
    </div>
  );
}

export default RecordAttachments;
