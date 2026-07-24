"use client";

/**
 * 项目计划 — 展示所有项目实施阶段（三级里程碑 has_module=true）下的
 * 明细 + 任务计划（PlanTask），19 列两级表头 + 项目分组行 + 合并单元格 + 导出。
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

/** 带 rowSpan 标记的行类型(合并单元格用)。 */
interface DisplayRow extends WeeklyPlanRow {
  __isGroup?: boolean;
  __groupProject?: string;
  __projectSpan?: number;
  __moduleSpan?: number;
  __seq?: number;
}

export default function WeeklyPlanPage() {
  const [allData, setAllData] = useState<WeeklyPlanRow[]>([]);
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
      setAllData(resp.items);
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

  // 构建带分组行 + rowSpan 的显示数据
  const displayData = useMemo<DisplayRow[]>(() => {
    const result: DisplayRow[] = [];
    let curProject: string | null = null;
    let projectStartIdx = -1;
    let dataSeq = 0;

    for (const row of allData) {
      const pn = row.project_name ?? "";

      // 项目切换 → 插入分组行
      if (pn !== curProject) {
        // 修正上一个项目的 projectSpan
        if (projectStartIdx >= 0 && result.length > projectStartIdx) {
          const span = result.length - projectStartIdx;
          for (let j = projectStartIdx; j < result.length; j++) {
            const rj = result[j];
            if (rj) rj.__projectSpan = j === projectStartIdx ? span : 0;
          }
        }
        curProject = pn;
        // 分组行
        const groupRow: DisplayRow = {
          project_name: row.project_name ?? null,
          plan_type: row.plan_type ?? null,
          detailed_stage: row.detailed_stage ?? null,
          module_name: row.module_name ?? null,
          task_theme: row.task_theme ?? null,
          task_description: row.task_description ?? null,
          work_load: row.work_load ?? null,
          user_name: row.user_name ?? null,
          start_time: row.start_time ?? null,
          end_time: row.end_time ?? null,
          status: row.status ?? null,
          actual_start_time: row.actual_start_time ?? null,
          actual_end_time: row.actual_end_time ?? null,
          week_number: row.week_number ?? null,
          detail_id: row.detail_id ?? null,
          __isGroup: true,
          __groupProject: pn,
          __projectSpan: 0,
          __moduleSpan: 0,
        };
        result.push(groupRow);
        projectStartIdx = result.length;
      }

      // 数据行
      dataSeq++;
      const dataRow: DisplayRow = {
        project_name: row.project_name ?? null,
        plan_type: row.plan_type ?? null,
        detailed_stage: row.detailed_stage ?? null,
        module_name: row.module_name ?? null,
        task_theme: row.task_theme ?? null,
        task_description: row.task_description ?? null,
        work_load: row.work_load ?? null,
        user_name: row.user_name ?? null,
        start_time: row.start_time ?? null,
        end_time: row.end_time ?? null,
        status: row.status ?? null,
        actual_start_time: row.actual_start_time ?? null,
        actual_end_time: row.actual_end_time ?? null,
        week_number: row.week_number ?? null,
        detail_id: row.detail_id ?? null,
        __projectSpan: 1,
        __moduleSpan: 1,
        __seq: dataSeq,
      };
      result.push(dataRow);
    }
    // 最后一组 projectSpan
    if (projectStartIdx >= 0 && result.length > projectStartIdx) {
      const span = result.length - projectStartIdx;
      for (let j = projectStartIdx; j < result.length; j++) {
        const rj = result[j];
        if (rj) rj.__projectSpan = j === projectStartIdx ? span : 0;
      }
    }

    // 计算 moduleSpan(同项目内同平台合并)
    let i = 0;
    while (i < result.length) {
      const ri = result[i];
      if (!ri) { i++; continue; }
      if (ri.__isGroup) {
        i++;
        continue;
      }
      const proj = ri.project_name ?? "";
      const mod = ri.module_name ?? "";
      let j = i + 1;
      while (j < result.length) {
        const rj = result[j];
        if (!rj || rj.__isGroup) break;
        if ((rj.project_name ?? "") !== proj || (rj.module_name ?? "") !== mod) break;
        rj.__moduleSpan = 0;
        j++;
      }
      ri.__moduleSpan = j - i;
      i = j;
    }

    return result;
  }, [allData]);

  const columns: TableProps<DisplayRow>["columns"] = [
    {
      title: "序号",
      key: "seq",
      width: 50,
      fixed: "left",
      align: "center",
      onCell: (_r: DisplayRow, idx?: number) => ({
        colSpan: _r.__isGroup ? 19 : 1,
      }),
      render: (_v: unknown, _r: DisplayRow, idx?: number) => {
        if (_r.__isGroup) {
          return (
            <div
              style={{
                background: "#305496",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                padding: "4px 12px",
                textAlign: "left",
              }}
            >
              📁 {_r.__groupProject}
            </div>
          );
        }
        // 序号用预计算的 __seq(跳过分组行)
        return _r.__seq ?? 1;
      },
    },
    {
      title: "项目名称",
      dataIndex: "project_name",
      key: "project_name",
      width: 140,
      fixed: "left",
      onCell: (r: DisplayRow) => ({
        rowSpan: r.__isGroup ? 0 : r.__projectSpan,
      }),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "计划类型",
      dataIndex: "plan_type",
      key: "plan_type",
      width: 80,
      align: "center",
      onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务分类",
      dataIndex: "detailed_stage",
      key: "detailed_stage",
      width: 90,
      onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "平台/子系统",
      dataIndex: "module_name",
      key: "module_name",
      width: 110,
      onCell: (r: DisplayRow) => ({
        rowSpan: r.__isGroup ? 0 : r.__moduleSpan,
      }),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务主题",
      dataIndex: "task_theme",
      key: "task_theme",
      width: 100,
      onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务描述",
      dataIndex: "task_description",
      key: "task_description",
      width: 180,
      onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
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
      onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
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
          onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
          render: (v: number | null) => v ?? "—",
        },
        {
          title: "责任人",
          dataIndex: "user_name",
          key: "user_name",
          width: 70,
          onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
          render: (v: string | null) => v ?? "—",
        },
        {
          title: "开始日期",
          dataIndex: "start_time",
          key: "start_time",
          width: 90,
          onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
          render: (v: string | null) => fmtDate(v),
        },
        {
          title: "结束日期",
          dataIndex: "end_time",
          key: "end_time",
          width: 90,
          onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
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
          onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
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
          onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
          render: (v: string | null) => fmtDate(v),
        },
        {
          title: "完成时间",
          dataIndex: "actual_end_time",
          key: "actual_end_time",
          width: 90,
          onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
          render: (v: string | null) => fmtDate(v),
        },
        {
          title: "延期原因",
          key: "delay_reason",
          width: 100,
          onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
          render: () => (
            <span className="text-xs text-muted-foreground">—</span>
          ),
        },
        {
          title: "执行说明",
          key: "exec_note",
          width: 120,
          onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
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
      onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
      render: () => <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      title: "备注",
      key: "remarks",
      width: 100,
      onCell: (r: DisplayRow) => ({ rowSpan: r.__isGroup ? 0 : 1 }),
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
        <Table<DisplayRow>
          rowKey={(r, idx) =>
            r.__isGroup
              ? `group-${r.__groupProject}-${idx}`
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
          rowClassName={(_r: DisplayRow, idx: number) =>
            idx % 2 === 1 ? "bg-muted/30" : ""
          }
        />
      </SectionCard>
    </PageContainer>
  );
}
