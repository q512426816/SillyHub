"use client";

import * as React from "react";
import type { TableColumnType, TableProps } from "antd";

/**
 * useResizableColumns — antd Table 列宽拖拽 hook（antd 官方 demo 路线的零依赖手写版）。
 *
 * 机制（design.md §5-1 / §7，2026-08-21-table-column-resize）：
 * - 返回包装后的 columns（每列经 onHeaderCell 注入 `data-col-key`，width 替换为本地拖拽宽）
 *   + 自定义 `components.header.cell`（th 内渲染手柄 span，样式在 globals.css `.sh-resize-handle`）。
 * - 仅 `typeof width === "number"` 的列挂手柄（D-502@v2）；string width / 无 width / 分组表头 /
 *   无法派生稳定 key（dataIndex 与 title 均非字符串）的列渲染纯 th，行为不变。
 * - 手柄 mousedown 记录起点（pageX + 当前宽），document mousemove 移动超过 3px 阈值后激活拖拽
 *   （阈值内视为点击不算拖拽），实时更新本地 widths state 驱动列宽重渲染；mouseup 收尾聚合
 *   全部可拖列宽度回调 onColumnsResize（key = dataIndex ?? title 字符串，D-503 防列序漂移）。
 * - 拖拽期间 body 挂 `.sh-col-resizing`（禁文本选中 + col-resize 光标），结束移除；
 *   手柄 click 一律不冒泡到 th，拖拽/点击手柄都不会误触发表头排序（R-03）。
 *
 * 注：本文件按 taskcard allowed_paths 固定为 .ts（不可写 JSX），th/span 渲染用 React.createElement。
 */
export interface ResizableHeaderCellProps
  extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** hook 经 onHeaderCell 注入，用于把手柄关联回可拖列注册表条目。 */
  "data-col-key"?: string;
}

/** rc-table onHeaderCell 的返回值约束（`data-*` 不在其类型内，注入时需 as 附加）。 */
type HeaderCellDomProps = React.HTMLAttributes<HTMLElement> &
  React.TdHTMLAttributes<HTMLTableCellElement>;

/** 可拖列注册表条目（渲染期由 columns + widths 重建，闭包取到的是最新渲染值）。 */
interface ResizableColumnEntry {
  /** 当前生效宽度（本地拖拽宽 ?? 原始 width）。 */
  width: number;
  /** 手柄 mousedown 启动一次拖拽。 */
  startDrag: (_event: React.MouseEvent<HTMLSpanElement>) => void;
}

export interface UseResizableColumnsResult<T> {
  columns: TableProps<T>["columns"];
  components: {
    header: {
      cell: React.ComponentType<ResizableHeaderCellProps>;
    };
  };
}

/** 最小列宽（px），design.md §2-2。 */
const MIN_COLUMN_WIDTH = 60;
/** 移动阈值（px）：3px 内不算拖拽（design.md §5-1 / R-03）。 */
const DRAG_THRESHOLD_PX = 3;
/** 手柄类名（globals.css：右缘 7px 命中区，hover/拖中 brand-400 高亮）。 */
const RESIZE_HANDLE_CLASS = "sh-resize-handle";
/** 拖拽中挂在 body 上的类名（globals.css：禁文本选中 + col-resize 光标）。 */
const RESIZING_BODY_CLASS = "sh-col-resizing";

/** 列稳定 key：dataIndex（number 转字符串、数组 join "."）→ title 字符串兜底（D-503）。 */
function columnWidthKey<T extends object>(
  column: TableColumnType<T>,
): string | undefined {
  const dataIndex: unknown = column.dataIndex;
  if (typeof dataIndex === "string" || typeof dataIndex === "number") {
    return String(dataIndex);
  }
  if (
    Array.isArray(dataIndex) &&
    dataIndex.every(
      (key) => typeof key === "string" || typeof key === "number",
    )
  ) {
    return dataIndex.map(String).join(".");
  }
  if (typeof column.title === "string" && column.title !== "") {
    return column.title;
  }
  return undefined;
}

/**
 * 列宽拖拽 hook。传入 antd columns，返回可直接透传给 Table 的 columns 与
 * components；不传 onColumnsResize 时为纯本地拖拽，消费页零改动。
 */
