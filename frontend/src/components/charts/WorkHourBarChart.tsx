"use client";

/**
 * 工时柱状图 (task-05 / FR-05)。
 *
 * 按用户 / 项目维度渲染工时柱状图,单系列。
 * - 经 components/charts/index.ts 用 next/dynamic ssr:false 加载,避免 SSR window。
 * - 空数据显示占位卡片,不渲染 ECharts。
 * - 主题感知 (task-09):订阅 useThemeStore,柱色默认按当前主题 chartColors(theme).user,
 *   坐标轴文字色(slate-600)与值轴分割线色(border)注入 option,切换主题即时重渲染。
 *
 * 数据源:lib/ppm/task.statWorkHoursByUser|ByProject 聚合后的 rows。
 */
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";

import { chartColors, toBarSeries, type BarRow } from "@/lib/ppm/aggregations";
import { themes } from "@/styles";
import { useThemeStore } from "@/stores/theme";

export interface WorkHourBarChartProps {
  rows: BarRow[];
  /** 柱颜色,默认按当前主题 chartColors(theme).user。 */
  color?: string;
  /** 高度 px,默认 320。 */
  height?: number;
  /** 父组件 loading 态:显示骨架。 */
  loading?: boolean;
}

export function WorkHourBarChart({
  rows,
  color,
  height = 320,
  loading = false,
}: WorkHourBarChartProps) {
  const theme = useThemeStore((s) => s.theme);
  const textColor = themes[theme].color.slate[600];
  const splitColor = themes[theme].color.border;
  const option = useMemo(
    () =>
      toBarSeries(rows, color ?? chartColors(theme).user, {
        textColor,
        splitColor,
      }),
    [rows, color, theme, textColor, splitColor],
  );

  if (loading) {
    return (
      <div
        className="animate-pulse rounded bg-muted/30"
        style={{ height }}
        aria-label="工时柱状图加载中"
      />
    );
  }
  if (rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded border bg-muted/20 text-xs text-muted-foreground"
        style={{ height }}
      >
        暂无数据
      </div>
    );
  }

  return (
    <ReactECharts
      option={option}
      style={{ width: "100%", height }}
      opts={{ renderer: "svg" }}
      notMerge
    />
  );
}
