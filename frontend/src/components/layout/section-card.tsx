import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SectionCard — 内容分区卡片。
 *
 * 替代零散的 `<div className="rounded border bg-card p-3">`(无 shadow、无 hover)。
 * 基础类:`bg-card border rounded-lg shadow-sm`(rounded-lg 对齐 task-03 `--radius-lg` token)。
 * 复用 task-05 Card 视觉变体的颜色/border 风格,不重新定义颜色 token。
 *
 * 可选 title/extra header(title 左,extra 右),bodyPadding 默认 p-4。
 * hover="lift" 时追加 `transition hover:shadow-md hover:-translate-y-0.5`
 * (默认 none,避免列表抖动)。
 *
 * 设计依据:tasks/task-07.md §3。
 */
export type SectionCardHover = "none" | "lift";

export interface SectionCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** 卡片标题(头部左侧)。 */
  title?: React.ReactNode;
  /** 标题右侧 slot(操作按钮/计数等)。 */
  extra?: React.ReactNode;
  /** 正文 padding,默认 p-4;可传 p-0/p-2/p-4/p-5/p-8(表格/列表类用 p-0)。 */
  bodyPadding?: "p-0" | "p-2" | "p-4" | "p-5" | "p-8";
  /** 悬浮效果,默认 none。lift 追加阴影/位移过渡。 */
  hover?: SectionCardHover;
  children?: React.ReactNode;
}

export const SectionCard = React.forwardRef<HTMLDivElement, SectionCardProps>(
  (
    {
      title,
      extra,
      bodyPadding = "p-4",
      hover = "none",
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const hasHeader = title !== undefined || extra !== undefined;
    return (
      <div
        ref={ref}
        className={cn(
          "bg-card border rounded-lg shadow-sm",
          hover === "lift" &&
            "transition hover:shadow-md hover:-translate-y-0.5",
          className,
        )}
        {...props}
      >
        {hasHeader && (
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <div className="text-sm font-medium">{title}</div>
            {extra !== undefined && <div className="flex gap-2">{extra}</div>}
          </div>
        )}
        <div className={bodyPadding}>{children}</div>
      </div>
    );
  },
);
SectionCard.displayName = "SectionCard";
