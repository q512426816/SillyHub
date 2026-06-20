"use client";

/**
 * 工时饼图 (task-05 / FR-05) — 替换原 CSS conic-gradient 零依赖实现。
 *
 * Top N + 其他聚合,避免颜色爆炸。空数据显示占位。
 * 经 components/charts/index.ts 用 next/dynamic ssr:false 加载。
 */
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";

import { toPieSeries, type BarRow } from "@/lib/ppm/aggregations";

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
  const option = useMemo(
    () => toPieSeries(rows, totalHours, topN),
    [rows, totalHours, topN],
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
