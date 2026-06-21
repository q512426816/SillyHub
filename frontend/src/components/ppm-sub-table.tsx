"use client";

/**
 * PPM 通用主子表组件。
 *
 * 支撑 ppm 里程碑 / 计划节点模板等「主表 + 多级子表 / 行内批量编辑」场景
 * (对齐源 dept_project_front el-table type="expand" + NodeDetailForm)。
 *
 * 两种使用模式:
 *  (a) **展开行模式** — 主表 expandable.expandedRowRender 渲染内嵌子表
 *      (props.masterColumns + props.expandRender)。
 *  (b) **行内编辑模式** — 整表行内 Input/Form.Item 编辑 + 一键加多行
 *      (props.editable=true + props.columns + props.onChange)。
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/tasks/task-02.md
 *          /design.md §7
 * 复用风格:frontend/src/components/ppm-resource-table.tsx (AntD Table + shadcn Button)
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Button as AntButton,
  Form,
  Input,
  InputNumber,
  Select,
  Table,
  type TableColumnsType,
  type TableProps,
} from "antd";

import { Button } from "@/components/ui/button";

// ── 通用类型 ────────────────────────────────────────────────────────────

/**
 * 行数据需带稳定主键 `id`。
 *
 * 不强制 index signature:业务模型(PsPlanNode / PlanNodeModule 等)通常为
 * 精确接口,加 index signature 会污染类型。组件内部需要动态字段访问处
 * 已显式断言为 `Record<string, unknown>`,因此仅要求 `id` 即可。
 */
export interface PpmSubTableRow {
  id: string;
}

/** 列内编辑控件的种类。 */
export type PpmSubEditType = "text" | "number" | "select" | "textarea";

/** select 选项。 */
export interface PpmSubOption {
  label: string;
  value: string;
}

/** 可编辑列定义(行内编辑模式用)。 */
export interface PpmSubEditableColumn<T extends PpmSubTableRow> {
  /** 字段名(对应 row 的 key)。 */
  name: keyof T & string;
  /** 中文列标题。 */
  label: string;
  /** 编辑控件种类,默认 text。 */
  editType?: PpmSubEditType;
  /** select 选项。 */
  options?: PpmSubOption[];
  /** 是否必填。 */
  required?: boolean;
  /** 占位符。 */
  placeholder?: string;
  /** 列宽。 */
  width?: number | string;
  /** 只读列(展示但不参与编辑)。 */
  readOnly?: boolean;
  /** 自定义展示渲染(非编辑态)。 */
  render?: (value: unknown, row: T) => ReactNode;
}

/** 主表列定义(展开行模式用),透传 AntD 列。 */
export type PpmSubMasterColumns<T extends PpmSubTableRow> = TableColumnsType<T>;

// ── Props ──────────────────────────────────────────────────────────────

export interface PpmSubTableProps<T extends PpmSubTableRow> {
  /** 主表行(展开行模式)或可编辑行(行内编辑模式)的数据源。 */
  masterRows: T[];
  /** 主表行唯一键取值器(默认 row.id)。 */
  rowKey?: (row: T) => string;
  /** 表格标题(可选)。 */
  title?: string;

  // ── 模式 (a) 展开行 ──
  /**
   * 主表列(展开行模式必填)。若不提供则按 editable columns 生成只读列。
   */
  masterColumns?: PpmSubMasterColumns<T>;
  /**
   * 展开行渲染函数(展开行模式)。返回的 ReactNode 嵌入展开区。
   * 常见用法:再嵌一个 PpmSubTable 或子业务表格。
   */
  expandRender?: (row: T) => ReactNode;
  /** 展开图标触发的字段(仅语义标记,实际由 AntD expandable 控制)。 */
  expandableTriggerField?: keyof T & string;

  // ── 模式 (b) 行内编辑 ──
  /** 是否启用整表行内编辑模式(默认 false)。 */
  editable?: boolean;
  /** 行内编辑列定义(行内编辑模式必填)。 */
  columns?: PpmSubEditableColumn<T>[];
  /** 行内编辑数据变更回调(受控)。 */
  onChange?: (rows: T[]) => void;
  /** 新增空行的工厂(行内编辑模式"一键加多行")。 */
  newRowFactory?: () => T;
  /** 是否允许新增/删除行(默认 true)。 */
  canAddRemove?: boolean;

  /** 额外 AntD Table 属性透传(分页 / loading / size 等)。 */
  tableProps?: Partial<TableProps<T>>;
}

