"use client";

/**
 * 工时统计页面 (task-12 / FR-06 + task-05 / FR-05 图表升级)。
 *
 * 设计 (对照源 dept_project_front/src/views/ppm/work-hour/statistics.vue):
 *  - 维度 radio:按成员 / 按项目。
 *  - 必选具体对象 (userId / projectId) + 时间段 → 调 stat-by-user/stat-by-project
 *    传 user_id/project_id 拉取该对象的聚合与明细。
 *  - 两个 Tab:
 *      · 聚合统计:柱状图 + 饼图 + 聚合表 (保留)。
 *      · 明细记录:listWorkHours 带 user_id/project_id + 时间段,展示工时明细记录。
 *
 * 外壳对齐 project-plans 风格 (ql-024):PageContainer size=full + PageHeader 去
 * actions + SectionCard bodyPadding=p-2 + 顶部按钮右对齐 + grid-cols-4 垂直 Field
 * 查询条件(原生 select/input → antd Select/RangePicker) + DataTable bordered。
 * 业务逻辑保留:维度切换、选对象即查的实时查询、Tabs、图表。
 *
 * 依赖:lib/ppm/task (stat + page API) + lib/ppm/project (项目名映射) +
 *       components/ppm-user-select (成员选择) + components/charts。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DatePicker, message, Select, Tabs, type TableProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { PpmUserSelect, type PpmSelectOption } from "@/components/ppm-user-select";
import { WorkHourBarChart, WorkHourPieChart } from "@/components/charts";
import { tokens } from "@/styles/tokens";
import { ApiError } from "@/lib/api";
import {
  listWorkHours,
  statWorkHoursByProject,
  statWorkHoursByUser,
} from "@/lib/ppm/task";
import { listSimpleProjects } from "@/lib/ppm/project";
import type {
  ProjectSimpleItem,
  WorkHour,
  WorkHourPageReq,
  WorkHourStatItem,
  WorkHourStatResponse,
} from "@/lib/ppm/types";
import { Toast, fmtDay, useToast } from "../shared";

const { RangePicker } = DatePicker;

type Dimension = "user" | "project";
type StatTab = "summary" | "detail";

interface Row extends WorkHourStatItem {
  name: string;
}

// 查询条件外壳:垂直布局(标题在上,控件在下),对齐 project-plans 风格。
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

export default function WorkHourStatisticsPage() {
  const { toast } = useToast();

  const [dimension, setDimension] = useState<Dimension>("user");
  const [userId, setUserId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [byUser, setByUser] = useState<WorkHourStatResponse | null>(null);
  const [byProject, setByProject] = useState<WorkHourStatResponse | null>(null);
  // 选中具体对象的工时明细记录 (listWorkHours 带 user_id/project_id)
  const [details, setDetails] = useState<WorkHour[]>([]);

  const [projects, setProjects] = useState<ProjectSimpleItem[]>([]);
  const [userOptions, setUserOptions] = useState<PpmSelectOption[]>([]);

  const [tab, setTab] = useState<StatTab>("summary");

  useEffect(() => {
    void (async () => {
      try {
        setProjects((await listSimpleProjects()) ?? []);
      } catch (e) {
        message.error(
          e instanceof Error ? e.message : "加载项目列表失败",
        );
      }
    })();
  }, []);

  const objectSelected =
    dimension === "user" ? !!userId : !!projectId;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 必选具体对象 (对照源 statistics.vue);未选时只清空,不发起全局聚合。
      if (dimension === "user") {
        if (!userId) {
          setByUser(null);
          setDetails([]);
          return;
        }
        const params = {
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          user_id: userId,
        };
        const resp = await statWorkHoursByUser(params);
        setByUser(resp);
        // 明细:listWorkHours 带 user_id
        const detailParams: WorkHourPageReq = {
          page: 1,
          page_size: 200,
          user_id: userId,
        };
        if (startDate) detailParams.work_date_start = startDate;
        if (endDate) detailParams.work_date_end = endDate;
        const d = await listWorkHours(detailParams);
        setDetails(d.items ?? []);
      } else {
        if (!projectId) {
          setByProject(null);
          setDetails([]);
          return;
        }
        const params = {
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          project_id: projectId,
        };
        const resp = await statWorkHoursByProject(params);
        setByProject(resp);
        const detailParams: WorkHourPageReq = {
          page: 1,
          page_size: 200,
          project_id: projectId,
        };
        if (startDate) detailParams.work_date_start = startDate;
        if (endDate) detailParams.work_date_end = endDate;
        const d = await listWorkHours(detailParams);
        setDetails(d.items ?? []);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [dimension, userId, projectId, startDate, endDate]);

  useEffect(() => {
    void load();
  }, [load]);

  // 维度切换时清空对象选择,避免跨维度残留。
  useEffect(() => {
    setUserId("");
    setProjectId("");
    setDetails([]);
  }, [dimension]);

  const current = dimension === "user" ? byUser : byProject;

  const rows: Row[] = useMemo(() => {
    if (!current) return [];
    const items = [...current.items].sort(
      (a, b) => b.total_hours - a.total_hours,
    );
    return items.map((it) => ({
      ...it,
      name: resolveName(dimension, it.key, projects),
    }));
  }, [current, dimension, projects]);

  const totalHours = current?.total_hours ?? 0;

  const userName = useCallback(
    (uid: string): string =>
      userOptions.find((u) => u.value === uid)?.label ?? uid,
    [userOptions],
  );

  // 时间范围 RangePicker 值:startDate/endDate(string) ↔ [Dayjs,Dayjs]。
  const dateRange: [Dayjs | null, Dayjs | null] | null =
    startDate || endDate
      ? [
          startDate ? dayjs(startDate) : null,
          endDate ? dayjs(endDate) : null,
        ]
      : null;

  const handleClearRange = () => {
    setStartDate("");
    setEndDate("");
  };

  const detailColumns: TableProps<WorkHour>["columns"] = useMemo(
    () => [
      {
        title: "日期",
        dataIndex: "work_date",
        key: "work_date",
        render: (v: string) => fmtDay(v),
        sorter: (a, b) =>
          (a.work_date ?? "").localeCompare(b.work_date ?? ""),
      },
      {
        title: "项目",
        key: "project",
        render: (_v, r: WorkHour) =>
          projects.find((p) => p.id === r.project_id)?.project_name ??
          r.project_id,
      },
      {
        title: "填报人",
        dataIndex: "user_id",
        key: "user_id",
        render: (uid: string) => userName(uid),
      },
      {
        title: "工时(h)",
        dataIndex: "hours",
        key: "hours",
        align: "right",
        sorter: (a, b) => a.hours - b.hours,
        render: (v: number) => (
          <span className="font-mono">{Number(v).toFixed(1)}</span>
        ),
      },
      {
        title: "类型",
        dataIndex: "type",
        key: "type",
        render: (v: number) => (v === 1 ? "任务工时" : v === 2 ? "项目工时" : String(v)),
      },
      {
        title: "说明",
        dataIndex: "description",
        key: "description",
        ellipsis: true,
        render: (v: string | null) => v ?? "—",
      },
    ],
    [projects, userName],
  );

  const columns: TableProps<Row>["columns"] = [
    {
      title: dimension === "user" ? "用户 ID" : "项目 ID",
      dataIndex: "key",
      key: "key",
      render: (v: string) => <span className="font-mono text-xs">{v}</span>,
    },
    {
      title: dimension === "user" ? "负责人" : "项目",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "工时(h)",
      dataIndex: "total_hours",
      key: "total_hours",
      align: "right",
      sorter: (a, b) => a.total_hours - b.total_hours,
      render: (v: number) => (
        <span className="font-mono">{Number(v).toFixed(1)}</span>
      ),
    },
    {
      title: "记录数",
      dataIndex: "count",
      key: "count",
      align: "right",
    },
    {
      title: "占比",
      key: "ratio",
      align: "right",
      render: (_v, r: Row) => {
        const ratio = totalHours > 0 ? (r.total_hours / totalHours) * 100 : 0;
        return <span className="font-mono text-xs">{ratio.toFixed(1)}%</span>;
      },
    },
  ];

  return (
    <PageContainer size="full">
      <PageHeader
        title="工时统计"
        subtitle="按成员 / 按项目选择具体对象 + 时间段,查看工时明细"
      />

      <Toast toast={toast} />

      <SectionCard bodyPadding="p-2">
        {/* 顶部按钮行(D-006):页面按钮(返回工时录入)左 | 查询按钮(清除范围)最右 */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => { window.location.href = "/ppm/work-hours"; }}>
            ← 返回工时录入
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button size="sm" variant="outline" onClick={handleClearRange}>
            清除范围
          </Button>
        </div>

        {/* 查询条件:垂直 grid-cols-4(选对象/范围即查,保留实时查询语义) */}
        <div className="grid w-full grid-cols-4 gap-3">
          <Field label="统计维度">
            <Select
              value={dimension}
              onChange={(v) => setDimension(v)}
              options={[
                { value: "user", label: "按成员" },
                { value: "project", label: "按项目" },
              ]}
              className="w-full"
            />
          </Field>
          {dimension === "user" ? (
            <Field label="成员">
              <PpmUserSelect
                res="user"
                value={userId || null}
                onChange={(v) => setUserId((v as string | null) ?? "")}
                placeholder="请选择成员"
                allowClear
                onLoadedOptions={setUserOptions}
                style={{ width: "100%" }}
              />
            </Field>
          ) : (
            <Field label="项目">
              <Select
                value={projectId || undefined}
                onChange={(v) => setProjectId(v ?? "")}
                placeholder="请选择项目"
                allowClear
                showSearch
                optionFilterProp="label"
                options={projects.map((p) => ({
                  value: p.id,
                  label: p.project_name ?? p.id,
                }))}
                className="w-full"
              />
            </Field>
          )}
          <Field label="时间范围">
            <RangePicker
              value={dateRange}
              onChange={(dates) => {
                const [s, e] = dates ?? [null, null];
                setStartDate(s ? s.format("YYYY-MM-DD") : "");
                setEndDate(e ? e.format("YYYY-MM-DD") : "");
              }}
              className="w-full"
            />
          </Field>
          <div className="self-end text-right text-xs text-muted-foreground">
            合计 {(totalHours ?? 0).toFixed(1)}h · 明细 {details.length} 条
          </div>
        </div>
      </SectionCard>

      {!objectSelected ? (
        <div className="rounded border bg-muted/20 px-3 py-10 text-center text-xs text-muted-foreground">
          请先选择{dimension === "user" ? "成员" : "项目"}再查看统计
        </div>
      ) : error ? (
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
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as StatTab)}
          items={[
            {
              key: "summary",
              label: "聚合统计",
              children:
                rows.length === 0 && !loading ? (
                  <div className="rounded border bg-muted/20 px-3 py-10 text-center text-xs text-muted-foreground">
                    该对象在所选范围内暂无聚合数据
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <DataTable<Row>
                      rowKey="key"
                      columns={columns}
                      dataSource={rows}
                      loading={loading}
                      size="small"
                      bordered
                      pagination={{ pageSize: 20, showSizeChanger: false }}
                      emptyText="暂无数据"
                    />
                    <div className="grid gap-4 lg:grid-cols-2">
                      <SectionCard
                        title={
                          dimension === "user" ? "用户工时分布" : "项目工时分布"
                        }
                      >
                        <WorkHourBarChart
                          rows={rows}
                          color={
                            dimension === "user"
                              ? tokens.color.blue[600]
                              : tokens.color.emerald
                          }
                          loading={loading}
                        />
                      </SectionCard>
                      <SectionCard
                        title={
                          dimension === "user" ? "用户工时占比" : "项目工时占比"
                        }
                      >
                        <WorkHourPieChart rows={rows} totalHours={totalHours} />
                      </SectionCard>
                    </div>
                  </div>
                ),
            },
            {
              key: "detail",
              label: `明细记录 (${details.length})`,
              children: (
                <DataTable<WorkHour>
                  rowKey="id"
                  columns={detailColumns}
                  dataSource={details}
                  loading={loading}
                  size="small"
                  bordered
                  scroll={{ x: "max-content" }}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  emptyText="该对象在所选范围内暂无工时明细"
                />
              ),
            },
          ]}
        />
      )}
    </PageContainer>
  );
}

function resolveName(
  dimension: Dimension,
  key: string,
  projects: ProjectSimpleItem[],
): string {
  if (dimension === "project") {
    return projects.find((p) => p.id === key)?.project_name ?? key;
  }
  // 用户名前端无统一映射表,展示 ID;后端如返回 user_name 可在 key 旁。
  return key;
}
