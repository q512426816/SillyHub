"use client";

/**
 * WorkCalendarPanel — 个人工作台双圆点月历 (task-11 / FR-08 / D-007@v1)。
 *
 * 自研月历 grid(design §3 明确不引入第三方日历库,全仓无日历组件):
 *  - 7 列 grid + 星期表头(日~六)
 *  - 每日格双圆点:左点=当日任务负载 load_level,右点=延期预警 alert_level
 *  - 点击某日 → 选中高亮 + 下方列出当日任务(D-增强,从 page 下传的 tasks
 *    按 start_time 当日落点过滤)。无任务的日期也可点(显示空)。
 *
 * load_level 分档(design §7.3 按当日 start_time 任务数):
 *  - none(0):不渲染左点
 *  - normal(1-2):bg-emerald-500 绿(正常)
 *  - mid(3-4):bg-amber-500 黄(偏满)
 *  - over(≥5):bg-red-500 红(过载)
 *
 * alert_level 分档(design §7.3:该日有 end_time<now AND status!=已完成 → over):
 *  - none:不渲染右点
 *  - normal:bg-emerald-500 绿
 *  - over:bg-red-500 红(延期预警)
 *
 * 数据 WorkbenchCalendar 由 page.tsx(task-08)装配后 props 下传,组件内不独立 fetch
 * (design §3 / task-11 constraints);当日任务列表复用 page.tsx 已装配的 tasks。
 */
import { useState } from "react";

import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/layout";
import type { PlanTask } from "@/lib/ppm/types";
import type { CalendarDay, WorkbenchCalendar } from "@/lib/ppm/types";
import { taskStatusTag } from "../../shared";
import { Tag } from "antd";

export interface WorkCalendarPanelProps {
  /** 当月日历数据,null/loading 时渲染空 grid 或骨架文案,不报错。 */
  calendar: WorkbenchCalendar | null;
  /** 加载态;true 时显示骨架文案「日历加载中」。 */
  loading?: boolean;
  /** 个人任务列表(page.tsx 装配),用于点击某日时列出当日任务。 */
  tasks?: PlanTask[] | null;
}

/** 星期表头(日~六)。 */
const WEEK_HEADERS = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 按 yearMonth(YYYY-MM)构建月历格子:1 号前按星期补前导空格 + 遍历当月每日。
 * 每日从 days 按 date 匹配取 load_level/alert_level;无数据视为 none(不显点)。
 *
 * 返回数组:null=前导空格占位,{ day, dayInfo }=真实日期格。
 */
function buildMonthGrid(
  yearMonth: string | undefined,
  days: CalendarDay[],
): Array<{ type: "blank" } | { type: "day"; day: number; info: CalendarDay | null }> {
  if (!yearMonth) return [];
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12
  if (!year || !month) return [];

  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0=周日
  const daysInMonth = new Date(year, month, 0).getDate();

  // 按 date 建索引,匹配格式兼容 YYYY-MM-DD / ISO 时间串。
  const dayMap = new Map<string, CalendarDay>();
  for (const d of days) {
    if (!d?.date) continue;
    const dd = d.date.slice(8, 10); // 取日号(兼容 YYYY-MM-DD 与 YYYY-MM-DDTHH:...)
    dayMap.set(dd, d);
  }

  const cells: Array<
    { type: "blank" } | { type: "day"; day: number; info: CalendarDay | null }
  > = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push({ type: "blank" });
  for (let day = 1; day <= daysInMonth; day++) {
    const dd = String(day).padStart(2, "0");
    cells.push({ type: "day", day, info: dayMap.get(dd) ?? null });
  }
  return cells;
}

/** load_level → 左点颜色(任务饱和,注意事项 2):
 * none→灰(无计划) / leisure→黄(有空余) / full→绿(饱和) / over→红(过载)。 */
function loadDotClass(level: string | undefined): string {
  switch (level) {
    case "leisure":
      return "bg-amber-500";
    case "full":
      return "bg-emerald-500";
    case "over":
      return "bg-red-500";
    default:
      return "bg-slate-300"; // none / 未知:灰(无计划)
  }
}

