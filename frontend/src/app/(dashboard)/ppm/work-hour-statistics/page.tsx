"use client";

/**
 * 工时统计页面 (task-12 / FR-06)。
 *
 * 设计:
 *  - 不引入新 npm 依赖(项目无 ECharts/@ant-design/plots)。
 *  - 用 AntD Table + Progress(水平条)近似柱状图;
 *  - 用纯 CSS conic-gradient 渲染饼图占比(零依赖,够用)。
 *  - 两张表:按用户聚合 / 按项目聚合,来自 stat-by-user / stat-by-project。
 *  - 支持日期范围筛选。
 *
 * 依赖:lib/ppm/task (stat API) + lib/ppm/project (项目名映射) + lib/admin (用户名映射可选)。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Progress, Table, type TableProps, Tag } from "antd";

import { Button } from "@/components/ui/button";
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
  const maxHours = rows.length > 0 ? (rows[0]?.total_hours ?? 0) : 0;

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
      render: (_v, r: Row) => {
        const ratio = totalHours > 0 ? (r.total_hours / totalHours) * 100 : 0;
        return (
          <div className="flex items-center gap-2">
            <Progress
              percent={Math.round(ratio * 10) / 10}
              size="small"
              strokeColor={dimension === "user" ? "#1677ff" : "#52c41a"}
              style={{ width: 120, marginBottom: 0 }}
            />
            <span className="text-xs text-muted-foreground">
              {ratio.toFixed(1)}%
            </span>
          </div>
        );
      },
    },
    {
      title: "柱状条",
      key: "bar",
      render: (_v, r: Row) => {
        const pct = maxHours > 0 ? (r.total_hours / maxHours) * 100 : 0;
        return (
          <Progress
            percent={Math.round(pct)}
            size="small"
            strokeColor={dimension === "user" ? "#1677ff" : "#52c41a"}
            style={{ width: 180, marginBottom: 0 }}
          />
        );
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
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex-1">
            <Table<Row>
              rowKey="key"
              columns={columns}
              dataSource={rows}
              loading={loading}
              size="small"
              pagination={{ pageSize: 50, showSizeChanger: false }}
              locale={{ emptyText: "暂无数据" }}
            />
          </div>
          <div className="w-full lg:w-80">
            <PiePanel rows={rows} totalHours={totalHours} dimension={dimension} />
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

/**
 * 零依赖饼图:用 CSS conic-gradient 渲染占比环。
 * 仅展示 Top 5 + 其他聚合,避免颜色爆炸。
 */
const PIE_COLORS = [
  "#1677ff",
  "#52c41a",
  "#faad14",
  "#eb2f96",
  "#722ed1",
  "#8c8c8c",
];

function PiePanel({
  rows,
  totalHours,
  dimension,
}: {
  rows: Row[];
  totalHours: number;
  dimension: Dimension;
}) {
  const top = rows.slice(0, 5);
  const rest = rows.slice(5);
  const restHours = rest.reduce((s, r) => s + r.total_hours, 0);

  const slices = top.map((r, i) => ({
    label: r.name || r.key,
    hours: r.total_hours,
    color: PIE_COLORS[i] ?? PIE_COLORS[PIE_COLORS.length - 1],
  }));
  if (restHours > 0) {
    slices.push({
      label: `其他(${rest.length})`,
      hours: restHours,
      color: PIE_COLORS[PIE_COLORS.length - 1],
    });
  }

  const stops: string[] = [];
  let acc = 0;
  for (const s of slices) {
    const start = totalHours > 0 ? (acc / totalHours) * 100 : 0;
    acc += s.hours;
    const end = totalHours > 0 ? (acc / totalHours) * 100 : 0;
    stops.push(`${s.color} ${start}% ${end}%`);
  }
  const gradient =
    stops.length > 0 ? `conic-gradient(${stops.join(", ")})` : "#e5e7eb";

  return (
    <div className="rounded border bg-card p-4">
      <h3 className="text-sm font-semibold">
        {dimension === "user" ? "用户工时占比" : "项目工时占比"}
      </h3>
      <div className="mt-3 flex items-center gap-4">
        <div
          className="relative h-32 w-32 shrink-0 rounded-full"
          style={{ background: gradient }}
          aria-label="工时占比饼图"
          role="img"
        />
        <div className="flex-1 space-y-1">
          {slices.length === 0 ? (
            <span className="text-xs text-muted-foreground">无数据</span>
          ) : (
            slices.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: s.color }}
                />
                <span className="flex-1 truncate">{s.label}</span>
                <span className="font-mono text-muted-foreground">
                  {s.hours.toFixed(1)}h
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="mt-3 border-t pt-2">
        <Tag color="default" className="text-[10px]">
          零依赖渲染(CSS conic-gradient)
        </Tag>
      </div>
    </div>
  );
}
