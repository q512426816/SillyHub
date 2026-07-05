---
id: task-12
title: 新建 RuntimeUsageLineChart.tsx(echarts sparkline 输入/输出双线)
priority: P2
estimated_hours: 2
depends_on: []
blocks: [task-13, task-14]
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/charts/RuntimeUsageLineChart.tsx
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-12: 新建 RuntimeUsageLineChart.tsx(echarts sparkline 输入/输出双线)

> Wave 4 前端图表组件。新建 `RuntimeUsageLineChart`(echarts `type:'line'` sparkline),
> 在 runtime 卡片内嵌渲染**输入 / 输出**两条折线(token 趋势)。
> 严格照搬 `WorkHourBarChart.tsx` 的结构(useMemo option / loading 骨架 / 空数据占位 / ECharts 渲染),
> 仅把 bar 换 line、单系列换双系列。本任务**不**加 `next/dynamic` 导出(那是 task-13)、
> **不**在 page 接线(那是 task-14)。

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/charts/RuntimeUsageLineChart.tsx` | echarts 折线 sparkline 组件:输入/输出双线,复用 `CHART_COLORS`(蓝/绿),照搬 WorkHourBarChart 骨架 |

> 不动 `index.tsx`(dynamic 导出在 task-13)、不动 `aggregations.ts` 的 `toLineSeries`(task-13 加)。
> 本任务的 option 构建**内联在组件内**(toLineSeries 工具由 task-13 抽取复用;本任务先内联,保证组件自洽可独立验收)。

## 覆盖来源

- **Requirements**:
  - `FR-04`:卡片内嵌 sparkline 折线(输入/输出双线)。
- **Decisions**:
  - `D-002@v1`:时间窗粒度——`daily` 序列在 1d 窗为 24 个小时桶、7d/30d 为日桶;组件只消费 props 传入的序列(已按窗切粒度),自身不关心桶语义,但 x 轴标签需兼容「小时(00~23)」与「日期(MM-DD)」两种 ts 格式。

## 实现要求

1. **结构照搬 `WorkHourBarChart.tsx`**:`"use client"` 头、`useMemo` 算 option、loading 骨架(`animate-pulse`)、空数据占位卡片(「暂无数据」)、`<ReactECharts option style opts={{renderer:"svg"}} notMerge />`。
2. **双系列 echarts line**:series = [{type:'line', name:'输入', data: inputArr, itemStyle:{color: CHART_COLORS.blue[600]}, smooth:true}, {type:'line', name:'输出', data: outputArr, itemStyle:{color: CHART_COLORS.emerald}, smooth:true}]。输入用蓝(tokens.color.blue[600])、输出用绿(tokens.color.emerald)——对齐 CHART_COLORS 现有语义(user→蓝、project/remaining→绿)。
3. **sparkline 风格**:height 默认 120(卡片内嵌,矮于 WorkHourBarChart 的 320);x 轴标签默认隐藏(`axisLabel:{show:false}`)或仅首尾显示(避免 24 点挤爆);y 轴标签隐藏或极简;tooltip trigger 'axis'。legend 显示「输入/输出」(顶部小字)。
4. **x 轴数据来自 `points.map(p => p.ts)`**;tooltip formatter 把 ts + 双线 value 格式化展示(token k/M 由 task-14 的展示层负责,组件内 tooltip 直接显示原始 number + " tokens",如需 k/M 在 task-14 包一层 formatter——本任务**保持简单**,tooltip 直接 `${value} tokens`)。
5. **props 接收 daily 序列**(类型 `RuntimeUsagePoint[]`,从 task-11 的 lib/daemon.ts import);组件不自己拉数据。
6. **缓存线**:本任务**不画第三条 cache 线**(输入/输出双线即可,FR-04 只要求双线;cache 在卡片用数字展示,见 task-14)。如未来要加可扩展,但 YAGNI 现在不画。

## 接口定义（代码类必填）

```tsx
// ===== frontend/src/components/charts/RuntimeUsageLineChart.tsx =====
"use client";

/**
 * 运行时用量折线图 (task-12 / FR-04 / D-002@v1)。
 * 卡片内嵌 sparkline:输入/输出双线 token 趋势。
 * - 经 components/charts/index.ts 用 next/dynamic ssr:false 加载(task-13),避免 SSR window。
 * - 空数据显示占位卡片,不渲染 ECharts(照搬 WorkHourBarChart)。
 *
 * 数据源:lib/daemon.ts RuntimeUsagePoint[](task-11 getRuntimesUsage 响应的 daily)。
 */
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import { CHART_COLORS } from "@/lib/ppm/aggregations";
import type { RuntimeUsagePoint } from "@/lib/daemon";

