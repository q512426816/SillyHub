"use client";

/**
 * 项目计划 — 展示所有项目实施阶段（三级里程碑 has_module=true）下的
 * 明细 + 任务计划（PlanTask），19 列两级表头 + 项目分组行 + 虚拟列表 + 导出。
 *
 * 虚拟列表不支持 rowSpan(跨行合并),但支持 colSpan(跨列,单行内)。
 * 方案:项目分组行用 colSpan=19 独占一整行(虚拟列表兼容),
 * 项目名称/平台每行都显示(不用 rowSpan 合并)。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  DatePicker,
  Input,
  Select,
  Table,
  Tag,
  message,
  type TableProps,
} from "antd";
import dayjs from "dayjs";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/ppm";
import {
  exportWeeklyPlan,
  listWeeklyPlan,
} from "@/lib/ppm/weekly-plan";
import type { WeeklyPlanRow, WeeklyPlanPageReq } from "@/lib/ppm";

const { RangePicker } = DatePicker;

const STATUS_COLOR: Record<string, string> = {
  未开始: "default",
  进行中: "processing",
  已完成: "success",
};

const STATUS_OPTIONS = [
  { value: "未开始", label: "未开始" },
  { value: "进行中", label: "进行中" },
  { value: "已完成", label: "已完成" },
];

/** 可排序+筛选的列配置(字段名 + 值类型)。占位列(无数据源)不加入。 */
type SortFieldKind = "text" | "number" | "date";
const SORTABLE_FIELDS: { key: string; kind: SortFieldKind }[] = [
  { key: "project_name", kind: "text" },
  { key: "plan_type", kind: "text" },
  { key: "detailed_stage", kind: "text" },
  { key: "module_name", kind: "text" },
  { key: "task_theme", kind: "text" },
  { key: "task_description", kind: "text" },
  { key: "work_load", kind: "number" },
  { key: "week_number", kind: "number" },
  { key: "user_name", kind: "text" },
  { key: "start_time", kind: "date" },
  { key: "end_time", kind: "date" },
  { key: "status", kind: "text" },
  { key: "actual_start_time", kind: "date" },
  { key: "actual_end_time", kind: "date" },
];

/** 取行字段值统一转字符串(空值→"")。 */
const fieldText = (r: WeeklyPlanRow, key: string): string => {
  const v = (r as unknown as Record<string, unknown>)[key];
  return v == null ? "" : String(v);
};

/** 非空值比较:number 用数值,其余(含 ISO 日期)用字符串字典序。 */
const compareNonEmpty = (
  a: string,
  b: string,
  kind: SortFieldKind
): number => {
  if (kind === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
  }
  return a.localeCompare(b, "zh");
};

/** 分组行标记类型。 */
interface DisplayRow extends WeeklyPlanRow {
  __isGroup?: boolean;
  __groupProject?: string;
  __seq?: number;
}

