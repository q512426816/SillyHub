"use client";

/**
 * 任务执行 (TaskExecute) 详情页 (task-06 / FR-06)。
 *
 * 与 task-plans/page.tsx 的 ExecuteDialog (写操作模态) 并存:
 * 本页是只读详情视图,聚焦「执行记录追溯 + 工时汇总 + 状态流转」。
 *
 * 功能:
 *  - 列表态:分页 task-execute/page,展示所有任务执行记录。
 *  - 行展开详情:ExecuteDetailPanel 反查关联 PlanTask (getPlanTask),
 *    展示执行说明 / 工时 / 起止时间 / 状态标签。
 *  - 边界:
 *    - 关联任务已删除:getPlanTask 抛 404 → 显示「关联任务已删除」,
 *      execute 本身字段仍渲染 (AC-08)。
 *    - 工时为 0:显式「工时:0」,区分「未填报」(AC-09)。
 *
 * 依赖:lib/ppm/task (API) + AntD Table + shared (taskStatusTag/fmtDate)。
 *
 * 设计依据:tasks/task-06.md §实现要求 3 + §边界处理 4/5 + §验收 AC-07~09。
 */
import { useCallback, useEffect, useState } from "react";
import { Table, type TableProps, Tag } from "antd";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { getPlanTask, listTaskExecutes } from "@/lib/ppm/task";
import type {
  PageResp,
  PlanTask,
  TaskExecute,
  TaskExecutePageReq,
} from "@/lib/ppm/types";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Toast,
  fmtDate,
  inputCls,
  taskStatusTag,
  useToast,
} from "../shared";

