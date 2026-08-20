"use client";

/**
 * KanbanWorkloadGrid — 人员 × 日期工时热力网格 (task-09)。
 *
 * 设计依据:design.md §7.2-7.4 + prototype-kanban-workload-heatmap.html。
 * 布局:左侧行头(人员,sticky left)+ 顶部日期刻度(sticky top,复用 workday
 *   休息/调休标签)+ 单元格 = 当日工时数字(人天),底色走 workloadCellColorForDay
 *   锚点偏离式染色;休息态(周末/法定)灰底不染色。
 * 数据:组件内按 mode/dateRange/过滤调 fetchWorkloadGrid(FR-02),不在 store。
 * 口径边界(图例注明):plan=剩余负载摊天(仅 ≥ today,面向未来);actual=
 *   time_spent 覆盖日求和(含今天);休息日列后端也可能有值,一律灰底不染色(D-04)。
 */
import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";

import { useNotify } from "@/lib/errors";
import { fetchWorkloadGrid, type WorkloadGridResponse } from "@/lib/ppm/kanban";
import { getDayStatus } from "@/lib/ppm/workday";
import { DEFAULT_THEME, themes } from "@/styles";
import { workloadCellColor, workloadCellColorForDay } from "./kanban-workload-helpers";
import { ROW_HEAD_WIDTH, todayKey } from "./kanban-gantt-helpers";

/** 单元格宽(比甘特 200px 窄,热力格只要容下数字)。 */
const CELL_WIDTH = 64;
/** 单元格高。 */
const CELL_HEIGHT = 40;
/** 日期刻度行高。 */
const HEADER_HEIGHT = 48;

export interface KanbanWorkloadGridProps {
  /** plan=团队计划排程表(剩余负载摊天) / actual=团队实际工作表(覆盖日求和)。 */
  mode: "plan" | "actual";
  startDate: string;
  endDate: string;
  projectId?: string | null;
  userIds?: string[] | null;
}

