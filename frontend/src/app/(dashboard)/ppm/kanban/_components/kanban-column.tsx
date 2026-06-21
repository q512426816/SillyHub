"use client";

/**
 * KanbanColumn — 对齐源 `KanbanColumn.vue`。
 *
 * 结构:
 *  - 列头:用户名/avatar + 部门 + 任务数 + 总工时 + **饱和度进度条**(对齐源)
 *    + 折叠按钮(单击切换)。
 *  - 任务卡片列表:每张卡之间/列尾都是 HTML5 DnD 落点。
 *  - 空列提示(对齐源 empty-state)。
 *
 * 拖拽落点语义(对齐源 vuedraggable onEnd):
 *  - onDropTo(targetUserId, beforeTaskId) 由 page 统一处理(跨列 assign+reorder,
 *    同列 reorder,乐观更新 + 失败回滚 + Toast)。
 *  - beforeTaskId=null → 落到列尾;否则落到该卡之前。
 *
 * 饱和度颜色(对齐源 saturationClass):<60 绿 / <80 黄 / ≥80 红。
 */
import { useState } from "react";
import { CaretDownOutlined } from "@ant-design/icons";
import { Avatar, Progress } from "antd";

import { groupTasksByDate } from "@/lib/ppm/kanban-grouping";
import type { KanbanTaskCard, KanbanUserColumn } from "@/lib/ppm/types";
import { KanbanTaskCard as TaskCardView } from "./kanban-task-card";

interface ColumnProps {
  user: KanbanUserColumn;
  tasks: KanbanTaskCard[];
  onDragStart: (taskId: string, fromUserId: string) => void;
  onDropTo: (targetUserId: string, beforeTaskId: string | null) => Promise<void>;
  onTaskClick: (task: KanbanTaskCard) => void;
  onTaskContextMenu: (task: KanbanTaskCard, e: React.MouseEvent) => void;
}

function saturationColor(v: number): string {
  if (v >= 80) return "#f5222d"; // 红
  if (v >= 60) return "#faad14"; // 黄
  return "#52c41a"; // 绿
}

export function KanbanColumn({
  user,
  tasks,
  onDragStart,
  onDropTo,
  onTaskClick,
  onTaskContextMenu,
}: ColumnProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const displayName = user.username ?? user.user_id;
  const totalHours = tasks.reduce(
    (sum, t) => sum + (t.estimate_hours ?? 0),
    0,
  );

  return (
    <div
      className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/20 shadow-sm"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void onDropTo(user.user_id, null);
      }}
      style={{
        outline: dragOver ? "2px dashed #1677ff" : undefined,
      }}
    >
      {/* 列头 */}
      <div
        className="cursor-pointer select-none border-b px-3 py-2.5"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          <Avatar size={36} src={user.avatar ?? undefined}>
            {displayName.charAt(0).toUpperCase()}
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {displayName}
            </div>
            {user.dept_name && (
              <div className="truncate text-[11px] text-muted-foreground">
                {user.dept_name}
              </div>
            )}
          </div>
          <CaretDownOutlined
            className="text-xs text-muted-foreground transition-transform"
            style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
          />
        </div>

        <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span>
            任务 <b className="text-foreground">{tasks.length}</b>
          </span>
          <span>
            工时 <b className="text-foreground">{totalHours}h</b>
          </span>
        </div>

        {/* 饱和度进度条(对齐源 saturation-bar) */}
        <div className="mt-2">
          <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>饱和度</span>
            <span>{user.saturation}%</span>
          </div>
          <Progress
            percent={Math.min(user.saturation, 100)}
            showInfo={false}
            size="small"
            strokeColor={saturationColor(user.saturation)}
          />
        </div>
      </div>

      {/* 任务列表 — 两重维度之日期维度:列内按截止日期分桶 */}
      {!collapsed && (
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
          {tasks.length === 0 && (
            <div className="rounded border border-dashed border-border bg-background/40 px-2 py-8 text-center text-[11px] text-muted-foreground">
              暂无任务,拖拽任务到此
            </div>
          )}
          {groupTasksByDate(tasks).map((bucket) => (
            <div key={bucket.key} className="flex flex-col gap-1.5">
              {/* 分组标题(视觉分隔,不参与拖拽落点) */}
              <div className="sticky top-0 z-10 flex items-center gap-1 bg-muted/20 py-0.5 text-[10px] font-medium">
                <span className={`inline-block h-2 w-0.5 rounded ${bucket.key === "overdue" ? "bg-destructive" : bucket.key === "today" ? "bg-red-500" : bucket.key === "tomorrow" ? "bg-orange-500" : bucket.key === "thisWeek" ? "bg-blue-500" : bucket.key === "nextWeek" ? "bg-cyan-600" : "bg-muted-foreground/40"}`} />
                <span className={bucket.colorClass}>{bucket.label}</span>
                <span className="text-muted-foreground">({bucket.tasks.length})</span>
              </div>
              {bucket.tasks.map((t) => (
                <div
                  key={t.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(false);
                    void onDropTo(user.user_id, t.id);
                  }}
                >
                  <TaskCardView
                    task={t}
                    onDragStart={onDragStart}
                    onContextMenu={onTaskContextMenu}
                    onClick={onTaskClick}
                  />
                </div>
              ))}
            </div>
          ))}
          {/* 列尾落点(对齐源拖到空白处 → 列尾) */}
          <div
            className="min-h-8 rounded"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
              void onDropTo(user.user_id, null);
            }}
          />
        </div>
      )}
    </div>
  );
}

export default KanbanColumn;
