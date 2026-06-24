---
id: task-13
title: charts/index.tsx 加 dynamic 导出 + aggregations.ts 加 toLineSeries
priority: P2
estimated_hours: 1
depends_on: [task-12]
blocks: [task-14]
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - frontend/src/components/charts/index.tsx
  - frontend/src/lib/ppm/aggregations.ts
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-13: charts/index.tsx 加 dynamic 导出 + aggregations.ts 加 toLineSeries

> Wave 4 前端基建。两件小事:
> 1. `charts/index.tsx` 加 `next/dynamic(ssr:false)` 导出 `RuntimeUsageLineChart`——避免 echarts 在 SSR 报 `window is not defined`(照搬 WorkHourBarChart/PieChart/CostBarChart 三个现有 dynamic 导出的模式)。
> 2. `lib/ppm/aggregations.ts` 加 `toLineSeries` option 工具(复用 CHART_COLORS)——把 task-12 内联的 option 抽成纯函数,便于单测 + 复用。
> 本任务**不改** `RuntimeUsageLineChart.tsx` 组件本体(task-12 已写)、**不接线** page(task-14)。

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/components/charts/index.tsx` | 新增 `next/dynamic(ssr:false)` 导出 `RuntimeUsageLineChart`(复用现有 Loading 占位);import 其 Props 类型 |
| 修改 | `frontend/src/lib/ppm/aggregations.ts` | 新增 `LinePoint` 接口 + `toLineSeries(points, options)` option 工具(复用 CHART_COLORS.blue[600]/emerald) |

> 不动 `RuntimeUsageLineChart.tsx`(task-12 产物;本任务只做导出桶 + 工具抽取)。
> 注意:task-12 内联了 option;本任务抽 `toLineSeries` 后,task-12 的组件**可**(可选)重构改用 `toLineSeries`,但非强制——为降低耦合,**本任务不强制改 task-12**;若 task-12 已用内联 option 工作正常,保留内联,`toLineSeries` 作为 task-15 单测目标 + 未来复用入口存在(YAGNI 不强行 DRY)。

## 覆盖来源

- **Requirements**:
  - `FR-04`:折线图组件——本任务提供 dynamic 导出(SSR 安全)+ option 工具(可测/复用)。
- **Decisions**:无(SSR 隔离是 echarts + Next App Router 的通用约束,非本次决策;dynamic 导出照搬现有 WorkHourBarChart 模式)。

## 实现要求

### 1. charts/index.tsx(照搬现有 3 个 dynamic 导出)

- 在文件顶部 import 加 `import type { RuntimeUsageLineChartProps } from "./RuntimeUsageLineChart";`。
- 复用现有 `Loading` 占位(`const Loading = () => <div className="h-64 animate-pulse rounded bg-muted/30" />;`,已定义)。
- 新增导出(插在 ProjectPlanCostBarChart 之后):
  ```tsx
  export const RuntimeUsageLineChart = dynamic<RuntimeUsageLineChartProps>(
    () => import("./RuntimeUsageLineChart").then((m) => m.RuntimeUsageLineChart),
    { ssr: false, loading: Loading },
  );
  ```
- **不动**现有 3 个 dynamic 导出(WorkHourBarChart/PieChart/CostBarChart)。

### 2. aggregations.ts(照搬 toBarSeries/toCostSeries 模式)

- 新增 `LinePoint` 接口(与 RuntimeUsagePoint 解耦,只取图表需要的字段):
  ```ts
  /** 折线图输入点(x + 输入 token + 输出 token)。 */
  export interface LinePoint {
    ts: string;
    input_tokens: number;
    output_tokens: number;
  }
  ```
- 新增 `toLineSeries` 纯函数(返回 EChartsOption,与 toBarSeries/toCostSeries 同风格):
  ```ts
  /**
   * 用量折线图 option:输入(蓝)/输出(绿)双线 sparkline。
   * - x 轴隐藏标签(sparkline 简化);legend 顶部小字。
   * - 复用 CHART_COLORS.blue[600](输入)/ emerald(输出)。
   */
  export function toLineSeries(
    points: LinePoint[],
    opts: { height?: number } = {},
  ): EChartsOption { ... }
  ```
- 复用既有 `CHART_COLORS`(不新增颜色 token;CHART_COLORS 已含 blue[600] 与 emerald)。
- 函数纯(无副作用,无 React 依赖),便于单测。

## 接口定义（代码类必填）

```tsx
// ===== frontend/src/components/charts/index.tsx 新增片段 =====
import type { RuntimeUsageLineChartProps } from "./RuntimeUsageLineChart";

