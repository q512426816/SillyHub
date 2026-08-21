"use client";

/**
 * 会话附件 chips（2026-08-20-session-multimodal-attachments task-13，FR-6 / D-3）。
 *
 * 历史回显：图片 → 鉴权拉取 objectURL 缩略图（点击新窗放大）；文件 → 只读 chip。
 * 拉取失败按文件 chip 降级（容错，不阻塞消息渲染）。
 */

import { useEffect, useState } from "react";
import { FileText, ImageIcon } from "lucide-react";

import { fetchAttachmentObjectUrl } from "@/lib/api/session-attachments";
import type { ParsedAttachmentMarker } from "@/components/daemon/runtime-session-helpers";

function AttachmentImageChip({ att }: { att: ParsedAttachmentMarker }) {
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
    <a href={url} target="_blank" rel="noreferrer" title={`${att.name}（点击查看大图）`}>
      {/* objectURL 本地 blob，不走图片优化管线 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={att.name}
        className="max-h-40 max-w-[220px] rounded-lg border border-primary-foreground/20 object-cover"
      />
    </a>
  );
}

export function AttachmentChips({
  attachments,
}: {
  attachments: ParsedAttachmentMarker[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {attachments.map((att) =>
        att.kind === "image" ? (
          <AttachmentImageChip key={att.id} att={att} />
        ) : (
          <span
            key={att.id}
            className="flex items-center gap-1.5 rounded-lg bg-primary-foreground/10 px-2 py-1.5 text-[11px]"
            title={att.name}
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            <span className="max-w-[180px] truncate">{att.name}</span>
          </span>
        ),
      )}
    </div>
  );
}
