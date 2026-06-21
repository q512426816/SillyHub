"use client";

/**
 * 看板主页 — 对齐源 `views/ppm/task-kanban/index.vue`。
 *
 * 布局:
 *  - 顶部 KanbanSearchBar(项目/状态/人员/关键词/新建按钮)
 *  - 主体 KanbanColumn 列表(横向滚动;响应式:桌面 280px 列 / 平板 240px /
 *    手机 1 列纵向,对齐源 index.vue is-mobile/is-tablet/is-desktop)
 *  - 各弹窗/抽屉:Create / Edit / Assign / Detail / ContextMenu
 *
 * 数据:全部走 useKanbanStore(Zustand,对齐源 usePpmStore),page 只管交互编排。
 *
 * 拖拽(原生 HTML5 DnD,对齐源 vuedraggable onEnd 语义):
 *  - onDropTo(targetUserId, beforeTaskId)
 *  - 跨列:store.assignTask(更新 user_id)+ reorder 锁定目标列顺序 + 源列重排
 *  - 同列:store.reorderTasks
 *  - 乐观更新(本地先移)+ 失败回滚 + Toast(对齐源 KanbanColumn confirmDrag 失败回滚)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";

import { ApiError } from "@/lib/api";
import {
  assignKanbanTask,
  reorderKanbanTasks,
} from "@/lib/ppm/kanban";
import type { KanbanTaskCard, KanbanUserColumn } from "@/lib/ppm/types";
import { useKanbanStore } from "@/stores/kanban";
import { Toast, useToast } from "../shared";
import { KanbanSearchBar } from "./_components/kanban-search-bar";
import { KanbanColumn } from "./_components/kanban-column";
import { KanbanCreateTaskDialog } from "./_components/kanban-create-task-dialog";
import { KanbanEditTaskDialog } from "./_components/kanban-edit-task-dialog";
import { KanbanAssignTaskDialog } from "./_components/kanban-assign-task-dialog";
import {
  KanbanTaskContextMenu,
  type ContextMenuState,
} from "./_components/kanban-task-context-menu";
import { KanbanTaskDetailDrawer } from "./_components/kanban-task-detail-drawer";

/** 本地视图列:UserColumn + 该列下的任务(按 kanban_order 排序)。 */
interface ColumnView extends KanbanUserColumn {
  tasks: KanbanTaskCard[];
}

