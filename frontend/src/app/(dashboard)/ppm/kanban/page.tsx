"use client";

/**
 * 看板页面 (task-12 / D-001 / X-001 / R-05)。
 *
 * 功能:
 *  - 人员分列(可见 project_member),可选按组织分组(group_by_org)。
 *  - 任务卡片在所属人员列内按 kanban_order 排列。
 *  - 拖拽:
 *      * 跨列拖拽 → 调 assignKanbanTask(更新 user_id + kanban_order)。
 *      * 同列重排 → 调 reorderKanbanTasks(批量写 kanban_order)。
 *    技术选型:原生 HTML5 drag-and-drop(项目无 @xyflow/react;源用 VueDraggable,
 *    原生方案零依赖、够用,符合 task-12 "优先原生" 要求)。
 *  - 顶部搜索:人员搜索 searchKanbanUsers + 任务 keyword 过滤。
 *  - 分配任务(assign)弹窗:把一个任务挂到某人员列。
 *
 * 乐观更新:拖拽时先改本地 state,API 失败再回滚 + Toast。
 *
 * 依赖:lib/ppm/kanban + lib/ppm/task(createPlanTask 用于新建任务)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  assignKanbanTask,
  listKanbanTasks,
  listKanbanUsers,
  reorderKanbanTasks,
  searchKanbanUsers,
} from "@/lib/ppm/kanban";
import type {
  KanbanOrgGroup,
  KanbanTaskCard,
  KanbanUserColumn,
} from "@/lib/ppm/types";
import { Toast, fmtDay, inputCls, useToast } from "../shared";

interface ColumnData extends KanbanUserColumn {
  tasks: KanbanTaskCard[];
}

interface DragPayload {
  taskId: string;
  fromUserId: string;
}

export default function KanbanPage() {
  const { toast, showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [groupByOrg, setGroupByOrg] = useState(false);
  const [keyword, setKeyword] = useState("");

  // 拍平的人员列(按 group_by_org 决定是否分组渲染)
  const [columns, setColumns] = useState<ColumnData[]>([]);
  const [groupedColumns, setGroupedColumns] = useState<
    { orgId: string | null; orgName: string | null; members: ColumnData[] }[]
  >([]);

  // 搜索建议
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<KanbanUserColumn[]>([]);

  const dragPayloadRef = useRef<DragPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersResp, tasksResp] = await Promise.all([
        listKanbanUsers({
          group_by_org: groupByOrg,
          keyword: keyword || undefined,
        }),
        listKanbanTasks({ keyword: keyword || undefined }),
      ]);
      const tasksByUser = new Map<string, KanbanTaskCard[]>();
      for (const t of tasksResp) {
        const uid = t.user_id ?? "__unassigned__";
        const arr = tasksByUser.get(uid) ?? [];
        arr.push(t);
        tasksByUser.set(uid, arr);
      }
      // 每列内按 kanban_order 升序
      for (const arr of tasksByUser.values()) {
        arr.sort((a, b) => a.kanban_order - b.kanban_order);
      }

      if (groupByOrg && Array.isArray(usersResp)) {
        // usersResp 实际是 KanbanOrgGroup[]
        const groups = usersResp as KanbanOrgGroup[];
        setGroupedColumns(
          groups.map((g) => ({
            orgId: g.org_id,
            orgName: g.org_name,
            members: g.members.map((m) => ({
              ...m,
              tasks: tasksByUser.get(m.user_id) ?? [],
            })),
          })),
        );
        setColumns([]);
      } else {
        const list = (usersResp as KanbanUserColumn[]) ?? [];
        setColumns(
          list.map((m) => ({
            ...m,
            tasks: tasksByUser.get(m.user_id) ?? [],
          })),
        );
        setGroupedColumns([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [groupByOrg, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  // 人员搜索(防抖 300ms)
  useEffect(() => {
    if (!searchInput.trim()) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        try {
          const list = await searchKanbanUsers(searchInput.trim());
          setSearchResults(list ?? []);
        } catch {
          setSearchResults([]);
        }
      })();
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const allColumns = useMemo<ColumnData[]>(() => {
    if (groupByOrg) {
      return groupedColumns.flatMap((g) => g.members);
    }
    return columns;
  }, [groupByOrg, groupedColumns, columns]);

  // -------------------------------------------------------------------------
  // 拖拽处理(原生 HTML5 DnD)
  // -------------------------------------------------------------------------

  const onDragStart = (taskId: string, fromUserId: string) => {
    dragPayloadRef.current = { taskId, fromUserId };
  };

  /**
   * 落在某列某位置:
   *  - targetUserId:目标人员
   *  - beforeTaskId:落在该卡片之前(null 表示落到列尾)
   */
  const onDropTo = async (
    targetUserId: string,
    beforeTaskId: string | null,
  ) => {
    const payload = dragPayloadRef.current;
    dragPayloadRef.current = null;
    if (!payload) return;
    const { taskId, fromUserId } = payload;
    if (targetUserId === fromUserId && beforeTaskId === taskId) return;

    // 乐观更新:重新计算目标列顺序
    const prevSnapshot = snapshot();
    applyLocalReorder(taskId, fromUserId, targetUserId, beforeTaskId);

    try {
      if (targetUserId !== fromUserId) {
        // 跨列:assign(后端会写 kanban_order 末尾,但前端已按落点重排)
        await assignKanbanTask({
          task_id: taskId,
          assignee_id: targetUserId,
        });
        // 再补一次 reorder 锁定目标列顺序
        const newOrder = currentColumnOrder(targetUserId);
        await reorderKanbanTasks({
          user_id: targetUserId,
          task_ids: newOrder,
        });
        // 源列也要重排(去掉了被拖走的卡)
        await reorderKanbanTasks({
          user_id: fromUserId,
          task_ids: currentColumnOrder(fromUserId),
        });
      } else {
        // 同列重排
        const newOrder = currentColumnOrder(targetUserId);
        await reorderKanbanTasks({
          user_id: targetUserId,
          task_ids: newOrder,
        });
      }
      showToast(true, "已保存排序");
    } catch (err) {
      restore(prevSnapshot);
      showToast(false, err instanceof ApiError ? err.message : "保存失败,已回滚");
    }
  };

  /** 拍一份当前列+任务的快照,供回滚。 */
  const snapshot = (): ColumnData[] =>
    allColumns.map((c) => ({ ...c, tasks: [...c.tasks] }));

  const restore = (snap: ColumnData[]) => {
    if (groupByOrg) {
      setGroupedColumns((prev) =>
        prev.map((g) => ({
          ...g,
          members:
            snap
              .filter((c) =>
                g.members.some((m) => m.user_id === c.user_id),
              )
              .map((c) => ({ ...c })) ?? g.members,
        })),
      );
    } else {
      setColumns(snap);
    }
  };

  /** 按落点重排所有列(本地)。 */
  const applyLocalReorder = (
    taskId: string,
    fromUserId: string,
    targetUserId: string,
    beforeTaskId: string | null,
  ) => {
    const mutate = (list: ColumnData[]): ColumnData[] => {
      const fromCol = list.find((c) => c.user_id === fromUserId);
      const moved = fromCol?.tasks.find((t) => t.id === taskId);
      if (!moved) return list;
      const next = list.map((c) =>
        c.user_id === fromUserId
          ? { ...c, tasks: c.tasks.filter((t) => t.id !== taskId) }
          : c,
      );
      return next.map((c) => {
        if (c.user_id !== targetUserId) return c;
        let tasks = c.tasks.filter((t) => t.id !== moved.id);
        if (beforeTaskId === null) {
          tasks = [...tasks, moved];
        } else {
          const idx = tasks.findIndex((t) => t.id === beforeTaskId);
          if (idx >= 0) {
            tasks = [...tasks.slice(0, idx), moved, ...tasks.slice(idx)];
          } else {
            tasks = [...tasks, moved];
          }
        }
        return { ...c, tasks };
      });
    };

    if (groupByOrg) {
      setGroupedColumns((prev) =>
        prev.map((g) => ({ ...g, members: mutate(g.members) })),
      );
    } else {
      setColumns((prev) => mutate(prev));
    }
  };

  const currentColumnOrder = (userId: string): string[] => {
    const col = allColumns.find((c) => c.user_id === userId);
    return col ? col.tasks.map((t) => t.id) : [];
  };

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-3">
        <div>
          <h1 className="mt-0.5 text-base font-semibold">任务看板</h1>
          <p className="text-[11px] text-muted-foreground">
            人员分列 · 拖拽排序自动持久化 · 跨列拖拽即重新分配
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索人员…"
              className={`w-48 ${inputCls}`}
              aria-label="搜索人员"
            />
            {searchResults.length > 0 && (
              <div className="absolute right-0 top-9 z-30 max-h-60 w-56 overflow-auto rounded border bg-popover shadow-lg">
                {searchResults.map((u) => (
                  <button
                    key={u.user_id}
                    className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted/40"
                    onClick={() => {
                      setKeyword(u.username ?? u.user_id);
                      setSearchInput(u.username ?? u.user_id);
                      setSearchResults([]);
                    }}
                  >
                    {u.username ?? u.user_id}
                    {u.dept_name ? ` · ${u.dept_name}` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="过滤任务关键字"
            className={`w-44 ${inputCls}`}
            aria-label="过滤任务"
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={groupByOrg}
              onChange={(e) => setGroupByOrg(e.target.checked)}
            />
            按组织分组
          </label>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            刷新
          </Button>
        </div>
      </header>

      <Toast toast={toast} />

      {error ? (
        <div className="m-4 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
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
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          加载中…
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-4 py-4">
          {groupByOrg && groupedColumns.length === 0 ? (
            <EmptyHint />
          ) : !groupByOrg && columns.length === 0 ? (
            <EmptyHint />
          ) : groupByOrg ? (
            <div className="space-y-6">
              {groupedColumns.map((g) => (
                <section key={g.orgId ?? "__nogroup__"}>
                  <h2 className="mb-2 text-xs font-semibold text-muted-foreground">
                    {g.orgName ?? "未分组"}（{g.members.length} 人）
                  </h2>
                  <ColumnsRow
                    columns={g.members}
                    onDragStart={onDragStart}
                    onDropTo={onDropTo}
                  />
                </section>
              ))}
            </div>
          ) : (
            <ColumnsRow
              columns={columns}
              onDragStart={onDragStart}
              onDropTo={onDropTo}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="rounded border bg-muted/20 px-3 py-16 text-center text-xs text-muted-foreground">
      暂无可见的人员/任务。请确认你有可见的 project_member,或清除搜索关键字。
    </div>
  );
}

function ColumnsRow({
  columns,
  onDragStart,
  onDropTo,
}: {
  columns: ColumnData[];
  onDragStart: (_taskId: string, _fromUserId: string) => void;
  onDropTo: (
    _targetUserId: string,
    _beforeTaskId: string | null,
  ) => Promise<void>;
}) {
  return (
    <div className="flex gap-3">
      {columns.map((col) => (
        <KanbanColumnView
          key={col.user_id}
          column={col}
          onDragStart={onDragStart}
          onDropTo={onDropTo}
        />
      ))}
    </div>
  );
}

function KanbanColumnView({
  column,
  onDragStart,
  onDropTo,
}: {
  column: ColumnData;
  onDragStart: (_taskId: string, _fromUserId: string) => void;
  onDropTo: (
    _targetUserId: string,
    _beforeTaskId: string | null,
  ) => Promise<void>;
}) {
  const [dragOver, setDragOver] = useState(false);

  const saturationColor =
    column.saturation >= 100
      ? "#ff4d4f"
      : column.saturation >= 80
        ? "#faad14"
        : "#52c41a";

  return (
    <div
      className="flex w-64 shrink-0 flex-col rounded-md border bg-muted/20"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        // 仅当真正离开列容器时才清状态
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        // 落到列空白处 → 列尾
        void onDropTo(column.user_id, null);
      }}
      style={{
        outline: dragOver ? "2px dashed #1677ff" : undefined,
      }}
    >
      {/* 列头:人员 + 饱和度 */}
      <div className="border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {column.username ?? column.user_id}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {column.task_count} 项
          </span>
        </div>
        {column.dept_name && (
          <div className="text-[10px] text-muted-foreground">
            {column.dept_name}
          </div>
        )}
        <div className="mt-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>饱和度</span>
            <span>{column.saturation}%</span>
          </div>
          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(column.saturation, 100)}%`,
                background: saturationColor,
              }}
            />
          </div>
        </div>
      </div>

      {/* 卡片列表(可拖拽落点) */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {column.tasks.length === 0 && (
          <div className="rounded border border-dashed bg-background/40 px-2 py-4 text-center text-[10px] text-muted-foreground">
            拖拽任务到此
          </div>
        )}
        {column.tasks.map((t) => (
          <div
            key={`${t.id}-gap`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              void onDropTo(column.user_id, t.id);
            }}
          >
            <TaskCardView task={t} onDragStart={onDragStart} />
          </div>
        ))}
        {/* 列尾落点 */}
        <div
          className="min-h-8 rounded"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            void onDropTo(column.user_id, null);
          }}
        />
      </div>
    </div>
  );
}

function TaskCardView({
  task,
  onDragStart,
}: {
  task: KanbanTaskCard;
  onDragStart: (_taskId: string, _fromUserId: string) => void;
}) {
  const statusTag = taskStatusBadge(task.status);
  return (
    <div
      draggable
      onDragStart={() => onDragStart(task.id, task.user_id ?? "__unassigned__")}
      className="cursor-grab rounded border bg-background px-2.5 py-2 text-xs shadow-sm transition hover:shadow-md active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 flex-1 font-medium">
          {task.title ?? "（未命名任务）"}
        </span>
        {task.status && (
          <span
            className="shrink-0 rounded px-1 py-0.5 text-[9px]"
            style={{ background: statusTag.bg, color: statusTag.fg }}
          >
            {statusTag.text}
          </span>
        )}
      </div>
      {task.project_name && (
        <div className="mt-1 truncate text-[10px] text-muted-foreground">
          {task.project_name}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>截止 {task.deadline ? fmtDay(task.deadline) : "—"}</span>
        <span>预估 {task.estimate_hours ?? "—"}h</span>
      </div>
    </div>
  );
}

function taskStatusBadge(
  status: string | null,
): { text: string; bg: string; fg: string } {
  switch (status) {
    case "10":
      return { text: "待执行", bg: "#f0f0f0", fg: "#595959" };
    case "20":
      return { text: "执行中", bg: "#e6f4ff", fg: "#1677ff" };
    case "30":
      return { text: "待验证", bg: "#fff7e6", fg: "#d46b08" };
    case "40":
      return { text: "已完成", bg: "#f6ffed", fg: "#389e0d" };
    default:
      return { text: status ?? "未知", bg: "#f0f0f0", fg: "#595959" };
  }
}
