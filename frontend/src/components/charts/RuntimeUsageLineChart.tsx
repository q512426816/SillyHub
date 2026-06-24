"use client";

/**
 * 运行时用量折线图 (task-12 / FR-04 / D-002@v1)。
 *
 * 卡片内嵌 sparkline:输入 / 输出双线 token 趋势。
 * - 经 components/charts/index.tsx 用 next/dynamic ssr:false 加载(task-13),避免 SSR window。
 * - 空数据显示占位卡片,不渲染 ECharts(照搬 WorkHourBarChart)。
 * - 不画 cache 线 / 费用线(FR-04 只要求双线;cache/费用在卡片用数字展示,见 task-14)。
 * - 不使用 react-query:本组件纯展示,数据由父组件(task-14)经 props 传入。
 *
 * 数据源:lib/daemon.ts getRuntimesUsage 响应的 daily 序列(task-11)。
 *
 * ⚠️ 类型迁移:task-11 在 lib/daemon.ts 落地 `RuntimeUsagePoint` 后,
 * 删除本文件内的局部 `RuntimeUsagePoint` 定义,改为
 * `import type { RuntimeUsagePoint } from "@/lib/daemon"`(由 task-13/14 统一迁移)。
 * 当前 task-11 未实现,本组件先内联最小类型保证自洽可独立验收(task-12 allowed_paths 仅本文件)。
 */
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import { CHART_COLORS } from "@/lib/ppm/aggregations";

/**
 * 时间序列单点(小时桶 1d / 日桶 7d·30d,D-002@v1)。
 * 字段与 task-11 lib/daemon.ts 的 RuntimeUsagePoint 对齐(完整 6 字段);
 * 本组件只消费 input_tokens / output_tokens,cache_* / total_cost_usd 透传不用。
 *
 * 临时局部定义:见文件头 JSDoc,task-11 完成后迁移到 lib/daemon.ts。
 */
export interface RuntimeUsagePoint {
  ts: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  total_cost_usd?: number;
}

export interface RuntimeUsageLineChartProps {
  /** 时间序列点(小时桶 1d / 日桶 7d·30d,D-002@v1)。组件不关心桶语义,只按顺序渲染。 */
  points: RuntimeUsagePoint[];
  /** 高度 px,默认 120(卡片内 sparkline,矮于 WorkHourBarChart 的 320)。 */
  height?: number;
  /** 父组件 loading 态:显示骨架。 */
  loading?: boolean;
}

export function RuntimeUsageLineChart({
  points,
  height = 120,
  loading = false,
}: RuntimeUsageLineChartProps) {
  const option = useMemo<EChartsOption>(() => {
    const xs = points.map((p) => p.ts);
    const inputs = points.map((p) => p.input_tokens);
    const outputs = points.map((p) => p.output_tokens);
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => `${Number(v ?? 0).toLocaleString()} tokens`,
      },
      legend: { data: ["输入", "输出"], top: 0, textStyle: { fontSize: 10 } },
      grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: false },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: xs,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      series: [
        {
          name: "输入",
          type: "line",
          data: inputs,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2 },
          itemStyle: { color: CHART_COLORS.user },
          areaStyle: { opacity: 0.08 },
        },
        {
          name: "输出",
          type: "line",
          data: outputs,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2 },
          itemStyle: { color: CHART_COLORS.project },
          areaStyle: { opacity: 0.08 },
        },
      ],
    };
  }, [points]);

  if (loading) {
    return (
      <div
        className="animate-pulse rounded bg-muted/30"
        style={{ height }}
        aria-label="用量折线图加载中"
      />
    );
  }
  if (points.length === 0) {
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
