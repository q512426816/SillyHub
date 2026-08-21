import * as React from "react";
import { Table, type TableProps } from "antd";

import { cn } from "@/lib/utils";
import { useResizableColumns } from "./use-resizable-columns";

/**
 * DataTable — antd Table 的样式/locale 包装层。
 *
 * D-006 业务组件边界:**不改 antd Table API**,只补默认 emptyText 和外层
 * overflow 包装。columns/dataSource/pagination/render 全部透传,分页行为由
 * 调用方通过 pagination prop 控制(headerBg 由 task-03 token 控制,不在此覆盖)。
 *
 * 设计依据:tasks/task-07.md §4。
 * 列宽拖拽(2026-08-21-table-column-resize design.md §5-2):columns 经
 * useResizableColumns 包装 + components.header.cell 透传 Table,消费页零改动
 * 获得拖拽;仅显式 number width 的列可拖,无 width/string width 列行为不变。
 */
export interface DataTableProps<T> extends TableProps<T> {
  /** 空态文案,默认 "暂无数据"。 */
  emptyText?: string;
  className?: string;
  /**
   * 列宽拖拽结束回调(design.md §5-2 / D-503):key=dataIndex??title 字符串,
   * 值为本次拖拽收尾时全部可拖列的最终宽度。页面可借此持久化列宽(如
   * localStorage,本轮不实现记忆);不传则纯本地拖拽,行为不变。
   */
  onColumnsResize?: (_widths: Record<string, number>) => void;
}

/**
 * 泛型函数组件(antd 6 TableProps 类型较严,参考 ppm-resource-table.tsx
 * 的泛型组件写法,避免 forwardRef 泛型穿透问题)。
 */
export function DataTable<T extends object>({
  emptyText = "暂无数据",
  className,
  locale,
  columns,
  components,
  onColumnsResize,
  ...rest
}: DataTableProps<T>): React.ReactElement {
  const { columns: wrappedColumns, components: resizeComponents } =
    useResizableColumns(columns, onColumnsResize);

  // R-01 防御式合并:消费方自传 components 时浅合并,header.cell 用拖拽版覆盖
  // (现状 13 个消费文件均不自传),body 等其余槽位保留消费方版本。
  const mergedComponents = React.useMemo(() => {
    if (!components) return resizeComponents;
    return {
      ...components,
      header: { ...components.header, cell: resizeComponents.header.cell },
    };
  }, [components, resizeComponents]);

  return (
    <div className={cn("sh-data-table overflow-hidden", className)}>
      <Table<T>
        {...rest}
        columns={wrappedColumns}
        components={mergedComponents}
        locale={{ emptyText, ...locale }}
      />
    </div>
  );
}
