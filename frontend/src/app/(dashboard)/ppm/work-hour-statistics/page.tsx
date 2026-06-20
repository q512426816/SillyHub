"use client";

/**
 * 工时统计页面 (task-12 / FR-06 + task-05 / FR-05 图表升级)。
 *
 * 设计:
 *  - 表格:按用户聚合 / 按项目聚合,来自 stat-by-user / stat-by-project。
 *  - 图表:echarts-for-react 柱状图(按维度)+ 饼图(Top5+其他),
 *    经 next/dynamic ssr:false 加载,见 components/charts/index.ts。
 *  - 支持日期范围筛选。
 *
 * 依赖:lib/ppm/task (stat API) + lib/ppm/project (项目名映射) + components/charts。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Table, type TableProps } from "antd";

import { Button } from "@/components/ui/button";
import { WorkHourBarChart, WorkHourPieChart } from "@/components/charts";
import { ApiError } from "@/lib/api";
import {
  statWorkHoursByProject,
  statWorkHoursByUser,
} from "@/lib/ppm/task";
import { listSimpleProjects } from "@/lib/ppm/project";
import type {
  ProjectSimpleItem,
  WorkHourStatItem,
  WorkHourStatResponse,
} from "@/lib/ppm/types";
import { Toast, inputCls, useToast } from "../shared";

type Dimension = "user" | "project";

interface Row extends WorkHourStatItem {
  name: string;
}

export default function WorkHourStatisticsPage() {
  const { toast, showToast } = useToast();

  const [dimension, setDimension] = useState<Dimension>("user");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [byUser, setByUser] = useState<WorkHourStatResponse | null>(null);
  const [byProject, setByProject] = useState<WorkHourStatResponse | null>(null);

  const [projects, setProjects] = useState<ProjectSimpleItem[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        setProjects((await listSimpleProjects()) ?? []);
      } catch (e) {
        console.error("[ppm/work-hour-statistics] load projects failed", e);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      };
      if (dimension === "user") {
        const resp = await statWorkHoursByUser(params);
        setByUser(resp);
      } else {
        const resp = await statWorkHoursByProject(params);
        setByProject(resp);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [dimension, startDate, endDate]);

  useEffect(() => {
    void load();
  }, [load]);

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
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">工时统计</h1>
          <p className="text-xs text-muted-foreground">
            按用户 / 项目聚合工时(基于 stat-by-user / stat-by-project)
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            window.location.href = "/ppm/work-hours";
          }}
        >
          ← 返回工时录入
        </Button>
      </header>

      <Toast toast={toast} />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={dimension}
          onChange={(e) => setDimension(e.target.value as Dimension)}
          className={`w-36 ${inputCls}`}
          aria-label="统计维度"
        >
          <option value="user">按用户</option>
          <option value="project">按项目</option>
        </select>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className={`${inputCls} w-40`}
          aria-label="开始日期"
        />
        <span className="text-xs text-muted-foreground">至</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className={`${inputCls} w-40`}
          aria-label="结束日期"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setStartDate("");
            setEndDate("");
          }}
        >
          清除范围
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          合计 {(totalHours ?? 0).toFixed(1)}h · {rows.length} 项
        </span>
      </div>

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
      ) : rows.length === 0 && !loading ? (
        <div className="rounded border bg-muted/20 px-3 py-10 text-center text-xs text-muted-foreground">
          暂无统计数据,请调整筛选条件或先录入工时
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Table<Row>
            rowKey="key"
            columns={columns}
            dataSource={rows}
            loading={loading}
            size="small"
            pagination={{ pageSize: 50, showSizeChanger: false }}
            locale={{ emptyText: "暂无数据" }}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded border bg-card p-4">
              <h3 className="mb-2 text-sm font-semibold">
                {dimension === "user" ? "用户工时分布" : "项目工时分布"}
              </h3>
              <WorkHourBarChart
                rows={rows}
                color={dimension === "user" ? "#1677ff" : "#52c41a"}
                loading={loading}
              />
            </div>
            <div className="rounded border bg-card p-4">
              <h3 className="mb-2 text-sm font-semibold">
                {dimension === "user" ? "用户工时占比" : "项目工时占比"}
              </h3>
              <WorkHourPieChart rows={rows} totalHours={totalHours} />
            </div>
          </div>
        </div>
      )}
    </div>
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
