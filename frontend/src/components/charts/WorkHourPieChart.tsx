"use client";

/**
 * 工时饼图 (task-05 / FR-05) — 替换原 CSS conic-gradient 零依赖实现。
 *
 * Top N + 其他聚合,避免颜色爆炸。空数据显示占位。
 * 经 components/charts/index.ts 用 next/dynamic ssr:false 加载。
 * 主题感知 (task-09):订阅 useThemeStore,饼图配色与 legend 文字色按当前主题
 * 从 themes 表取值注入,切换主题即时重渲染(ECharts 读不到 CSS 变量)。
 */
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";

import { chartColors, toPieSeries, type BarRow } from "@/lib/ppm/aggregations";
import { themes } from "@/styles";
import { useThemeStore } from "@/stores/theme";

export interface WorkHourPieChartProps {
  rows: BarRow[];
  totalHours: number;
  /** Top N 切片数,默认 5。 */
  topN?: number;
  /** 高度 px,默认 280。 */
  height?: number;
}

export function WorkHourPieChart({
  rows,
  totalHours,
  topN = 5,
  height = 280,
}: WorkHourPieChartProps) {
  const theme = useThemeStore((s) => s.theme);
  const option = useMemo(
    () =>
      toPieSeries(rows, totalHours, topN, {
        pieColors: chartColors(theme).pie,
        textColor: themes[theme].color.slate[600],
      }),
    [rows, totalHours, topN, theme],
  );

  if (rows.length === 0 || totalHours <= 0) {
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
