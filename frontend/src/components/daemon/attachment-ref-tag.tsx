"use client";

/**
 * 历史正文行内引用渲染（2026-10-09-attachment-inline-reference task-02，
 * FR-06，D-005@v1；2026-10-10-workspace-ref-intake task-09 扩展三类工作区标记）。
 *
 * 消费 parseInlineRefs（统一解析：附件 + 文件/目录/代码三类工作区标记）拆段：
 * text 段原样、ref 段按 kind 渲染标签——附件走 onOpenRef（uuid 锚定），
 * 工作区三类走 onOpenWsRef（workspaceId+path 锚定，图标 FileText/Folder/
 * Braces + 名称 + 行号段）；点击由宿主打开 FilePreviewModal。回调缺省渲染为
 * 不可点击标签。解析失败的片段归 text 段原样（容错不丢字）；无引用文本单
 * text 段直出（本变更前消息渲染逐字不变）。React.memo 段级缓存防长文重析
 * （R-06）。
 *
 * tone（D-005@v2 用户反馈「蓝色气泡里标签看不清」）：brand=浅色气泡默认（品牌
 * 色底+深字）；onPrimary=蓝色主气泡内（白色半透明底+白字，与附件卡片同族对比）。
 */

import { memo, useMemo, useState } from "react";
import { Braces, FileText, Folder, Paperclip } from "lucide-react";

import { cn } from "@/lib/utils";
import { parseInlineRefs, type InlineRefPart } from "@/lib/attachment-refs";
import { fetchAttachmentBlob } from "@/lib/api/session-attachments";
import { fetchDownload } from "@/lib/explorer";
import {
  FilePreviewModal,
  type FilePreviewTarget,
} from "@/components/files/file-preview-modal";

/** 工作区引用点击载荷（onOpenWsRef 入参，task-09）。 */
export interface WsRefOpenPayload {
  workspaceId: string;
  path: string;
  lines?: [number, number];
}

interface InlineAttRefTextProps {
  /** 待渲染正文（可含 [附件引用:uuid|name] 与三类工作区行内引用）。 */
  text: string;
  /** 附件引用点击回调（宿主开预览窗）；缺省渲染为不可点击标签。 */
  onOpenRef?: (ref: { id: string; name: string }) => void;
  /** 工作区引用点击回调（宿主开预览窗）；缺省渲染为不可点击标签（task-09）。 */
  onOpenWsRef?: (ref: WsRefOpenPayload) => void;
  /** 标签色调：brand（默认，浅底气泡）/ onPrimary（蓝色主气泡内）。 */
  tone?: "brand" | "onPrimary";
}

/** kind → lucide 图标（附件 Paperclip / 文件 FileText / 目录 Folder / 代码块 Braces）。 */
const REF_KIND_ICON = { att: Paperclip, file: FileText, dir: Folder, code: Braces } as const;

/** ref 段收窄类型（InlineRefPart 非判别联合，Extract 不适用）。 */
type InlineRefSegment = InlineRefPart & {
  type: "ref";
  ref: NonNullable<InlineRefPart["ref"]>;
};

/** 单个 ref 段标签（附件与工作区三类同形态：图标 + 名称 + 行号段）。 */
function RefTag({
  part,
  onOpenRef,
  onOpenWsRef,
  tone,
}: {
  part: InlineRefSegment;
  onOpenRef?: (ref: { id: string; name: string }) => void;
  onOpenWsRef?: (ref: WsRefOpenPayload) => void;
  tone: "brand" | "onPrimary";
}) {
  const ref = part.ref!;
  const isAtt = ref.kind === "att";
  const Icon = REF_KIND_ICON[ref.kind];
  const clickable = isAtt ? !!onOpenRef : !!onOpenWsRef;
  // tooltip：附件保持既有文案（零视觉回归）；工作区三类带路径/行号完整绑定。
  const title = isAtt
    ? `${ref.name}（点击在线预览）`
    : ref.kind === "code" && ref.lines
      ? `代码：${ref.path || "工作区根"} 第 ${ref.lines[0]}-${ref.lines[1]} 行（点击预览）`
      : ref.kind === "dir"
        ? `目录：${ref.path || "工作区根"}（点击预览）`
        : `文件：${ref.path}（点击预览）`;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => {
        if (isAtt) onOpenRef?.({ id: ref.id ?? "", name: ref.name });
        else onOpenWsRef?.({ workspaceId: ref.workspaceId ?? "", path: ref.path ?? "", lines: ref.lines });
      }}
      title={title}
      className={cn(
        "mx-px my-0.5 inline-flex items-center gap-0.5 rounded px-1 py-px text-[0.95em] font-medium transition-colors disabled:cursor-default",
        tone === "onPrimary"
          ? // 蓝色主气泡内：白色半透明胶囊 + 白字（对比可读，D-005@v2）。
            "border border-white/30 bg-white/25 text-white hover:bg-white/40"
          : "bg-brand-500/15 text-brand-700 hover:bg-brand-500/25 dark:text-brand-300",
        !clickable && "opacity-90",
      )}
    >
      <Icon aria-hidden className="h-3 w-3 shrink-0" />
      {ref.name}
    </button>
  );
}

export const InlineAttRefText = memo(function InlineAttRefText({
  text,
  onOpenRef,
  onOpenWsRef,
  tone = "brand",
}: InlineAttRefTextProps) {
  const parts = useMemo(() => parseInlineRefs(text), [text]);
  // 快速路径：无引用段原样直出（含空文本），与现状渲染逐字一致。
  if (parts.every((p) => p.type === "text")) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => {
        if (p.type !== "ref" || !p.ref) return <span key={i}>{p.value}</span>;
        const seg: InlineRefSegment = { ...p, type: "ref", ref: p.ref };
        return (
          <RefTag key={i} part={seg} onOpenRef={onOpenRef} onOpenWsRef={onOpenWsRef} tone={tone} />
        );
      })}
    </>
  );
});

/**
 * 带预览窗的完整接线（task-06 / task-09）：InlineAttRefText + 点击开
 * FilePreviewModal。按 ref.kind 分流：
 * - 附件：fetch=fetchAttachmentBlob(uuid)，officeSource 高保真标识（同
 *   attachment-chips.tsx 链路）。
 * - 工作区三类：fetch=fetchDownload(workspaceId, path)（lib/explorer.ts 签名），
 *   meta.mime 传 null 靠扩展名经 matchRenderer 分发（下载端点 blob.type 多为
 *   octet-stream，R-05 同 file-preview.tsx 全屏预览先例），不加 officeSource
 *   （explorer 文件无平台 id 恒本地渲染，D-007）。
 * 单聊 turn-timeline 用户气泡正文、steered 引导段与群聊气泡正文共用——宿主
 * 一行接入，自持 modal state。
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
        onOpenWsRef={(ref) => {
          // path 空串（工作区根目录引用）无文件可预览——下载端点也不接受空
          // path，点击仅提示（预览语义留给文件/代码类）。
          if (!ref.path) return;
          const name = ref.path.split("/").filter(Boolean).pop() ?? ref.path;
          setTarget({
            fetch: () => fetchDownload(ref.workspaceId, ref.path),
            meta: { name, mime: null },
          });
          setOpen(true);
        }}
      />
      <FilePreviewModal target={target} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
