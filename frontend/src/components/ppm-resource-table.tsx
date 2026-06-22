"use client";

/**
 * PPM 通用 CRUD 表格组件。
 *
 * 给 ppm 4 个子域页面(项目维护 / 客户维护 / 项目成员 / 项目干系人)复用:
 *  - 顶部搜索栏(由 searchFields 配置驱动,Enter 触发)
 *  - AntD Table 列表 + 分页(后端直返 list[]，前端分页 + 排序)
 *  - 新增 / 编辑 Drawer Form(由 formFields 配置驱动)
 *  - 删除二次确认
 *  - 导出(可选,调 exportFn)
 *
 * 设计依据:.sillyspec/changes/2026-06-20-ppm-module-migration/tasks/task-10.md
 * 复用样板:frontend/src/app/(dashboard)/admin/users/page.tsx
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Form, Input, Select, Tag, type TableProps } from "antd";

import { Button } from "@/components/ui/button";
import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { ApiError } from "@/lib/api";

// ── 字段配置 ────────────────────────────────────────────────────────────

export type PpmFieldType =
  | "text"
  | "number"
  | "select"
  | "date"
  | "datetime"
  | "textarea";

export interface PpmFieldOption {
  label: string;
  value: string;
  /**
   * 列表 dict-tag 颜色(AntD Tag color,如 "blue"/"green"/"red"/"#f50")。
   * 对照源 vue dict-tag,select 字段在表格列里渲染带颜色的 Tag。
   */
  color?: string;
}

/**
 * 把 ISO 字符串格式化为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm。
 * 非 ISO / 已格式化字符串原样返回。空值返回 ""。
 */
function formatDate(value: unknown, withTime: boolean): string {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value);
  // 兼容已有 "YYYY-MM-DD HH:mm" / "YYYY-MM-DD" 文本
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  if (dateOnly) return withTime ? `${s} 00:00` : s;
  const full = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(s);
  if (full && full[1]) {
    return withTime ? `${full[1]} ${full[2] ?? "00:00"}` : full[1];
  }
  // 退化:截前 10/16 字符
  return withTime ? s.slice(0, 16) : s.slice(0, 10);
}

export interface PpmFieldDef<
  T,
  K extends keyof T & string = keyof T & string,
> {
  /** 字段名(对应 entity / form body 的 key) */
  name: K;
  /** 中文标签 */
  label: string;
  /** 字段类型 */
  type?: PpmFieldType;
  /** select 的可选项 */
  options?: PpmFieldOption[];
  /** 是否必填(默认 false) */
  required?: boolean;
  /** 占位提示 */
  placeholder?: string;
  /**
   * 编辑时只读(用于 code 这种创建后不可改字段)。
   */
  readOnlyOnEdit?: boolean;
  /** 默认值 */
  defaultValue?: T[K];
  /** 在 Table 列里隐藏(只用于表单,如外键/创建人) */
  hideInTable?: boolean;
  /** 在 Drawer Form 里隐藏(只用于列表,如创建人/时间) */
  hideInForm?: boolean;
  /** 自定义 Table 列宽 */
  width?: number | string;
  /** 自定义渲染(列表单元格) */
  render?: (value: unknown, row: T) => React.ReactNode;
  /**
   * 正则校验(Form.Item pattern,如 phone 11 位数字)。
   * 字符串会被转 RegExp;直接传 RegExp 亦可。
   */
  pattern?: string | RegExp;
  /** 校验失败提示(配合 pattern) */
  patternMessage?: string;
  /**
   * 异步加载选项(给 select 用,如 users/projects 下拉)。
   * 组件挂载时调用一次,结果塞进 options。
   */
  loadOptions?: () => Promise<PpmFieldOption[]>;
}

// ── 组件 Props ──────────────────────────────────────────────────────────

export interface PpmResourceTableProps<
  T extends { id: string },
  CreateBody,
  UpdateBody,
  Query = Record<string, unknown>,
