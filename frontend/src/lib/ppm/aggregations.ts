/**
 * PPM 图表聚合纯函数 (task-05 / D-013)。
 *
 * 将 stat / plans 数据转换为 echarts option,与渲染层解耦,
 * 便于单测覆盖空数据 / null / 字符串兜底等边界。
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-full-alignment/tasks/task-05.md §接口定义。
 */
import type { EChartsOption } from "echarts";

import { DEFAULT_THEME, themes, type ThemeName } from "@/styles";

/** 饼图六色定长元组(Top5 + 其他),保持旧 `as const` 表的索引安全性。 */
export type PiePalette = readonly [string, string, string, string, string, string];

/** chartColors 返回结构:user/project/budget/actual/remaining/negative/pie 七键。 */
export interface ChartColors {
  user: string;
  project: string;
  budget: string;
  actual: string;
  remaining: string;
  negative: string;
  pie: PiePalette;
}

/**
 * 图表配色工厂:按主题取 themes 注册表对应值(task-09 / FR-01 / D-003@v1),
 * 替换原编译期静态 CHART_COLORS(只能取 DEFAULT_THEME 一套)。
 * ECharts 读不到 CSS 变量,取色必须走 themes 表这条通道;聚合逻辑不变。
 */
export function chartColors(theme: ThemeName): ChartColors {
  const c = themes[theme].color;
  return {
    user: c.brand[600],
    project: c.semantic.success,
    budget: c.brand[600],
    actual: c.semantic.warning,
    remaining: c.semantic.success,
    negative: c.semantic.error,
    pie: [
      c.brand[600],
      c.accent,
      c.semantic.success,
      c.semantic.warning,
      c.semantic.error,
      c.semantic.neutral,
    ],
  };
}

/** toBarSeries 主题取值入参:不传时回落 DEFAULT_THEME 浅色取值(兼容旧行为)。 */
export interface BarSeriesThemeOptions {
  /** 坐标轴标签与轴名文字色(themes[theme].color.slate[600])。 */
  textColor?: string;
  /** 分割线色(themes[theme].color.border)。 */
  splitColor?: string;
}

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
 * - opts 注入当前主题文字色/分割线色(ECharts 默认深灰在暗色底不可读);
 *   类目轴 splitLine 默认隐藏,仅值轴分割线需着色。
 */
export function toBarSeries(
  rows: BarRow[],
  color: string,
  opts: BarSeriesThemeOptions = {},
): EChartsOption {
  const names = rows.map((r) => r.name);
  const hours = rows.map((r) => toNumber(r.total_hours));
  const crowded = names.length > 30;
  const textColor = opts.textColor ?? themes[DEFAULT_THEME].color.slate[600];
  const splitColor = opts.splitColor ?? themes[DEFAULT_THEME].color.border;

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
        color: textColor,
        formatter: (v: string) =>
          typeof v === "string" && v.length > 8 ? v.slice(0, 7) + "…" : v,
      },
    },
    yAxis: {
      type: "value",
      name: "工时(h)",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor, formatter: (v: number) => `${v}h` },
      splitLine: { lineStyle: { color: splitColor } },
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

/** toPieSeries 主题取值入参:不传时回落 DEFAULT_THEME 取值(兼容旧行为)。 */
export interface PieSeriesThemeOptions {
  /** 饼图系列六色(chartColors(theme).pie)。 */
  pieColors?: PiePalette;
  /** legend 文字色(themes[theme].color.slate[600])。 */
  textColor?: string;
}

/**
 * 饼图 option:Top N + 其他聚合(默认 N=5),避免颜色爆炸。
 * - totalHours=0 时返回空 series(不抛错),由调用方决定占位。
 * - opts 注入当前主题饼图配色与 legend 文字色(ECharts 默认深灰在暗色底不可读)。
 */
export function toPieSeries(
  rows: BarRow[],
  totalHours: number,
  topN = 5,
  opts: PieSeriesThemeOptions = {},
): EChartsOption {
  const n = Math.max(0, topN);
  const top = rows.slice(0, n);
  const rest = rows.slice(n);
  const restHours = rest.reduce((s, r) => s + toNumber(r.total_hours), 0);
  const pieColors = opts.pieColors ?? chartColors(DEFAULT_THEME).pie;
  const textColor = opts.textColor ?? themes[DEFAULT_THEME].color.slate[600];

  const data: { name: string; value: number; itemStyle?: { color: string } }[] =
    top.map((r, i) => ({
      name: r.name,
      value: toNumber(r.total_hours),
      itemStyle: { color: pieColors[i] ?? pieColors[5] },
    }));
  if (restHours > 0) {
    data.push({
      name: `其他(${rest.length})`,
      value: restHours,
      itemStyle: { color: pieColors[5] },
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
      textStyle: { color: textColor },
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
