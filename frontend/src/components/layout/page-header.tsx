import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * PageHeader — 页面标题头。
 *
 * 替代各页面重复的 `<header><h1>{title}</h1><p className="text-muted-foreground">{subtitle}</p></header>`。
 * 结构:`header(flex justify-between) > div(h1 + subtitle) + actions slot`。
 *
 * 设计依据:tasks/task-07.md §2。
 */
export interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** 主标题(h1,text-2xl font-semibold tracking-tight)。 */
  title: React.ReactNode;
  /** 副标题(text-xs text-muted-foreground)。 */
  subtitle?: React.ReactNode;
  /** 右侧操作区 slot。 */
  actions?: React.ReactNode;
}

export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  ({ title, subtitle, actions, className, ...props }, ref) => (
    <header
      ref={ref}
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  ),
);
PageHeader.displayName = "PageHeader";
