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
 * ql-20260825-006：输入框支持 Ctrl+V 粘贴剪贴板图片/文件——textarea onPaste 读
 * clipboardData.files，非空则拦截默认插入并复用 handleFiles 上传管线（与 📎 完全
 * 等价，含 attachmentsDisabled 门控与 10 个上限）；纯文本粘贴走默认行为不受影响。
 *
 * 本组件无弹窗上下文依赖，/runtimes 弹窗与 /sessions 新页面均可独立 import 组装。
 */

import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Paperclip, RefreshCw, Send, X } from "lucide-react";
import { Button } from "antd";

import {
  removeSessionAttachment,
  uploadSessionAttachment,
  type AttachmentRead,
} from "@/lib/api/session-attachments";

/* ── ql-20260826-010：输入框高度拖拽调节（全局持久化）────────────────────── */

/** localStorage key（先例 sillyhub.sessions.* 前缀；高度是全局偏好不分会话）。 */
const INPUT_HEIGHT_LS_KEY = "sillyhub.sessions.inputBarHeight";
/** 下限 = 默认单行高度 min-h-11（44px）；上限固定 480px 与视口 60% 取小。 */
const INPUT_HEIGHT_MIN = 44;
const INPUT_HEIGHT_MAX = 480;

/** 回读持久化高度（SSR / 无值 / 非法值 → null 走默认自适应）。 */
function readPersistedInputHeight(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(INPUT_HEIGHT_LS_KEY);
    const n = raw == null ? Number.NaN : Number(raw);
    return Number.isFinite(n)
      ? Math.min(INPUT_HEIGHT_MAX, Math.max(INPUT_HEIGHT_MIN, Math.round(n)))
      : null;
  } catch {
    return null;
  }
}

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
  /** ql-20260825-007：附件入口禁用时的悬停原因（缺省「当前引擎不支持附件」——
   *  dialog 首句门控等非引擎场景传自定义文案，避免误导）。 */
  attachmentsDisabledTitle?: string;
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
  attachmentsDisabledTitle,
  multimodalDowngraded = false,
  onAttachmentsChange,
  registerClearAttachments,
}: SessionInputBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** 上传完成的附件（chips 数据源）。上传中/失败以 id=null 占位行内呈现。 */
  const [attachments, setAttachments] = useState<AttachmentRead[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ql-20260826-010：用户拖拽调节的输入框高度（null = 默认自适应）。拖拽中经
  // setInputHeight 实时生效；effect 落盘（拖完才有的稳定值也覆盖）；双击手柄
  // 恢复默认并清键。上限取 min(480, 视口 60%)，拖拽时按当次视口动态算。
  const [inputHeight, setInputHeight] = useState<number | null>(readPersistedInputHeight);
  useEffect(() => {
    if (inputHeight == null) return;
    try {
      window.localStorage.setItem(INPUT_HEIGHT_LS_KEY, String(inputHeight));
    } catch {
      /* 隐私模式等写入失败静默 */
    }
  }, [inputHeight]);

  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleHeightDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    // 实测高度兜底：jsdom / 未布局时 offsetHeight 为 0，按默认下限起步。
    const measured = textareaRef.current?.offsetHeight ?? 0;
    const current = inputHeight ?? (measured > 0 ? measured : INPUT_HEIGHT_MIN);
    dragStateRef.current = { startY: e.clientY, startHeight: current };
    const onMove = (ev: MouseEvent) => {
      const d = dragStateRef.current;
      if (!d) return;
      const max = Math.min(INPUT_HEIGHT_MAX, Math.round(window.innerHeight * 0.6));
      const next = Math.min(
        Math.max(INPUT_HEIGHT_MIN, d.startHeight + (d.startY - ev.clientY)),
        max,
      );
      setInputHeight(next);
    };
    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleHeightReset = () => {
    setInputHeight(null);
    try {
      window.localStorage.removeItem(INPUT_HEIGHT_LS_KEY);
    } catch {
      /* 静默容错 */
    }
  };

  /* task-14（2026-08-27-background-subagent-progress / FR-08）：空内容禁点提示——
   * 纯空文本（strip 后为空且无附件）时发送按钮 title/aria-label 提示「消息内容
   * 不能为空」，与后端 inject 空 prompt 422 文案一致（backend session/service.py
   * SessionEmptyPrompt）。仅在非父级禁用时提示：终态/离线等父级禁用原因由
   * placeholder 承载，此时不误报空内容。D-7 例外口径不变——有附件无文本仍可发
   * （看图说话），提示保持「发送」。 */
  const sendEmptyHinted =
    !disabled && !value.trim() && attachments.length === 0;

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
    <footer className="shrink-0 bg-card px-5 pb-4 pt-1">
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
                <span className="truncate inline-flex items-center gap-1">
                  {att.kind === "image" ? (
                    <ImageIcon aria-hidden className="h-3 w-3 shrink-0" />
                  ) : (
                    <FileText aria-hidden className="h-3 w-3 shrink-0" />
                  )}
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
      {/* 高度拖拽手柄（ql-20260826-010）：输入胶囊上缘细条——按下沿竖向拖动
          增减高度（实时生效 + 落盘），双击恢复默认。 */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖动调节输入框高度（双击恢复默认）"
        title="拖动调节输入框高度，双击恢复默认"
        onMouseDown={handleHeightDragStart}
        onDoubleClick={handleHeightReset}
        className="group -mb-0.5 flex h-3 cursor-ns-resize touch-none items-center justify-center"
      >
        <span className="h-[3px] w-10 rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-brand-500" />
      </div>
      {/* 胶囊输入区（2026-08-23-sessions-page-style 原型 .input-row）：圆角容器
          聚焦光环 + 附件按钮内嵌 + 渐变圆形发送按钮；Enter/附件/disabled 交互
          契约原样（task-13 / D-7）。 */}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-muted/40 px-2.5 py-2 transition-all focus-within:border-primary focus-within:bg-card focus-within:ring-4 focus-within:ring-brand-100">
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button
          type="text"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || attachmentsDisabled}
          className="h-10 w-10 shrink-0 self-center rounded-full p-0 text-muted-foreground"
          title={
            attachmentsDisabled
              ? (attachmentsDisabledTitle ?? "当前引擎不支持附件")
              : "添加图片/文件附件，支持 Ctrl+V 直接粘贴（图片直读需多模态模型）"
          }
        >
          <Paperclip className="h-5 w-5" />
        </Button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            // ql-20260825-006：剪贴板带文件（截图/复制的文件）→ 与 📎 同上传管线；
            // 空文件列表（纯文本粘贴）直接放行默认插入。
            if (attachmentsDisabled) return;
            const files = e.clipboardData?.files;
            if (!files || files.length === 0) return;
            e.preventDefault();
            void handleFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          className="min-h-11 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          rows={2}
          disabled={disabled}
          style={inputHeight != null ? { height: inputHeight } : undefined}
        />
        <Button
          type="primary"
          shape="circle"
          onClick={onSend}
          // D-7：带附件时空文本可发（看图说话）；纯文本仍要求非空。
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          className="h-9 w-9 shrink-0 self-center border-none bg-gradient-to-br from-brand-600 to-info shadow-primary hover:from-brand-700 hover:to-info hover:shadow-primary"
          title={sendEmptyHinted ? "消息内容不能为空" : "发送"}
          aria-label={sendEmptyHinted ? "消息内容不能为空" : "发送"}
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
