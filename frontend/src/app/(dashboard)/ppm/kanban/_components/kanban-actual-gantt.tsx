"use client";

/**
 * KanbanActualGantt — 时间轴甘特图(实际工作视图)。
 *
 * 与 KanbanGantt(计划)骨架同源,差异(design §4.5 + D-004):
 *  - 数据 executes: TaskExecuteWithPlan[],条形 actual_start_time → actual_end_time
 *  - 按 execute_user_id 归人
 *  - 点击条形 → onEdit(ActualEditModal),**无右键菜单**(对齐 KanbanActualMatrix)
 *  - 固定 status 语义色(无 projectColorMap)
 *  - 标题 execute.plan_task?.content ?? "(无关联任务)"
 */
import { useMemo } from "react";
import { Avatar } from "antd";
import dayjs from "dayjs";

import type { KanbanUserColumn, TaskExecuteWithPlan } from "@/lib/ppm/types";
import { tokens } from "@/styles";
import {
  assignLanes,
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

export interface KanbanActualGanttProps {
  users: KanbanUserColumn[];
  executes: TaskExecuteWithPlan[];
  startDate: string;
  endDate: string;
  selectedUserId?: string | null;
  onSelectUser?: (userId: string | null) => void;
  onEdit: (item: TaskExecuteWithPlan) => void;
}

const UNSCHEDULED_ROW_H = 24;
const UNSCHEDULED_HEADER_H = 26;

const STATUS_TEXT: Record<string, string> = {
  "10": "待开始",
  "20": "进行中",
  "30": "待验证",
  "40": "验证中",
  "90": "已完成",
};

/** 实际条形按 status 映射语义色(无 projectColorMap)。 */
function executeBarColor(status: string | null | undefined): string {
  switch (status) {
    case "90":
      return tokens.color.semantic.success.color;
    case "20":
      return tokens.color.primary;
    case "30":
    case "40":
      return tokens.color.semantic.warning.color;
    default:
      return tokens.color.slate[500];
  }
}

export function KanbanActualGantt({
  users,
  executes,
  startDate,
  endDate,
  selectedUserId,
  onSelectUser,
  onEdit,
}: KanbanActualGanttProps) {
  const rangeStart = useMemo(() => dayjs(startDate), [startDate]);
  const rangeEnd = useMemo(() => dayjs(endDate), [endDate]);
  const dates = useMemo(() => rangeDateKeys(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const today = todayKey();
  const totalDaysWidth = dates.length * DAY_WIDTH;

  // 按 execute_user_id 分组
  const { perUser, globalUnscheduled } = useMemo(() => {
    const perUser = new Map<string, { scheduled: TaskExecuteWithPlan[]; unscheduled: TaskExecuteWithPlan[] }>();
    const globalUnscheduled: TaskExecuteWithPlan[] = [];
    for (const ex of executes) {
      const uid = ex.execute_user_id;
      if (!uid) {
        globalUnscheduled.push(ex);
        continue;
      }
      if (!perUser.has(uid)) perUser.set(uid, { scheduled: [], unscheduled: [] });
      const grp = perUser.get(uid)!;
      (ex.actual_start_time && ex.actual_end_time ? grp.scheduled : grp.unscheduled).push(ex);
    }
    return { perUser, globalUnscheduled };
  }, [executes]);

  if (users.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-16 text-center text-xs text-muted-foreground">
        暂无可见的人员/实际工作记录。
      </div>
    );
  }

  const todayIdx = dates.indexOf(today);

  return (
    <div className="relative h-full overflow-auto rounded-lg border border-border bg-background">
      <div className="relative" style={{ minWidth: ROW_HEAD_WIDTH + totalDaysWidth }}>
        {/* 日期刻度行 */}
        <div className="sticky top-0 z-20 flex border-b border-border bg-background">
          <div
            className="sticky left-0 z-30 flex shrink-0 items-center border-r border-border bg-background px-3 text-xs font-medium text-muted-foreground"
            style={{ width: ROW_HEAD_WIDTH, height: DATE_ROW_HEIGHT }}
          >
            人员 / 实际工时
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

        {users.map((u) => {
          const grp = perUser.get(u.user_id) ?? { scheduled: [], unscheduled: [] };
          const { laneMap, rowCount } = assignLanes(
            grp.scheduled.map((ex) => ({
              id: ex.id,
              start: dayjs(ex.actual_start_time!),
              end: dayjs(ex.actual_end_time!),
            })),
          );
          const lanesH = rowCount * LANE_HEIGHT;
          const unschedH =
            grp.unscheduled.length > 0
              ? UNSCHEDULED_HEADER_H + grp.unscheduled.length * UNSCHEDULED_ROW_H
              : 0;
          const blockH = lanesH + unschedH;
          const isSelected = selectedUserId === u.user_id;
          const displayName = u.username ?? u.user_id;
          return (
            <div key={u.user_id} className="flex border-b border-border" style={{ height: blockH }}>
              <div
                className={`sticky left-0 z-10 shrink-0 cursor-pointer border-r border-border bg-background transition hover:bg-muted/40 ${isSelected ? "!bg-primary/10" : ""}`}
                style={{ width: ROW_HEAD_WIDTH }}
                onClick={() => onSelectUser?.(isSelected ? null : u.user_id)}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <Avatar size={32} src={u.avatar ?? undefined}>
                    {displayName.charAt(0).toUpperCase()}
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-foreground">{displayName}</div>
                    <div className="text-[10px] text-muted-foreground">
                      记录 {grp.scheduled.length + grp.unscheduled.length}
                    </div>
                  </div>
                </div>
              </div>
              <div className="relative" style={{ width: totalDaysWidth }}>
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
                {grp.scheduled.map((ex) => {
                  const layout = computeBarLayout(
                    ex.actual_start_time,
                    ex.actual_end_time,
                    rangeStart,
                    rangeEnd,
                  );
                  if (!layout) return null;
                  const lane = laneMap.get(ex.id) ?? 0;
                  const title = ex.plan_task?.content ?? "(无关联任务)";
                  return (
                    <ActualBar
                      key={ex.id}
                      title={title}
                      tag={STATUS_TEXT[ex.status ?? ""] ?? ex.status ?? undefined}
                      color={executeBarColor(ex.status)}
                      layout={layout}
                      top={lane * LANE_HEIGHT + BAR_TOP_PAD}
                      onClick={() => onEdit(ex)}
                    />
                  );
                })}
                {grp.unscheduled.length > 0 && (
                  <div
                    className="absolute left-0 border-t border-dashed border-border bg-muted/20"
                    style={{ top: lanesH, width: totalDaysWidth }}
                  >
                    <div className="px-2 py-1 text-[10px] text-muted-foreground">
                      未记录时间({grp.unscheduled.length})
                    </div>
                    {grp.unscheduled.map((ex) => (
                      <div
                        key={ex.id}
                        role="button"
                        tabIndex={0}
                        className="flex cursor-pointer items-center gap-1 px-2 text-[11px] hover:bg-muted/60"
                        style={{ height: UNSCHEDULED_ROW_H }}
                        onClick={() => onEdit(ex)}
                      >
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: executeBarColor(ex.status) }}
                        />
                        <span className="truncate text-foreground">
                          {ex.plan_task?.content ?? "(无关联任务)"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* 全局未排期(null execute_user_id) */}
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
              {globalUnscheduled.map((ex, i) => (
                <div
                  key={ex.id}
                  role="button"
                  tabIndex={0}
                  className="absolute left-0 flex cursor-pointer items-center gap-1 px-2 text-[11px] hover:bg-muted/60"
                  style={{ top: i * UNSCHEDULED_ROW_H, right: 0, height: UNSCHEDULED_ROW_H }}
                  onClick={() => onEdit(ex)}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: executeBarColor(ex.status) }}
                  />
                  <span className="truncate">{ex.plan_task?.content ?? "(无关联任务)"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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

function ActualBar({
  title,
  tag,
  color,
  layout,
  top,
  onClick,
}: {
  title: string;
  tag?: string;
  color: string;
  layout: BarLayout;
  top: number;
  onClick: () => void;
}) {
  const narrow = layout.width < BAR_MIN_TEXT_WIDTH;
  const clipped = layout.clippedStart || layout.clippedEnd;
  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      className="absolute flex cursor-pointer items-center overflow-hidden rounded-md text-[11px] text-white shadow-sm transition hover:-translate-y-px hover:shadow-md"
      style={{
        left: layout.left,
        width: layout.width,
        top,
        height: BAR_HEIGHT,
        backgroundColor: color,
        ...(clipped
          ? { maskImage: "linear-gradient(90deg, rgba(0,0,0,0.35), #000 14%, #000 86%, rgba(0,0,0,0.35))" }
          : {}),
      }}
      onClick={onClick}
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

export default KanbanActualGantt;