// ── 主组件 ─────────────────────────────────────────────────────────────

export function PpmSubTable<T extends PpmSubTableRow>(
  props: PpmSubTableProps<T>,
) {
  const {
    masterRows,
    rowKey = (r: T) => r.id,
    title,
    masterColumns,
    expandRender,
    expandableTriggerField,
    editable = false,
    columns,
    onChange,
    newRowFactory,
    canAddRemove = true,
    tableProps,
  } = props;

  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  // ── 展开行模式 ──
  const expandable = useMemo(() => {
    if (!expandRender) return undefined;
    return {
      expandedRowRender: (record: T) => expandRender(record),
      rowExpandable: () => true,
      // expandableTriggerField 仅语义提示,默认所有行可展开
      columnTitle: expandableTriggerField ? "展开" : undefined,
    };
  }, [expandRender, expandableTriggerField]);

  // ── 列构建 ──
  const tableColumns = useMemo<TableColumnsType<T>>(() => {
    // 展开行模式:优先用外部传入的 masterColumns
    if (masterColumns && masterColumns.length > 0) {
      return masterColumns;
    }
    // 行内编辑模式:按 columns 生成
    if (!columns) return [];

    return columns.map((col) => ({
      title: col.label,
      dataIndex: col.name as string,
      key: col.name as string,
      width: col.width,
      render: editable && !col.readOnly
        ? undefined // 编辑态由 components 注入 Form.Item 渲染
        : (value: unknown, row: T) => {
            if (col.render) return col.render(value, row);
            if (col.editType === "select") {
              const hit = (col.options ?? []).find((o) => o.value === String(value ?? ""));
              if (hit) return hit.label;
            }
            if (value === null || value === undefined || value === "") {
              return <span className="text-xs text-muted-foreground">—</span>;
            }
            return String(value);
          },
    }));
  }, [masterColumns, columns, editable]);

  // ── 行内编辑模式:Form 包装 ──
  if (editable && columns) {
    return (
      <EditableSubTable<T>
        title={title}
        rows={masterRows}
        rowKey={rowKey}
        columns={columns}
        onChange={onChange}
        newRowFactory={newRowFactory}
        canAddRemove={canAddRemove}
        tableColumns={tableColumns}
        tableProps={tableProps}
      />
    );
  }

  // ── 展开行模式 ──
  return (
    <div className="flex flex-col gap-2">
      {title && (
        <div className="text-sm font-medium text-foreground">{title}</div>
      )}
      <Table<T>
        rowKey={rowKey}
        columns={tableColumns}
        dataSource={masterRows}
        size="small"
        scroll={{ x: "max-content" }}
        expandable={expandable}
        expandedRowKeys={expandedKeys}
        onExpandedRowsChange={setExpandedKeys}
        {...tableProps}
      />
    </div>
  );
}

// ── 行内编辑子表(整表受控 Form) ───────────────────────────────────────

interface EditableSubTableProps<T extends PpmSubTableRow> {
  title?: string;
  rows: T[];
  rowKey: (row: T) => string;
  columns: PpmSubEditableColumn<T>[];
  onChange?: (rows: T[]) => void;
  newRowFactory?: () => T;
  canAddRemove: boolean;
  tableColumns: TableColumnsType<T>;
  tableProps?: Partial<TableProps<T>>;
}

