"use client";

/**
 * KanbanTaskCard — 对齐源 `TaskCard.vue`。
 *
 * 展示:title / status 标签(对齐源优先级标签位置;本仓无 priority 字段,用
 * status 中文 enum 顶替,颜色:未开始灰 / 进行中蓝 / 已完成绿) /
 * project_name / deadline(逾期红) / estimate_hours。
 *
 * 交互:
 *  - draggable:HTML5 DnD,dragStart 回传 task.id + 当前 user_id(供列容器识别跨/同列)。
 *  - onContextMenu:右键 → 父级 TaskContextMenu(对齐源 contextmenu emit)。
 *  - onClick:打开 TaskDetailDrawer(对齐源 taskClick emit)。
 *
 * 字段差异说明:源有 priority(1/2/3)+ progress 条;本仓 PlanTask 无这两个字段,
 * 故卡片不渲染优先级单色 Tag 和 progress 条。status Tag 对齐源 task-meta 视觉位。
 */
import { useMemo } from "react";
import { CalendarOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { Tag } from "antd";

import type { KanbanTaskCard } from "@/lib/ppm/types";
import { fmtDay } from "../../shared";

function statusTagOf(status: string | null): { text: string; color: string } {
  switch (status) {
    case "未开始":
      return { text: "未开始", color: "default" };
    case "进行中":
      return { text: "进行中", color: "processing" };
    case "已完成":
      return { text: "已完成", color: "success" };
    default:
      return { text: status ?? "—", color: "default" };
  }
}

export function KanbanTaskCard({
  task,
  onDragStart,
  onContextMenu,
  onClick,
}: {
  task: KanbanTaskCard;
  onDragStart: (taskId: string, fromUserId: string) => void;
  onContextMenu: (task: KanbanTaskCard, e: React.MouseEvent) => void;
  onClick: (task: KanbanTaskCard) => void;
}) {
  const tag = useMemo(() => statusTagOf(task.status), [task.status]);

  const isOverdue = useMemo(() => {
    if (!task.deadline) return false;
    const d = new Date(task.deadline);
    if (Number.isNaN(d.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d < today && task.status !== "已完成";
  }, [task.deadline, task.status]);

  return (
    <div
      draggable
      onDragStart={(e) => {
        // 透传 taskId 供列容器 dataTransfer(对齐源 vuedraggable item)
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart(task.id, task.user_id ?? "__unassigned__");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(task, e);
      }}
      onClick={() => onClick(task)}
      className="cursor-grab rounded border border-border bg-background px-2.5 py-2 text-xs shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md active:cursor-grabbing"
    >
      {/* title + status 标签 */}
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 flex-1 font-medium text-foreground">
          {task.title ?? "(未命名任务)"}
        </span>
        <Tag color={tag.color} className="mt-0.5 shrink-0">
          {tag.text}
        </Tag>
      </div>

      {/* project */}
      {task.project_name && (
        <div className="mt-1 truncate text-[11px] text-muted-foreground">
          {task.project_name}
        </div>
      )}

      {/* deadline + hours */}
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span
          className={`flex items-center gap-1 ${isOverdue ? "font-medium text-destructive" : ""}`}
        >
          <CalendarOutlined />
          {task.deadline ? fmtDay(task.deadline) : "—"}
        </span>
        <span className="flex items-center gap-1">
          <ClockCircleOutlined />
          {task.estimate_hours ?? "—"}h
        </span>
      </div>
    </div>
  );
}

export default KanbanTaskCard;
