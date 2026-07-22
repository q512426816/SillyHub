"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * 移动端简洁顶栏（design §5.2）。
 *
 * - 简洁：仅【可选返回箭头】+【可选标题】，不带桌面 TopBar 的面包屑 / 搜索 / 通知 /
 *   工作区切换器 / 用户菜单（移动端这些下沉到底部 Tab 与「我的」页）。
 * - 返回：传 `onBack` 时渲染返回箭头并调用之；未传则不渲染返回按钮（Tab 根页无需返回）。
 * - 标题：text-base（16px ≥ 14px，满足 R-04 正文下限），左对齐，truncate 防溢出。
 * - 触摸热区：返回按钮 min-h/min-w-[44px]（R-04）。顶栏整体 min-h-[44px]。
 * - 不复用 / 不改桌面 top-bar.tsx（D-001 独立移动 UI，桌面零回归）。
 */
export interface MobileTopBarProps {
  /** 顶栏标题（可选）。未传时顶栏仅作容器（背景 + 底分隔线）。 */
  title?: string;
  /** 传入则渲染返回箭头并以此作为返回回调；不传则不渲染返回按钮。 */
  onBack?: () => void;
}

export function MobileTopBar({ title, onBack }: MobileTopBarProps) {
  const router = useRouter();

  const handleBack = () => {
    if (typeof onBack === "function") {
      onBack();
      return;
    }
    router.back();
  };

  return (
    <header
      data-testid="mobile-top-bar"
      className="sticky top-0 z-30 flex min-h-[44px] shrink-0 items-center gap-1 border-b border-border bg-card px-1 pt-[env(safe-area-inset-top)] shadow-[var(--shadow-sm)]"
    >
      {onBack !== undefined && (
        <button
          type="button"
          onClick={handleBack}
          aria-label="返回"
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
      )}
      {title !== undefined && (
        <h1 className="min-w-0 flex-1 truncate px-1 text-base font-medium text-foreground">
          {title}
        </h1>
      )}
    </header>
  );
}
