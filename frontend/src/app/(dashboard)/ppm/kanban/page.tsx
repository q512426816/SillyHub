"use client";

/**
 * 看板主页 — 人员 × 日期矩阵布局(对齐源 task-kanban 矩阵语义)。
 *
 * 布局(自上而下):
 *  - KanbanSearchBar(项目/状态/人员/关键词/截止范围/新建按钮)
 *  - 顶部一行:KanbanDateNav(上周/本周/下周 + RangePicker)
 *  - 主体两栏:
 *    · 左:KanbanMatrix(纵人员,横日期,单元格=该人该日任务缩略卡)
 *    · 右(固定 380px):KanbanWorkHourChart(默认全员柱图,点人员行切单人项目饼图)
 *
 * 数据:全部走 useKanbanStore(tasks 含 user_id + deadline),
 * 工时图表用 statWorkHoursByUser + tasks 按 project 前端聚合。
 *
 * 筛选与日期范围(对齐源 selectKanbanCards 无日期过滤,任务默认全量):
 *  - DateNav 仅决定矩阵**展示**的日期列(本周/上周/下周/自定义),不参与任务拉取过滤
 *  - SearchBar 的截止范围决定**任务拉取**的过滤(可选,用户手动选才触发)
 *  - 任务默认全量拉取;DateNav 切换只改矩阵展示列,不重拉
 *
 * 弹窗/抽屉:Create / Edit / Assign / Detail / ContextMenu 全部保留。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dayjs, { type Dayjs } from "dayjs";

import {
  listSimpleProjects,
} from "@/lib/ppm/project";
import { DatePicker, Form, message, Modal, Radio, Tabs } from "antd";
import type {
  KanbanTaskCard,
  ProjectSimpleItem,
  TaskExecuteWithPlan,
} from "@/lib/ppm/types";
import { listTaskExecutesWithPlanByDateRange, updateTaskExecute } from "@/lib/ppm/task";
import { useKanbanStore } from "@/stores/kanban";
import { tokens } from "@/styles";
import { Toast, useToast } from "../shared";
import { KanbanSearchBar } from "./_components/kanban-search-bar";
import { KanbanGantt } from "./_components/kanban-gantt";
import { KanbanActualGantt } from "./_components/kanban-actual-gantt";
import { KanbanDateNav } from "./_components/kanban-date-nav";
import { KanbanWorkHourChart } from "./_components/kanban-work-hour-chart";
import { KanbanCreateTaskDialog } from "./_components/kanban-create-task-dialog";
import { KanbanEditTaskDialog } from "./_components/kanban-edit-task-dialog";
import { KanbanAssignTaskDialog } from "./_components/kanban-assign-task-dialog";
import {
  KanbanTaskContextMenu,
  type ContextMenuState,
} from "./_components/kanban-task-context-menu";
import { KanbanTaskDetailDrawer } from "./_components/kanban-task-detail-drawer";

/** 以周一为起点的本周范围 [weekStart, weekEnd](Dayjs)。 */
function thisWeekRange(): [Dayjs, Dayjs] {
  const today = dayjs();
  const dow = today.day(); // 周日=0,周一=1 ... 周六=6
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = today.add(offset, "day").startOf("day");
  const sunday = monday.add(6, "day").endOf("day");
  return [monday, sunday];
}

/**
 * 项目色点调色板(任务-09):全部走 task-01 的 tokens 色阶,不用 antd 老色板。
 * 取 blue 色阶多档 + cyan + emerald + slate 兜底,保持视觉区分度。
 */
const PALETTE = [
  tokens.color.blue[500],
  tokens.color.blue[600],
  tokens.color.blue[700],
  tokens.color.blue[400],
  tokens.color.cyan,
  tokens.color.emerald,
  tokens.color.blue[300],
  tokens.color.slate[500],
];

