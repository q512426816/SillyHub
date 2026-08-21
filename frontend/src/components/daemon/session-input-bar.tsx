"use client";

/**
 * task-13（2026-08-14-sessions-portal / FR-05 / D-002@v1）：会话输入区共享子组件。
 *
 * 从 interactive-session-panel.tsx 纯机械抽取（弹窗零回归，NG-04/D-002）：
 *   - 输入框（Enter 发送 / Shift+Enter 换行）
 *   - 发送按钮（creating 态转 spinner）
 *
 * 2026-08-20-session-multimodal-attachments task-12：附件流——📎 选文件即传
 * （FR-1/FR-3）、chips 预览可删（缩略图/文件名+大小）、发送守卫带附件豁免空
 * 文本（D-7）、attachmentsDisabled 门控（codex 引擎 D-6）、降级提示条（FR-10
 * D-9：当前供应商 multimodal 判不支持 → 图片将落盘供 agent 工具读）。
 *
 * 本组件无弹窗上下文依赖，/runtimes 弹窗与 /sessions 新页面均可独立 import 组装。
 */

import { useRef, useState } from "react";
import { Paperclip, RefreshCw, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  removeSessionAttachment,
  uploadSessionAttachment,
  type AttachmentRead,
} from "@/lib/api/session-attachments";

export interface SessionInputBarProps {
  /** 输入框当前值（受控）。 */
  value: string;
  /** 输入内容变化。 */
  onChange: (next: string) => void;
  /** 发送（Enter 或按钮）。守卫（turn 级串行 / 状态机 / 长度）由父级 handleSend 负责。 */
  onSend: () => void;
  /** 输入框 + 发送按钮禁用（父级 sendingDisabled）。 */
  disabled: boolean;
  /** 输入框占位文案（父级按会话状态推导）。 */
  placeholder: string;
  /** 会话创建中（view.status === "creating"）→ 发送按钮转 spinner。 */
  creating: boolean;
  /** task-12：附件入口禁用（codex 引擎 D-6 三层门控第一层）。默认 false 兼容。 */
  attachmentsDisabled?: boolean;
  /** task-12：降级提示（FR-10）：当前供应商判不支持多模态 → 图片转落盘模式。 */
  multimodalDowngraded?: boolean;
  /** task-12：待发送附件变化（回传完整对象——父级合成标记行/取 ids；发送成功后父级调 clearAttachments）。 */
  onAttachmentsChange?: (next: AttachmentRead[]) => void;
  /** task-12：父级发送成功后清空 chips（经 ref 暴露口，这里改用受控清理回调）。 */
  registerClearAttachments?: (fn: () => void) => void;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

export function SessionInputBar({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  creating,
  attachmentsDisabled = false,
  multimodalDowngraded = false,
  onAttachmentsChange,
  registerClearAttachments,
}: SessionInputBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  /** 上传完成的附件（chips 数据源）。上传中/失败以 id=null 占位行内呈现。 */
  const [attachments, setAttachments] = useState<AttachmentRead[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const syncToParent = (next: AttachmentRead[]) => {
    onAttachmentsChange?.(next);
  };

  registerClearAttachments?.(() => {
    setAttachments([]);
    onAttachmentsChange?.([]);
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    for (const file of Array.from(files).slice(0, 10)) {
      const kind = file.type.startsWith("image/") ? "image" : "file";
      setUploading((n) => n + 1);
      try {
        const added = await uploadSessionAttachment(file, kind);
        setAttachments((prev) => {
          const next = [...prev, added];
          syncToParent(next);
          return next;
        });
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "上传失败");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleRemove = async (att: AttachmentRead) => {
    setAttachments((prev) => {
      const next = prev.filter((a) => a.id !== att.id);
      syncToParent(next);
      return next;
    });
    try {
      await removeSessionAttachment(att.id);
    } catch {
      /* 行已在本地移除；服务端残留由 48h 草稿清理兜底 */
    }
  };

  return (
    <footer className="shrink-0 border-t bg-card px-5 py-4">
      {/* 附件区：chips + 降级提示条（task-12）。 */}
      {(attachments.length > 0 || uploading > 0 || uploadError) && (
        <div className="mb-2 space-y-1.5">
          {multimodalDowngraded && attachments.some((a) => a.kind === "image") && (
            <div className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
              当前供应商不支持图片直读：图片将以文件形式落盘，供智能体用工具读取（不能「看」图）。
              可在「我的供应商」开启该供应商的多模态能力。
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((att) => (
              <span
                key={att.id}
                className="flex max-w-[220px] items-center gap-1 rounded border border-input bg-muted/50 px-2 py-1 text-[11px]"
                title={`${att.name} · ${formatBytes(att.bytes)}`}
              >
                <span className="truncate">
                  {att.kind === "image" ? "🖼 " : "📄 "}
                  {att.name} · {formatBytes(att.bytes)}
                </span>
                <button
                  type="button"
                  aria-label={`移除附件 ${att.name}`}
                  onClick={() => void handleRemove(att)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {uploading > 0 && (
              <span className="flex items-center gap-1 rounded border border-input px-2 py-1 text-[11px] text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" /> 上传中…（{uploading}）
              </span>
            )}
          </div>
          {uploadError && (
            <div className="text-[11px] text-destructive">{uploadError}</div>
          )}
        </div>
      )}
      <div className="flex items-end gap-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button
          variant="ghost"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || attachmentsDisabled}
          className="h-12 w-12 shrink-0 p-0"
          title={
            attachmentsDisabled
              ? "当前引擎不支持附件"
              : "添加图片/文件附件（图片直读需多模态模型）"
          }
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          className="min-h-12 flex-1 resize-none rounded border border-input bg-background px-3 py-2 text-sm leading-5 focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-muted"
          rows={2}
          disabled={disabled}
        />
        <Button
          onClick={onSend}
          // D-7：带附件时空文本可发（看图说话）；纯文本仍要求非空。
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          className="h-12 w-12 shrink-0 p-0"
          title="发送"
        >
          {creating ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </footer>
  );
}
