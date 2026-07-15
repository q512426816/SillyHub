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
import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";

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
  /** 当前显示月份 YYYY-MM(可切换,page.tsx state 下传)。 */
  month: string;
  /** 切换月份回调(传新 YYYY-MM)。 */
  onMonthChange: (month: string) => void;
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

/** alert_level → 右点颜色(D-008 进度,后端 green/yellow/red):
 * none→灰(无覆盖) / green→绿(正常) / yellow→黄(临期) / red→红(延期)。 */
function alertDotClass(level: string | undefined): string {
  switch (level) {
    case "green":
      return "bg-emerald-500";
    case "yellow":
      return "bg-amber-500";
    case "red":
      return "bg-red-500";
    default:
      return "bg-slate-300"; // none / 未知:灰(无覆盖)
  }
}

export function WorkCalendarPanel({
  calendar,
  loading,
  month,
  onMonthChange,
}: WorkCalendarPanelProps) {
  const cells = buildMonthGrid(calendar?.year_month, calendar?.days ?? []);
  // 今天(YYYY-MM-DD),用于默认选中;useMemo 稳定避免重渲染抖动。
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const [selectedDay, setSelectedDay] = useState<string | null>(todayStr);
  // 切换月份:今天在新月则选中今天,否则清空(避免跨月残留旧选中)。
  useEffect(() => {
    setSelectedDay(todayStr.startsWith(month) ? todayStr : null);
  }, [month, todayStr]);

  // 当日详情:从 calendar.days 取该天的 CalendarDay(含计划/缺陷/实际三类,D-009)
  const selectedInfo = selectedDay
    ? (calendar?.days ?? []).find((d) => d.date === selectedDay) ?? null
    : null;

  return (
    <SectionCard title="工作日历" bodyPadding="p-4">
      {/* 月份导航:‹ 上月 | YYYY年M月 | 下月 › */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() =>
            onMonthChange(dayjs(month).subtract(1, "month").format("YYYY-MM"))
          }
          className="rounded px-2 py-0.5 text-base text-muted-foreground hover:bg-muted"
          aria-label="上个月"
        >
          ‹
        </button>
        <span className="text-sm font-medium">
          {dayjs(month).format("YYYY年M月")}
        </span>
        <button
          type="button"
          onClick={() =>
            onMonthChange(dayjs(month).add(1, "month").format("YYYY-MM"))
          }
          className="rounded px-2 py-0.5 text-base text-muted-foreground hover:bg-muted"
          aria-label="下个月"
        >
          ›
        </button>
      </div>
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
              const date = `${month}-${String(cell.day).padStart(2, "0")}`;
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
            <div className="text-muted-foreground/60">
              左点：过去日期按实际工时 · 今天及以后按剩余负载
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

          {/* 当日详情(点击某日后展示):计划/缺陷/实际三类 (D-009) */}
          {selectedDay && selectedInfo && (
            <div className="mt-3 space-y-2 border-t border-border pt-2">
              <div className="text-[11px] font-medium text-muted-foreground">
                {selectedDay} 详情
              </div>
              {/* 计划任务 */}
              <div>
                <div className="mb-0.5 text-[10px] text-muted-foreground">
                  计划任务（{selectedInfo.plan_items.length}）
                </div>
                {selectedInfo.plan_items.length === 0 ? (
                  <div className="text-xs text-muted-foreground/70">无</div>
                ) : (
                  <ul className="space-y-0.5">
                    {selectedInfo.plan_items.map((p) => {
                      const tag = taskStatusTag(p.status ?? "");
                      return (
                        <li key={p.id} className="flex items-center gap-2 text-xs">
                          <Tag color={tag.color} className="shrink-0">{tag.text}</Tag>
                          <span className="min-w-0 flex-1 truncate" title={p.content ?? ""}>
                            {p.content ?? "—"}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {p.project_name ?? ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {/* 缺陷任务 */}
              <div>
                <div className="mb-0.5 text-[10px] text-muted-foreground">
                  缺陷任务（{selectedInfo.problem_items.length}）
                </div>
                {selectedInfo.problem_items.length === 0 ? (
                  <div className="text-xs text-muted-foreground/70">无</div>
                ) : (
                  <ul className="space-y-0.5">
                    {selectedInfo.problem_items.map((p) => (
                      <li key={p.id} className="flex items-center gap-2 text-xs">
                        <span
                          className={cn(
                            "shrink-0 rounded px-1 text-[10px]",
                            p.status === "4"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700",
                          )}
                        >
                          {p.status === "4" ? "已关闭" : "未关闭"}
                        </span>
                        <span className="min-w-0 flex-1 truncate" title={p.pro_desc ?? ""}>
                          {p.pro_desc ?? "—"}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {p.project_name ?? ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {/* 实际执行 */}
              <div>
                <div className="mb-0.5 text-[10px] text-muted-foreground">
                  实际执行（{selectedInfo.execute_items.length}）
                </div>
                {selectedInfo.execute_items.length === 0 ? (
                  <div className="text-xs text-muted-foreground/70">无</div>
                ) : (
                  <ul className="space-y-0.5">
                    {selectedInfo.execute_items.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 text-xs">
                        <span
                          className={cn(
                            "shrink-0 rounded px-1 text-[10px]",
                            e.status === "90"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-blue-100 text-blue-700",
                          )}
                        >
                          {e.status === "90" ? "已完成" : (e.status ?? "—")}
                        </span>
                        <span className="min-w-0 flex-1 truncate" title={e.content ?? ""}>
                          {e.content ?? "(无关联任务)"}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {e.time_spent != null ? `${e.time_spent}人天` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