export default function KanbanPage() {
  const { toast } = useToast();

  const users = useKanbanStore((s) => s.users);
  const tasks = useKanbanStore((s) => s.tasks);
  const loading = useKanbanStore((s) => s.loading);
  const filters = useKanbanStore((s) => s.filters);
  const fetchUsers = useKanbanStore((s) => s.fetchUsers);
  const fetchTasks = useKanbanStore((s) => s.fetchTasks);
  const reset = useKanbanStore((s) => s.reset);

  // 日期范围(默认本周一~周日)
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(thisWeekRange);
  const [projects, setProjects] = useState<ProjectSimpleItem[]>([]);

  // 工时图表选中的人员(联动矩阵行头)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // 弹窗状态
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaultAssignee, setCreateDefaultAssignee] = useState<
    string | undefined
  >(undefined);
  const [editOpen, setEditOpen] = useState(false);
  const [editTask, setEditTask] = useState<KanbanTaskCard | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTask, setAssignTask] = useState<KanbanTaskCard | null>(null);
  const [detailTask, setDetailTask] = useState<KanbanTaskCard | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // 计划/实际 tab + 实际工作表数据(对齐源 Home ScheduleCard/WorkCard)
  const [activeTab, setActiveTab] = useState<"plan" | "actual">("plan");
  const [actualExecutes, setActualExecutes] = useState<TaskExecuteWithPlan[]>([]);
  const [actualLoading, setActualLoading] = useState(false);
  const [displayMode, setDisplayMode] = useState<"both" | "task" | "problem">("both");
  const [editExecute, setEditExecute] = useState<TaskExecuteWithPlan | null>(null);

  // 首屏拉数据 + 项目列表
  useEffect(() => {
    void Promise.all([fetchUsers(), fetchTasks(), loadProjects()]).catch(() => {
      // store 内已 message.error,这里吞掉避免未处理 rejection
    });
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const list = await listSimpleProjects();
      setProjects(list);
    } catch {
      // 忽略:工时图按 id 兜底显示,不阻断看板
    }
  }, []);

  // filters 变化时重拉(任务默认全量,对齐源 selectKanbanCards 无日期过滤;
  // 日期范围仅由 SearchBar 截止范围可选过滤,DateNav 不参与查询)
  useEffect(() => {
    void Promise.all([fetchUsers(), fetchTasks()]).catch(() => {
      // store 内已 message.error
    });
  }, [filters, fetchUsers, fetchTasks]);

  // 实际工作表:tab=actual 时按 dateRange/projectId 拉 TaskExecute(对齐源 generateWorkData)
  const fetchActualExecutes = useCallback(async () => {
    setActualLoading(true);
    try {
      const list = await listTaskExecutesWithPlanByDateRange(
        dateRange[0].format("YYYY-MM-DD"),
        dateRange[1].format("YYYY-MM-DD"),
        { projectId: filters.project_id },
      );
      setActualExecutes(list);
    } catch (err) {
      setActualExecutes([]);
      message.error(
        err instanceof Error ? err.message : "加载实际工作表失败",
      );
    } finally {
      setActualLoading(false);
    }
  }, [dateRange, filters.project_id]);

  useEffect(() => {
    if (activeTab === "actual") void fetchActualExecutes();
  }, [activeTab, fetchActualExecutes]);

  // displayMode 过滤实际工作(按 problem_task_id 判 itemType,对齐源 WorkCard)
  const filteredExecutes = useMemo(() => {
    if (displayMode === "both") return actualExecutes;
    return actualExecutes.filter((e) =>
      displayMode === "problem" ? e.problem_task_id : !e.problem_task_id,
    );
  }, [actualExecutes, displayMode]);

  // projectId → 稳定颜色(矩阵卡片色点)
  const projectColorMap = useMemo(() => {
    const m = new Map<string, string>();
    // 收集出现过的 project_id(任务里 + projects 里)
    const ids = new Set<string>();
    for (const t of tasks) if (t.project_id) ids.add(t.project_id);
    for (const p of projects) ids.add(p.id);
    let i = 0;
    for (const id of ids) {
      m.set(id, PALETTE[i % PALETTE.length]!);
      i++;
    }
    return m;
  }, [tasks, projects]);

  // -------------------------------------------------------------------------
  // handlers
  // -------------------------------------------------------------------------
  const handleTaskClick = (task: KanbanTaskCard) => setDetailTask(task);
  const handleContextMenu = (task: KanbanTaskCard, e: React.MouseEvent) => {
    setContextMenu({ task, x: e.clientX, y: e.clientY });
  };
  const handleEdit = (task: KanbanTaskCard) => {
    setEditTask(task);
    setEditOpen(true);
  };
  const handleAssign = (task: KanbanTaskCard) => {
    setAssignTask(task);
    setAssignOpen(true);
  };

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchTasks(), fetchUsers()]).catch(() => {
      // store 内已 message.error
    });
  }, [fetchTasks, fetchUsers]);

  return (
    <div className="flex h-full flex-col">
      <KanbanSearchBar
        onCreateTask={() => {
          setCreateDefaultAssignee(undefined);
          setCreateOpen(true);
        }}
      />

      <Toast toast={toast} />

      {/* 日期导航条(计划/实际两 tab 共享) */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-2">
        <KanbanDateNav range={dateRange} onChange={setDateRange} />
        <div className="text-xs text-muted-foreground">
          {activeTab === "plan"
            ? loading
              ? "加载中…"
              : `共 ${tasks.length} 个任务 / ${users.length} 人`
            : actualLoading
              ? "加载中…"
              : `共 ${filteredExecutes.length} 条实际工作 / ${users.length} 人`}
        </div>
      </div>

      {/* 主体:计划/实际 tab(对齐源 Home ScheduleCard/WorkCard) */}
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as "plan" | "actual")}
        className="flex flex-1 flex-col overflow-hidden px-3 pt-2 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-content]:h-full [&_.ant-tabs-tabpane]:h-full"
        items={[
          {
            key: "plan",
            label: "团队计划排程表",
            children: (
              <div className="flex h-full gap-3 overflow-hidden">
                <div className="min-w-0 flex-1">
                  <KanbanGantt
                    users={users}
                    tasks={tasks}
                    startDate={dateRange[0].format("YYYY-MM-DD")}
                    endDate={dateRange[1].format("YYYY-MM-DD")}
                    selectedUserId={selectedUserId}
                    onSelectUser={setSelectedUserId}
                    onTaskClick={handleTaskClick}
                    onTaskContextMenu={handleContextMenu}
                    projectColorMap={projectColorMap}
                  />
                </div>
                <div className="w-[380px] shrink-0">
                  <KanbanWorkHourChart
                    startDate={dateRange[0].format("YYYY-MM-DD")}
                    endDate={dateRange[1].format("YYYY-MM-DD")}
                    users={users}
                    projects={projects}
                    tasks={tasks}
                    selectedUserId={selectedUserId}
                    onClearSelect={() => setSelectedUserId(null)}
                  />
                </div>
              </div>
            ),
          },
          {
            key: "actual",
            label: "团队实际工作表",
            children: (
              <div className="flex h-full gap-3 overflow-hidden">
                <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">显示:</span>
                    <Radio.Group
                      size="small"
                      value={displayMode}
                      onChange={(e) =>
                        setDisplayMode(
                          e.target.value as "both" | "task" | "problem",
                        )
                      }
                      options={[
                        { value: "both", label: "全部" },
                        { value: "task", label: "计划任务" },
                        { value: "problem", label: "问题任务" },
                      ]}
                    />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <KanbanActualGantt
                      users={users}
                      executes={filteredExecutes}
                      startDate={dateRange[0].format("YYYY-MM-DD")}
                      endDate={dateRange[1].format("YYYY-MM-DD")}
                      selectedUserId={selectedUserId}
                      onSelectUser={setSelectedUserId}
                      onEdit={(e) => setEditExecute(e)}
                    />
                  </div>
                </div>
                <div className="w-[380px] shrink-0">
                  <KanbanWorkHourChart
                    startDate={dateRange[0].format("YYYY-MM-DD")}
                    endDate={dateRange[1].format("YYYY-MM-DD")}
                    users={users}
                    projects={projects}
                    tasks={tasks}
                    selectedUserId={selectedUserId}
                    onClearSelect={() => setSelectedUserId(null)}
                  />
                </div>
              </div>
            ),
          },
        ]}
      />

      {/* 实际工作 cell 编辑(改 actual_start/end_time,仅 status=90) */}
      <ActualEditModal
        execute={editExecute}
        onClose={() => setEditExecute(null)}
        onSaved={() => {
          setEditExecute(null);
          void fetchActualExecutes();
        }}
      />

      {/* 弹窗 / 抽屉 / 菜单 */}
      <KanbanCreateTaskDialog
        open={createOpen}
        defaultAssigneeId={createDefaultAssignee}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => void refreshAll()}
      />
      <KanbanEditTaskDialog
        open={editOpen}
        task={editTask}
        onClose={() => {
          setEditOpen(false);
          setEditTask(null);
        }}
        onSuccess={() => void refreshAll()}
      />
      <KanbanAssignTaskDialog
        open={assignOpen}
        task={assignTask}
        onClose={() => {
          setAssignOpen(false);
          setAssignTask(null);
        }}
        onSuccess={() => void refreshAll()}
      />
      <KanbanTaskContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        onViewDetail={(t) => setDetailTask(t)}
        onEdit={handleEdit}
        onAssign={handleAssign}
        onDeleted={() => void refreshAll()}
      />
      <KanbanTaskDetailDrawer
        task={detailTask}
        onClose={() => setDetailTask(null)}
        onTaskUpdated={(updated) =>
          setDetailTask((cur) => (cur ? { ...cur, ...updated } : cur))
        }
      />
    </div>
  );
}

