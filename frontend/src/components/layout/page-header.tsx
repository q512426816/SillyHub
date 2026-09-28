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
      {/* 2026-09-28-change-detail-header-overflow：flex 项默认 min-width:auto，
          其内 nowrap 长文（如详情页描述行）的 min-content 会把本列撑破 header
          宽度并产生页面级横向滚动（生产实测 1861>1228）——min-w-0 放宽收缩
          下限，让子级 truncate/w-full 链路生效；正常宽度内容零视觉影响。 */}
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  ),
);
PageHeader.displayName = "PageHeader";
