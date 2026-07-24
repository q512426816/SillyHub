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
 *  - 状态下拉 (未开始/进行中/已完成)
 *  - 重置
 *  日期/项目/状态 → 后端查; module_name 由后端按 module_id 反查补值(表冗余字段历史空, 模块列仅展示不参与筛选)。
 *
 * 「详情/执行」打开 TaskDetailModal(与任务计划页同款,含任务信息+执行记录+跨天填报);
 * 「启动」只切状态(D-002,对齐任务计划页),不弹执行填写窗。
 */
import { useEffect, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { DatePicker, Select, Tag, type TableProps } from "antd";

import { DataTable } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { listPersonalPlanTasks, startPlanTask } from "@/lib/ppm/task";
import { listSimpleProjects } from "@/lib/ppm/project";
import type { PlanTask, PlanTaskPageReq, ProjectSimpleItem } from "@/lib/ppm/types";
import {
  TaskDetailModal,
  type TaskDetailMode,
} from "../../_components/task-detail-modal";
import { Toast, taskStatusTag, useToast } from "../../shared";

export interface WorkbenchTaskTableProps {
  /** 执行/提交后回调(page 刷 summary 等)。 */
  onChanged?: () => void;
  /** 切换查看的目标用户 id;null/undefined=当前登录人(D-004 任务表跟随切换)。 */
  targetUserId?: string | null;
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

export function WorkbenchTaskTable({ onChanged, targetUserId }: WorkbenchTaskTableProps) {
  // 查询条件: 日期范围 / 项目(后端) / 状态(后端)
  // 默认本月 + 未开始/进行中(进行中任务最需本人关注)
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(() => [
    dayjs().startOf("month"),
    dayjs().endOf("month"),
  ]);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [statusF, setStatusF] = useState<string[]>(["未开始", "进行中"]);

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
      if (statusF.length > 0) params.status = statusF;
      const page = await listPersonalPlanTasks(params, targetUserId);
      setTasks(page.items ?? []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };
  // 日期/项目/状态/target 变 → 后端重查
  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, projectId, statusF, targetUserId]);

  // 预设按钮高亮: 日期范围与预设区间一致时标记对应预设(自定义/清空后取消高亮)
  const [activePreset, setActivePreset] = useState<"week" | "month" | "all" | null>(
    "month",
  );

  // 预设按钮
  const applyPreset = (preset: "week" | "month" | "all") => {
    setActivePreset(preset);
    if (preset === "week") {
      setDateRange(thisWeekRange());
    } else if (preset === "month") {
      setDateRange([dayjs().startOf("month"), dayjs().endOf("month")]);
    } else {
      setDateRange(null); // 全部置空
    }
  };

  const reset = () => {
    setDateRange([dayjs().startOf("month"), dayjs().endOf("month")]);
    setProjectId(undefined);
    setStatusF(["未开始", "进行中"]);
    setActivePreset("month");
  };

  // 详情/执行弹窗(抽自任务计划页的 TaskDetailModal)
  const [detailTask, setDetailTask] = useState<PlanTask | null>(null);
  const [detailMode, setDetailMode] = useState<TaskDetailMode>("detail");
  const { toast, showToast } = useToast();

  // 启动只切状态(D-002, 对齐任务计划页): startPlanTask→刷本表+回调 page 刷 summary+toast, 不弹执行窗
  const handleStart = async (task: PlanTask) => {
    try {
      await startPlanTask({ plan_task_id: task.id });
      showToast(true, "任务已启动，点「执行」填报进展");
      onChanged?.(); // 通知 page 刷 summary
      await loadTasks(); // 刷新列表显示"进行中"
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "启动失败");
    }
  };

  const columns: TableProps<PlanTask>["columns"] = [
    {
      title: "序号",
      key: "no",
      width: 50,
      align: "center",
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
      align: "center",
      width: 180,
      render: (_v: unknown, t: PlanTask) => (
        <div className="flex whitespace-nowrap gap-1 justify-center">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDetailTask(t);
              setDetailMode("detail");
            }}
          >
            详情
          </Button>
          {t.status === "未开始" && (
            <Button size="sm" variant="ghost" onClick={() => void handleStart(t)}>
              启动
            </Button>
          )}
          {t.status === "进行中" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDetailTask(t);
                setDetailMode("execute");
              }}
            >
              执行
            </Button>
          )}
        </div>
      ),
    },
  ];

  const inputCls =
    "h-8 rounded-md border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none";

  return (
    <>
      {/* 筛选 toolbar: 预设 + 日期范围 + 项目 + 状态 + 重置 */}
      <div className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-muted/40 p-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">快捷范围</label>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={activePreset === "week" ? "default" : "outline"}
              onClick={() => applyPreset("week")}
            >
              本周
            </Button>
            <Button
              size="sm"
              variant={activePreset === "month" ? "default" : "outline"}
              onClick={() => applyPreset("month")}
            >
              本月
            </Button>
            <Button
              size="sm"
              variant={activePreset === "all" ? "default" : "outline"}
              onClick={() => applyPreset("all")}
            >
              全部
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">日期范围</label>
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(vals) => {
              setDateRange(vals as [Dayjs, Dayjs] | null);
              setActivePreset(null); // 手动改日期 → 取消预设高亮
            }}
            size="small"
            allowClear
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">项目</label>
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value || undefined)}
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
          <label className="text-[11px] text-muted-foreground">状态</label>
          <Select
            mode="multiple"
            value={statusF}
            onChange={(v: string[]) => setStatusF(v)}
            size="small"
            allowClear
            placeholder="全部状态"
            style={{ minWidth: 160 }}
            options={STATUS_OPTIONS.map((s) => ({ label: s, value: s }))}
          />
        </div>
        <Button size="sm" variant="outline" onClick={reset}>
          重置
        </Button>
      </div>
      <DataTable<PlanTask>
        rowKey="id"
        size="small"
        bordered
        tableLayout="fixed"
        columns={columns}
        dataSource={tasks}
        loading={loading}
        emptyText="暂无任务"
      />

      {/* 任务详情/执行弹窗(抽自任务计划页的 TaskDetailModal, 2026-07-20-workbench-task-modal-align) */}
      <TaskDetailModal
        task={detailTask}
        mode={detailMode}
        onClose={() => setDetailTask(null)}
        onChanged={() => {
          onChanged?.();
          void loadTasks();
        }}
      />

      <Toast toast={toast} />
    </>
  );
}
