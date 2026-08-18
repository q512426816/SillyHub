---
schema_version: 1
doc_type: module-card
module_id: components-charts
author: qinyi
created_at: 2026-08-18 01:45:00
---

# ECharts 图表组件（components-charts）

## 定位
ECharts 图表组件（`components/charts/`，3 图 + 1 桶文件），基于 `echarts-for-react` 封装。
两张 PPM 工时图（柱状/饼图）+ 一张 daemon 运行时用量 sparkline 折线图。ECharts 依赖
window/DOM，Next.js App Router 下必须 ssr:false——`index.tsx` 桶统一用 `next/dynamic`
动态包装并带 Loading 占位，页面只从桶 import 动态版，无需各自再 dynamic。

## 契约摘要
- `WorkHourBarChart`（`WorkHourBarChart.tsx`）：PPM 工时柱状图；props
  `WorkHourBarChartProps`（rows、color 等）。
- `WorkHourPieChart`（`WorkHourPieChart.tsx`）：工时饼图；props 含 rows、totalHours。
- `RuntimeUsageLineChart`（`RuntimeUsageLineChart.tsx`）：运行时用量双线 sparkline
  （输入/输出 token 趋势）。
  - props：`{ points: RuntimeUsagePoint[], height? = 120 }`（卡片内矮图，低于工时图的 320）。
  - 纯展示：不 react-query，数据由父组件注入；空数据渲染占位卡不画 ECharts。
  - 只画 input/output 双线；cache/费用不画（FR-04，卡片侧用数字展示）。
  - `RuntimeUsagePoint` 当前内联定义（6 字段：ts/input_tokens/output_tokens/
    cache_read_tokens/cache_creation_tokens/total_cost_usd，组件只消费前三个）——
    文件头留有迁移到 lib/daemon.ts 的类型迁移备忘。
- `index.tsx`（桶）：三个 `dynamic(() => import(...), { ssr:false, loading })`
  具名导出 + 各 Props 类型静态 re-export；loading 为 h-64 pulse 骨架块。

## 关键逻辑
- 各图统一模式：
  ```
  const option = useMemo(() => toXxxSeries(data), [deps])
  return <ReactECharts option={option} notMerge lazyUpdate />
  ```

## 注意事项
- 页面必须 `import { XxxChart } from "@/components/charts"`（动态版）；直接 import
  具体文件会在 SSR 报 `window is not defined`。
- 旧 `ProjectPlanCostBarChart` 已删除，勿再引用（module-map 基线已剔除）。
- 配色经 `CHART_COLORS`（lib/ppm/aggregations）取统一色源，勿在图内硬编码 hex。
- option 依赖 rows/points 引用 identity，传每次新建的数组字面量会触发重算/重渲染。
- 图表数据转换函数（toBarSeries 等）是各文件私有逻辑，跨图复用需先提炼。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