/** 实际工作详情(展示字段 + 仅 status=90 可编辑 actual_start/end_time)。 */
function ActualEditModal({
  execute,
  onClose,
  onSaved,
}: {
  execute: TaskExecuteWithPlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const editable = execute?.status === "90";

  useEffect(() => {
    if (execute) {
      form.setFieldsValue({
        actual_start_time: execute.actual_start_time
          ? dayjs(execute.actual_start_time)
          : null,
        actual_end_time: execute.actual_end_time
          ? dayjs(execute.actual_end_time)
          : null,
      });
    }
  }, [execute, form]);

  const submit = async () => {
    if (!execute) return;
    if (!editable) {
      onClose();
      return;
    }
    try {
      const vals = await form.validateFields();
      setBusy(true);
      try {
        await updateTaskExecute(execute.id, {
          actual_start_time: vals.actual_start_time
            ? vals.actual_start_time.toISOString()
            : null,
          actual_end_time: vals.actual_end_time
            ? vals.actual_end_time.toISOString()
            : null,
        });
        onSaved();
      } catch (err) {
        message.error(
          err instanceof Error ? err.message : "保存实际工时失败",
        );
      }
    } catch {
      // validateFields 失败:AntD Form.Item 已显示字段级错误,无需额外提示
    } finally {
      setBusy(false);
    }
  };

  const STATUS_TEXT: Record<string, string> = {
    "10": "待开始",
    "20": "进行中",
    "30": "待验证",
    "40": "验证中",
    "90": "已完成",
  };
  const fmt = (v: string | null) =>
    v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—";

  return (
    <Modal
      title="实际工作详情"
      open={execute !== null}
      onOk={() => void submit()}
      okText={editable ? "保存" : "关闭"}
      cancelText="取消"
      onCancel={onClose}
      confirmLoading={busy}
      destroyOnClose
    >
      {execute && (
        <div className="space-y-1.5 text-sm">
          <DetailRow label="任务">
            {execute.plan_task?.content ?? "(无关联任务)"}
          </DetailRow>
          <DetailRow label="所属项目">
            {execute.plan_task?.project_name ?? "—"}
          </DetailRow>
          <DetailRow label="状态">
            {STATUS_TEXT[execute.status] ?? execute.status}
          </DetailRow>
          <DetailRow label="工时">{execute.time_spent ?? 0} 人天</DetailRow>
          <DetailRow label="实际开始">{fmt(execute.actual_start_time)}</DetailRow>
          <DetailRow label="实际结束">{fmt(execute.actual_end_time)}</DetailRow>
          <DetailRow label="执行信息">{execute.execute_info ?? "—"}</DetailRow>
          <DetailRow label="开始备注">{execute.start_remark ?? "—"}</DetailRow>
          <DetailRow label="结束备注">{execute.end_remark ?? "—"}</DetailRow>

          {editable ? (
            <Form
              form={form}
              layout="vertical"
              className="mt-3 border-t border-border pt-3"
            >
              <Form.Item label="修改实际开始时间" name="actual_start_time">
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="修改实际结束时间" name="actual_end_time">
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
            </Form>
          ) : (
            <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
              仅「已完成」状态可编辑实际时间
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="flex-1 break-words text-foreground">{children}</span>
    </div>
  );
}
