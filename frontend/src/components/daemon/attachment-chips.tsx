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

import { cn } from "@/lib/utils";
import { fetchAttachmentObjectUrl, fetchAttachmentBlob } from "@/lib/api/session-attachments";
import { FilePreviewModal, type FilePreviewTarget } from "@/components/files/file-preview-modal";
import type { ParsedAttachmentMarker } from "@/components/daemon/runtime-session-helpers";

function AttachmentImageChip({
  att,
  onPreview,
  tone,
}: {
  att: ParsedAttachmentMarker;
  onPreview: () => void;
  /**
   * 2026-10-20-session-page-dsh-alignment（FR-05）：气泡底色档——onPrimary＝
   * brand 实色主气泡（旧形态，白色半透明 chip）；brand＝低饱和 brand 浅底气泡
   * （会话页新形态，chip 走品牌浅底 + 语义描边）。缺省 onPrimary ＝ 旧行为。
   */
  tone: "onPrimary" | "brand";
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
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px]",
          tone === "onPrimary" ? "bg-primary-foreground/10" : "bg-brand-500/15",
        )}
      >
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
        className={cn(
          "max-h-40 max-w-[220px] rounded-lg border object-cover transition-all hover:border-brand-300",
          tone === "onPrimary" ? "border-primary-foreground/20" : "border-border",
        )}
      />
    </button>
  );
}

export function AttachmentChips({
  attachments,
  align = "end",
  tone = "onPrimary",
}: {
  attachments: ParsedAttachmentMarker[];
  /** chips 行主轴对齐（单聊用户气泡右对齐缺省；群聊非 self 气泡传 start）。 */
  align?: "start" | "end";
  /**
   * 2026-10-20-session-page-dsh-alignment（FR-05 / D-016④）：气泡底色档。
   * 缺省 "onPrimary" ＝ 既有 brand 实色气泡内的白色半透明 chip（群聊等旧消费方
   * 零变化）；会话页用户气泡改低饱和 brand 浅底后传 "brand"，chip 换品牌浅底。
   */
  tone?: "onPrimary" | "brand";
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
      <div
        className={cn(
          "mb-1.5 flex flex-wrap gap-1.5",
          align === "end" ? "justify-end" : "justify-start",
        )}
      >
        {attachments.map((att) =>
          att.kind === "image" ? (
            <AttachmentImageChip
              key={att.id}
              att={att}
              tone={tone}
              onPreview={() => openPreview(att)}
            />
          ) : (
            <button
              key={att.id}
              type="button"
              onClick={() => openPreview(att)}
              title={`${att.name}（点击在线预览）`}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] transition-colors hover:text-brand-700",
                tone === "onPrimary"
                  ? "bg-primary-foreground/10 hover:bg-primary-foreground/20"
                  : "bg-brand-500/15 hover:bg-brand-500/25",
              )}
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
