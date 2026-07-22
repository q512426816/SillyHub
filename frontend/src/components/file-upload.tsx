"use client";

/**
 * FileUpload — 平台级文件中心通用上传组件（编辑态）。
 *
 * 受控组件（value = 文件 id 列表 / onChange），antd ``Upload.customRequest``
 * 调 ``uploadFile``（XHR，带进度 + 401 自动刷新重试）。已上传项经
 * ``fetchFileMetaBatch`` 回显文件名/类型/大小：图片显缩略图、文件显类型图标，
 * 每项可删除。
 *
 * 图片/文件按 MIME 前端判定（D-005），样式对齐前端设计系统总纲。
 * ``file_urls`` 字段类型不变（string[]），值语义为文件 id（D-006）。
 *
 * 依据：design.md §D-005/D-006 + tasks/task-08.md。
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Typography, Upload } from "antd";
import type { UploadProps } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";

import {
  fetchFileMetaBatch,
  uploadFile,
  type FileMetaResp,
} from "@/lib/file/api";
import { FileImage } from "@/components/file-image";
import { FileTypeIcon, formatFileSize, isImageMime } from "@/lib/file/utils";

const { Text } = Typography;

// antd Upload customRequest 参数类型（从 UploadProps 推断，保证与 Upload 期望一致）。
type CustomRequestOption = Parameters<NonNullable<UploadProps["customRequest"]>>[0];

export type FileUploadAccept = "image" | "file" | "all";

export interface FileUploadProps {
  /** 当前文件 id 列表（受控）。 */
  value?: string[];
  /** 文件 id 列表变更回调。 */
  onChange?: (next: string[]) => void;
  /** 接受的类型：image 仅图片 / file 仅非图片 / all 全部。默认 all。 */
  accept?: FileUploadAccept;
  /** 归属对象类型（ppm_problem 等），上传时透传。 */
  owner_type?: string;
  /** 归属对象 id（编辑场景传；新建场景留空，D-008）。 */
  owner_id?: string | null;
  /** 禁用上传/删除（查看态）。默认 false。 */
  disabled?: boolean;
}

function acceptAttr(accept: FileUploadAccept): string | undefined {
  if (accept === "image") return "image/*";
  return undefined;
}

export function FileUpload({
  value = [],
  onChange,
  accept = "all",
  owner_type,
  owner_id,
  disabled = false,
}: FileUploadProps) {
  const ids = useMemo(() => (Array.isArray(value) ? value : []), [value]);
  const [metas, setMetas] = useState<Record<string, FileMetaResp>>({});
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  // 回显：拉取缺失 id 的元数据（已上传项的文件名/类型/大小）。
  useEffect(() => {
    const missing = ids.filter((id) => !metas[id]);
    if (!missing.length) return;
    let cancelled = false;
    fetchFileMetaBatch(missing)
      .then((list) => {
        if (cancelled) return;
        setMetas((prev) => {
          const next = { ...prev };
          for (const m of list) next[m.id] = m;
          return next;
        });
      })
      .catch(() => {
        /* 回显失败不阻塞（删除仍可用，仅文件名暂缺） */
      });
    return () => {
      cancelled = true;
    };
  }, [ids, metas]);

  const emit = (next: string[]) => onChange?.(next);

  const customRequest = async (opt: CustomRequestOption) => {
    const file = opt.file as File & { uid?: string };
    const uid = file.uid ?? `${file.name}-${file.size}-${file.lastModified}`;
    setError(null);
    try {
      const resp = await uploadFile(file, {
        owner_type,
        owner_id: owner_id ?? null,
        onProgress: (p) => setUploading((prev) => ({ ...prev, [uid]: p })),
      });
      setMetas((prev) => ({
        ...prev,
        [resp.id]: {
          id: resp.id,
          original_name: resp.original_name,
          mime_type: resp.mime_type,
          size: resp.size,
          owner_type: owner_type ?? "",
          owner_id: owner_id ?? null,
        },
      }));
      setUploading((prev) => {
        const next = { ...prev };
        delete next[uid];
        return next;
      });
      emit([...ids, resp.id]);
      opt.onSuccess?.(resp);
    } catch (e) {
      setUploading((prev) => {
        const next = { ...prev };
        delete next[uid];
        return next;
      });
      setError(e instanceof Error ? e.message : "上传失败");
      opt.onError?.(e as Error);
    }
  };

  const removeId = (id: string) => emit(ids.filter((x) => x !== id));

  const uploadingEntries = Object.entries(uploading);

  return (
    <div className="space-y-2">
      {!disabled && (
        <Upload
          customRequest={customRequest}
          accept={acceptAttr(accept)}
          multiple
          showUploadList={false}
          disabled={disabled}
        >
          <Button size="small" icon={<PlusOutlined />}>
            上传附件
          </Button>
        </Upload>
      )}

      {uploadingEntries.map(([uid, pct]) => (
        <div
          key={uid}
          className="rounded border border-border bg-muted/20 px-2 py-1.5"
        >
          <div className="text-xs text-muted-foreground">上传中… {pct}%</div>
          <div className="mt-1 h-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded bg-blue-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ))}

      {ids.length > 0 && (
        <ul className="space-y-1">
          {ids.map((id) => {
            const meta = metas[id];
            const img = meta ? isImageMime(meta.mime_type) : false;
            return (
              <li
                key={id}
                className="flex items-center gap-2 rounded border border-border bg-muted/20 px-2 py-1"
              >
                {img ? (
                  <FileImage
                    id={id}
                    alt={meta?.original_name ?? "附件"}
                    className="h-8 w-8 flex-none rounded object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 flex-none items-center justify-center">
                    <FileTypeIcon mime={meta?.mime_type ?? ""} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {meta?.original_name ?? "加载中…"}
                  </div>
                  {meta && (
                    <div className="text-[11px] text-muted-foreground">
                      {isImageMime(meta.mime_type) ? "图片" : "文件"} · {formatFileSize(meta.size)}
                    </div>
                  )}
                </div>
                {!disabled && (
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeId(id)}
                    aria-label="删除附件"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {ids.length === 0 && uploadingEntries.length === 0 && (
        <Text type="secondary" className="text-xs">
          暂无附件
        </Text>
      )}

      {error && (
        <Text type="danger" className="text-[11px]">
          {error}
        </Text>
      )}
    </div>
  );
}

export default FileUpload;