function EditableSubTable<T extends PpmSubTableRow>(
  props: EditableSubTableProps<T>,
) {
  const {
    title,
    rows,
    rowKey,
    columns,
    onChange,
    newRowFactory,
    canAddRemove,
    tableColumns,
    tableProps,
  } = props;

  const [form] = Form.useForm();

  // 把整张表数据塞进 Form,字段名 = name__rowId
  const formValues = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const row of rows) {
      const key = rowKey(row);
      for (const col of columns) {
        values[`${col.name}__${key}`] = (row as Record<string, unknown>)[col.name] ?? "";
      }
    }
    return values;
  }, [rows, columns, rowKey]);

  const emitChange = useCallback(
    (next: T[]) => {
      onChange?.(next);
    },
    [onChange],
  );

  // 单字段变更 → 同步回 rows
  const handleFieldChange = useCallback(
    (fieldName: string, key: string, value: unknown) => {
      const next = rows.map((row) => {
        if (rowKey(row) !== key) return row;
        const colName = fieldName.replace(/__.*$/, "") as keyof T & string;
        return { ...row, [colName]: value ?? null } as T;
      });
      emitChange(next);
    },
    [rows, rowKey, emitChange],
  );

  const handleAddRow = useCallback(() => {
    if (!newRowFactory) return;
    emitChange([...rows, newRowFactory()]);
  }, [rows, newRowFactory, emitChange]);

  const handleRemoveRow = useCallback(
    (key: string) => {
      emitChange(rows.filter((row) => rowKey(row) !== key));
    },
    [rows, rowKey, emitChange],
  );

  // 注入 components,让每个可编辑单元变成 Form.Item + Input
  const mergedColumns: TableColumnsType<T> = useMemo(() => {
    const result: TableColumnsType<T> = (tableColumns ?? []).map((col) => {
      const colDef = columns.find((c) => c.name === (col as { dataIndex?: string }).dataIndex);
      if (!colDef || colDef.readOnly) return col;
      return {
        ...col,
        // 通过自定义 components 渲染 Form.Item
        onCell: (row: T) => ({
          // 用 record + colDef 闭包渲染编辑控件
          record: row,
          colDef,
          handleFieldChange,
          rowKey,
        } as unknown as Record<string, unknown>),
      };
    });
    if (canAddRemove) {
      result.push({
        title: "操作",
        key: "__sub_actions",
        fixed: "right",
        width: 80,
        render: (_v: unknown, row: T) => (
          <AntButton
            type="link"
            size="small"
            danger
            onClick={() => handleRemoveRow(rowKey(row))}
          >
            删除
          </AntButton>
        ),
      });
    }
    return result;
  }, [tableColumns, columns, canAddRemove, handleRemoveRow, handleFieldChange, rowKey]);

  // 自定义 components:把 onCell 注入的 props 透传给可编辑单元格
  const components = {
    body: {
      cell: ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
        const colDef = rest.colDef as PpmSubEditableColumn<T> | undefined;
        const record = rest.record as T | undefined;
        const handleFieldChangeFn = rest.handleFieldChange as
          | ((name: string, key: string, value: unknown) => void)
          | undefined;
        const rowKeyFn = rest.rowKey as ((row: T) => string) | undefined;

        // 非可编辑列(无 colDef): 直接渲染 children
        if (!colDef || !record || !handleFieldChangeFn || !rowKeyFn) {
          return <td>{children}</td>;
        }

        const key = rowKeyFn(record);
        const fieldName = `${colDef.name}__${key}`;
        const value = (record as Record<string, unknown>)[colDef.name];

        let control: ReactNode;
        if (colDef.editType === "select") {
          control = (
            <Select
              size="small"
              value={value === null || value === undefined ? undefined : String(value)}
              placeholder={colDef.placeholder ?? `请选择${colDef.label}`}
              options={colDef.options ?? []}
              allowClear
              style={{ width: "100%" }}
              onChange={(v) => handleFieldChangeFn(colDef.name, key, v ?? null)}
            />
          );
        } else if (colDef.editType === "number") {
          control = (
            <InputNumber
              size="small"
              value={value === null || value === undefined ? undefined : Number(value)}
              placeholder={colDef.placeholder}
              style={{ width: "100%" }}
              onChange={(v) => handleFieldChangeFn(colDef.name, key, v ?? null)}
            />
          );
        } else if (colDef.editType === "textarea") {
          control = (
            <Input.TextArea
              size="small"
              autoSize={{ minRows: 1, maxRows: 3 }}
              value={value === null || value === undefined ? "" : String(value)}
              placeholder={colDef.placeholder}
              onChange={(e) =>
                handleFieldChangeFn(colDef.name, key, e.target.value || null)
              }
            />
          );
        } else {
          control = (
            <Input
              size="small"
              value={value === null || value === undefined ? "" : String(value)}
              placeholder={colDef.placeholder}
              onChange={(e) =>
                handleFieldChangeFn(colDef.name, key, e.target.value || null)
              }
            />
          );
        }

        return <td>{control}</td>;
      },
    },
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        {title && (
          <div className="text-sm font-medium text-foreground">{title}</div>
        )}
        {canAddRemove && newRowFactory && (
          <Button size="sm" variant="outline" onClick={handleAddRow}>
            + 新增行
          </Button>
        )}
      </div>
      <Form form={form} component={false} initialValues={formValues}>
        <Table<T>
          rowKey={rowKey}
          columns={mergedColumns}
          dataSource={rows}
          components={components}
          size="small"
          scroll={{ x: "max-content" }}
          pagination={false}
          {...tableProps}
        />
      </Form>
    </div>
  );
}