export interface RuntimeUsageLineChartProps {
  /** 时间序列点(小时桶 1d / 日桶 7d·30d,D-002@v1)。组件不关心桶语义,只按顺序渲染。 */
  points: RuntimeUsagePoint[];
  /** 高度 px,默认 120(卡片内 sparkline,矮于柱状图)。 */
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
```

## 边界处理（必填,至少5条）

1. **points 为空数组**(`[]`):返回「暂无数据」占位卡片(照搬 WorkHourBarChart:44-53),不渲染 ECharts。
2. **loading=true**:显示骨架 `animate-pulse`(照搬 WorkHourBarChart:35-43),不渲染图表。
3. **points 只有 1 个点**:echarts line 单点会退化(无线段,可能只画 symbol);设 `showSymbol:false` 后单点不显示 → 视觉空白。处理:单点时仍渲染(空 sparkline 不崩),不强行补点(YAGNI,task-14 实测若有问题再加 `showSymbol: points.length === 1`)。
4. **ts 字符串格式不统一**(1d 窗带小时 `2026-06-24T10:00:00`、7d/30d 窗为日 `2026-06-24T00:00:00`):x 轴 axisLabel 默认隐藏,tooltip 直接展示原始 ts 字符串(不做 Date 解析/格式化,避免时区漂移)。
5. **token 数值极大**(M 级,如 36_000_000):y 轴自动自适应;tooltip `toLocaleString()` 千分位显示,不溢出。
6. **cache_* 字段**:props 类型含但本组件不消费(只取 input/output),不影响渲染。
7. **SSR window 报错**:本组件依赖 echarts-for-react(需 window/DOM),必须经 task-13 的 `next/dynamic(ssr:false)` 间接加载;**本组件文件不直接被 page import**,若误直接 import 会在 SSR 报 `window is not defined`——由 task-13 的 dynamic 桶隔离。

## 非目标

- 不画 cache 线(FR-04 只双线;cache 走数字展示)。
- 不画费用线(YAGNI;费用用数字展示)。
- 不在 `index.tsx` 加 dynamic 导出(task-13)。
- 不抽 `toLineSeries` 工具(task-13 把 option 抽到 aggregations.ts;本任务先内联,组件自洽)。
- 不做 x 轴标签格式化(隐藏即简化,tooltip 展原始 ts)。
- 不接线 page(task-14)。

## 参考

- `components/charts/WorkHourBarChart.tsx` —— **结构模板**(useMemo/loading/空数据/ECharts 渲染全套照搬,仅 series type 与数量不同)。
- `lib/ppm/aggregations.ts:15-30` `CHART_COLORS` —— 蓝(blue[600])/绿(emerald)取色。
- design.md §5 Wave 4 前端展示(echarts `type:'line'` sparkline)。

## TDD 步骤

> 本项目无既有 charts 组件单测(WorkHourBarChart 也无 .test.tsx,见 glob 结果)。图表渲染测试价值低(svg 断言脆弱),按 CLAUDE.md 规则 7,本任务**不写新单测**,靠 task-15 的 page 集成测试覆盖(切窗 → sparkline 切换)。
> 若 task-15 要求组件可测,补一个「空数据渲染占位」+「loading 渲染骨架」的 RTL 测试(纯 DOM 文案断言,不测 svg)。

1. (无单测)写完组件后 `cd frontend && pnpm typecheck`,确认 props 类型与 RuntimeUsagePoint 对齐、CHART_COLORS 引用正确。
2. 静态走查:确认结构完全照搬 WorkHourBarChart(loading/empty/ECharts 三分支齐全)。
3. task-13 加 dynamic 导出后,task-14 接线时目视验证双线渲染(蓝/绿)。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd frontend && pnpm typecheck` | 退出码 0,RuntimeUsageLineChartProps 类型正确(CHART_COLORS/runtime point import 路径无误) |
| 2 | 读组件源码,对照 WorkHourBarChart | 三分支(loading 骨架 / 空数据「暂无数据」占位 / ECharts 渲染)齐全,结构一致 |
| 3 | 读 series 定义 | 两条 line:输入(color=CHART_COLORS.blue[600])、输出(color=CHART_COLORS.emerald),smooth + showSymbol:false |
| 4 | 读 props | `points: RuntimeUsagePoint[]`(从 task-11 lib/daemon import)、height 默认 120、loading 默认 false |
| 5 | 读 x 轴配置 | boundaryGap:false(线贴左轴)、axisLabel 隐藏(sparkline 简化) |
| 6 | 确认未直接被 page import | 仅 export 组件符号,dynamic 导出留给 task-13(避免 SSR window 报错) |
| 7 | (task-14 接线后)目视 | 卡片内 sparkline 渲染蓝/绿双线,切窗后双线随 points 变化 |
