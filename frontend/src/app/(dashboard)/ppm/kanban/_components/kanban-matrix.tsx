"use client";

/**
 * KanbanMatrix — 人员 × 日期矩阵看板。
 *
 * 布局:
 *  - 行(纵):人员,每人一行。行头显示 avatar + 姓名 + 工时(h) + 饱和度进度条
 *  - 列(横):自然日(连续 7 天或自定义范围)。周六日列表头标绿背景 + "休"标签
 *  - 单元格:该人该日的任务(按 deadline/end_time 落到该日)。缩略卡显示
 *    title + project 颜色点。多个任务竖排。空单元格淡色。点击卡片开 Detail
 *
 * 交互:
 *  - 点击任务卡 → onTaskClick(开 TaskDetailDrawer)
 *  - 右键任务卡 → onTaskContextMenu
 *  - 点击人员行头 → onSelectUser(联动工时图表)
 *  - 横向滚动(日期多时)
 *
 * 数据:外部传入 users + tasks + dates(YYYY-MM-DD 数组),
 * 内部用 groupByUserAndDate 做二维分组。
 */
import { useMemo } from "react";
import { Avatar, Progress } from "antd";

import type {
  KanbanTaskCard,
  KanbanUserColumn,
} from "@/lib/ppm/types";
import {
  dateRangeKeys,
  groupByUserAndDate,
  weekdayMeta,
  type DateKey,
} from "@/lib/ppm/kanban-grouping";
import { tokens } from "@/styles";

export interface KanbanMatrixProps {
  users: KanbanUserColumn[];
  tasks: KanbanTaskCard[];
  /** 日期范围(YYYY-MM-DD)。 */
  startDate: string;
  endDate: string;
  /** 当前选中的行(联动工时图)。 */
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onTaskClick: (task: KanbanTaskCard) => void;
  onTaskContextMenu: (task: KanbanTaskCard, e: React.MouseEvent) => void;
  /** projectId → 颜色(用于卡片颜色点)。由 page 计算注入,保证稳定。 */
  projectColorMap: Map<string, string>;
}

/** 计算人员在该范围内的总预估工时(从 tasks 累加,round 1 位小数避免浮点精度)。 */
function userTotalHours(
  userId: string,
  tasks: KanbanTaskCard[],
): number {
  let sum = 0;
  for (const t of tasks) {
    if (t.user_id === userId) sum += t.estimate_hours ?? 0;
  }
  return Math.round(sum * 10) / 10;
}

/** 饱和度色(任务-09):走 tokens 语义色,error/warning/success 三档。 */
function saturationColor(v: number): string {
  if (v >= 80) return tokens.color.semantic.error.color;
  if (v >= 60) return tokens.color.semantic.warning.color;
  return tokens.color.semantic.success.color;
}

const COL_WIDTH = 168; // 日期列宽 px(留出多卡空间)
const ROW_HEADER_WIDTH = 220;

