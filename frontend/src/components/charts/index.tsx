/**
 * 图表组件桶导出 (task-05)。
 *
 * ECharts 依赖 window/DOM,Next.js App Router 下必须 next/dynamic ssr:false 加载,
 * 否则 server 端渲染报 `window is not defined`。页面统一从此桶 import 动态包装版,
 * 无需各自再 dynamic。
 */
import dynamic from "next/dynamic";

import type { WorkHourBarChartProps } from "./WorkHourBarChart";
import type { WorkHourPieChartProps } from "./WorkHourPieChart";
import type { ProjectPlanCostBarChartProps } from "./ProjectPlanCostBarChart";

const Loading = () => <div className="h-64 animate-pulse rounded bg-muted/30" />;

export const WorkHourBarChart = dynamic<WorkHourBarChartProps>(
  () => import("./WorkHourBarChart").then((m) => m.WorkHourBarChart),
  { ssr: false, loading: Loading },
);

export const WorkHourPieChart = dynamic<WorkHourPieChartProps>(
  () => import("./WorkHourPieChart").then((m) => m.WorkHourPieChart),
  { ssr: false, loading: Loading },
);

export const ProjectPlanCostBarChart = dynamic<ProjectPlanCostBarChartProps>(
  () =>
    import("./ProjectPlanCostBarChart").then((m) => m.ProjectPlanCostBarChart),
  { ssr: false, loading: Loading },
);
