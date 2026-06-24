"use client";

/**
 * KanbanGantt — 时间轴甘特图(计划视图)。
 *
 * 设计依据:design.md §4.1-4.6 + D-004/D-006/D-007;原型 prototype-kanban-gantt.html。
 * 布局:左侧行头(人员,sticky left)+ 右侧时间轴(日期刻度 sticky top + 周末高亮 +
 *   今天竖线)+ 任务条形(CSS 绝对定位,start→deadline)+ 多行泳道(贪心)+ 未排期区。
 * 左右行高同源常量 LANE_HEIGHT/DATE_ROW_HEIGHT/DAY_WIDTH 驱动,不混用 table(D-006)。
 * 复用 helpers:computeBarLayout / assignLanes / rangeDateKeys / isWeekendKey / todayKey。
 */
import { useMemo } from "react";
import { Avatar, Progress } from "antd";
import dayjs from "dayjs";

import type { KanbanTaskCard, KanbanUserColumn } from "@/lib/ppm/types";
import { tokens } from "@/styles";
import {
  assignLanes,
  BAR_GAP,
  BAR_HEIGHT,
  BAR_MIN_TEXT_WIDTH,
  BAR_TOP_PAD,
  computeBarLayout,
  DATE_ROW_HEIGHT,
  DAY_WIDTH,
  isWeekendKey,
  LANE_HEIGHT,
  rangeDateKeys,
  ROW_HEAD_WIDTH,
  todayKey,
  type BarLayout,
} from "./kanban-gantt-helpers";

export interface KanbanGanttProps {
  users: KanbanUserColumn[];
  tasks: KanbanTaskCard[];
  startDate: string;
  endDate: string;
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onTaskClick: (task: KanbanTaskCard) => void;
  onTaskContextMenu: (task: KanbanTaskCard, e: React.MouseEvent) => void;
  /** projectId → 颜色,由 page 注入(projectColorMap)。 */
  projectColorMap: Map<string, string>;
}

const UNSCHEDULED_ROW_H = 24;
const UNSCHEDULED_HEADER_H = 26;

function saturationColor(v: number): string {
  if (v >= 80) return tokens.color.semantic.error.color;
  if (v >= 60) return tokens.color.semantic.warning.color;
  return tokens.color.semantic.success.color;
}

function userTotalHours(userId: string, tasks: KanbanTaskCard[]): number {
  let sum = 0;
  for (const t of tasks) if (t.user_id === userId) sum += t.estimate_hours ?? 0;
  return Math.round(sum * 10) / 10;
}

function isOverdue(t: KanbanTaskCard): boolean {
  if (!t.deadline || t.status === "已完成") return false;
  const d = dayjs(t.deadline);
  if (!d.isValid()) return false;
  return d.startOf("day").isBefore(dayjs().startOf("day"));
}