export function useResizableColumns<T extends object>(
  columns: TableProps<T>["columns"],
  onColumnsResize?: (_widths: Record<string, number>) => void,
): UseResizableColumnsResult<T> {
  /** 本地宽度覆盖（colKey → width），setState 驱动 columns 重渲染。 */
  const [widths, setWidths] = React.useState<Record<string, number>>({});
  /** widths 的同步镜像：mouseup 聚合回调时不受 setState 异步批量影响。 */
  const widthsRef = React.useRef<Record<string, number>>({});
  /** 可拖列注册表：colKey → { width, startDrag }（渲染期随 columns/widths 重建）。 */
  const registryRef = React.useRef<Map<string, ResizableColumnEntry>>(new Map());
  /** 活跃拖拽的监听清理函数（卸载兜底用）。 */
  const teardownRef = React.useRef<(() => void) | null>(null);
  /** 回调走 ref：不因回调身份变化导致 components 重建。 */
  const onColumnsResizeRef = React.useRef(onColumnsResize);
  onColumnsResizeRef.current = onColumnsResize;

  /** 组件卸载时兜底：移除残留的 document 监听与 body 拖拽类。 */
  React.useEffect(() => {
    return () => {
      teardownRef.current?.();
      document.body.classList.remove(RESIZING_BODY_CLASS);
    };
  }, []);

  const makeStartDrag = React.useCallback(
    (colKey: string, startWidth: number) => {
      return (event: React.MouseEvent<HTMLSpanElement>) => {
        if (event.button !== 0) return;
        // 阻止原生文本选中/拖拽启动；手柄交互不向消费方 onHeaderCell 冒泡
        event.preventDefault();
        event.stopPropagation();
        const handleEl = event.currentTarget;
        const startX = event.pageX;
        let activated = false;

        const onMove = (ev: MouseEvent) => {
          const delta = ev.pageX - startX;
          if (!activated) {
            if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
            activated = true;
            document.body.classList.add(RESIZING_BODY_CLASS);
            handleEl.classList.add("active");
          }
          const nextWidth = Math.max(
            MIN_COLUMN_WIDTH,
            Math.round(startWidth + delta),
          );
          widthsRef.current = { ...widthsRef.current, [colKey]: nextWidth };
          setWidths(widthsRef.current);
        };

        const cleanup = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onMouseUp);
          teardownRef.current = null;
        };

        const onMouseUp = () => {
          cleanup();
          document.body.classList.remove(RESIZING_BODY_CLASS);
          handleEl.classList.remove("active");
          if (!activated) return;
          // 聚合当前全部可拖列宽度（本地拖拽宽优先，未拖过用注册表里的原始宽）
          const allWidths: Record<string, number> = {};
          registryRef.current.forEach((entry, key) => {
            allWidths[key] = widthsRef.current[key] ?? entry.width;
          });
          onColumnsResizeRef.current?.(allWidths);
        };

        teardownRef.current = cleanup;
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onMouseUp);
      };
    },
    [],
  );

  /** 包装 columns：替换 width 为本地拖拽宽、注入 data-col-key、合并消费方 onHeaderCell。 */
  const wrappedColumns = React.useMemo(() => {
    const registry = new Map<string, ResizableColumnEntry>();
    const next = (columns ?? []).map((column) => {
      // 分组表头（children）不挂手柄；空列透传
      if (!column || "children" in column) return column;
      const leaf = column as TableColumnType<T>;
      const colKey = columnWidthKey(leaf);
      // D-502@v2：仅 number width 且可派生稳定 key 的列可拖
      if (typeof leaf.width !== "number" || !colKey) return column;
      const effectiveWidth = widths[colKey] ?? leaf.width;
      const originalOnHeaderCell = leaf.onHeaderCell;
      registry.set(colKey, {
        width: effectiveWidth,
        startDrag: makeStartDrag(colKey, effectiveWidth),
      });
      const wrapped: TableColumnType<T> = {
        ...leaf,
        width: effectiveWidth,
        onHeaderCell: (data, index) => ({
          ...originalOnHeaderCell?.(data, index),
          "data-col-key": colKey,
        } as HeaderCellDomProps),
      };
      return wrapped;
    });
    registryRef.current = registry;
    return next;
  }, [columns, widths, makeStartDrag]);

  /** header.cell 组件只创建一次（闭包读 registryRef），components 身份稳定不触发 th 重挂载。 */
  const [headerCell] = React.useState(() => {
    const ResizableHeaderCell = (
      props: ResizableHeaderCellProps,
    ): React.ReactElement => {
      const { children, ...rest } = props;
      const colKey = props["data-col-key"];
      const entry = colKey
        ? registryRef.current.get(colKey)
        : undefined;
      // 非可拖列（无 number width / 分组表头）：渲染纯 th，不干预 antd 原行为
      if (!entry) {
        return React.createElement("th", rest, children);
      }
      return React.createElement(
        "th",
        rest,
        children,
        React.createElement("span", {
          className: RESIZE_HANDLE_CLASS,
          "data-col-key": colKey,
          onMouseDown: entry.startDrag,
          // 手柄 click 不冒泡到 th：拖拽/纯点击手柄均不触发 antd 排序（R-03）
          onClick: (event: React.MouseEvent<HTMLSpanElement>) => {
            event.preventDefault();
            event.stopPropagation();
          },
        }),
      );
    };
    ResizableHeaderCell.displayName = "ResizableHeaderCell";
    return ResizableHeaderCell;
  });

  const components = React.useMemo(
    () => ({ header: { cell: headerCell } }),
    [headerCell],
  );

  return { columns: wrappedColumns, components };
}
