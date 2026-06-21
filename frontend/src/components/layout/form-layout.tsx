import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * FormLayout — 表单字段栅格容器。
 *
 * 基础类:`grid gap-4` + `grid-cols-1`(columns=1,默认)或 `sm:grid-cols-2`(columns=2)。
 * 内部不渲染 antd Form,只提供栅格;调用方在外层用 antd `Form` 包。
 *
 * 设计依据:tasks/task-07.md §6。
 */
export interface FormLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 列数,默认 1。 */
  columns?: 1 | 2;
  children?: React.ReactNode;
}

export const FormLayout = React.forwardRef<HTMLDivElement, FormLayoutProps>(
  ({ columns = 1, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("grid gap-4 grid-cols-1", columns === 2 && "sm:grid-cols-2", className)}
      {...props}
    >
      {children}
    </div>
  ),
);
FormLayout.displayName = "FormLayout";
