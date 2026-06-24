/**
 * PPM 图表聚合纯函数 (task-05 / D-013)。
 *
 * 将 stat / plans 数据转换为 echarts option,与渲染层解耦,
 * 便于单测覆盖空数据 / null / 字符串兜底等边界。
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-full-alignment/tasks/task-05.md §接口定义。
 */
import type { EChartsOption } from "echarts";

import { tokens } from "@/styles";
import type { PsProjectPlan } from "./types";

/** 图表配色:集中管理,柱/饼/成本三图共用。 */
export const CHART_COLORS = {
  user: tokens.color.blue[600],
  project: tokens.color.emerald,
  budget: tokens.color.blue[600],
  actual: tokens.color.semantic.warning.color,
  remaining: tokens.color.emerald,
  negative: tokens.color.semantic.error.color,
  pie: [
    tokens.color.blue[600],
    tokens.color.cyan,
    tokens.color.emerald,
    tokens.color.semantic.warning.color,
    tokens.color.semantic.error.color,
    tokens.color.semantic.neutral.color,
  ],
} as const;

/** 后端 Decimal → JSON 字符串,前端需 Number() 兜底,null/undefined → 0。 */
export function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 柱状图输入行(按 user/project 维度聚合后的工时)。 */
export interface BarRow {
  name: string;
  total_hours: number;
}

/**
 * 柱状图 option:names 为 X 轴,hours 为单系列。
 * - 类别 > 30 时启用 dataZoom + 标签旋转 45°。
 */
export function toBarSeries(rows: BarRow[], color: string): EChartsOption {
  const names = rows.map((r) => r.name);
  const hours = rows.map((r) => toNumber(r.total_hours));
  const crowded = names.length > 30;

  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (v) => `${toNumber(v).toFixed(1)}h`,
    },
    grid: { left: 48, right: 24, top: 24, bottom: names.length > 6 ? 96 : 40, containLabel: true },
    xAxis: {
      type: "category",
      data: names,
      axisLabel: {
        rotate: names.length > 6 ? 45 : 0,
        interval: 0,
        formatter: (v: string) =>
          typeof v === "string" && v.length > 8 ? v.slice(0, 7) + "…" : v,
      },
    },
    yAxis: {
      type: "value",
      name: "工时(h)",
      axisLabel: { formatter: (v: number) => `${v}h` },
    },
    series: [
      {
        type: "bar",
        data: hours,
        itemStyle: { color },
        barMaxWidth: 48,
      },
    ],
    ...(crowded
      ? { dataZoom: [{ type: "slider", xAxisIndex: 0, start: 0, end: 30 }] }
      : {}),
  };
}

/**
 * 饼图 option:Top N + 其他聚合(默认 N=5),避免颜色爆炸。
 * - totalHours=0 时返回空 series(不抛错),由调用方决定占位。
 */
export function toPieSeries(
  rows: BarRow[],
  totalHours: number,
  topN = 5,
): EChartsOption {
  const n = Math.max(0, topN);
  const top = rows.slice(0, n);
  const rest = rows.slice(n);
  const restHours = rest.reduce((s, r) => s + toNumber(r.total_hours), 0);

  const data: { name: string; value: number; itemStyle?: { color: string } }[] =
    top.map((r, i) => ({
      name: r.name,
      value: toNumber(r.total_hours),
      itemStyle: { color: CHART_COLORS.pie[i] ?? CHART_COLORS.pie[5] },
    }));
  if (restHours > 0) {
    data.push({
      name: `其他(${rest.length})`,
      value: restHours,
      itemStyle: { color: CHART_COLORS.pie[5] },
    });
  }

  return {
    tooltip: {
      trigger: "item",
      formatter: (p: any) =>
        `${p.name}: ${toNumber(p.value).toFixed(1)}h (${p.percent ?? 0}%)`,
    },
    legend: { type: "scroll", orient: "vertical", right: 0, top: "middle" },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        center: ["40%", "50%"],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        data,
      },
    ],
  };
}

/**
 * 成本条形图 option:横向,Y 轴项目名,三系列 budget/actual/remaining。
 * - 字符串/null 兜底为 0;actual 优先用 total_cost,缺省回退 actual_consumption_person_days(口径不同)。
 * - 项目 > 20 时启用 yAxis dataZoom。
 */
export function toCostSeries(
  plans: Pick<
    PsProjectPlan,
    | "id"
    | "project_name"
    | "budget_amount"
    | "total_cost"
    | "actual_consumption_person_days"
    | "remaining_cost"
  >[],
): EChartsOption {
  // Y 轴自下而上展示,反转使第一个项目在顶部。
  const names = plans.map((p) => p.project_name ?? p.id).reverse();
  const budget = plans.map((p) => toNumber(p.budget_amount)).reverse();
  const actual = plans
    .map((p) =>
      toNumber(p.total_cost) !== 0
        ? toNumber(p.total_cost)
        : toNumber(p.actual_consumption_person_days),
    )
    .reverse();
  const remaining = plans.map((p) => toNumber(p.remaining_cost)).reverse();

  const crowded = plans.length > 20;

  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0, data: ["预算", "实际", "剩余"] },
    grid: { left: 16, right: 24, top: 40, bottom: crowded ? 56 : 24, containLabel: true },
    xAxis: { type: "value", name: "金额" },
    yAxis: { type: "category", data: names },
    series: [
      {
        name: "预算",
        type: "bar",
        data: budget,
        itemStyle: { color: CHART_COLORS.budget },
      },
      {
        name: "实际",
        type: "bar",
        data: actual,
        itemStyle: { color: CHART_COLORS.actual },
      },
      {
        name: "剩余",
        type: "bar",
        data: remaining,
        // 负剩余(超支)标红;其余绿。逐项着色。
        itemStyle: {
          color: (p: { value: unknown }) =>
            toNumber(p.value) < 0
              ? CHART_COLORS.negative
              : CHART_COLORS.remaining,
        },
      },
    ],
    ...(crowded
      ? { dataZoom: [{ type: "slider", yAxisIndex: 0, start: 0, end: 20 }] }
      : {}),
  };
}
