import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * PageContainer — 页面最外层统一容器。
 *
 * 收敛散落的 4 种 max-w 写法(max-w-7xl / max-w-[1400px] / max-w-5xl / max-w-[420px]),
 * 仅通过 `size` prop 在 narrow/default/full 三档切换。
 *
 * 基础类:`mx-auto flex flex-col gap-4 px-6 py-6`。
 *
 * 设计依据:tasks/task-07.md §1。
 */
export type PageContainerSize = "narrow" | "default" | "full";

const SIZE_MAX_W: Record<PageContainerSize, string> = {
  narrow: "max-w-[420px]",
  default: "max-w-[1400px]",
  full: "max-w-none",
};

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 容器最大宽度档位,默认 default(1400px)。 */
  size?: PageContainerSize;
  children?: React.ReactNode;
}

export const PageContainer = React.forwardRef<
  HTMLDivElement,
  PageContainerProps
>(({ size = "default", className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "mx-auto flex flex-col gap-4 px-6 py-6",
      SIZE_MAX_W[size],
      className,
    )}
    {...props}
  >
    {children}
  </div>
));
PageContainer.displayName = "PageContainer";
