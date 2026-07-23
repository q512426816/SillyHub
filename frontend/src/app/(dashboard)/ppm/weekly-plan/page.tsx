"use client";

/**
 * 项目周计划一览表 — 展示所有项目实施阶段（三级里程碑 has_module=true）下的
 * 明细 + 任务计划（PlanTask），19 列两级表头，服务端分页 + 导出 Excel。
 *
 * 数据源：后端 GET /api/ppm/weekly-plan（5 表 JOIN 聚合）。
 * 导出：GET /api/ppm/weekly-plan/export-excel（grouped_report_to_workbook 按项目分组）。
 */
import { useCallback, useEffect, useState } from "react";
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

/** 任务状态 → Tag 颜色（对齐 milestone-details 的 TASK_EXECUTE_STATUS_COLOR）。 */
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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 搜索条件
  const [projectName, setProjectName] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<
    [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
  >(null);

  // 搜索 nonce（防 onChange 即查，走搜索按钮提交）
  const [searchNonce, setSearchNonce] = useState(0);

  const buildReq = useCallback(
    (p: number, ps: number): WeeklyPlanPageReq => {
      const req: WeeklyPlanPageReq = { page: p, page_size: ps };
      if (projectName.trim()) req.project_name = projectName.trim();
      if (statusFilter.length) req.status = statusFilter;
      if (dateRange && dateRange[0])
        req.start_time = dateRange[0].format("YYYY-MM-DD");
      if (dateRange && dateRange[1])
        req.end_time = dateRange[1].format("YYYY-MM-DD");
      return req;
    },
    [projectName, statusFilter, dateRange],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await listWeeklyPlan(buildReq(page, pageSize));
      setData(resp.items);
      setTotal(resp.total);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [buildReq, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load, searchNonce]);

  const handleSearch = () => {
    setPage(1);
    setSearchNonce((n) => n + 1);
  };

  const handleReset = () => {
    setProjectName("");
    setStatusFilter([]);
    setDateRange(null);
    setPage(1);
    setSearchNonce((n) => n + 1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportWeeklyPlan(buildReq(1, 200));
      message.success("导出已开始");
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const columns: TableProps<WeeklyPlanRow>["columns"] = [
    {
      title: "序号",
      key: "seq",
      width: 50,
      fixed: "left",
      align: "center",
      render: (_v: unknown, _r: WeeklyPlanRow, idx: number) =>
        (page - 1) * pageSize + idx + 1,
    },
    {
      title: "项目名称",
      dataIndex: "project_name",
      key: "project_name",
      width: 140,
      fixed: "left",
      render: (v: string | null) => v ?? "—",
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
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
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
        title="项目周计划一览表"
        subtitle="展示所有项目实施阶段（三级里程碑）下的任务计划，支持导出 Excel"
      />

      {/* 搜索区 */}
      <SectionCard bodyPadding="p-2">
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button onClick={handleReset}>重置</Button>
          <Button
            type="primary"
            onClick={handleSearch}
          >
            搜索
          </Button>
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

      {/* 表格 */}
      <SectionCard bodyPadding="p-0">
        <Table<WeeklyPlanRow>
          rowKey={(r) => r.detail_id ?? Math.random().toString()}
          columns={columns}
          dataSource={data}
          loading={loading}
          size="small"
          bordered
          scroll={{ x: "max-content", y: "calc(100vh - 380px)" }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t: number) => `共 ${t} 条`,
            onChange: (p: number, ps: number) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </SectionCard>
    </PageContainer>
  );
}
