import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SearchBar — 横向筛选容器。
 *
 * 基础类:`flex flex-wrap items-center gap-2`。内部不强制 Form,允许调用方
 * 塞 antd `Form layout="inline"` 或裸输入控件。
 *
 * 配套 `SearchBarActions` 子组件:右侧对齐区(`ml-auto`)。
 *
 * 设计依据:tasks/task-07.md §5。
 */
export interface SearchBarProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export const SearchBar = React.forwardRef<HTMLDivElement, SearchBarProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    >
      {children}
    </div>
  ),
);
SearchBar.displayName = "SearchBar";

export interface SearchBarActionsProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

/** SearchBar 内的右侧对齐区(`ml-auto`)。 */
export const SearchBarActions = React.forwardRef<
  HTMLDivElement,
  SearchBarActionsProps
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("ml-auto flex items-center gap-2", className)}
    {...props}
  >
    {children}
  </div>
));
SearchBarActions.displayName = "SearchBarActions";
