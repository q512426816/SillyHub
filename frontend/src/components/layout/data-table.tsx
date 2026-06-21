import * as React from "react";
import { Table, type TableProps } from "antd";

import { cn } from "@/lib/utils";

/**
 * DataTable — antd Table 的样式/locale 包装层。
 *
 * D-006 业务组件边界:**不改 antd Table API**,只补默认 emptyText 和外层
 * overflow 包装。columns/dataSource/pagination/render 全部透传,分页行为由
 * 调用方通过 pagination prop 控制(headerBg 由 task-03 token 控制,不在此覆盖)。
 *
 * 设计依据:tasks/task-07.md §4。
 */
export interface DataTableProps<T> extends TableProps<T> {
  /** 空态文案,默认 "暂无数据"。 */
  emptyText?: string;
  className?: string;
}

/**
 * 泛型函数组件(antd 6 TableProps 类型较严,参考 ppm-resource-table.tsx
 * 的泛型组件写法,避免 forwardRef 泛型穿透问题)。
 */
export function DataTable<T extends object>({
  emptyText = "暂无数据",
  className,
  locale,
  ...rest
}: DataTableProps<T>): React.ReactElement {
  return (
    <div className={cn("overflow-hidden", className)}>
      <Table<T>
        {...rest}
        locale={{ emptyText, ...locale }}
      />
    </div>
  );
}