export function KanbanGantt({
  users,
  tasks,
  startDate,
  endDate,
  selectedUserId,
  onSelectUser,
  onTaskClick,
  onTaskContextMenu,
  projectColorMap,
}: KanbanGanttProps) {
  const rangeStart = useMemo(() => dayjs(startDate), [startDate]);
  const rangeEnd = useMemo(() => dayjs(endDate), [endDate]);
  const dates = useMemo(() => rangeDateKeys(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const today = todayKey();
  const totalDaysWidth = dates.length * DAY_WIDTH;

  // 按人分组:scheduled(有 start+deadline) / unscheduled / null user 全局
  const { perUser, globalUnscheduled } = useMemo(() => {
    const perUser = new Map<string, { scheduled: KanbanTaskCard[]; unscheduled: KanbanTaskCard[] }>();
    const globalUnscheduled: KanbanTaskCard[] = [];
    for (const t of tasks) {
      const uid = t.user_id;
      if (!uid) {
        globalUnscheduled.push(t);
        continue;
      }
      if (!perUser.has(uid)) perUser.set(uid, { scheduled: [], unscheduled: [] });
      const grp = perUser.get(uid)!;
      (t.start_time && t.deadline ? grp.scheduled : grp.unscheduled).push(t);
    }
    return { perUser, globalUnscheduled };
  }, [tasks]);

  if (users.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-16 text-center text-xs text-muted-foreground">
        暂无可见的人员/任务。请确认你有可见的 project_member,或清除筛选条件。
      </div>
    );
  }

  const todayIdx = dates.indexOf(today);

  return (
    <div className="relative h-full overflow-auto rounded-lg border border-border bg-background">
      <div className="relative" style={{ minWidth: ROW_HEAD_WIDTH + totalDaysWidth }}>
        {/* 日期刻度行 sticky top */}
        <div className="sticky top-0 z-20 flex border-b border-border bg-background">
          <div
            className="sticky left-0 z-30 flex shrink-0 items-center border-r border-border bg-background px-3 text-xs font-medium text-muted-foreground"
            style={{ width: ROW_HEAD_WIDTH, height: DATE_ROW_HEIGHT }}
          >
            人员 / 工时
          </div>
          {dates.map((dk) => {
            const weekend = isWeekendKey(dk);
            const isToday = dk === today;
            const d = dayjs(dk);
            return (
              <div
                key={dk}
                className="shrink-0 text-center"
                style={{
                  width: DAY_WIDTH,
                  height: DATE_ROW_HEIGHT,
                  backgroundColor: weekend
                    ? `color-mix(in srgb, ${tokens.color.emerald} 14%, transparent)`
                    : undefined,
                }}
              >
                <div className={`pt-1.5 text-sm font-medium ${isToday ? "text-primary" : "text-foreground"}`}>
                  {d.format("MM/DD")}
                  {weekend && (
                    <span className="ml-0.5 rounded bg-amber-400 px-1 text-[9px] text-white">休</span>
                  )}
                </div>
                <div className={`text-[11px] ${weekend ? "text-amber-600" : "text-muted-foreground"}`}>
                  {d.format("ddd")}
                </div>
              </div>
            );
          })}
        </div>

        {/* 每人块 */}
        {users.map((u) => {
          const grp = perUser.get(u.user_id) ?? { scheduled: [], unscheduled: [] };
          const { laneMap, rowCount } = assignLanes(
            grp.scheduled.map((t) => ({
              id: t.id,
              start: dayjs(t.start_time!),
              end: dayjs(t.deadline!),
            })),
          );
          const lanesH = rowCount * LANE_HEIGHT;
          const unschedH =
            grp.unscheduled.length > 0
              ? UNSCHEDULED_HEADER_H + grp.unscheduled.length * UNSCHEDULED_ROW_H
              : 0;
          const blockH = lanesH + unschedH;
          const isSelected = selectedUserId === u.user_id;
          const totalHrs = userTotalHours(u.user_id, tasks);
          const displayName = u.username ?? u.user_id;
          return (
            <div key={u.user_id} className="flex border-b border-border" style={{ height: blockH }}>
              {/* 左行头 */}
              <div
                className={`sticky left-0 z-10 shrink-0 cursor-pointer border-r border-border bg-background transition hover:bg-muted/40 ${isSelected ? "!bg-primary/10" : ""}`}
                style={{ width: ROW_HEAD_WIDTH }}
                onClick={() => onSelectUser(isSelected ? null : u.user_id)}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <Avatar size={32} src={u.avatar ?? undefined}>
                    {displayName.charAt(0).toUpperCase()}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-foreground">{displayName}</div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>
                        工时 <b className="text-foreground">{totalHrs}h</b>
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
              </div>
              {/* 右内容:泳道 + 条形 + 未排期 */}
              <div className="relative" style={{ width: totalDaysWidth }}>
                {/* 周末背景列 */}
                {dates.map((dk, i) =>
                  isWeekendKey(dk) ? (
                    <div
                      key={dk}
                      className="absolute top-0"
                      style={{
                        left: i * DAY_WIDTH,
                        width: DAY_WIDTH,
                        height: lanesH,
                        backgroundColor: `color-mix(in srgb, ${tokens.color.emerald} 8%, transparent)`,
                      }}
                    />
                  ) : null,
                )}
                {/* 任务条形 */}
                {grp.scheduled.map((t) => {
                  const layout = computeBarLayout(t.start_time, t.deadline, rangeStart, rangeEnd);
                  if (!layout) return null;
                  const lane = laneMap.get(t.id) ?? 0;
                  const color = t.project_id
                    ? (projectColorMap.get(t.project_id) ?? tokens.color.slate[400])
                    : tokens.color.slate[400];
                  return (
                    <GanttBar
                      key={t.id}
                      title={t.title ?? "(未命名任务)"}
                      tag={t.status ?? undefined}
                      color={color}
                      layout={layout}
                      top={lane * LANE_HEIGHT + BAR_TOP_PAD}
                      overdue={isOverdue(t)}
                      onClick={() => onTaskClick(t)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onTaskContextMenu(t, e);
                      }}
                    />
                  );
                })}
                {/* 未排期区(底部,按人归) */}
                {grp.unscheduled.length > 0 && (
                  <div
                    className="absolute left-0 border-t border-dashed border-border bg-muted/20"
                    style={{ top: lanesH, width: totalDaysWidth }}
                  >
                    <div className="px-2 py-1 text-[10px] text-muted-foreground">
                      未排期({grp.unscheduled.length})
                    </div>
                    {grp.unscheduled.map((t) => (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        className="flex cursor-pointer items-center gap-1 px-2 text-[11px] hover:bg-muted/60"
                        style={{ height: UNSCHEDULED_ROW_H }}
                        onClick={() => onTaskClick(t)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onTaskContextMenu(t, e);
                        }}
                      >
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: t.project_id
                              ? (projectColorMap.get(t.project_id) ?? tokens.color.slate[400])
                              : tokens.color.slate[400],
                          }}
                        />
                        <span className="truncate text-foreground">{t.title ?? "(未命名任务)"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* 全局未排期(null user) */}
        {globalUnscheduled.length > 0 && (
          <div className="flex border-b border-border">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-muted/30 px-3 text-xs font-medium text-muted-foreground"
              style={{ width: ROW_HEAD_WIDTH }}
            >
              未分配人员
            </div>
            <div
              className="relative"
              style={{ width: totalDaysWidth, minHeight: UNSCHEDULED_HEADER_H + globalUnscheduled.length * UNSCHEDULED_ROW_H }}
            >
              {globalUnscheduled.map((t, i) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  className="absolute left-0 flex cursor-pointer items-center gap-1 px-2 text-[11px] hover:bg-muted/60"
                  style={{ top: i * UNSCHEDULED_ROW_H, right: 0, height: UNSCHEDULED_ROW_H }}
                  onClick={() => onTaskClick(t)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onTaskContextMenu(t, e);
                  }}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: tokens.color.slate[400] }}
                  />
                  <span className="truncate">{t.title ?? "(未命名任务)"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 今天竖线(内容层 absolute,随横向滚动;z 低于条形高于背景) */}
        {todayIdx >= 0 && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: ROW_HEAD_WIDTH + todayIdx * DAY_WIDTH + DAY_WIDTH / 2 - 1,
              top: DATE_ROW_HEIGHT,
              bottom: 0,
              width: 2,
              backgroundColor: tokens.color.semantic.error.color,
              opacity: 0.5,
              zIndex: 5,
            }}
          />
        )}
      </div>
    </div>
  );
}

/** 甘特任务条形:项目色背景 + 标题 + tag,点击/右键回调,跨范围裁剪渐变。 */
function GanttBar({
  title,
  tag,
  color,
  layout,
  top,
  overdue,
  onClick,
  onContextMenu,
}: {
  title: string;
  tag?: string;
  color: string;
  layout: BarLayout;
  top: number;
  overdue: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const narrow = layout.width < BAR_MIN_TEXT_WIDTH;
  const clipped = layout.clippedStart || layout.clippedEnd;
  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      className={`absolute flex cursor-pointer items-center overflow-hidden rounded-md text-[11px] text-white shadow-sm transition hover:-translate-y-px hover:shadow-md ${overdue ? "ring-2 ring-red-400" : ""}`}
      style={{
        left: layout.left,
        width: layout.width,
        top,
        height: BAR_HEIGHT,
        backgroundColor: color,
        ...(clipped
          ? {
              maskImage:
                "linear-gradient(90deg, rgba(0,0,0,0.35), #000 14%, #000 86%, rgba(0,0,0,0.35))",
            }
          : {}),
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {!narrow && <span className="truncate px-2">{title}</span>}
      {!narrow && tag && <span className="ml-auto pr-1.5 text-[10px] opacity-80">{tag}</span>}
    </div>
  );
}

export default KanbanGantt;