export function KanbanMatrix({
  users,
  tasks,
  startDate,
  endDate,
  selectedUserId,
  onSelectUser,
  onTaskClick,
  onTaskContextMenu,
  projectColorMap,
}: KanbanMatrixProps) {
  const dates: DateKey[] = useMemo(() => {
    const s = new Date(startDate);
    const e = new Date(endDate);
    return dateRangeKeys(s, e);
  }, [startDate, endDate]);

  const userIds = useMemo(() => users.map((u) => u.user_id), [users]);

  const matrix = useMemo(
    () => groupByUserAndDate(tasks, userIds, dates),
    [tasks, userIds, dates],
  );

  if (users.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-16 text-center text-xs text-muted-foreground">
        暂无可见的人员/任务。请确认你有可见的 project_member,或清除筛选条件。
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background">
      {/* 横向滚动容器:行头 sticky 左,日期列可滚 */}
      <div className="flex-1 overflow-auto">
        <table
          className="border-separate"
          style={{ borderSpacing: 0, minWidth: "100%" }}
        >
          {/* 表头:行头占位 + 日期列 */}
          <thead className="sticky top-0 z-20">
            <tr>
              <th
                className="sticky left-0 z-30 border-b border-r border-border bg-background"
                style={{ width: ROW_HEADER_WIDTH, minWidth: ROW_HEADER_WIDTH }}
              >
                <div className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  人员 / 工时
                </div>
              </th>
              {dates.map((dk) => {
                const meta = weekdayMeta(dk);
                const d = new Date(dk);
                const isToday =
                  dk ===
                  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
                    2,
                    "0",
                  )}-${String(d.getDate()).padStart(2, "0")}` &&
                  dk === todayKey();
                return (
                  <th
                    key={dk}
                    className="border-b border-border"
                    style={{
                      width: COL_WIDTH,
                      minWidth: COL_WIDTH,
                      // 周六日表头标绿(emerald token 派生半透明)
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
                          meta.isWeekend
                            ? "text-green-600"
                            : "text-muted-foreground"
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
              const totalHrs = userTotalHours(u.user_id, tasks);
              const isSelected = selectedUserId === u.user_id;
              const displayName = u.username ?? u.user_id;
              return (
                <tr
                  key={u.user_id}
                  className={isSelected ? "bg-primary/5" : undefined}
                >
                  {/* 行头:sticky 左,点击联动工时图 */}
                  <td
                    className={`sticky left-0 z-10 cursor-pointer border-b border-r border-border bg-background transition hover:bg-muted/40 ${
                      isSelected ? "!bg-primary/10" : ""
                    }`}
                    style={{ width: ROW_HEADER_WIDTH, minWidth: ROW_HEADER_WIDTH }}
                    onClick={() =>
                      onSelectUser(isSelected ? null : u.user_id)
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
                            工时{" "}
                            <b className="text-foreground">{totalHrs}h</b>
                          </span>
                          <span>任务 {u.task_count}</span>
                        </div>
                        <Progress
                          percent={Math.min(u.saturation, 100)}
                          showInfo={false}
                          size="small"
                          strokeColor={saturationColor(u.saturation)}
                        />
                      </div>
                    </div>
                  </td>

                  {/* 日期单元格 */}
                  {dates.map((dk) => {
                    const cellTasks = row?.get(dk) ?? [];
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
                            : cellTasks.length === 0
                              ? `color-mix(in srgb, ${tokens.color.slate[500]} 1.5%, transparent)`
                              : undefined,
                        }}
                      >
                        <div className="flex min-h-[88px] flex-col gap-1 p-1.5">
                          {cellTasks.length === 0 ? (
                            <div className="flex h-[80px] items-center justify-center text-[10px] text-muted-foreground/40">
                              —
                            </div>
                          ) : (
                            cellTasks.map((t) => (
                              <TaskMiniCard
                                key={t.id}
                                task={t}
                                color={
                                  t.project_id
                                    ? (projectColorMap.get(t.project_id) ??
                                      tokens.color.slate[400])
                                    : tokens.color.slate[400]
                                }
                                onTaskClick={onTaskClick}
                                onTaskContextMenu={onTaskContextMenu}
                              />
                            ))
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

/** 任务缩略卡:title + project 颜色点。点击开详情,右键开菜单。 */
function TaskMiniCard({
  task,
  color,
  onTaskClick,
  onTaskContextMenu,
}: {
  task: KanbanTaskCard;
  color: string;
  onTaskClick: (t: KanbanTaskCard) => void;
  onTaskContextMenu: (t: KanbanTaskCard, e: React.MouseEvent) => void;
}) {
  const isOverdue = useMemo(() => {
    if (!task.deadline) return false;
    if (task.status === "已完成") return false;
    const d = new Date(task.deadline);
    if (Number.isNaN(d.getTime())) return false;
    // 严格早于今天 0 点 = 逾期
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    return d.getTime() < today0.getTime();
  }, [task.deadline, task.status]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onTaskClick(task)}
      onContextMenu={(e) => {
        e.preventDefault();
        onTaskContextMenu(task, e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTaskClick(task);
        }
      }}
      className={`cursor-pointer rounded border bg-background px-1.5 py-1 text-[11px] shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md ${
        isOverdue ? "border-l-2 border-l-red-500" : "border-border"
      }`}
    >
      <div className="flex items-center gap-1">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="line-clamp-1 flex-1 text-foreground">
          {task.title ?? "(未命名任务)"}
        </span>
      </div>
      {task.project_name && (
        <div className="mt-0.5 line-clamp-1 pl-3 text-[10px] text-muted-foreground">
          {task.project_name}
        </div>
      )}
    </div>
  );
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

export default KanbanMatrix;
