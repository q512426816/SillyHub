"use client";

/**
 * 项目计划成本条形图 (task-05 / FR-05)。
 *
 * 横向条形,Y 轴项目名,三系列 budget / actual / remaining。
 * - actual 优先 total_cost,缺省回退 actual_consumption_person_days(口径不同,注释见 aggregations.ts)。
 * - 空 plans 显示占位。
 * 经 components/charts/index.ts 用 next/dynamic ssr:false 加载。
 */
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";

import { toCostSeries } from "@/lib/ppm/aggregations";
import type { PsProjectPlan } from "@/lib/ppm/types";

export interface ProjectPlanCostBarChartProps {
  plans: PsProjectPlan[];
  /** 高度 px,默认 360。 */
  height?: number;
}

export function ProjectPlanCostBarChart({
  plans,
  height = 360,
}: ProjectPlanCostBarChartProps) {
  const option = useMemo(() => toCostSeries(plans), [plans]);

  if (plans.length === 0) {
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
