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
 * 筛选与日期范围:SearchBar 的截止范围与 DateNav 的导航范围相互独立——
 *  - DateNav 决定矩阵**展示**的日期列(本周/上周/下周/自定义)
 *  - SearchBar 的截止范围决定**任务拉取**的过滤(可选)
 *  若 SearchBar 未填截止范围,矩阵以 DateNav 范围作为默认拉取窗口
 *
 * 弹窗/抽屉:Create / Edit / Assign / Detail / ContextMenu 全部保留。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";

import {
  listSimpleProjects,
} from "@/lib/ppm/project";
import type {
  KanbanTaskCard,
  ProjectSimpleItem,
} from "@/lib/ppm/types";
import { useKanbanStore } from "@/stores/kanban";
import { Toast, useToast } from "../shared";
import { KanbanSearchBar } from "./_components/kanban-search-bar";
import { KanbanMatrix } from "./_components/kanban-matrix";
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

const PALETTE = [
  "#1677ff",
  "#52c41a",
  "#faad14",
  "#eb2f96",
  "#722ed1",
  "#13c2c2",
  "#fa8c16",
  "#f5222d",
];

export default function KanbanPage() {
  const { toast } = useToast();

  const users = useKanbanStore((s) => s.users);
  const tasks = useKanbanStore((s) => s.tasks);
  const loading = useKanbanStore((s) => s.loading);
  const filters = useKanbanStore((s) => s.filters);
  const fetchUsers = useKanbanStore((s) => s.fetchUsers);
  const fetchTasks = useKanbanStore((s) => s.fetchTasks);
  const setFilters = useKanbanStore((s) => s.setFilters);
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

  // 首屏拉数据 + 项目列表
  useEffect(() => {
    void Promise.all([fetchUsers(), fetchTasks(), loadProjects()]);
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

  // filters 变化时重拉
  useEffect(() => {
    void Promise.all([fetchUsers(), fetchTasks()]);
  }, [filters, fetchUsers, fetchTasks]);

  // DateNav 变化:同步到 store.start_date/end_date(SearchBar 会读会显示),
  // 并触发拉取。这样矩阵展示范围与任务拉取范围一致。
  useEffect(() => {
    const start = dateRange[0].format("YYYY-MM-DD");
    const end = dateRange[1].format("YYYY-MM-DD");
    setFilters({ start_date: start, end_date: end });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

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
    await Promise.all([fetchTasks(), fetchUsers()]);
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

      {/* 日期导航条 */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-2">
        <KanbanDateNav range={dateRange} onChange={setDateRange} />
        <div className="text-xs text-muted-foreground">
          {loading ? "加载中…" : `共 ${tasks.length} 个任务 / ${users.length} 人`}
        </div>
      </div>

      {/* 主体:矩阵 + 工时图 */}
      <div className="flex flex-1 gap-3 overflow-hidden p-3">
        <div className="min-w-0 flex-1">
          <KanbanMatrix
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
