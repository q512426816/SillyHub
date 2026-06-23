---
schema_version: 1
doc_type: module-card
module_id: components-charts
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# components-charts

## 定位
PPM 可视化图表组件（`components/charts/*.tsx`），基于 `echarts-for-react` 封装，用于工时统计、项目计划成本等场景的柱状图/饼图。为规避 echarts SSR 问题，`index.tsx` 用 `next/dynamic` 动态导入（仅客户端渲染），页面层只 import 动态包装后的具名导出。

## 契约摘要
- `WorkHourBarChart`（`WorkHourBarChart.tsx`）：工时柱状图，props `WorkHourBarChartProps`（含 rows、color 等）；内部 `useMemo(() => toBarSeries(rows, color))` 生成 option。
- `WorkHourPieChart`（`WorkHourPieChart.tsx`）：工时饼图，props 含 rows、totalHours；`useMemo` 算 option。
- `ProjectPlanCostBarChart`（`ProjectPlanCostBarChart.tsx`）：项目计划成本柱状图，props `ProjectPlanCostBarChartProps`（含 plans）；`useMemo(() => toCostSeries(plans))`。
- 三者底层都渲染 `<ReactECharts option={option} ... />`。
- `index.tsx`：`export const WorkHourBarChart = dynamic(() => import(...), { ssr:false })` 等，对外暴露动态版。

## 关键逻辑
- 统一模式：
  ```
  export function XxxChart(props) {
    const option = useMemo(() => toXxxSeries(...), [deps])
    return <ReactECharts option={option} notMerge lazyUpdate />
  }
  ```
- 动态导出隔离 SSR：`dynamic(import, { ssr: false })`，避免 echarts 在服务端访问 window。

## 注意事项
- 页面务必 import `@/components/charts`（动态版），直接 import 具体文件会带 SSR 报错。
- option 用 `useMemo` 依赖 rows/plans，数据引用变化才重算；传新数组每次都换 identity 会触发重渲染。
- echarts-for-react 透传 echarts 实例，改主题/注册地图等需在客户端 effect 内操作。
- 图表数据转换函数（toBarSeries/toPieSeries/toCostSeries）是各文件内的私有逻辑，跨图复用需提炼。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