export function KanbanWorkloadGrid({
  mode,
  startDate,
  endDate,
  projectId,
  userIds,
}: KanbanWorkloadGridProps) {
  const [data, setData] = useState<WorkloadGridResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const notify = useNotify();

  const userIdsKey = useMemo(() => (userIds ?? []).join(","), [userIds]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWorkloadGrid({
      start_date: startDate,
      end_date: endDate,
      project_id: projectId ?? null,
      user_ids: userIds && userIds.length > 0 ? userIds : null,
    })
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          notify.error(err, "加载工时热力网格失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // userIdsKey 代表 userIds 内容,避免数组引用变化重复拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, startDate, endDate, projectId, userIdsKey]);

  const days = useMemo(() => data?.days ?? [], [data]);
  const rows = useMemo(() => data?.users ?? [], [data]);
  const today = todayKey();

  if (loading && !data) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-16 text-center text-xs text-muted-foreground">
        工时热力加载中…
      </div>
    );
  }

  if (!data || rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-16 text-center text-xs text-muted-foreground">
        暂无可见的人员工时数据。请确认你有可见的 project_member,或清除筛选条件。
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      {/* 口径说明 */}
      <div className="shrink-0 text-xs text-muted-foreground">
        {mode === "plan" ? (
          <>
            当日<b>计划</b>工时(剩余负载摊天 = (计划−已用)/剩余日历天数,面向未来:
            今天及未来有值,过去日期无计划负载=0)
          </>
        ) : (
          <>
            当日<b>实际</b>工时(TaskExecute.time_spent 覆盖日求和,面向过去:
            过去及今天有值,未来=0)
          </>
        )}
      </div>

      {/* 网格 */}
      <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-background">
        <div
          className="relative"
          style={{ minWidth: ROW_HEAD_WIDTH + days.length * CELL_WIDTH }}
        >
          {/* 日期刻度行 sticky top */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-background">
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center border-r border-border bg-background px-3 text-xs font-medium text-muted-foreground"
              style={{ width: ROW_HEAD_WIDTH, height: HEADER_HEIGHT }}
            >
              人员 / 日期
            </div>
            {days.map((dk) => {
              const status = getDayStatus(dk);
              const isToday = dk === today;
              const d = dayjs(dk);
              return (
                <div
                  key={dk}
                  className="shrink-0 text-center"
                  style={{
                    width: CELL_WIDTH,
                    height: HEADER_HEIGHT,
                    backgroundColor: status.rest ? themes[DEFAULT_THEME].color.slate[100] : undefined,
                  }}
                >
                  <div
                    className={`pt-1.5 text-xs font-medium ${isToday ? "text-primary" : status.rest ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {d.format("MM/DD")}
                    {status.adjustedWork && (
                      <span className="ml-0.5 rounded bg-amber-500 px-1 text-[9px] text-white">
                        班
                      </span>
                    )}
                  </div>
                  <div
                    className={`text-[10px] ${status.rest ? "text-muted-foreground" : status.adjustedWork ? "text-amber-600" : "text-muted-foreground"}`}
                  >
                    {d.format("ddd")}
                    {status.rest && status.label && status.label !== "休"
                      ? `·${status.label}`
                      : ""}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 每人一行 */}
          {rows.map((u) => {
            const hoursMap = (mode === "plan" ? u.plan_hours : u.actual_hours) ?? {};
            const displayName = u.username ?? u.user_id;
            return (
              <div key={u.user_id} className="flex border-b border-border">
                {/* 左行头 */}
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-background px-3"
                  style={{ width: ROW_HEAD_WIDTH, height: CELL_HEIGHT }}
                >
                  <span className="truncate text-xs font-semibold text-foreground">
                    {displayName}
                  </span>
                </div>
                {/* 单元格 */}
                {days.map((dk) => {
                  const status = getDayStatus(dk);
                  const v = hoursMap[dk] ?? 0;
                  if (status.rest) {
                    return (
                      <div
                        key={dk}
                        className="flex shrink-0 items-center justify-center text-xs"
                        style={{
                          width: CELL_WIDTH,
                          height: CELL_HEIGHT,
                          backgroundColor: themes[DEFAULT_THEME].color.slate[100],
                          color: themes[DEFAULT_THEME].color.slate[300],
                        }}
                      >
                        —
                      </div>
                    );
                  }
                  const c = workloadCellColorForDay(dk, v);
                  return (
                    <div
                      key={dk}
                      className="flex shrink-0 items-center justify-center border-l border-border/40 text-xs font-semibold tabular-nums"
                      style={{
                        width: CELL_WIDTH,
                        height: CELL_HEIGHT,
                        backgroundColor: c.bg,
                        color: v === 0 ? themes[DEFAULT_THEME].color.slate[400] : c.fg,
                      }}
                      title={`${displayName} ${dk}: ${v.toFixed(1)} 人天`}
                    >
                      {v === 0 ? "0" : v.toFixed(1)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* 图例 */}
      <WorkloadLegend />
    </div>
  );
}

/** 锚点偏离式配色图例 + 口径边界说明。 */
function WorkloadLegend() {
  const stops = [0, 0.3, 0.6, 0.9, 1.0, 1.3, 1.7, 2.2, 3.0];
  return (
    <div className="shrink-0 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] text-muted-foreground">
          配色(基准 1人天=8h):
        </span>
        {stops.map((v) => {
          const c = workloadCellColor(v);
          return (
            <span
              key={v}
              className="flex h-6 w-10 items-center justify-center rounded border border-border text-[10px] font-semibold tabular-nums"
              style={{
                backgroundColor: c.bg === "transparent" ? "#fff" : c.bg,
                color: c.fg,
              }}
            >
              {v.toFixed(1)}
            </span>
          );
        })}
        <span
          className="flex h-6 w-10 items-center justify-center rounded border border-border text-[10px]"
          style={{
            backgroundColor: themes[DEFAULT_THEME].color.slate[100],
            color: themes[DEFAULT_THEME].color.slate[300],
          }}
        >
          休
        </span>
      </div>
      <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
        不足(&lt;1人天)越接近 0 越绿(闲)、越接近 1 越黄;正好 1 人天无色(达标);
        超出(&gt;1人天)越大越红、≥3 趋黑。周末/法定假日灰底休息态不染色,调休补班正常染色。
      </div>
    </div>
  );
}

export default KanbanWorkloadGrid;
