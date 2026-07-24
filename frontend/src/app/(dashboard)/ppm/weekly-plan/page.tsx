"use client";

/**
 * 项目计划 — 展示所有项目实施阶段（三级里程碑 has_module=true）下的
 * 明细 + 任务计划（PlanTask），19 列两级表头 + 虚拟列表 + 导出。
 *
 * 虚拟列表模式不支持 rowSpan 合并,改为每行都显示项目名称/平台,
 * 项目切换时用粗上边框做视觉分组。
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

export default function WeeklyPlanPage() {
  const [data, setData] = useState<WeeklyPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<
    [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
  >(null);
  const [searchNonce, setSearchNonce] = useState(0);

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
      setData(resp.items);
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

  // 项目切换行(粗上边框)判定:第一行 or 与前一行 project_name 不同
  const isProjectBoundary = useCallback(
    (row: WeeklyPlanRow, idx: number) => {
      if (idx === 0) return true;
      const prev = data[idx - 1];
      if (!prev) return false;
      return (prev.project_name ?? "") !== (row.project_name ?? "");
    },
    [data],
  );

  const columns: TableProps<WeeklyPlanRow>["columns"] = [
    {
      title: "序号",
      key: "seq",
      width: 50,
      fixed: "left",
      align: "center",
      render: (_v: unknown, _r: WeeklyPlanRow, idx?: number) =>
        (idx ?? 0) + 1,
    },
    {
      title: "项目名称",
      dataIndex: "project_name",
      key: "project_name",
      width: 140,
      fixed: "left",
      render: (v: string | null, _r: WeeklyPlanRow, idx?: number) => {
        const isBoundary = idx != null && isProjectBoundary(_r, idx);
        if (isBoundary) {
          return (
            <div
              style={{
                background: "#305496",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                padding: "4px 10px",
                borderRadius: 3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {v ?? "—"}
            </div>
          );
        }
        return <span className="text-muted-foreground">{v ?? "—"}</span>;
      },
    },
    {
      title: "计划类型",
      dataIndex: "plan_type",
      key: "plan_type",
      width: 80,
      align: "center",
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务分类",
      dataIndex: "detailed_stage",
      key: "detailed_stage",
      width: 90,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "平台/子系统",
      dataIndex: "module_name",
      key: "module_name",
      width: 110,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务主题",
      dataIndex: "task_theme",
      key: "task_theme",
      width: 100,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务描述",
      dataIndex: "task_description",
      key: "task_description",
      width: 180,
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
          render: (v: number | null) => v ?? "—",
        },
        {
          title: "责任人",
          dataIndex: "user_name",
          key: "user_name",
          width: 70,
          render: (v: string | null) => v ?? "—",
        },
        {
          title: "开始日期",
          dataIndex: "start_time",
          key: "start_time",
          width: 90,
          render: (v: string | null) => fmtDate(v),
        },
        {
          title: "结束日期",
          dataIndex: "end_time",
          key: "end_time",
          width: 90,
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
          render: (v: string | null) => fmtDate(v),
        },
        {
          title: "完成时间",
          dataIndex: "actual_end_time",
          key: "actual_end_time",
          width: 90,
          render: (v: string | null) => fmtDate(v),
        },
        {
          title: "延期原因",
          key: "delay_reason",
          width: 100,
          render: () => (
            <span className="text-xs text-muted-foreground">—</span>
          ),
        },
        {
          title: "执行说明",
          key: "exec_note",
          width: 120,
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
      render: () => <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      title: "备注",
      key: "remarks",
      width: 100,
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
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button onClick={handleReset}>重置</Button>
          <Button type="primary" onClick={handleSearch}>搜索</Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button loading={exporting} onClick={() => void handleExport()}>
            {exporting ? "导出中…" : "导出 Excel"}
          </Button>
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
        <Table<WeeklyPlanRow>
          rowKey={(r, idx) => r.detail_id ?? `row-${idx}`}
          columns={columns}
          dataSource={data}
          loading={loading}
          size="small"
          bordered
          virtual
          scroll={{ x: "max-content", y: 600 }}
          pagination={false}
          rowClassName={(_r: WeeklyPlanRow, idx: number) =>
            isProjectBoundary(_r, idx) ? "bg-blue-50/50" : ""
          }
        />
      </SectionCard>
    </PageContainer>
  );
}