export default function KanbanPage() {
  // AntD 静态方法(message)需要 App 包裹上下文;此处用 hook 取 message 实例。
  // 注:页面已被全局 AntD App provider 包裹(layout),这里拿到的是同一实例。
  const { message } = App.useApp();
  const { toast, showToast } = useToast();

  const users = useKanbanStore((s) => s.users);
  const tasks = useKanbanStore((s) => s.tasks);
  const loading = useKanbanStore((s) => s.loading);
  const filters = useKanbanStore((s) => s.filters);
  const fetchUsers = useKanbanStore((s) => s.fetchUsers);
  const fetchTasks = useKanbanStore((s) => s.fetchTasks);
  const reset = useKanbanStore((s) => s.reset);

  // 拖拽中的 payload(对齐源 dragPayloadRef)
  const dragPayloadRef = useRef<{ taskId: string; fromUserId: string } | null>(
    null,
  );

  // 本地乐观视图:覆盖 tasks 的展示顺序(拖拽中先改本地,失败回滚)
  // 用 user_id -> KanbanTaskCard[] 的有序映射表达;null 表示用 store 原始顺序。
  const [localView, setLocalView] = useState<
    Map<string, KanbanTaskCard[]> | null
  >(null);

  // 弹窗状态(对齐源各 ref)
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

  // 首屏拉数据(对齐源 onMounted initData)
  useEffect(() => {
    void Promise.all([fetchUsers(), fetchTasks()]);
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 筛选变化(由 SearchBar 触发)→ 拉数据。filters 引用变化即触发。
  useEffect(() => {
    void Promise.all([fetchUsers(), fetchTasks()]);
  }, [filters, fetchUsers, fetchTasks]);

  // 把 store tasks 按 user_id 分组(对齐源 getTasksByUser)
  const columns: ColumnView[] = useMemo(() => {
    const byUser = new Map<string, KanbanTaskCard[]>();
    // 选中的 user_ids 决定可见列(对齐源 displayUsers: selectedUserIds 过滤)
    const visibleUsers =
      filters.user_ids && filters.user_ids.length > 0
        ? users.filter((u) => filters.user_ids!.includes(u.user_id))
        : users;

    for (const u of visibleUsers) byUser.set(u.user_id, []);
    for (const t of tasks) {
      const uid = t.user_id ?? "__unassigned__";
      const arr = byUser.get(uid);
      if (arr) arr.push(t);
      else byUser.set(uid, [t]);
    }
    // 每列按 kanban_order 升序(对齐源排序约定)
    for (const arr of byUser.values()) {
      arr.sort((a, b) => a.kanban_order - b.kanban_order);
    }
    // 若有 localView(拖拽中),覆盖对应列顺序
    if (localView) {
      for (const [uid, ordered] of localView) {
        byUser.set(uid, ordered);
      }
    }
    return visibleUsers.map((u) => ({
      ...u,
      tasks: byUser.get(u.user_id) ?? [],
    }));
  }, [users, tasks, filters.user_ids, localView]);

  // -------------------------------------------------------------------------
  // 拖拽处理
  // -------------------------------------------------------------------------

  const onDragStart = (taskId: string, fromUserId: string) => {
    dragPayloadRef.current = { taskId, fromUserId };
  };

  /** 取某列当前任务顺序(优先 localView,否则 store 视图)。 */
  const columnOrder = (userId: string): KanbanTaskCard[] =>
    columns.find((c) => c.user_id === userId)?.tasks ?? [];

  /** 本地重排:把 taskId 从 fromUserId 移到 targetUserId 的 beforeTaskId 之前。 */
  const applyLocalReorder = (
    taskId: string,
    fromUserId: string,
    targetUserId: string,
    beforeTaskId: string | null,
  ) => {
    const next = new Map<string, KanbanTaskCard[]>();
    // 以当前 columns 为基准(每列拷贝)
    for (const c of columns) next.set(c.user_id, [...c.tasks]);

    const fromArr = next.get(fromUserId) ?? [];
    const moved = fromArr.find((t) => t.id === taskId);
    if (!moved) return;
    next.set(
      fromUserId,
      fromArr.filter((t) => t.id !== taskId),
    );

    const targetArr = (next.get(targetUserId) ?? []).filter(
      (t) => t.id !== moved.id,
    );
    if (beforeTaskId === null) {
      targetArr.push(moved);
    } else {
      const idx = targetArr.findIndex((t) => t.id === beforeTaskId);
      if (idx >= 0) targetArr.splice(idx, 0, moved);
      else targetArr.push(moved);
    }
    next.set(targetUserId, targetArr);
    setLocalView(next);
  };

  const onDropTo = useCallback(
    async (targetUserId: string, beforeTaskId: string | null) => {
      const payload = dragPayloadRef.current;
      dragPayloadRef.current = null;
      if (!payload) return;
      const { taskId, fromUserId } = payload;
      if (targetUserId === fromUserId && beforeTaskId === taskId) return;

      // 乐观更新
      applyLocalReorder(taskId, fromUserId, targetUserId, beforeTaskId);

      try {
        if (targetUserId !== fromUserId) {
          // 跨列:assign + reorder 锁目标列顺序 + 源列重排
          await assignKanbanTask({
            task_id: taskId,
            assignee_id: targetUserId,
          });
          const targetOrder = (columns.find((c) => c.user_id === targetUserId)?.tasks ?? [])
            .filter((t) => t.id !== taskId)
            .map((t) => t.id);
          const insertIdx =
            beforeTaskId === null
              ? targetOrder.length
              : targetOrder.indexOf(beforeTaskId);
          const newTargetOrder = [...targetOrder];
          if (insertIdx < 0) newTargetOrder.push(taskId);
          else newTargetOrder.splice(insertIdx, 0, taskId);
          await reorderKanbanTasks({
            user_id: targetUserId,
            task_ids: newTargetOrder,
          });
          await reorderKanbanTasks({
            user_id: fromUserId,
            task_ids: (columns.find((c) => c.user_id === fromUserId)?.tasks ?? [])
              .filter((t) => t.id !== taskId)
              .map((t) => t.id),
          });
        } else {
          // 同列重排
          await reorderKanbanTasks({
            user_id: targetUserId,
            task_ids: (columns.find((c) => c.user_id === targetUserId)?.tasks ?? [])
              .map((t) => t.id),
          });
        }
        // 成功:清本地视图,让 store 拉新数据
        setLocalView(null);
        await Promise.all([fetchTasks(), fetchUsers()]);
        showToast(true, "已保存");
      } catch (err) {
        // 失败回滚(对齐源 confirmDrag catch → localTasks 恢复)
        setLocalView(null);
        const text = err instanceof ApiError ? err.message : "保存失败,已回滚";
        showToast(false, text);
        void message.error(text);
      }
    },
    [columns, fetchTasks, fetchUsers, message, showToast],
  );

  // -------------------------------------------------------------------------
  // 各 handler(对齐源 handle*)
  // -------------------------------------------------------------------------

  const handleTaskClick = (task: KanbanTaskCard) => setDetailTask(task);

  const handleContextMenu = (task: KanbanTaskCard, e: React.MouseEvent) => {
    setContextMenu({ task, x: e.clientX, y: e.clientY });
  };

  const handleCreateFromColumn = (userId: string) => {
    setCreateDefaultAssignee(userId);
    setCreateOpen(true);
  };

  const handleEdit = (task: KanbanTaskCard) => {
    setEditTask(task);
    setEditOpen(true);
  };

  const handleAssign = (task: KanbanTaskCard) => {
    setAssignTask(task);
    setAssignOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      <KanbanSearchBar onCreateTask={() => { setCreateDefaultAssignee(undefined); setCreateOpen(true); }} />

      <Toast toast={toast} />

      <div className="flex-1 overflow-auto px-4 py-4">
        {loading && columns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : columns.length === 0 ? (
          <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-16 text-center text-xs text-muted-foreground">
            暂无可见的人员/任务。请确认你有可见的 project_member,或清除筛选条件。
          </div>
        ) : (
          <div className="flex gap-4">
            {columns.map((col) => (
              <div key={col.user_id} className="flex flex-col">
                <KanbanColumn
                  user={col}
                  tasks={col.tasks}
                  onDragStart={onDragStart}
                  onDropTo={onDropTo}
                  onTaskClick={handleTaskClick}
                  onTaskContextMenu={handleContextMenu}
                />
                {/* 列底"在此新建"(对齐源列头双击新建入口,本仓给一个显式按钮) */}
                <button
                  className="mt-2 self-center text-[11px] text-primary hover:underline"
                  onClick={() => handleCreateFromColumn(col.user_id)}
                >
                  + 为 {col.username ?? col.user_id} 新建任务
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 弹窗 / 抽屉 / 菜单 */}
      <KanbanCreateTaskDialog
        open={createOpen}
        defaultAssigneeId={createDefaultAssignee}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => { void fetchTasks(); void fetchUsers(); }}
      />
      <KanbanEditTaskDialog
        open={editOpen}
        task={editTask}
        onClose={() => { setEditOpen(false); setEditTask(null); }}
        onSuccess={() => { void fetchTasks(); void fetchUsers(); }}
      />
      <KanbanAssignTaskDialog
        open={assignOpen}
        task={assignTask}
        onClose={() => { setAssignOpen(false); setAssignTask(null); }}
        onSuccess={() => { void fetchTasks(); void fetchUsers(); }}
      />
      <KanbanTaskContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        onViewDetail={(t) => setDetailTask(t)}
        onEdit={handleEdit}
        onAssign={handleAssign}
        onDeleted={() => { void fetchTasks(); void fetchUsers(); }}
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
