"use client";

/**
 * 工时柱状图 (task-05 / FR-05)。
 *
 * 按用户 / 项目维度渲染工时柱状图,单系列。
 * - 经 components/charts/index.ts 用 next/dynamic ssr:false 加载,避免 SSR window。
 * - 空数据显示占位卡片,不渲染 ECharts。
 *
 * 数据源:lib/ppm/task.statWorkHoursByUser|ByProject 聚合后的 rows。
 */
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";

import { CHART_COLORS, toBarSeries, type BarRow } from "@/lib/ppm/aggregations";

export interface WorkHourBarChartProps {
  rows: BarRow[];
  /** 柱颜色,默认按 user 维度蓝。 */
  color?: string;
  /** 高度 px,默认 320。 */
  height?: number;
  /** 父组件 loading 态:显示骨架。 */
  loading?: boolean;
}

export function WorkHourBarChart({
  rows,
  color = CHART_COLORS.user,
  height = 320,
  loading = false,
}: WorkHourBarChartProps) {
  const option = useMemo(() => toBarSeries(rows, color), [rows, color]);

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