// ... 现有 3 个 dynamic 导出不动 ...

export const RuntimeUsageLineChart = dynamic<RuntimeUsageLineChartProps>(
  () => import("./RuntimeUsageLineChart").then((m) => m.RuntimeUsageLineChart),
  { ssr: false, loading: Loading },
);
```

```typescript
// ===== frontend/src/lib/ppm/aggregations.ts 新增片段 =====

/** 折线图输入点(x 轴 ts + 输入/输出 token)。 */
export interface LinePoint {
  ts: string;
  input_tokens: number;
  output_tokens: number;
}

/**
 * 用量折线图 option(FR-04):输入(蓝)/输出(绿)双线 sparkline。
 * - 与 task-12 组件内联 option 行为一致;x 轴隐藏标签、legend 顶部、smooth line。
 * - 复用 CHART_COLORS.blue[600](输入)/ emerald(输出),不新增颜色。
 * - 纯函数(无 React/echarts-for-react 依赖),便于单测覆盖空数据/单点/极值。
 *
 * @param points 时间序列(小时桶 1d / 日桶 7d·30d,D-002@v1);组件传入 task-11 RuntimeUsagePoint[]。
 * @param opts.height 可选高度(默认 120,仅用于调用方参考,option 本身不含 height)。
 */
export function toLineSeries(
  points: LinePoint[],
  opts: { height?: number } = {},
): EChartsOption {
  const xs = points.map((p) => p.ts);
  const inputs = points.map((p) => toNumber(p.input_tokens));
  const outputs = points.map((p) => toNumber(p.output_tokens));
  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => `${toNumber(v).toLocaleString()} tokens`,
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
        itemStyle: { color: CHART_COLORS.blue[600] },
        areaStyle: { opacity: 0.08 },
      },
      {
        name: "输出",
        type: "line",
        data: outputs,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        itemStyle: { color: CHART_COLORS.emerald },
        areaStyle: { opacity: 0.08 },
      },
    ],
  };
}
```

## 边界处理（必填,至少5条）

1. **points 为空数组**:`toLineSeries([])` 返回合法 option(xAxis.data=[]、series.data=[]),echarts 渲染空图;调用方(RuntimeUsageLineChart 组件)在空数据时返回占位卡片,不调用 toLineSeries——故 toLineSeries 不做空判断(YAGNI,组件层已挡)。但单测应覆盖「空数组不抛错」(返回结构完整)。
2. **input_tokens/output_tokens 为 null/undefined/字符串**:`toNumber`(aggregations.ts:33-36)兜底为 0(已有逻辑,toLineSeries 内复用)。单测覆盖字符串「"1200000"」→ 1200000。
3. **单点序列**:toLineSeries 正常返回(单 element 数组);echarts line 单点 + showSymbol:false 视觉空白——由组件层决定是否补 showSymbol(toLineSeries 不特殊处理,YAGNI)。
4. **SSR window(dynamic 导出职责)**:`RuntimeUsageLineChart` dynamic 导出 `ssr:false` 确保 echarts-for-react 只在 client 加载;**page 必须从 `components/charts`(桶)import,不能从 `./RuntimeUsageLineChart`(原始)import**——后者会绕过 dynamic 导致 SSR 报错。task-14 接线时遵守此约定。
5. **Loading 占位复用**:不新建 Loading 函数,复用 index.tsx:14 现有 `Loading`(h-64 骨架);各图表 dynamic 导出共享同一 loading 视觉。
6. **类型 LinePoint 与 RuntimeUsagePoint 解耦**:LinePoint 只含图表需要的 3 字段;RuntimeUsagePoint(task-11)含更多(cache/cost)。组件传参时 TS 结构子集兼容(RuntimeUsagePoint 是 LinePoint 的超集,可直接传),无需手动映射。
7. **toNumber 极值**:36_000_000 等大数正常 Number,无精度问题(JS number 安全整数上限 2^53 远超)。

## 非目标

- 不改 RuntimeUsageLineChart.tsx 组件(task-12 产物,本任务只导出它)。
- 不强制 task-12 内联 option 改用 toLineSeries(YAGNI;toLineSeries 作为可测工具 + 未来 DRY 入口存在;若 task-15 想让组件用 toLineSeries,task-15 内自行重构)。
- 不接线 page(task-14)。
- 不新增颜色 token(复用 CHART_COLORS.blue[600]/emerald)。
- 不写组件单测(组件渲染测价值低;toLineSeries 纯函数可测,留给 task-15)。

## 参考

- `components/charts/index.tsx:16-30` —— **dynamic 导出模板**(WorkHourBarChart/PieChart/CostBarChart 三例,ssr:false + Loading)。
- `lib/ppm/aggregations.ts:48-82` `toBarSeries` —— **option 工具模板**(纯函数 + toNumber 兜底 + crowded 分支)。
- `lib/ppm/aggregations.ts:33-36` `toNumber` —— 字符串/null 兜底(复用)。
- `lib/ppm/aggregations.ts:15-30` `CHART_COLORS` —— 蓝(blue[600])/绿(emerald)取色。

## TDD 步骤

> 本任务含一个纯函数 `toLineSeries`,**值得单测**(无 React 依赖,边界清晰)。但按 plan.md,单测统一在 task-15 落地(三子项目集中测)。本任务**可**先写测试占位(toLineSeries.test.ts 骨架),但非强制——遵循 plan 的 Wave 5 集中测试。
> 若 execute 阶段判断 toLineSeries 需要即时验证,可临时在 task-15 前补最小测试。

1. (无单测,留 task-15)`cd frontend && pnpm typecheck` 确认 dynamic 导出 + toLineSeries 类型正确。
2. 静态走查:dynamic 导出模式与现有 3 个一致;toLineSeries 与 toBarSeries 风格一致。
3. task-15 将覆盖 toLineSeries 的:空数组不抛 / 字符串 token 兜底 / 双 series 颜色正确。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd frontend && pnpm typecheck` | 退出码 0;RuntimeUsageLineChartProps import 路径正确、toLineSeries 返回 EChartsOption 类型契合 |
| 2 | 读 `charts/index.tsx` | 新增 `export const RuntimeUsageLineChart = dynamic<...>(...{ ssr:false, loading: Loading })`,模式与 WorkHourBarChart 一致;现有 3 个导出未动 |
| 3 | 读 `aggregations.ts` | 新增 `LinePoint` 接口 + `toLineSeries(points, opts)` 纯函数;复用 `CHART_COLORS.blue[600]`/`emerald`,无新颜色 |
| 4 | 读 `toLineSeries` series | 两条 line(输入蓝/输出绿),smooth + showSymbol:false + areaStyle.opacity:0.08 |
| 5 | 确认 page 未直接 import 原始组件 | task-14 将从 `@/components/charts`(桶)import RuntimeUsageLineChart,不绕过 dynamic(避免 SSR window 报错) |
| 6 | 确认未改 RuntimeUsageLineChart.tsx | 组件本体(task-12)未在本任务修改(仅导出桶 + 工具抽取) |