> {
  /** 页面标题 */
  title: string;
  /** 副标题 */
  subtitle?: string;
  /** 实体中文名(用于 toast / 确认框),如 "项目" */
  entityLabel: string;
  /** 导出文件名(如设置 exportFn) */
  exportFilename?: string;
  /** 表格列字段定义(同时用于 Table + Form + Search) */
  fields: PpmFieldDef<T>[];
  /** 哪些字段出现在搜索栏(默认那些 type=text 的非外键字段),这里显式指定 name 列表 */
  searchFieldNames?: (keyof T & string)[];
  /** 实体唯一主键取值器(默认 row.id) */
  getRowId?: (row: T) => string;
  /** 实体"显示名"取值器(用于 toast / 删除确认描述) */
  getRowLabel?: (row: T) => string;
  /** 是否允许写入(隐藏新增/编辑/删除),默认 true */
  canWrite?: boolean;
  /**
   * 首列序号(跨页连续:page*pageSize+index+1)。默认 true。
   * 对照源 vue scope.$index + (pageNo-1)*pageSize + 1。
   */
  showIndex?: boolean;
  /**
   * 斑马纹(对照源 el-table :stripe="true")。默认 false。
   * customers 页源开启,P2-5 复刻。
   */
  striped?: boolean;
  /**
   * 后端真分页:默认 true。
   *  - true:list 必须返回 { items, total }(PpmPageResp 形态),Table total 接
   *    后端 total,page/pageSize 变化时调 list(params 含 page/page_size) 重拉。
   *  - false:list 返回 T[],前端切片(向后兼容老调用)。
   */
  serverSidePagination?: boolean;
  /**
   * 每行追加额外操作按钮(渲染在内置「编辑/删除」之前)。
   * 用于跨域入口,如 projects 行的「成员管理」按钮(W1 task-03)。
   */
  extraActions?: (row: T) => React.ReactNode;

  // ── API ──
  /**
   * 列表加载。
   *  - serverSidePagination=true 时返回 { items, total }(组件会注入 page/page_size)。
   *  - serverSidePagination=false 时返回 T[](全量,前端切片)。
   */
  list: (
    params?: Query,
  ) => Promise<T[] | PpmPageResp<T>>;
  create: (body: CreateBody) => Promise<T>;
  update: (id: string, body: UpdateBody) => Promise<T>;
  remove: (id: string) => Promise<void>;
  exportFn?: (params?: Query) => Promise<void>;

  /**
   * 把表单状态(扁平 Record)组装成 create body。默认直接强转。
   * 外键关系(如 pmProjectId)在这里补。
   */
  buildCreateBody?: (form: Partial<T>) => CreateBody;
  /** 把表单状态组装成 update body。默认去掉主键后强转。 */
  buildUpdateBody?: (form: Partial<T>) => UpdateBody;
  /** 把搜索栏状态组装成 query params。默认只挑 searchFieldNames 中非空字段。 */
  buildQuery?: (form: Partial<Record<keyof T & string, string>>) => Query;
}

/** 后端真分页响应信封(对应后端 Page[T]:{items,total,page,page_size})。 */
export interface PpmPageResp<T> {
  items: T[];
  total: number;
  page?: number;
  page_size?: number;
}

// 输入框样式走 shadcn 语义类(border-input/bg-background 基于 CSS 变量,
// 对齐 D-006@v1 边界,task-09 §ppm-resource-table)。非硬编码 hex。
const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";
const textareaCls =
  "min-h-[72px] w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm focus:border-ring focus:outline-none";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function PpmResourceTable<
  T extends { id: string },
  CreateBody,
  UpdateBody,
  Query = Record<string, unknown>,
