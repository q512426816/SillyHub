/**
 * EmptyState —— primer 空态原语（2026-09-26-core-pages-visual-redesign FR-01 / FR-08）。
 *
 * 替代破碎的「—」占位表格空态：图标+标题+描述+可选 action 插槽，
 * 中文文案默认值，供列表页/门户空分支消费。
 */
import * as React from "react";

export interface EmptyStateProps {
  /** 标题（默认「暂无数据」）。 */
  title?: string;
  /** 描述一行（可选）。 */
  description?: string;
  /** 图标节点（可选，默认不渲染）。 */
  icon?: React.ReactNode;
  /** 操作区插槽（如「新建」按钮）。 */
  children?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title = "暂无数据",
  description,
  icon,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center ${className ?? ""}`}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="text-sm font-medium">{title}</div>
      {description ? (
        <div className="max-w-md text-xs leading-5 text-muted-foreground">
          {description}
        </div>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
