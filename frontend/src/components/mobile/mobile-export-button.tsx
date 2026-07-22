"use client";

import { Download } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * MobileExportButton — 导出 Excel 入口（design §5.5 / D-008）。
 *
 * - 放进 MobileCardList 的 headerActions（与「新建」并列）。
 * - 纯 UI：导出请求由页面 onClick 发起（D-003 数据层复用，不自写请求）。
 * - 触摸 ≥ 44×44px、正文 ≥ 14px（R-04）。不复用桌面组件（D-001 桌面零回归）。
 */
export interface MobileExportButtonProps {
  /** 点击导出回调（页面实现，通常触发 lib/* 的导出函数）。 */
  onClick: () => void;
  /** 导出进行中：按钮 disabled + 文案「导出中…」。 */
  loading?: boolean;
  /** 文案，默认「导出」。 */
  label?: string;
  /** 可选额外的 className（如父层定位微调）。 */
  className?: string;
}

export function MobileExportButton({
  onClick,
  loading = false,
  label = "导出",
  className,
}: MobileExportButtonProps) {
  return (
    <button
      type="button"
      data-testid="mobile-export-button"
      onClick={onClick}
      disabled={loading}
      aria-label={label}
      className={cn(
        "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card px-3 text-[14px] text-foreground transition-colors hover:bg-muted",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <Download className="h-4 w-4" aria-hidden />
      {loading ? "导出中…" : label}
    </button>
  );
}