export default function WeeklyPlanPage() {
  const [rawData, setRawData] = useState<WeeklyPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<
    [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
  >(null);
  const [searchNonce, setSearchNonce] = useState(0);

  // 表头筛选/排序(Excel 式):受控状态。实际过滤+排序在 processedData 中完成,
  // 不依赖 antd 内部 onFilter —— virtual 虚拟列表 + 分组行(colSpan)组合下,外部计算更稳。
  const [columnFilters, setColumnFilters] = useState<
    Record<string, (string | number)[]>
  >({});
  const [columnSorter, setColumnSorter] = useState<{
    field?: string;
    order?: "ascend" | "descend";
  }>({});

  const buildReq = useCallback((): WeeklyPlanPageReq => {
    const req: WeeklyPlanPageReq = { page: 1, page_size: 10000 };
    if (projectName.trim()) req.project_name = projectName.trim();
    if (statusFilter.length) req.status = statusFilter;
    if (dateRange && dateRange[0])
      req.start_time = dateRange[0].format("YYYY-MM-DD");
    if (dateRange && dateRange[1])
      req.end_time = dateRange[1].format("YYYY-MM-DD");
    return req;
  }, [projectName, statusFilter, dateRange]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listWeeklyPlan(buildReq());
      setRawData(resp.items);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [buildReq]);

  useEffect(() => {
    void load();
  }, [load, searchNonce]);

  const handleSearch = () => setSearchNonce((n) => n + 1);
  const handleReset = () => {
    setProjectName("");
    setStatusFilter([]);
    setDateRange(null);
    setSearchNonce((n) => n + 1);
  };
  const handleExport = async () => {
    setExporting(true);
    try {
      await exportWeeklyPlan(buildReq());
      message.success("导出已开始");
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  // 各可排序字段的筛选下拉选项(从当前数据动态去重,下拉内带搜索框)
  const fieldFiltersMap = useMemo(() => {
    const map: Record<string, { text: string; value: string }[]> = {};
    for (const { key } of SORTABLE_FIELDS) {
      const vals = Array.from(
        new Set(rawData.map((r) => fieldText(r, key)).filter(Boolean))
      );
      map[key] = vals
        .sort((a, b) => a.localeCompare(b, "zh"))
        .map((n) => ({ text: n, value: n }));
    }
    return map;
  }, [rawData]);

  // 应用表头筛选 + 排序后的扁平行(分组行插入前)
  const processedData = useMemo<WeeklyPlanRow[]>(() => {
    let rows = rawData;
    // 多列筛选(AND 叠加)
    for (const { key } of SORTABLE_FIELDS) {
      const sel = columnFilters[key];
      if (sel && sel.length) {
        const allow = new Set(sel.map(String));
        rows = rows.filter((r) => allow.has(fieldText(r, key)));
      }
    }
    // 单列排序:升序 / 降序,第三次点击取消(空值固定排最后,不受升降序影响)
    const { field, order } = columnSorter;
    if (field && order) {
      const spec = SORTABLE_FIELDS.find((f) => f.key === field);
      if (spec) {
        const dir = order === "ascend" ? 1 : -1;
        rows = [...rows].sort((a, b) => {
          const va = fieldText(a, field);
          const vb = fieldText(b, field);
          if (!va && !vb) return 0;
          if (!va) return 1;
          if (!vb) return -1;
          return compareNonEmpty(va, vb, spec.kind) * dir;
        });
      }
    }
    return rows;
  }, [rawData, columnFilters, columnSorter]);

  /** 生成某字段的 Excel 式表头属性(排序 + 多选筛选,受控)。 */
  const sortableColProps = (key: string) => ({
    sorter: true as const,
    sortOrder: columnSorter.field === key ? columnSorter.order : undefined,
    filters: fieldFiltersMap[key] ?? [],
    filterMultiple: true,
    filterSearch: true,
    filteredValue: columnFilters[key] ?? null,
    onFilter: () => true, // 实际过滤在 processedData 外部完成
  });

  // 构建带分组行的 displayData(项目切换时插入独占一行的分组行)
  const displayData = useMemo<DisplayRow[]>(() => {
    const result: DisplayRow[] = [];
    let curProject: string | null = null;
    let seq = 0;

    for (const row of processedData) {
      const pn = row.project_name ?? "";
      if (pn !== curProject) {
        curProject = pn;
        result.push({
          ...row,
          __isGroup: true,
          __groupProject: pn,
        });
      }
      seq++;
      result.push({ ...row, __seq: seq });
    }
    return result;
  }, [processedData]);

  // colSpan 辅助:分组行首列 colSpan=19(独占一整行),其余列 colSpan=0(隐藏)
  const groupCell = (r: DisplayRow) => ({
    colSpan: r.__isGroup ? 19 : 1,
  });
  const hiddenCell = (r: DisplayRow) => ({
    colSpan: r.__isGroup ? 0 : 1,
  });

  const columns: TableProps<DisplayRow>["columns"] = [
    {
      title: "序号",
      key: "seq",
      width: 50,
      fixed: "left",
      align: "center",
      onCell: groupCell,
      render: (_v: unknown, r: DisplayRow) => {
        if (r.__isGroup) {
          return (
            <div
              style={{
                background: "#305496",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                padding: "6px 12px",
                textAlign: "left",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              📁 {r.__groupProject}
            </div>
          );
        }
        return r.__seq ?? 1;
      },
    },
    {
      title: "项目名称",
      dataIndex: "project_name",
      key: "project_name",
      width: 140,
      fixed: "left",
      onCell: hiddenCell,
      ...sortableColProps("project_name"),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "计划类型",
      dataIndex: "plan_type",
      key: "plan_type",
      width: 80,
      align: "center",
      onCell: hiddenCell,
      ...sortableColProps("plan_type"),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务分类",
      dataIndex: "detailed_stage",
      key: "detailed_stage",
      width: 90,
      onCell: hiddenCell,
      ...sortableColProps("detailed_stage"),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "平台/子系统",
      dataIndex: "module_name",
      key: "module_name",
      width: 110,
      onCell: hiddenCell,
      ...sortableColProps("module_name"),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务主题",
      dataIndex: "task_theme",
      key: "task_theme",
      width: 100,
      onCell: hiddenCell,
      ...sortableColProps("task_theme"),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务描述",
      dataIndex: "task_description",
      key: "task_description",
      width: 180,
      onCell: hiddenCell,
      ...sortableColProps("task_description"),
      render: (v: string | null) => (
        <div className="whitespace-normal break-words" style={{ maxWidth: 160 }}>
          {v ?? "—"}
        </div>
      ),
    },
    {
      title: "工作量\n(人天)",
      dataIndex: "work_load",
      key: "work_load",
      width: 70,
      align: "center",
      onCell: hiddenCell,
      ...sortableColProps("work_load"),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务计划安排",
      children: [
        {
          title: "周次",
          dataIndex: "week_number",
          key: "week_number",
          width: 50,
          align: "center",
          onCell: hiddenCell,
          ...sortableColProps("week_number"),
          render: (v: number | null) => v ?? "—",
        },
        {
          title: "责任人",
          dataIndex: "user_name",
          key: "user_name",
          width: 70,
          onCell: hiddenCell,
          ...sortableColProps("user_name"),
          render: (v: string | null) => v ?? "—",
        },
        {
          title: "开始日期",
          dataIndex: "start_time",
          key: "start_time",
          width: 90,
          onCell: hiddenCell,
          ...sortableColProps("start_time"),
          render: (v: string | null) => fmtDate(v),
        },
        {
          title: "结束日期",
          dataIndex: "end_time",
          key: "end_time",
          width: 90,
          onCell: hiddenCell,
          ...sortableColProps("end_time"),
          render: (v: string | null) => fmtDate(v),
        },
      ],
    },
    {
      title: "计划执行情况（执行人填写）",
      children: [
        {
          title: "状态",
          dataIndex: "status",
          key: "status",
          width: 60,
          align: "center",
          onCell: hiddenCell,
          ...sortableColProps("status"),
          render: (v: string | null) =>
            v ? (
              <Tag color={STATUS_COLOR[v] ?? "default"}>{v}</Tag>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            ),
        },
        {
          title: "开始时间",
          dataIndex: "actual_start_time",
          key: "actual_start_time",
          width: 90,
          onCell: hiddenCell,
          ...sortableColProps("actual_start_time"),
          render: (v: string | null) => fmtDate(v),
        },
        {
          title: "完成时间",
          dataIndex: "actual_end_time",
          key: "actual_end_time",
          width: 90,
          onCell: hiddenCell,
          ...sortableColProps("actual_end_time"),
          render: (v: string | null) => fmtDate(v),
        },
        {
          title: "延期原因",
          key: "delay_reason",
          width: 100,
          onCell: hiddenCell,
          render: () => (
            <span className="text-xs text-muted-foreground">—</span>
          ),
        },
        {
          title: "执行说明",
          key: "exec_note",
          width: 120,
          onCell: hiddenCell,
          render: () => (
            <span className="text-xs text-muted-foreground">—</span>
          ),
        },
      ],
    },
    {
      title: "评估说明",
      key: "eval_note",
      width: 100,
      onCell: hiddenCell,
      render: () => <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      title: "备注",
      key: "remarks",
      width: 100,
      onCell: hiddenCell,
      render: () => <span className="text-xs text-muted-foreground">—</span>,
    },
  ];

  return (
    <PageContainer size="full">
      <PageHeader
        title="项目计划"
        subtitle="展示所有项目实施阶段（三级里程碑）下的任务计划，支持导出 Excel"
      />

      <SectionCard bodyPadding="p-2">
        {/* 按钮行:导出 | 分隔 | 搜索(primary) 重置(default,透明) 全右对齐 */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button loading={exporting} onClick={() => void handleExport()}>
            {exporting ? "导出中…" : "导出 Excel"}
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button type="primary" onClick={handleSearch}>搜索</Button>
          <Button onClick={handleReset}>重置</Button>
        </div>
        <div className="grid w-full grid-cols-4 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">项目名称</label>
            <Input
              allowClear
              placeholder="搜索项目名称"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onPressEnter={handleSearch}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">状态</label>
            <Select
              mode="multiple"
              allowClear
              placeholder="选择状态"
              value={statusFilter}
              onChange={(v: string[]) => setStatusFilter(v)}
              options={STATUS_OPTIONS}
              maxTagCount={2}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">日期范围（按计划开始日期）</label>
            <RangePicker
              value={dateRange}
              onChange={(v) => setDateRange(v as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard bodyPadding="p-0">
        <Table<DisplayRow>
          rowKey={(r, idx) =>
            r.__isGroup
              ? `group-${r.__groupProject}`
              : r.detail_id ?? `row-${idx}`
          }
          columns={columns}
          dataSource={displayData}
          loading={loading}
          size="small"
          bordered
          virtual
          scroll={{ x: "max-content", y: 600 }}
          pagination={false}
          onChange={(_pagination, filters, sorter) => {
            setColumnFilters(
              filters as Record<string, (string | number)[]>
            );
            const s = (Array.isArray(sorter) ? sorter[0] : sorter) ?? {};
            setColumnSorter({
              field: (s as { field?: string }).field,
              order: (s as { order?: "ascend" | "descend" }).order,
            });
          }}
        />
      </SectionCard>
    </PageContainer>
  );
}
