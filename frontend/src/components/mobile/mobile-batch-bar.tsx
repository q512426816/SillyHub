"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * MobileBatchBar — selectable 模式底部批量栏（design §5.5 / D-008）。
 *
 * - 固定底部（fixed inset-x-0 bottom-0），z-50 盖在 MobileTabBar(z-40) 之上：
 *   批量选择模式下视觉替代主导航，符合移动端选择态惯例。
 * - 居中 max-w-[480px]，与 MobileAppShell 容器对齐。
 * - 左侧「已选 N 项」，右侧「删除」（danger）+ 可选扩展动作。
 * - 纯 UI：删除/取消由页面回调传入，数据由 MobileCardList 的 onSelectedKeysChange 维护。
 * - 触摸 ≥ 44×44px、正文 ≥ 14px（R-04）。不复用桌面组件（D-001 桌面零回归）。
 */
export interface MobileBatchBarProps {
  /** 当前选中条数（来自 selectedKeys.length）。 */
  selectedCount: number;
  /** 批量删除回调。不传则不渲染删除按钮（仅展示计数）。 */
  onDelete?: () => void;
  /** 删除按钮文案，默认「删除」。 */
  deleteLabel?: string;
  /** 可选：扩展批量动作（如批量导出），渲染在删除按钮左侧。 */
  extraActions?: ReactNode;
}

export function MobileBatchBar({
  selectedCount,
  onDelete,
  deleteLabel = "删除",
  extraActions,
}: MobileBatchBarProps) {
  return (
    <div
      data-testid="mobile-batch-bar"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-lg)]"
    >
      <div className="mx-auto flex w-full max-w-[480px] items-center gap-2 px-4 py-2">
        <span
          data-testid="mobile-batch-bar-count"
          className="flex-1 text-[14px] text-foreground"
        >
          已选 {selectedCount} 项
        </span>
        {extraActions}
        {onDelete && (
          <button
            type="button"
            data-testid="mobile-batch-bar-delete"
            onClick={onDelete}
            disabled={selectedCount === 0}
            className={cn(
              "inline-flex min-h-[44px] items-center rounded-[var(--radius-md)] px-4 text-[14px] font-medium transition-colors",
              "bg-destructive text-destructive-foreground hover:opacity-90",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            {deleteLabel}
          </button>
        )}
      </div>
    </div>
  );
}
