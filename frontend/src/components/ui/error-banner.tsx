import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorBannerProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** 错误文案（必填，逐字展示）。 */
  message: string;
  /** 可选重试回调：传入时右侧内嵌「重试」按钮（shadcn Button size=sm variant=outline）。 */
  onRetry?: () => void;
}

/**
 * ErrorBanner：统一错误提示条（纯展示组件，onRetry 为透传回调，由 client 页面引用）。
 *
 * 设计依据：2026-08-20-workspace-subpages-style-unify design.md §5 项1 / D-301
 * （公共件先行，收敛 8 处手写硬编码红条为 destructive 语义 token 统一规格，
 * 双主题自动跟随）。容器 role="alert" 为无障碍语义，且 explorer-page.test.tsx 与
 * shared-daemon-manager.test.tsx 均有 getByRole("alert") 断言，不可移除。
 */
export function ErrorBanner({
  className,
  message,
  onRetry,
  ...props
}: ErrorBannerProps): JSX.Element {
  return (
    <div
      {...props}
      role="alert"
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive",
        className,
      )}
    >
      <span className="min-w-0 flex-1 break-all">{message}</span>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry} className="shrink-0">
          重试
        </Button>
      ) : null}
    </div>
  );
}