/** alert_level → 右点颜色(任务进度,注意事项 2):
 * none→灰(无进度) / normal→绿(正常) / late→黄(临期) / over→红(延期)。 */
function alertDotClass(level: string | undefined): string {
  switch (level) {
    case "normal":
      return "bg-emerald-500";
    case "late":
      return "bg-amber-500";
    case "over":
      return "bg-red-500";
    default:
      return "bg-slate-300"; // none / 未知:灰(无进度)
  }
}

export function WorkCalendarPanel({
  calendar,
  loading,
  tasks,
}: WorkCalendarPanelProps) {
  const yearMonth = calendar?.year_month;
  const cells = buildMonthGrid(yearMonth, calendar?.days ?? []);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // 当日任务:按 start_time 的日期部分(YYYY-MM-DD,对齐后端 UTC day)过滤
  const dayTasks = selectedDay
    ? (tasks ?? []).filter((t) => (t.start_time ?? "").slice(0, 10) === selectedDay)
    : [];

  return (
    <SectionCard
      title={`本月日历 ${yearMonth ?? ""}`.trim()}
      bodyPadding="p-4"
    >
      {loading || !calendar ? (
        <div className="py-8 text-center text-xs text-muted-foreground animate-pulse">
          日历加载中…
        </div>
      ) : (
        <>
          {/* 星期表头 */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {WEEK_HEADERS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          {/* 日期 grid */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, idx) => {
              if (cell.type === "blank") {
                return <div key={`blank-${idx}`} className="aspect-square" />;
              }
              const loadColor = loadDotClass(cell.info?.load_level);
              const alertColor = alertDotClass(cell.info?.alert_level);
              const date = `${yearMonth}-${String(cell.day).padStart(2, "0")}`;
              const selected = selectedDay === date;
              return (
                <button
                  type="button"
                  key={`day-${cell.day}`}
                  onClick={() => setSelectedDay(date)}
                  className={cn(
                    "flex aspect-square flex-col rounded border p-1 text-left transition-colors",
                    selected
                      ? "border-primary bg-accent"
                      : "border-slate-100 bg-card hover:border-slate-300",
                  )}
                >
                  <span className="text-center text-xs">{cell.day}</span>
                  <div className="mt-auto flex items-center justify-center gap-0.5">
                    {loadColor ? (
                      <span
                        className={cn("size-1.5 rounded-full", loadColor)}
                        aria-label={`负载:${cell.info?.load_level ?? "none"}`}
                      />
                    ) : (
                      <span className="size-1.5" />
                    )}
                    {alertColor ? (
                      <span
                        className={cn("size-1.5 rounded-full", alertColor)}
                        aria-label={`预警:${cell.info?.alert_level ?? "none"}`}
                      />
                    ) : (
                      <span className="size-1.5" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {/* 图例:左点=任务饱和,右点=任务进度(注意事项 2) */}
          <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground/70">左·负载:</span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald-500" /> 饱和
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-amber-500" /> 有空余
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-red-500" /> 过载
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground/70">右·进度:</span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald-500" /> 正常
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-amber-500" /> 临期
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-red-500" /> 延期
              </span>
            </div>
          </div>

          {/* 当日任务列表(点击某日后展示) */}
          {selectedDay && (
            <div className="mt-3 border-t border-border pt-2">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                {selectedDay} 任务（{dayTasks.length}）
              </div>
              {dayTasks.length === 0 ? (
                <div className="text-xs text-muted-foreground">当日无任务</div>
              ) : (
                <ul className="space-y-1">
                  {dayTasks.map((t) => {
                    const tag = taskStatusTag(t.status);
                    return (
                      <li key={t.id} className="flex items-center gap-2 text-xs">
                        <Tag color={tag.color} className="shrink-0">
                          {tag.text}
                        </Tag>
                        <span className="min-w-0 flex-1 truncate" title={t.content ?? ""}>
                          {t.content ?? "—"}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {t.project_name ?? ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
