"use client";

/**
 * MinimizedDialogCapsule：最小化待决策卡片的右下角浮动胶囊。
 *
 * 最初为 2026-08-24-platform-session-feedback-fix task-08（FR-04 / D-003@v1）在
 * SessionPermissionPanel 内实现；ql-20260825-006 抽为共享组件，供两处复用：
 *   - SessionPermissionPanel（approvals 聚合页，AskUser 提问 + 工具审批混排）；
 *   - TurnTimeline（会话页 pending 提问卡，page / dialog 两模式同构）。
 *
 * 行为契约（与原 panel 内实现逐 DOM 等价，既有 session-permission-minimize
 * 测试直接覆盖本组件经 panel 的渲染）：
 *   - 主体点击 → 还原 items 末位（最近一条最小化的卡）；
 *   - 右侧 chevron → 展开明细列表，逐条定点还原；
 *   - 角标 = items.length；items 为空时整体不渲染。
 * 展开态（open）组件内部自持，不外泄。
 *
 * 主题合规（对齐 design 总纲）：brand-* 语义阶（浅/深主题都可读）+ shadow-lg +
 * bg-card/border 变量类；图标语义色仅 HelpCircle/ShieldAlert 的类型区分。
 */

import { useState } from "react";
import {
  ChevronUp,
  HelpCircle,
  MessageCircleQuestion,
  ShieldAlert,
} from "lucide-react";

import type { SessionPermissionRequest } from "@/lib/daemon";

/** 胶囊明细条目：requestId + 展示标题 + 卡片类型（图标区分）。 */
export interface MinimizedCapsuleItem {
  requestId: string;
  /** 胶囊标题（提问问题文本 / 工具审批名）。 */
  title: string;
  /** true=AskUser 提问卡（问号图标）；false=工具审批卡（盾牌图标）。 */
  isDialog: boolean;
}

export interface MinimizedDialogCapsuleProps {
  /** 最小化中的卡（顺序即最小化先后，末位 = 最近一条）。空数组不渲染。 */
  items: MinimizedCapsuleItem[];
  /** 点击还原（主体 = 最近一条；明细列表 = 指定条）时回调。 */
  onRestore: (requestId: string) => void;
}

/**
 * 胶囊标题推导（原 panel 内 resolvePendingTitle，随组件迁出）——dialog 卡取
 * 第一个非空问题文本，普通审批卡取 tool_name。纯函数便于测试。
 */
export function resolvePendingTitle(req: SessionPermissionRequest): string {
  if (req.dialog_kind) {
    const raw = req.dialog_payload?.questions;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const question = (item as { question?: unknown } | null)?.question;
        if (typeof question === "string" && question.trim()) {
          return question.trim();
        }
      }
    }
    return "智能体提问";
  }
  return `工具审批：${req.tool_name}`;
}

export function MinimizedDialogCapsule({
  items,
  onRestore,
}: MinimizedDialogCapsuleProps) {
  const [open, setOpen] = useState(false);
  const latest = items[items.length - 1];
  if (!latest) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
      role="group"
      aria-label="最小化的待决策卡片"
      data-minimized-capsule
    >
      {open && (
        <ul className="w-64 overflow-hidden rounded-md border bg-card shadow-lg">
          {items.map((item) => (
            <li key={item.requestId} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => onRestore(item.requestId)}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-muted"
                aria-label={`还原 ${item.title}`}
              >
                {item.isDialog ? (
                  <HelpCircle className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                )}
                <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                  {item.title}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {item.requestId.slice(0, 12)}
                </span>
                <span className="shrink-0 text-[11px] font-medium text-brand-600">
                  还原
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex max-w-72 items-center gap-1.5 rounded-full border bg-card py-1.5 pl-3 pr-1.5 shadow-lg">
        <MessageCircleQuestion className="h-4 w-4 shrink-0 text-brand-600" />
        <button
          type="button"
          onClick={() => onRestore(latest.requestId)}
          className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-foreground hover:underline"
          title="点击还原该卡片（最近一条）"
        >
          {latest.title}
        </button>
        <span
          aria-hidden
          data-capsule-count={items.length}
          className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold tabular-nums text-brand-50"
        >
          {items.length}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={open ? "收起最小化列表" : "展开最小化列表"}
        >
          <ChevronUp
            className={`h-3.5 w-3.5 transition-transform${open ? "" : " rotate-180"}`}
          />
        </button>
      </div>
    </div>
  );
}