export default function TaskExecutePage() {
  const { toast, showToast } = useToast();
  const [rows, setRows] = useState<TaskExecute[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // 筛选
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>("");

  // 展开的详情面板
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: TaskExecutePageReq = {
        page,
        page_size: pageSize,
        status: statusFilter || null,
        execute_user_id: userFilter || null,
      };
      const resp: PageResp<TaskExecute> = await listTaskExecutes(params);
      setRows(resp.items ?? []);
      setTotal(resp.total ?? 0);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "加载失败";
      setError(msg);
      showToast(false, msg);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, userFilter, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: TableProps<TaskExecute>["columns"] = [
    {
      title: "执行记录",
      key: "exec",
      render: (_v, e: TaskExecute) => (
        <div className="flex flex-col">
          <span className="line-clamp-1 max-w-md text-sm">
            {e.execute_info ?? "（未填写执行说明）"}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {e.id}
          </span>
        </div>
      ),
    },
    {
      title: "关联任务",
      dataIndex: "plan_task_id",
      key: "plan_task_id",
      render: (v: string | null) =>
        v ? (
          <span className="font-mono text-xs text-muted-foreground">{v}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      title: "执行人",
      dataIndex: "execute_user_id",
      key: "execute_user_id",
      render: (v: string | null) =>
        v ? (
          <span className="font-mono text-xs">{v}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => {
        const tag = taskStatusTag(v);
        return <Tag color={tag.color}>{tag.text}</Tag>;
      },
    },
    {
      title: "工时",
      dataIndex: "time_spent",
      key: "time_spent",
      align: "right",
      render: (v: number | null) => (
        <span className="text-sm tabular-nums">
          {v === null || v === undefined ? "—" : v}
        </span>
      ),
    },
    {
      title: "执行时间",
      key: "time",
      render: (_v, e: TaskExecute) => (
        <div className="flex flex-col text-xs text-muted-foreground">
          <span>起 {fmtDate(e.actual_start_time)}</span>
          <span>止 {fmtDate(e.actual_end_time)}</span>
        </div>
      ),
    },
    {
      title: "操作",
      key: "actions",
      align: "center",
      render: (_v, e: TaskExecute) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
        >
          {expandedId === e.id ? "收起" : "详情"}
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">任务执行详情</h1>
          <p className="text-xs text-muted-foreground">
            任务执行记录追溯 / 工时汇总 / 状态流转时间线
          </p>
        </div>
      </header>

      <Toast toast={toast} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] text-muted-foreground">状态筛选</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className={`mt-0.5 w-36 ${inputCls}`}
            aria-label="状态筛选"
          >
            <option value="">全部</option>
            <option value="10">待执行</option>
            <option value="20">执行中</option>
            <option value="30">待验证</option>
            <option value="40">已完成</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">
            执行人 ID
          </label>
          <input
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              setPage(1);
            }}
            placeholder="UUID"
            className={`mt-0.5 w-64 ${inputCls}`}
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          刷新
        </Button>
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
      ) : (
        <div className="flex flex-col gap-3">
          <Table<TaskExecute>
            rowKey="id"
            columns={columns}
            dataSource={rows}
            rowClassName={(_row, idx) => (idx % 2 === 1 ? "bg-muted/40" : "")}
            loading={loading}
            size="small"
            scroll={{ x: "max-content" }}
            pagination={{
              current: page,
              pageSize,
              total,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              showSizeChanger: true,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
            locale={{ emptyText: "暂无任务执行记录" }}
          />
          {expandedId && (
            <ExecuteDetailPanel
              execute={rows.find((r) => r.id === expandedId) ?? null}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 执行详情面板 — 反查关联 PlanTask,展示执行详情 + 状态时间线。
 *
 * 边界:
 *  - 关联任务已删除 (getPlanTask 404):显示「关联任务已删除」,
 *    execute 本身字段仍渲染。
 *  - 工时为 0:显式「工时:0」,区分「未填报」。
 */
function ExecuteDetailPanel({ execute }: { execute: TaskExecute | null }) {
  const [planTask, setPlanTask] = useState<PlanTask | null>(null);
  const [taskDeleted, setTaskDeleted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!execute?.plan_task_id) {
      setPlanTask(null);
      setTaskDeleted(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setTaskDeleted(false);
    getPlanTask(execute.plan_task_id)
      .then((t) => {
        if (!cancelled) setPlanTask(t);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setTaskDeleted(true);
          setPlanTask(null);
        } else {
          setTaskDeleted(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [execute?.plan_task_id]);

  if (!execute) return null;

  const statusTag = taskStatusTag(execute.status);
  const timeSpentLabel =
    execute.time_spent === null || execute.time_spent === undefined
      ? "—"
      : String(execute.time_spent);

  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex items-center justify-between border-b pb-2">
        <h3 className="text-sm font-semibold">执行详情</h3>
        <Tag color={statusTag.color}>{statusTag.text}</Tag>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 关联任务区段 */}
        <div>
          <h4 className="text-[11px] font-medium text-muted-foreground">
            关联任务
          </h4>
          {loading ? (
            <p className="mt-1 text-xs text-muted-foreground">加载中…</p>
          ) : taskDeleted || !planTask ? (
            <p className="mt-1 text-xs text-amber-600">关联任务已删除</p>
          ) : (
            <div className="mt-1 space-y-1 text-xs">
              <FieldRow label="任务内容" value={planTask.content} />
              <FieldRow label="所属项目" value={planTask.project_name} />
              <FieldRow label="所属模块" value={planTask.module_name} />
              <FieldRow label="负责人" value={planTask.user_name} />
              <FieldRow
                label="计划时间"
                value={`${planTask.start_time ?? "—"} ~ ${planTask.end_time ?? "—"}`}
              />
            </div>
          )}
        </div>

        {/* 执行信息区段 */}
        <div>
          <h4 className="text-[11px] font-medium text-muted-foreground">
            执行信息
          </h4>
          <div className="mt-1 space-y-1 text-xs">
            <FieldRow label="执行人 ID" value={execute.execute_user_id} />
            <FieldRow label="工时（小时）" value={timeSpentLabel} />
            <FieldRow
              label="实际开始"
              value={fmtDate(execute.actual_start_time)}
            />
            <FieldRow
              label="实际结束"
              value={fmtDate(execute.actual_end_time)}
            />
            <FieldRow label="开始备注" value={execute.start_remark} />
            <FieldRow label="结束备注" value={execute.end_remark} />
          </div>
        </div>
      </div>

      <div className="mt-3">
        <h4 className="text-[11px] font-medium text-muted-foreground">
          执行说明
        </h4>
        <p className="mt-1 whitespace-pre-wrap rounded border bg-muted/30 px-3 py-2 text-xs">
          {execute.execute_info ?? "（未填写执行说明）"}
        </p>
      </div>

      {/* 状态流转时间线 (简化:基于 status + 时间戳) */}
      <div className="mt-3">
        <h4 className="text-[11px] font-medium text-muted-foreground">
          状态流转
        </h4>
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          <TimelineItem
            label="执行开始"
            time={execute.actual_start_time}
            active={execute.actual_start_time != null}
          />
          <TimelineItem
            label="执行结束"
            time={execute.actual_end_time}
            active={execute.actual_end_time != null}
          />
          <TimelineItem
            label="记录创建"
            time={execute.created_at}
            active
          />
          <TimelineItem
            label="最后更新"
            time={execute.updated_at}
            active
          />
        </div>
      </div>

      {/* 验证信息 (若已被验证) */}
      {execute.check_flag != null && (
        <div className="mt-3 rounded border bg-muted/20 px-3 py-2 text-xs">
          <h4 className="text-[11px] font-medium text-muted-foreground">
            验证信息
          </h4>
          <div className="mt-1 space-y-1">
            <FieldRow
              label="验证结果"
              value={execute.check_flag === "1" ? "通过" : "未通过"}
            />
            <FieldRow label="验证人 ID" value={execute.check_user_id} />
            <FieldRow label="验证说明" value={execute.check_info} />
          </div>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="flex-1 break-all">
        {value === null || value === undefined || value === "" ? "—" : value}
      </span>
    </div>
  );
}

function TimelineItem({
  label,
  time,
  active,
}: {
  label: string;
  time: string | null | undefined;
  active: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1 rounded border px-2 py-1 ${
        active
          ? "border-ring/30 bg-background"
          : "border-dashed border-muted bg-muted/20 text-muted-foreground"
      }`}
    >
      <span className="font-medium">{label}</span>
      <span className="tabular-nums">{active ? fmtDate(time) : "—"}</span>
    </div>
  );
}
