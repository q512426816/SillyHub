"use client";

/**
 * FileViewer — 平台级文件中心通用预览组件（只读态）。
 *
 * 按文件 id 列表（fileIds）经 ``fetchFileMetaBatch`` 取元数据，按 MIME 前端判定：
 * 图片显缩略图网格 + antd ``Image.PreviewGroup`` 点击放大；非图片显类型图标 +
 * 文件名 + 下载链接（``getFileDownloadUrl``）。空列表显示「暂无附件」。
 *
 * 纯前端 MIME 判定（D-005），样式对齐前端设计系统总纲。
 *
 * 依据：design.md §D-005 + tasks/task-09.md。
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

const { Text, Link } = Typography;

export interface FileViewerProps {
  /** 文件 id 列表。 */
  fileIds?: string[];
}

export function FileViewer({ fileIds = [] }: FileViewerProps) {
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
    return (
      <Text type="secondary" className="text-xs">
        暂无附件
      </Text>
    );
  }
  if (!loaded) {
    return (
      <Text type="secondary" className="text-xs">
        加载附件…
      </Text>
    );
  }

  const images = metas.filter((m) => isImageMime(m.mime_type));
  const files = metas.filter((m) => !isImageMime(m.mime_type));

  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <Image.PreviewGroup>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
            {images.map((m) => (
              <FileImage
                key={m.id}
                id={m.id}
                alt={m.original_name}
                className="aspect-square rounded-md border border-border object-cover"
                preview
              />
            ))}
          </div>
        </Image.PreviewGroup>
      )}

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 rounded border border-border bg-muted/20 px-2 py-1"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center">
                <FileTypeIcon mime={m.mime_type} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {m.original_name}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {formatFileSize(m.size)}
                </div>
              </div>
              <Link
                className="flex-none"
                aria-label={`下载 ${m.original_name}`}
                onClick={(e) => {
                  e.preventDefault();
                  void downloadFile(m.id, m.original_name);
                }}
              >
                <DownloadOutlined />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default FileViewer;
