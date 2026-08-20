/**
 * PPM 图表聚合纯函数 (task-05 / D-013)。
 *
 * 将 stat / plans 数据转换为 echarts option,与渲染层解耦,
 * 便于单测覆盖空数据 / null / 字符串兜底等边界。
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-full-alignment/tasks/task-05.md §接口定义。
 */
import type { EChartsOption } from "echarts";

import { DEFAULT_THEME, themes } from "@/styles";

/** 图表配色:集中管理,柱/饼/成本三图共用。取自主题注册表(编译期静态取色)。 */
export const CHART_COLORS = {
  user: themes[DEFAULT_THEME].color.brand[600],
  project: themes[DEFAULT_THEME].color.semantic.success,
  budget: themes[DEFAULT_THEME].color.brand[600],
  actual: themes[DEFAULT_THEME].color.semantic.warning,
  remaining: themes[DEFAULT_THEME].color.semantic.success,
  negative: themes[DEFAULT_THEME].color.semantic.error,
  pie: [
    themes[DEFAULT_THEME].color.brand[600],
    themes[DEFAULT_THEME].color.accent,
    themes[DEFAULT_THEME].color.semantic.success,
    themes[DEFAULT_THEME].color.semantic.warning,
    themes[DEFAULT_THEME].color.semantic.error,
    themes[DEFAULT_THEME].color.semantic.neutral,
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
      // FE-8：echarts formatter 回调参数是库内联合类型，收 unknown 后窄化，
      // 替掉全仓唯一的显式 any（非测试代码）。
      formatter: (p: unknown) => {
        const o = p as { name?: string; value?: unknown; percent?: number };
        return `${o.name ?? ""}: ${toNumber(o.value).toFixed(1)}h (${o.percent ?? 0}%)`;
      },
    },
    legend: {
      type: "scroll",
      orient: "horizontal",
      bottom: 0,
      left: "center",
      formatter: (name: string) =>
        typeof name === "string" && name.length > 8 ? name.slice(0, 7) + "…" : name,
    },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        center: ["50%", "42%"],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        data,
      },
    ],
  };
}
