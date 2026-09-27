/**
 * PageHead —— primer 页头（2026-09-26-core-pages-visual-redesign FR-01）。
 *
 * GitHub 页头范式：面包屑 → 标题（20px/600）+副标题 → 右侧操作组，
 * 承载五页面重排后的第一层结构（对照原型 prototype-github-redesign.html）。
 */
import * as React from "react";

export interface PageHeadProps {
  /** 面包屑节点（可选，调用方自带斜杠分隔灰字链接）。 */
  breadcrumb?: React.ReactNode;
  /** 页面标题。 */
  title: React.ReactNode;
  /** 标题右侧补充（如状态 StateLabel，可选）。 */
  titleExtra?: React.ReactNode;
  /** 副标题灰字（可选）。 */
  subtitle?: React.ReactNode;
  /** 右侧操作组插槽。 */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHead({
  breadcrumb,
  title,
  titleExtra,
  subtitle,
  actions,
  className,
}: PageHeadProps) {
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      {breadcrumb ? (
        <nav className="text-xs text-muted-foreground" aria-label="面包屑">
          {breadcrumb}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h1 className="truncate text-xl font-semibold leading-7">{title}</h1>
          {titleExtra}
        </div>
        {actions ? (
          <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {subtitle ? (
        <div className="text-xs leading-5 text-muted-foreground">{subtitle}</div>
      ) : null}
    </div>
  );
}
