"use client";

/**
 * 历史正文行内附件引用渲染（2026-10-09-attachment-inline-reference task-02，
 * FR-06，D-005@v1）。
 *
 * 消费 parseInlineAttRefs（task-01）拆段：text 段原样、ref 段渲染标签，
 * 点击经 onOpenRef 回调由宿主打开 FilePreviewModal（fetch=fetchAttachmentBlob(uuid)，
 * 与已发送附件 chips 同链路）；onOpenRef 缺省渲染为不可点击标签（无回调场景）。
 * 解析失败的片段归 text 段原样（容错不丢字）；无引用文本单 text 段直出（本变更前
 * 消息渲染逐字不变）。React.memo 段级缓存防长文重析（R-06）。
 *
 * tone（D-005@v2 用户反馈「蓝色气泡里标签看不清」）：brand=浅色气泡默认（品牌
 * 色底+深字）；onPrimary=蓝色主气泡内（白色半透明底+白字，与附件卡片同族对比）。
 */

import { memo, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { parseInlineAttRefs } from "@/lib/attachment-refs";
import { fetchAttachmentBlob } from "@/lib/api/session-attachments";
import {
  FilePreviewModal,
  type FilePreviewTarget,
} from "@/components/files/file-preview-modal";

interface InlineAttRefTextProps {
  /** 待渲染正文（可含 [附件引用:uuid|name] 行内引用）。 */
  text: string;
  /** 引用点击回调（宿主开预览窗）；缺省渲染为不可点击标签。 */
  onOpenRef?: (ref: { id: string; name: string }) => void;
  /** 标签色调：brand（默认，浅底气泡）/ onPrimary（蓝色主气泡内）。 */
  tone?: "brand" | "onPrimary";
}

export const InlineAttRefText = memo(function InlineAttRefText({
  text,
  onOpenRef,
  tone = "brand",
}: InlineAttRefTextProps) {
  const parts = useMemo(() => parseInlineAttRefs(text), [text]);
  // 快速路径：无引用段原样直出（含空文本），与现状渲染逐字一致。
  if (parts.every((p) => p.type === "text")) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => {
        if (p.type !== "ref" || !p.ref) return <span key={i}>{p.value}</span>;
        const ref = p.ref;
        return (
          <button
            key={i}
            type="button"
            disabled={!onOpenRef}
            onClick={() => onOpenRef?.(ref)}
            title={`${ref.name}（点击在线预览）`}
            className={cn(
              "mx-px my-0.5 rounded px-1 py-px text-[0.95em] font-medium transition-colors disabled:cursor-default",
              tone === "onPrimary"
                ? // 蓝色主气泡内：白色半透明胶囊 + 白字（对比可读，D-005@v2）。
                  "border border-white/30 bg-white/25 text-white hover:bg-white/40"
                : "bg-brand-500/15 text-brand-700 hover:bg-brand-500/25 dark:text-brand-300",
              !onOpenRef && "opacity-90",
            )}
          >
            {ref.name}
          </button>
        );
      })}
    </>
  );
});

/**
 * 带预览窗的完整接线（task-06）：InlineAttRefText + 点击开 FilePreviewModal
 * （fetch=fetchAttachmentBlob(uuid)，与已发送附件 chips/attachment-chips.tsx
 * 同链路含 officeSource 高保真标识）。单聊 turn-timeline 用户气泡正文、steered
 * 引导段与群聊气泡正文共用——宿主一行接入，自持 modal state。
 */
export function InlineAttRefTextWithPreview({
  text,
  tone = "brand",
}: {
  text: string;
  tone?: "brand" | "onPrimary";
}) {
  const [target, setTarget] = useState<FilePreviewTarget | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <InlineAttRefText
        text={text}
        tone={tone}
        onOpenRef={(ref) => {
          setTarget({
            fetch: () => fetchAttachmentBlob(ref.id),
            meta: { name: ref.name },
            officeSource: { source: "session_attachment", id: ref.id },
          });
          setOpen(true);
        }}
      />
      <FilePreviewModal target={target} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
