"use client";

/**
 * task-13（2026-08-14-sessions-portal / FR-05 / D-002@v1）：会话输入区共享子组件。
 *
 * 从 interactive-session-panel.tsx 纯机械抽取（弹窗零回归，NG-04/D-002）：
 *   - 输入框（Enter 发送 / Shift+Enter 换行）
 *   - 发送按钮（creating 态转 spinner）
 *
 * 本组件无弹窗上下文依赖，/runtimes 弹窗与 /sessions 新页面均可独立 import 组装。
 */

import { RefreshCw, Send } from "lucide-react";

import { Button } from "@/components/ui/button";

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
}

export function SessionInputBar({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  creating,
}: SessionInputBarProps) {
  return (
    <footer className="shrink-0 border-t bg-card px-5 py-4">
      <div className="flex items-end gap-3">
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
          disabled={disabled || !value.trim()}
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
