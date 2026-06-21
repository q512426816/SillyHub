"use client";

/**
 * KanbanActualMatrix — 团队实际工作表(对齐源 WorkCard,风格对齐 KanbanMatrix)。
 *
 * 人员 × 日期 matrix,cell = 该成员该日的 TaskExecute(按 actual_start_time
 * 单点落 cell,不跨天)。布局/行头/列头/cell 风格与 KanbanMatrix(计划)
 * 保持一致:行头 avatar+工时+饱和度条、列头日期+周几+周末绿、cell 卡片+空"—"。
 */
import { useMemo } from "react";
import { Avatar, Progress } from "antd";

import type { KanbanUserColumn, TaskExecuteWithPlan } from "@/lib/ppm/types";
import {
  dateRangeKeys,
  groupByUserAndExecuteDate,
  weekdayMeta,
  type DateKey,
} from "@/lib/ppm/kanban-grouping";
import { tokens } from "@/styles";
import { KanbanActualCell } from "./kanban-actual-cell";

export interface KanbanActualMatrixProps {
  users: KanbanUserColumn[];
  executes: TaskExecuteWithPlan[];
  startDate: string;
  endDate: string;
  selectedUserId?: string | null;
  onSelectUser?: (userId: string | null) => void;
  onEdit?: (item: TaskExecuteWithPlan) => void;
}

const COL_WIDTH = 168;
const ROW_HEADER_WIDTH = 220;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function userActualDays(userId: string, executes: TaskExecuteWithPlan[]): number {
  const sum = executes
    .filter((e) => e.execute_user_id === userId)
    .reduce((s, e) => s + (e.time_spent ?? 0), 0);
  return Math.round(sum * 10) / 10; // round 1 位小数避免浮点累加精度
}

function userActualCount(userId: string, executes: TaskExecuteWithPlan[]): number {
  return executes.filter((e) => e.execute_user_id === userId).length;
}

/** 饱和度色(任务-09):走 tokens 语义色,error/warning/success 三档。 */
function saturationColor(v: number): string {
  if (v >= 80) return tokens.color.semantic.error.color;
  if (v >= 60) return tokens.color.semantic.warning.color;
  return tokens.color.semantic.success.color;
}

export function KanbanActualMatrix({
  users,
  executes,
  startDate,
  endDate,
  selectedUserId,
  onSelectUser,
  onEdit,
}: KanbanActualMatrixProps) {
  const dates: DateKey[] = useMemo(
    () => dateRangeKeys(new Date(startDate), new Date(endDate)),
    [startDate, endDate],
  );
  const userIds = useMemo(() => users.map((u) => u.user_id), [users]);
  const matrix = useMemo(
    () => groupByUserAndExecuteDate(executes, userIds, dates),
    [executes, userIds, dates],
  );
  const tk = todayKey();

  if (users.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-16 text-center text-xs text-muted-foreground">
        暂无可见人员。
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex-1 overflow-auto">
        <table className="border-separate" style={{ borderSpacing: 0, minWidth: "100%" }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th
                className="sticky left-0 z-30 border-b border-r border-border bg-background"
                style={{ width: ROW_HEADER_WIDTH, minWidth: ROW_HEADER_WIDTH }}
              >
                <div className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  人员 / 实际工时
                </div>
              </th>
              {dates.map((dk) => {
                const meta = weekdayMeta(dk);
                const d = new Date(dk);
                const isToday = dk === tk;
                return (
                  <th
                    key={dk}
                    className="border-b border-border"
                    style={{
                      width: COL_WIDTH,
                      minWidth: COL_WIDTH,
                      backgroundColor: meta.isWeekend
                        ? `color-mix(in srgb, ${tokens.color.emerald} 12%, transparent)`
                        : undefined,
                    }}
                  >
                    <div className="px-2 py-2 text-center">
                      <div
                        className={`flex items-center justify-center gap-1 text-sm font-medium ${
                          isToday ? "text-primary" : "text-foreground"
                        }`}
                      >
                        <span>
                          {String(d.getMonth() + 1).padStart(2, "0")}-
                          {String(d.getDate()).padStart(2, "0")}
                        </span>
                        {meta.isWeekend && (
                          <span className="rounded bg-green-500 px-1 py-px text-[9px] font-bold text-white">
                            休
                          </span>
                        )}
                      </div>
                      <div
                        className={`text-[11px] ${
                          meta.isWeekend ? "text-green-600" : "text-muted-foreground"
                        }`}
                      >
                        {meta.label}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {users.map((u) => {
              const row = matrix.get(u.user_id);
              const totalDays = userActualDays(u.user_id, executes);
              const count = userActualCount(u.user_id, executes);
              const isSelected = selectedUserId === u.user_id;
              const displayName = u.username ?? u.user_id;
              // 饱和度:实际人天 / 5(每周 5 人天基线) * 100,封顶 100
              const saturation = Math.min((totalDays / 5) * 100, 100);
              return (
                <tr key={u.user_id} className={isSelected ? "bg-primary/5" : undefined}>
                  <td
                    className={`sticky left-0 z-10 cursor-pointer border-b border-r border-border bg-background transition hover:bg-muted/40 ${
                      isSelected ? "!bg-primary/10" : ""
                    } ${onSelectUser ? "" : "cursor-default"}`}
                    style={{ width: ROW_HEADER_WIDTH, minWidth: ROW_HEADER_WIDTH }}
                    onClick={() =>
                      onSelectUser?.(isSelected ? null : u.user_id)
                    }
                  >
                    <div className="flex items-center gap-2 px-3 py-2">
                      <Avatar size={32} src={u.avatar ?? undefined}>
                        {displayName.charAt(0).toUpperCase()}
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-foreground">
                          {displayName}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>
                            工时 <b className="text-foreground">{totalDays}人天</b>
                          </span>
                          <span>记录 {count}</span>
                        </div>
                        <Progress
                          percent={saturation}
                          showInfo={false}
                          size="small"
                          strokeColor={saturationColor(saturation)}
                        />
                      </div>
                    </div>
                  </td>

                  {dates.map((dk) => {
                    const items = row?.get(dk) ?? [];
                    const meta = weekdayMeta(dk);
                    return (
                      <td
                        key={dk}
                        className="border-b border-border align-top"
                        style={{
                          width: COL_WIDTH,
                          minWidth: COL_WIDTH,
                          backgroundColor: meta.isWeekend
                            ? `color-mix(in srgb, ${tokens.color.emerald} 5%, transparent)`
                            : items.length === 0
                              ? `color-mix(in srgb, ${tokens.color.slate[500]} 1.5%, transparent)`
                              : undefined,
                        }}
                      >
                        <div className="flex min-h-[88px] flex-col gap-1 p-1.5">
                          {items.length === 0 ? (
                            <div className="flex h-[80px] items-center justify-center text-[10px] text-muted-foreground/40">
                              —
                            </div>
                          ) : (
                            <KanbanActualCell items={items} onEdit={onEdit} />
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
