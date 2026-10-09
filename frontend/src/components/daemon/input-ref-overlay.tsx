"use client";

/**
 * 输入区引用镜像高亮层（2026-10-09-attachment-inline-reference task-02，FR-03，
 * D-001@v1）。
 *
 * textarea 保持纯文本持有 token（输入/IME/退格/联想零回归）；本层以同版式参数
 * 铺在 textarea 之下渲染 token 位置的品牌色背景块 + 右上角 × 角标：
 * - 层容器 absolute inset-0、pointer-events:none、z-index 不设（auto——不创建
 *   stacking context），宿主 textarea 加 relative z-10 → 背景块压在文字下方；
 * - × 角标独立小元素 pointer-events:auto + z-20，越过 textarea 接收点击（删除
 *   该处一次出现，D-004）；角标容器（token span）不得带 opacity/transform 等
 *   context 触发器，否则 z-20 困在层内失效；
 * - 版式对齐（R-01）：overlayClassName 传与 textarea 完全相同的字体/行高/
 *   padding/宽度 class，overlayStyle 透传高度拖拽同步值；本层自带
 *   whitespace-pre-wrap break-words 对齐 textarea 软换行。
 * - tokens 为空返回 null（零视觉/行为回归，兼容策略）。
 */

import { useMemo } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

interface InputRefOverlayProps {
  /** 输入框当前值（受控，与 textarea 同源）。 */
  value: string;
  /** 需高亮的编辑态 token 文本集（attTokenMap 值集）。 */
  tokens: string[];
  /** × 角标点击：从 value 中移除该 token 一次出现（由宿主执行并 onChange）。 */
  onRemoveToken: (token: string) => void;
  /** 与 textarea 完全一致的版式 class（字体/行高/padding/宽度）。 */
  overlayClassName?: string;
  /** 高度拖拽等受控样式同步（与 textarea style 同值）。 */
  overlayStyle?: React.CSSProperties;
}

/** 正则元字符转义（文件名可含 ()[] 等）。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface OverlayPart {
  text: string;
  /** 是否 token 段（渲染背景块与角标）。 */
  token: boolean;
}

/** 按 token 出现位置拆分 value（长 token 优先匹配，防部分重叠误拆）。 */
function splitByTokens(value: string, tokens: string[]): OverlayPart[] {
  const valid = tokens.filter((t) => t.length > 0);
  if (valid.length === 0) return [{ text: value, token: false }];
  const re = new RegExp(
    valid.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|"),
    "g",
  );
  const parts: OverlayPart[] = [];
  let last = 0;
  for (const m of value.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ text: value.slice(last, idx), token: false });
    parts.push({ text: m[0], token: true });
    last = idx + m[0].length;
  }
  if (last < value.length) parts.push({ text: value.slice(last), token: false });
  return parts;
}

export function InputRefOverlay({
  value,
  tokens,
  onRemoveToken,
  overlayClassName,
  overlayStyle,
}: InputRefOverlayProps) {
  const parts = useMemo(() => splitByTokens(value, tokens), [value, tokens]);
  if (tokens.length === 0) return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words",
        overlayClassName,
      )}
      style={overlayStyle}
    >
      {parts.map((p, i) =>
        p.token ? (
          <span key={i} className="relative mx-px rounded bg-brand-500/15 dark:bg-brand-400/20">
            {/* 占位文本撑出背景块宽度（透明，不与 textarea 文字叠加重影）。 */}
            <span aria-hidden className="text-transparent">
              {p.text}
            </span>
            <button
              type="button"
              aria-label={`移除引用 ${p.text.replace(/^【|】$/g, "")}`}
              title={`移除引用 ${p.text.replace(/^【|】$/g, "")}`}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemoveToken(p.text);
              }}
              className="pointer-events-auto absolute -right-1.5 -top-1 z-20 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <X aria-hidden className="h-2.5 w-2.5" />
            </button>
          </span>
        ) : (
          <span key={i} aria-hidden className="text-transparent">
            {p.text}
          </span>
        ),
      )}
    </div>
  );
}
