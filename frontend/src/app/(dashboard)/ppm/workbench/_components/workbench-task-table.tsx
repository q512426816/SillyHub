"use client";

/**
 * WorkbenchTaskTable — 个人工作台「我的任务」表(自包含 fetch + 筛选, ql-005)。
 *
 * 中栏「我的任务」: 自包含调 listPersonalPlanTasks(带筛选), 不再由 page 下传 tasks。
 *
 * 筛选 toolbar (design §3.3):
 *  - 预设按钮 本周/本月/全部 → 设置日期范围(本周=周一~周日, 本月=1~月末, 全部=置空)
 *  - 日期范围 RangePicker (自定义, 预设按钮控制其值)
 *  - 项目下拉 (listSimpleProjects, value=project_id)
 *  - 模块下拉 (options 从当前结果推导; 选项目→重查→options 自动更新=联动)
 *  - 状态下拉 (未开始/进行中/已完成)
 *  - 重置
 * 日期/项目/状态 → 后端查; 模块 → 前端过滤 (PlanTaskPageReq 无 module 字段)。
 *
 * 「执行」按钮打开 ExecuteTaskDialog (填耗时/说明/提交), 已完成任务禁用。
 */
import { useEffect, useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { DatePicker, Tag, type TableProps } from "antd";

import { DataTable } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import { executePlanTask, listPersonalPlanTasks } from "@/lib/ppm/task";
import { listSimpleProjects } from "@/lib/ppm/project";
import type { PlanTask, PlanTaskPageReq, ProjectSimpleItem } from "@/lib/ppm/types";
import {
  ExecuteTaskDialog,
  type ExecuteTaskState,
} from "../../_components/execute-task-dialog";
import { Toast, fmtDate, taskStatusTag, useToast } from "../../shared";

export interface WorkbenchTaskTableProps {
  /** 执行/提交后回调(page 刷 summary 等)。 */
  onChanged?: () => void;
}

/** 本周一~周日 [start, end] (本地日, 对齐 page 旧 inTaskRange 口径)。 */
function thisWeekRange(): [Dayjs, Dayjs] {
  const today = dayjs();
  const dow = today.day(); // 周日=0..周六=6
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = today.add(offset, "day").startOf("day");
  const sunday = monday.add(6, "day").endOf("day");
  return [monday, sunday];
}

const STATUS_OPTIONS = ["未开始", "进行中", "已完成"] as const;

export function WorkbenchTaskTable({ onChanged }: WorkbenchTaskTableProps) {
  // 查询条件: 日期范围 / 项目(后端) + 模块(前端) + 状态(后端)
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [moduleF, setModuleF] = useState<string>("");
  const [statusF, setStatusF] = useState<string | undefined>(undefined);

  // 项目下拉数据(listSimpleProjects 一次性拉)
  const [projects, setProjects] = useState<ProjectSimpleItem[]>([]);
  useEffect(() => {
    void listSimpleProjects()
      .then(setProjects)
      .catch(() => {
        // 忽略: 下拉空不影响表格
      });
  }, []);

  // 任务查询(后端: start_time/end_time/project_id/status)
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [loading, setLoading] = useState(false);
  const loadTasks = async () => {
    setLoading(true);
    try {
      const params: PlanTaskPageReq = { page: 1, page_size: 100 };
      if (dateRange) {
        params.start_time = dateRange[0].format("YYYY-MM-DD");
        params.end_time = dateRange[1].format("YYYY-MM-DD");
      }
      if (projectId) params.project_id = projectId;
      if (statusF) params.status = [statusF];
      const page = await listPersonalPlanTasks(params);
      setTasks(page.items ?? []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };
  // 日期/项目/状态 变 → 后端重查
  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, projectId, statusF]);

  // 模块下拉 options: 从当前结果推导(选项目后结果变 → options 联动)
  const moduleOptions = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => {
      if (t.module_name) set.add(t.module_name);
    });
    return Array.from(set);
  }, [tasks]);

  // 模块前端过滤(后端无 module 字段)
  const filtered = useMemo(() => {
    return tasks.filter((t) => !moduleF || t.module_name === moduleF);
  }, [tasks, moduleF]);

  // 预设按钮
  const applyPreset = (preset: "week" | "month" | "all") => {
    if (preset === "week") {
      setDateRange(thisWeekRange());
    } else if (preset === "month") {
      setDateRange([dayjs().startOf("month"), dayjs().endOf("month")]);
    } else {
      setDateRange(null); // 全部置空
    }
  };

  // 选项目 → 清旧模块(联动, 旧模块可能不在新项目结果)
  const changeProject = (pid: string) => {
    setProjectId(pid || undefined);
    setModuleF("");
  };

  const reset = () => {
    setDateRange(null);
    setProjectId(undefined);
    setModuleF("");
    setStatusF(undefined);
  };

  // 执行表单/详情
  const [execute, setExecute] = useState<ExecuteTaskState | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailTask, setDetailTask] = useState<PlanTask | null>(null);
  const { toast, showToast } = useToast();

  const handleExecute = async () => {
    if (!execute) return;
    setBusy(true);
    try {
      const timeSpent = execute.timeSpent ? Number(execute.timeSpent) : undefined;
      await executePlanTask({
        plan_task_id: execute.task.id,
        submit: execute.submit,
        execute_info: execute.executeInfo || undefined,
        time_spent:
          timeSpent !== undefined && !Number.isNaN(timeSpent) ? timeSpent : undefined,
      });
      showToast(
        true,
        execute.submit ? "任务已标记当日完成" : "执行进度已保存",
      );
      setExecute(null);
      onChanged?.(); // 通知 page 刷 summary
      void loadTasks(); // 重载本表
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "执行失败");
    } finally {
      setBusy(false);
    }
  };

  const columns: TableProps<PlanTask>["columns"] = [
    {
      title: "序号",
      key: "no",
      width: 50,
      render: (_v: unknown, _t: PlanTask, idx: number) => idx + 1,
    },
    {
      title: "项目",
      dataIndex: "project_name",
      key: "project_name",
      width: 120,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "模块",
      dataIndex: "module_name",
      key: "module_name",
      width: 120,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "任务内容",
      dataIndex: "content",
      key: "content",
      width: 240,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (v: string) => {
        const t = taskStatusTag(v);
        return <Tag color={t.color}>{t.text}</Tag>;
      },
    },
    {
      title: "操作",
      key: "action",
      width: 140,
      render: (_v: unknown, t: PlanTask) => (
        <div className="flex justify-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setDetailTask(t)}>
            详情
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={t.status === "已完成"}
            onClick={() =>
              setExecute({
                task: t,
                executeInfo: "",
                timeSpent: t.time_spent ? String(t.time_spent) : "",
                submit: false,
              })
            }
          >
            执行
          </Button>
        </div>
      ),
    },
  ];

  const inputCls =
    "h-8 rounded border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none";

  return (
    <>
      {/* 筛选 toolbar: 预设 + 日期范围 + 项目 + 模块 + 状态 + 重置 */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => applyPreset("week")}>
            本周
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset("month")}>
            本月
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset("all")}>
            全部
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">日期范围</label>
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(vals) => setDateRange(vals as [Dayjs, Dayjs] | null)}
            size="small"
            allowClear
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">项目</label>
          <select
            value={projectId ?? ""}
            onChange={(e) => changeProject(e.target.value)}
            className={`${inputCls} w-40`}
          >
            <option value="">全部项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">模块</label>
          <select
            value={moduleF}
            onChange={(e) => setModuleF(e.target.value)}
            className={`${inputCls} w-36`}
          >
            <option value="">全部模块</option>
            {moduleOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">状态</label>
          <select
            value={statusF ?? ""}
            onChange={(e) => setStatusF(e.target.value || undefined)}
            className={`${inputCls} w-28`}
          >
            <option value="">全部状态</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" variant="outline" onClick={reset}>
          重置
        </Button>
      </div>
      <DataTable<PlanTask>
        rowKey="id"
        size="small"
        bordered
        scroll={{ x: "max-content" }}
        columns={columns}
        dataSource={filtered}
        loading={loading}
        emptyText="暂无任务"
      />

      {/* 执行表单(共享 ExecuteTaskDialog,填耗时/说明/提交) */}
      {execute && (
        <ExecuteTaskDialog
          state={execute}
          onChange={setExecute}
          onConfirm={() => void handleExecute()}
          onCancel={() => setExecute(null)}
          busy={busy}
        />
      )}

      {/* 详情 dialog(只读任务完整字段) */}
      {detailTask && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setDetailTask(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>任务详情</DialogTitle>
              <DialogDescription>
                {detailTask.content ?? "（未填写）"}
              </DialogDescription>
            </DialogHeader>
            <dl className="space-y-1.5 text-xs">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">项目</dt>
                <dd className="min-w-0 flex-1">
                  {detailTask.project_name ?? "—"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">模块</dt>
                <dd>{detailTask.module_name ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">状态</dt>
                <dd>{taskStatusTag(detailTask.status).text}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">开始时间</dt>
                <dd>{fmtDate(detailTask.start_time)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">截止时间</dt>
                <dd>{fmtDate(detailTask.end_time)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">计划工时</dt>
                <dd>{detailTask.work_load ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">配合人员</dt>
                <dd>{detailTask.work_partner ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">备注</dt>
                <dd className="min-w-0 break-all">
                  {detailTask.remarks ?? "—"}
                </dd>
              </div>
            </dl>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDetailTask(null)}
              >
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Toast toast={toast} />
    </>
  );
}
