"use client";

/**
 * KanbanActualCell — 实际工作表单元格(风格对齐 TaskMiniCard)。
 *
 * 顶部日工作量汇总条(timeSpent 累加:>1 红、>=0.5 绿、<0.5 黄) +
 * 每条实际工作卡(项目色点 + 任务名 + StatusBadge 状态 + 工时)。点击卡片 → onEdit
 * 打开详情 Modal(展示字段 + 仅 status=90 可改 actual_time)。
 *
 * 任务-09:状态渲染统一走 task-06 的 StatusBadge + fromStatus,消除硬编码状态色。
 */
import {
  StatusBadge,
  fromStatus,
} from "@/components/ui/status-badge";
import { tokens } from "@/styles";
import type { TaskExecuteWithPlan } from "@/lib/ppm/types";

/** TaskExecute.status(10/20/30/40/90)→ 文案(色由 fromStatus 派生)。 */
const STATUS_TEXT: Record<string, string> = {
  "10": "待开始",
  "20": "进行中",
  "30": "待验证",
  "40": "验证中",
  "90": "已完成",
};

export interface KanbanActualCellProps {
  items: TaskExecuteWithPlan[];
  /** 点击卡片 → 打开详情 Modal(详情展示 + 编辑入口)。 */
  onEdit?: (item: TaskExecuteWithPlan) => void;
}

export function KanbanActualCell({ items, onEdit }: KanbanActualCellProps) {
  const total = items.reduce((s, e) => s + (e.time_spent ?? 0), 0);
  const barColor =
    total > 1 ? "bg-red-500" : total >= 0.5 ? "bg-green-500" : "bg-yellow-400";
  return (
    <>
      <div
        className={`h-1 w-full rounded ${barColor}`}
        title={`日工作量 ${total} 人天`}
      />
      {items.map((e) => {
        const text = STATUS_TEXT[e.status] ?? e.status;
        const title = e.plan_task?.content ?? "(无关联任务)";
        return (
          <div
            key={e.id}
            className="cursor-pointer rounded border border-border bg-background px-1.5 py-1 text-xs shadow-sm transition hover:border-primary"
            onClick={() => onEdit?.(e)}
            title="点击查看详情"
          >
            <div className="flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: tokens.color.slate[400] }}
              />
              <span className="truncate font-medium text-foreground">{title}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-1">
              <StatusBadge kind={fromStatus(text)} size="sm">
                {text}
              </StatusBadge>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {e.time_spent ?? 0}人天
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}
