"use client";

/**
 * 会话附件 chips（2026-08-20-session-multimodal-attachments task-13，FR-6 / D-3）。
 *
 * 改造后（2026-08-25-session-attachment-preview）：全部 chip 可点击弹统一预览窗
 * （FilePreviewModal），图片缩略图点击从「新窗打开」改为弹窗预览；文件 chip 从只读
 * 标签改为可点击。拉取失败仍按图标 chip 降级（容错，不阻塞消息渲染）。
 */

import { useEffect, useState } from "react";
import { FileText, ImageIcon } from "lucide-react";

import { fetchAttachmentObjectUrl, fetchAttachmentBlob } from "@/lib/api/session-attachments";
import { FilePreviewModal, type FilePreviewTarget } from "@/components/files/file-preview-modal";
import type { ParsedAttachmentMarker } from "@/components/daemon/runtime-session-helpers";

function AttachmentImageChip({
  att,
  onPreview,
}: {
  att: ParsedAttachmentMarker;
  onPreview: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    fetchAttachmentObjectUrl(att.id)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        created = u;
        setUrl(u);
      })
      .catch(() => {
        /* 失败保持 null → 图标 chip 降级 */
      });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [att.id]);

  if (!url) {
    return (
      <span className="flex items-center gap-1.5 rounded-lg bg-primary-foreground/10 px-2 py-1.5 text-[11px]">
        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
        <span className="max-w-[180px] truncate">{att.name}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onPreview}
      title={`${att.name}（点击在线预览）`}
      className="cursor-pointer"
    >
      {/* objectURL 本地 blob，不走图片优化管线 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={att.name}
        className="max-h-40 max-w-[220px] rounded-lg border border-primary-foreground/20 object-cover transition-all hover:border-brand-300"
      />
    </button>
  );
}

export function AttachmentChips({
  attachments,
}: {
  attachments: ParsedAttachmentMarker[];
}) {
  const [previewTarget, setPreviewTarget] = useState<FilePreviewTarget | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const openPreview = (att: ParsedAttachmentMarker) => {
    setPreviewTarget({
      fetch: () => fetchAttachmentBlob(att.id),
      meta: { name: att.name },
      // 2026-08-26-onlyoffice-preview：office 家族先试 DS 高保真（失败降级本地）。
      officeSource: { source: "session_attachment", id: att.id },
    });
    setPreviewOpen(true);
  };

  if (attachments.length === 0) return null;
  return (
    <>
      <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
        {attachments.map((att) =>
          att.kind === "image" ? (
            <AttachmentImageChip
              key={att.id}
              att={att}
              onPreview={() => openPreview(att)}
            />
          ) : (
            <button
              key={att.id}
              type="button"
              onClick={() => openPreview(att)}
              title={`${att.name}（点击在线预览）`}
              className="flex items-center gap-1.5 rounded-lg bg-primary-foreground/10 px-2 py-1.5 text-[11px] transition-colors hover:bg-primary-foreground/20 hover:text-brand-700"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden />
              <span className="max-w-[180px] truncate">{att.name}</span>
            </button>
          ),
        )}
      </div>
      <FilePreviewModal
        target={previewTarget}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}