>(props: PpmResourceTableProps<T, CreateBody, UpdateBody, Query>) {
  const {
    title,
    subtitle,
    entityLabel,
    exportFilename,
    fields,
    searchFieldNames,
    getRowId = (row) => row.id,
    getRowLabel = (row) => String(row.id),
    canWrite = true,
    showIndex = true,
    striped = false,
    serverSidePagination = true,
    list,
    create,
    update,
    remove,
    exportFn,
    extraActions,
    buildCreateBody,
    buildUpdateBody,
    buildQuery,
  } = props;

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [exporting, setExporting] = useState(false);

  // 搜索栏:输入框受控值 + 已触发查询值
  const searchFields = useMemo(
    () =>
      (searchFieldNames ?? []).map((name) => fields.find((f) => f.name === name)).filter(Boolean) as PpmFieldDef<T>[],
    [fields, searchFieldNames],
  );
  const [searchInput, setSearchInput] = useState<Record<string, string>>({});
  const [searchCommitted, setSearchCommitted] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [drawer, setDrawer] = useState<{
    open: boolean;
    mode: "create" | "edit";
    row?: T;
  }>({ open: false, mode: "create" });
  const [confirmDelete, setConfirmDelete] = useState<T | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  // 查询区展开/收起:超过 4 个字段时显示切换按钮(对齐 project-plans 风格)。
  const [expanded, setExpanded] = useState(false);

  // select 字段异步选项缓存
  const [asyncOptions, setAsyncOptions] = useState<Record<string, PpmFieldOption[]>>({});

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  };

  // 异步加载 select 选项(仅一次)
  useEffect(() => {
    for (const f of fields) {
      if (f.type === "select" && f.loadOptions && !asyncOptions[f.name as string]) {
        const loader = f.loadOptions;
        void (async () => {
          try {
            const opts = await loader();
            setAsyncOptions((prev) => ({ ...prev, [f.name as string]: opts }));
          } catch {
            // 静默,选项缺失时 select 会显示空
          }
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const baseQuery = (buildQuery
        ? buildQuery(searchCommitted as Partial<Record<keyof T & string, string>>)
        : (searchCommitted as unknown as Query)) as Query | undefined;
      // 真分页模式注入 page/page_size(覆盖调用方可能传的同名 key)。
      const query =
        serverSidePagination && baseQuery
          ? ({ ...(baseQuery as object), page, page_size: pageSize } as Query)
          : serverSidePagination
            ? ({ page, page_size: pageSize } as Query)
            : (baseQuery as Query | undefined);
      const result = await list(
        Object.keys(query ?? {}).length > 0 ? query : undefined,
      );
      if (serverSidePagination) {
        // 真分页:list 返回 {items,total} 或兼容性返回 T[]
        if (Array.isArray(result)) {
          setRows(result);
          setTotal(result.length);
        } else {
          setRows(result.items ?? []);
          setTotal(result.total ?? result.items?.length ?? 0);
        }
      } else {
        // 前端切片模式:list 返回 T[](也兼容误返回 {items})
        const arr = Array.isArray(result) ? result : (result.items ?? []);
        setRows(arr);
        setTotal(arr.length);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [list, buildQuery, searchCommitted, serverSidePagination, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSearchInput = (name: string, value: string) => {
    setSearchInput((prev) => ({ ...prev, [name]: value }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchCommitted((prev) => ({ ...prev, [name]: value }));
      setPage(1);
    }, 400);
  };

  const handleReset = () => {
    setSearchInput({});
    setSearchCommitted({});
    setPage(1);
  };

  // 顶部"搜索"按钮:把 searchInput 立刻 flush 到 searchCommitted(覆盖原 debounce)。
  const handleSearchCommit = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchCommitted({ ...searchInput });
    setPage(1);
  };

  const handleExport = async () => {
    if (!exportFn) return;
    setExporting(true);
    try {
      const query = (buildQuery
        ? buildQuery(searchCommitted as Partial<Record<keyof T & string, string>>)
        : (searchCommitted as unknown as Query)) as Query | undefined;
      await exportFn(Object.keys(query ?? {}).length > 0 ? query : undefined);
      showToast(true, "导出已开始");
    } catch (err) {
      showToast(false, err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleSubmit = async (form: Partial<T>) => {
    if (drawer.mode === "create") {
      const body = buildCreateBody
        ? buildCreateBody(form)
        : (form as unknown as CreateBody);
      const created = await create(body);
      showToast(true, `${entityLabel} ${getRowLabel(created)} 已创建`);
    } else if (drawer.row) {
      const body = buildUpdateBody
        ? buildUpdateBody(form)
        : (form as unknown as UpdateBody);
      const updated = await update(getRowId(drawer.row), body);
      showToast(true, `${entityLabel} ${getRowLabel(updated)} 已更新`);
    }
    setDrawer({ open: false, mode: "create" });
    await load();
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await remove(getRowId(target));
      showToast(true, `${entityLabel} ${getRowLabel(target)} 已删除`);
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  // ── Table 列 ──
  const columns: TableProps<T>["columns"] = useMemo(() => {
    const visible = fields.filter((f) => !f.hideInTable);
    const cols: NonNullable<TableProps<T>["columns"]> = [];
    // 首列序号(跨页连续):page*pageSize+index+1,对照源 scope.$index 计算。
    if (showIndex) {
      cols.push({
        title: "#",
        key: "__index",
        width: 56,
        fixed: "left",
        render: (_v: unknown, _row: T, index?: number) =>
          (page - 1) * pageSize + (index ?? 0) + 1,
      });
    }
    for (const f of visible) {
      cols.push({
        title: f.label,
        dataIndex: f.name as string,
        key: f.name as string,
        width: f.width,
        sorter: f.type === "number",
        render: (value: unknown, row: T) => {
          if (f.render) return f.render(value, row);
          // date/datetime 格式化
          if (f.type === "date" || f.type === "datetime") {
            const text = formatDate(value, f.type === "datetime");
            if (!text) {
              return <span className="text-xs text-muted-foreground">—</span>;
            }
            return text;
          }
          // select 渲染 dict-tag(带颜色);无 color 退化为纯文本
          if (f.type === "select") {
            const opts = asyncOptions[f.name] ?? f.options ?? [];
            const hit = opts.find((o) => o.value === String(value ?? ""));
            if (!hit) {
              if (value === null || value === undefined || value === "") {
                return <span className="text-xs text-muted-foreground">—</span>;
              }
              return String(value);
            }
            if (hit.color) {
              return <Tag color={hit.color}>{hit.label}</Tag>;
            }
            return hit.label;
          }
          if (value === null || value === undefined || value === "") {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return String(value);
        },
      });
    }
    cols.push({
      title: "操作",
      key: "__actions",
      fixed: "right",
      width: extraActions ? 220 : 140,
      render: (_v: unknown, row: T) => (
        <div className="flex justify-end gap-1">
          {extraActions?.(row)}
          <Button
            size="sm"
            variant="ghost"
            disabled={!canWrite}
            onClick={() => setDrawer({ open: true, mode: "edit", row })}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!canWrite}
            onClick={() => setConfirmDelete(row)}
          >
            删除
          </Button>
        </div>
      ),
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, asyncOptions, canWrite, extraActions, showIndex, page, pageSize]);

  // ── 数据源:真分页=后端已切,前端切片=本地切 ──
  const pagedRows = useMemo(() => {
    if (serverSidePagination) return rows;
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize, serverSidePagination]);

  // 查询区前 N 行可见字段:collapsed 时取前 4 个,expanded 取全部。
  // 字段 ≤ 4 时不显示"展开"按钮(无需切换)。
  const visibleSearchFields = useMemo(() => {
    if (expanded || searchFields.length <= 4) return searchFields;
    return searchFields.slice(0, 4);
  }, [searchFields, expanded]);
  const showExpandToggle = searchFields.length > 4;

  // 立即触发查询(用于 select/date 选中即查)。
  const commitSearchField = (name: string, value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchCommitted((prev) => ({ ...prev, [name]: value }));
    setPage(1);
  };

  return (
    <PageContainer>
      <PageHeader
        title={title}
        subtitle={subtitle}
      />

      {toast && (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            toast.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-destructive/30 bg-red-50 text-destructive"
          }`}
        >
          {toast.text}
        </div>
      )}

      {error ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
          <Button
            size="sm"
            variant="outline"
            className="ml-3"
            onClick={() => void load()}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <>
          <SectionCard bodyPadding="p-2">
            {/* 顶部按钮行:搜索/重置/(展开) | 分隔 | 导出/新增 */}
            <div className="mb-2 flex items-center justify-end gap-2">
              <Button size="sm" onClick={() => handleSearchCommit()}>
                搜索
              </Button>
              <Button size="sm" variant="outline" onClick={handleReset}>
                重置
              </Button>
              {showExpandToggle && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? "收起" : "展开"}
                </Button>
              )}
              <span className="mx-1 h-6 w-px bg-border" aria-hidden />
              {exportFn && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting}
                  onClick={() => void handleExport()}
                  title={exportFilename}
                >
                  {exporting ? "导出中…" : "导出"}
                </Button>
              )}
              <Button
                size="sm"
                disabled={!canWrite}
                onClick={() => setDrawer({ open: true, mode: "create" })}
              >
                + 新增{entityLabel}
              </Button>
            </div>

            {searchFields.length > 0 && (
              <Form layout="vertical" className="grid w-full grid-cols-4 gap-3">
                {visibleSearchFields.map((f) => {
                  const name = f.name as string;
                  const isSelect = f.type === "select";
                  const opts = asyncOptions[name] ?? f.options ?? [];
                  return (
                    <Field key={name} label={f.label}>
                      <Form.Item name={name} noStyle>
                        {isSelect ? (
                          <Select
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            placeholder={f.placeholder ?? `请选择${f.label}`}
                            options={opts.map((o) => ({
                              label: o.label,
                              value: o.value,
                            }))}
                            onChange={(v: string | undefined) => {
                              setSearchInput((prev) => ({
                                ...prev,
                                [name]: v ?? "",
                              }));
                              commitSearchField(name, v ?? "");
                            }}
                          />
                        ) : (
                          <Input
                            allowClear
                            placeholder={f.placeholder ?? `请输入${f.label}`}
                            onChange={(e) =>
                              handleSearchInput(name, e.target.value)
                            }
                            onPressEnter={() => {
                              if (debounceRef.current)
                                clearTimeout(debounceRef.current);
                              setSearchCommitted((prev) => ({
                                ...prev,
                                [name]: searchInput[name] ?? "",
                              }));
                              setPage(1);
                            }}
                          />
                        )}
                      </Form.Item>
                    </Field>
                  );
                })}
              </Form>
            )}
          </SectionCard>

          <DataTable<T>
            rowKey={(row: T) => getRowId(row)}
            columns={columns}
            dataSource={pagedRows}
            loading={loading}
            size="small"
            bordered
            rowClassName={
              striped
                ? (_row: T, idx: number) =>
                    idx % 2 === 1 ? "bg-muted/40" : ""
                : undefined
            }
            scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              showTotal: (t: number) => `共 ${t} 条`,
              onChange: (p: number, s: number) => {
                setPage(p);
                setPageSize(s);
              },
            }}
            emptyText={`暂无${entityLabel}`}
          />
        </>
      )}

      {drawer.open && (
        <PpmResourceDrawer<T>
          mode={drawer.mode}
          row={drawer.row}
          fields={fields}
          entityLabel={entityLabel}
          asyncOptions={asyncOptions}
          canWrite={canWrite}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSubmit={handleSubmit}
        />
      )}

      {confirmDelete && (
        <DeleteConfirm
          label={getRowLabel(confirmDelete)}
          entityLabel={entityLabel}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
    </PageContainer>
  );
}

/**
 * 查询条件外壳:垂直布局(标题在上,控件在下)。
 * 借鉴 project-plans page.tsx 的 Field,让搜索区视觉一致。
 */
function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-xs leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

// ── Drawer 表单 ─────────────────────────────────────────────────────────

function PpmResourceDrawer<T extends { id: string }>({
  mode,
  row,
  fields,
  entityLabel,
  asyncOptions,
  canWrite,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  row?: T;
  fields: PpmFieldDef<T>[];
  entityLabel: string;
  asyncOptions: Record<string, PpmFieldOption[]>;
  canWrite: boolean;
  onClose: () => void;
  onSubmit: (form: Partial<T>) => Promise<void>;
}) {
  // 表单值:Partial<T> 的扁平 Record
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initial: Record<string, unknown> = {};
    for (const f of fields) {
      if (mode === "edit" && row) {
        initial[f.name as string] =
          (row ? (row as Record<string, unknown>)[f.name as string] : undefined) ??
          f.defaultValue ??
          "";
      } else {
        initial[f.name as string] = f.defaultValue ?? "";
      }
    }
    setForm(initial);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, row]);

  const setValue = (name: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // 表单内显示的字段:默认全部,hideInForm=true 的字段(如创建人/时间)不在表单显示。
  const visibleFields = useMemo(
    () => fields.filter((f) => !f.hideInForm),
    [fields],
  );

  // 必填校验 + pattern 正则校验
  const fieldErrors = useMemo<Record<string, string>>(() => {
    const errs: Record<string, string> = {};
    for (const f of visibleFields) {
      const v = form[f.name as string];
      if (f.required && (v === null || v === undefined || v === "")) {
        errs[f.name as string] = `${f.label}为必填项`;
        continue;
      }
      if (f.pattern && v !== null && v !== undefined && v !== "") {
        const re =
          f.pattern instanceof RegExp
            ? f.pattern
            : new RegExp(f.pattern);
        if (!re.test(String(v))) {
          errs[f.name as string] =
            f.patternMessage ?? `${f.label}格式不正确`;
        }
      }
    }
    return errs;
  }, [visibleFields, form]);
  const formValid = Object.keys(fieldErrors).length === 0;

  const submit = async () => {
    if (!formValid || !canWrite || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form as Partial<T>);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[520px] flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">
            {mode === "create" ? `新增${entityLabel}` : `编辑${entityLabel}`}
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {visibleFields.map((f) => {
            const name = f.name as string;
            const value = form[name] ?? "";
            const readOnly = mode === "edit" && f.readOnlyOnEdit;
            const opts = asyncOptions[name] ?? f.options ?? [];
            const errMsg = fieldErrors[name];
            // date/datetime 表单用原生 input;后端存 ISO 字符串,取前 10 / 16 位。
            const isDate = f.type === "date";
            const isDateTime = f.type === "datetime";
            const inputType = isDate
              ? "date"
              : isDateTime
                ? "datetime-local"
                : f.type === "number"
                  ? "number"
                  : "text";
            return (
              <div key={name}>
                <label className="text-[11px] text-muted-foreground">
                  {f.label}
                  {f.required && <span className="ml-0.5 text-destructive">*</span>}
                </label>
                {f.type === "textarea" ? (
                  <textarea
                    value={String(value ?? "")}
                    onChange={(e) => setValue(name, e.target.value || null)}
                    disabled={!canWrite || readOnly}
                    placeholder={f.placeholder}
                    className={`mt-0.5 ${textareaCls}`}
                  />
                ) : f.type === "select" ? (
                  <select
                    value={String(value ?? "")}
                    onChange={(e) => setValue(name, e.target.value || null)}
                    disabled={!canWrite || readOnly}
                    className={`mt-0.5 ${inputCls}`}
                  >
                    <option value="">{f.placeholder ?? `请选择${f.label}`}</option>
                    {opts.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={inputType}
                    value={isDate || isDateTime ? String(value ?? "").slice(0, isDateTime ? 16 : 10) : String(value ?? "")}
                    onChange={(e) => {
                      const v =
                        f.type === "number"
                          ? e.target.value === ""
                            ? null
                            : Number(e.target.value)
                          : e.target.value || null;
                      setValue(name, v);
                    }}
                    disabled={!canWrite || readOnly}
                    placeholder={f.placeholder}
                    className={`mt-0.5 ${inputCls}`}
                  />
                )}
                {errMsg && (
                  <p className="mt-0.5 text-[11px] text-destructive">{errMsg}</p>
                )}
              </div>
            );
          })}
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!canWrite || !formValid || saving}
            onClick={() => void submit()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </>
  );
}

function DeleteConfirm({
  label,
  entityLabel,
  onCancel,
  onConfirm,
}: {
  label: string;
  entityLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">确认删除{entityLabel}？</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          将删除 <span className="font-mono">{label}</span>。该操作不可恢复。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            确认删除
          </Button>
        </div>
      </div>
    </div>
  );
}
