---
id: task-05
title: echarts-for-react + work-hour/projectplan 图表(柱状 + 饼图 + 成本条形)
priority: P1
estimated_hours: 6
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-013@v1]
author: qinyi
created_at: 2026-06-21T02:37:10+0800
allowed_paths:
  - frontend/package.json
  - frontend/src/components/charts/WorkHourBarChart.tsx
  - frontend/src/components/charts/WorkHourPieChart.tsx
  - frontend/src/components/charts/ProjectPlanCostBarChart.tsx
  - frontend/src/components/charts/index.ts
  - frontend/src/lib/ppm/aggregations.ts
  - frontend/src/app/(dashboard)/ppm/work-hour-statistics/page.tsx
  - frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
  - frontend/src/components/__tests__/work-hour-bar-chart.test.tsx
  - frontend/src/components/__tests__/work-hour-pie-chart.test.tsx
  - frontend/src/components/__tests__/project-plan-cost-bar-chart.test.tsx
  - frontend/src/lib/ppm/__tests__/aggregations.test.ts
---

# task-05 echarts-for-react + work-hour/projectplan 图表(柱状 + 饼图 + 成本条形)

对应 design.md §5 W5「图表:echarts-for-react;work-hour 统计(柱+饼)+ projectplan 成本条形」与 plan.md task-05(覆盖 FR-05、D-013@v1)。

现有 `work-hour-statistics/page.tsx` 用零依赖方案(AntD `Progress` 条 + CSS `conic-gradient` 饼图),project-plans 页无成本可视化。本任务按 D-013 引入 `echarts-for-react`,替换为真正的 ECharts 柱状/饼图,并为 project-plans 增加成本条形图(budget / actual / remaining)。

## 覆盖来源

- **FR-05**: 工时统计柱状图 + 饼图、项目计划成本条形图渲染
- **D-013@v1**: 选型 `echarts-for-react`(而非 @ant-design/plots / recharts),理由:与现有 AntD 视觉协调、包体积可控、dynamic import 规避 SSR

## 修改文件

| 类型 | 路径 | 动作 |
|---|---|---|
| 依赖 | `frontend/package.json` | 新增 `echarts ^5.5.0` + `echarts-for-react ^3.0.2`(dependencies) |
| 组件 | `frontend/src/components/charts/WorkHourBarChart.tsx` | 新建 — 工时柱状图 |
| 组件 | `frontend/src/components/charts/WorkHourPieChart.tsx` | 新建 — 工时饼图(替换现有 CSS conic-gradient) |
| 组件 | `frontend/src/components/charts/ProjectPlanCostBarChart.tsx` | 新建 — 成本条形图(budget/actual/remaining) |
| 组件 | `frontend/src/components/charts/index.ts` | 新建 — 桶导出 + dynamic 封装 |
| 聚合 | `frontend/src/lib/ppm/aggregations.ts` | 新建 — `toBarSeries` / `toPieSeries` / `toCostSeries` 纯函数 |
| 页面 | `frontend/src/app/(dashboard)/ppm/work-hour-statistics/page.tsx` | 改 — 移除 `PiePanel`(CSS)与 `Progress` 柱状列,改用 dynamic 加载的 ECharts 组件 |
| 页面 | `frontend/src/app/(dashboard)/ppm/project-plans/page.tsx` | 改 — 在 Table 下方嵌入 `ProjectPlanCostBarChart` |
| 测试 | `frontend/src/components/__tests__/work-hour-bar-chart.test.tsx` | 新建 |
| 测试 | `frontend/src/components/__tests__/work-hour-pie-chart.test.tsx` | 新建 |
| 测试 | `frontend/src/components/__tests__/project-plan-cost-bar-chart.test.tsx` | 新建 |
| 测试 | `frontend/src/lib/ppm/__tests__/aggregations.test.ts` | 新建 |

## 实现要求

### 1. 依赖安装(package.json)

在 `dependencies` 增加两行(对齐 D-013):

```json
"echarts": "^5.5.0",
"echarts-for-react": "^3.0.2",
```

执行 `pnpm install`(项目 `packageManager: pnpm@9.6.0`)。

### 2. work-hour-statistics:柱状图(按人 / 按项目工时)

- 数据源沿用现有 `statWorkHoursByUser` / `statWorkHoursByProject`(后端 `task/router.py` 的 `/api/ppm/work-hour/stat-by-user|stat-by-project`),**不改 API**。
- 用 `echarts-for-react` 的 `ReactECharts` 渲染柱状图:
  - X 轴:`rows.map(r => r.name || r.key)`(负责人/项目名)
  - Y 轴:工时(h),`total_hours`
  - 单系列 bar,颜色按 dimension 区分(user=#1677ff / project=#52c41a,与现有 PIE_COLORS 一致)
  - tooltip 显示 `{name}: {value}h`
  - `grid.left/right` 留足标签空间;类别多时 `xAxis.axisLabel.rotate = 30`
- dimension 切换 / 日期筛选 / 重新加载逻辑保留不动,仅把「柱状条」列(`columns` 最后那一列 AntD Progress)替换成页面上方的独立柱状图区块。

### 3. work-hour-statistics:饼图(替换 CSS conic-gradient)

- 删除现有 `PiePanel` 组件(整段,含 `PIE_COLORS` 数组上移到 `aggregations.ts` 共用)。
- 用 ECharts `pie` 类型替代:Top 5 + 其他聚合(逻辑沿用 `PiePanel` 的 slice 计算,但 slice 计算下沉到 `toPieSeries` 纯函数,便于单测)。
- `radius: ['40%', '70%']`(环形)或实心饼,图例右侧显示 hours。

### 4. project-plans:成本条形图

- 在 `ProjectPlansPage` 的 `<Table>` 下方新增图表区块,数据源 `plans`(`listProjectPlans` 已返回的 `PsProjectPlan[]`,**无需新接口**)。
- 横向条形图(`yAxis.type: 'category'`),Y 轴 = 项目名(`project_name ?? id`),三系列堆叠或分组:
  - `budget_amount`(预算,蓝)
  - `actual_consumption_person_days` 或 `total_cost`(实际,橙)— 优先用 `total_cost`,缺省回退 `actual_consumption_person_days`(注释说明两者口径不同,以 `total_cost` 为准)
  - `remaining_cost`(剩余,绿),后端 D-014 已派生 `remaining = budget - actual`
- tooltip 显示三元组;`legend.top` 顶部;空数据隐藏图表。

### 5. Next.js dynamic import(SSR 规避)

ECharts 依赖 `window`/DOM,Next.js 14 App Router 下必须用 `next/dynamic` + `ssr: false` 加载。**禁止**在 server component 直接 import `echarts-for-react`。

在 `components/charts/index.ts` 统一导出 dynamic 包装版:

```ts
import dynamic from "next/dynamic";

export const WorkHourBarChart = dynamic(
  () => import("./WorkHourBarChart").then((m) => m.WorkHourBarChart),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded bg-muted/30" /> },
);
// WorkHourPieChart / ProjectPlanCostBarChart 同理
```

页面直接 `import { WorkHourBarChart } from "@/components/charts"`,无需在页面里再 dynamic。

## 接口定义

### 1. 聚合函数(lib/ppm/aggregations.ts)

```ts
import type { EChartsOption } from "echarts";
import type { WorkHourStatItem, PsProjectPlan } from "./types";

export const CHART_COLORS = {
  user: "#1677ff",
  project: "#52c41a",
  budget: "#1677ff",
  actual: "#faad14",
  remaining: "#52c41a",
  pie: ["#1677ff", "#52c41a", "#faad14", "#eb2f96", "#722ed1", "#8c8c8c"],
};

/** 柱状图 option:names 为 X 轴,hours 为单系列。 */
export function toBarSeries(
  rows: { name: string; total_hours: number }[],
  color: string,
): EChartsOption;

/** 饼图 option:Top N + 其他聚合(默认 N=5)。 */
export function toPieSeries(
  rows: { name: string; total_hours: number }[],
  totalHours: number,
  topN?: number,
): EChartsOption;

/** 成本条形图 option:横向,Y 轴项目名,三系列。 */
export function toCostSeries(
  plans: Pick<PsProjectPlan, "id" | "project_name" | "budget_amount" | "total_cost" | "actual_consumption_person_days" | "remaining_cost">[],
): EChartsOption;
```

> 所有字段可能为 `null`/字符串(后端 `Decimal` → JSON 字符串),聚合函数内 `Number(v) || 0` 兜底。

### 2. 图表组件 props

```ts
// WorkHourBarChart.tsx
export interface WorkHourBarChartProps {
  rows: { name: string; total_hours: number }[];
  color?: string;          // 默认 CHART_COLORS.user
  height?: number;         // 默认 320
  loading?: boolean;
}

// WorkHourPieChart.tsx
export interface WorkHourPieChartProps {
  rows: { name: string; total_hours: number }[];
  totalHours: number;
  topN?: number;           // 默认 5
  height?: number;         // 默认 280
}

// ProjectPlanCostBarChart.tsx
export interface ProjectPlanCostBarChartProps {
  plans: PsProjectPlan[];
  height?: number;         // 默认 360
}
```

每个组件内部:`const option = useMemo(() => toXxx(props), [deps])`,然后 `<ReactECharts option={option} style={{ height }} opts={{ renderer: "svg" }} />`。`renderer: "svg"` 便于测试(jsdom 下 canvas 不可用,svg 可序列化断言)。

### 3. dynamic import 写法(charts/index.ts)

```ts
import dynamic from "next/dynamic";

const Loading = () => <div className="h-64 animate-pulse rounded bg-muted/30" />;

export const WorkHourBarChart = dynamic(
  () => import("./WorkHourBarChart").then((m) => m.WorkHourBarChart),
  { ssr: false, loading: Loading },
);
export const WorkHourPieChart = dynamic(
  () => import("./WorkHourPieChart").then((m) => m.WorkHourPieChart),
  { ssr: false, loading: Loading },
);
export const ProjectPlanCostBarChart = dynamic(
  () => import("./ProjectPlanCostBarChart").then((m) => m.ProjectPlanCostBarChart),
  { ssr: false, loading: Loading },
);
```

## 边界处理

1. **数据为空显示占位**:三个组件 `rows.length === 0` / `plans.length === 0` 时不渲染 ECharts,显示「暂无数据」占位卡片(复用页面现有 `bg-muted/20` 样式),避免空饼图/空柱。
2. **SSR window 未定义**:必须 `dynamic(..., { ssr: false })`;页面 server 端渲染时只出现 `Loading` 骨架,客户端 hydrate 后挂载 ECharts,杜绝 `window is not defined`。
3. **图表容器 resize**:ECharts-for-react 默认监听 window resize 自动 resize;容器用 `style={{ width: "100%", height }}` 而非固定 px,父容器 flex 布局变化时图表跟随。组件 unmount 时 echarts-for-react 自动 dispose。
4. **大数据量聚合**:柱状图类别 > 30 时 `dataZoom`(slider) + `axisLabel.rotate=45`;饼图固定 Top 5 + 其他,避免颜色爆炸;成本条形图项目 > 20 时 `dataZoom`(type:"slider", yAxisIndex:0)。
5. **颜色主题**:沿用现有 `PIE_COLORS` / `#1677ff` / `#52c41a`,集中到 `CHART_COLORS` 常量;支持 dark mode 通过 `ReactECharts` 的 `notMerge={false}` + CSS 变量(本期不强制,保持现有浅色主题)。
6. **字段 null / 字符串兜底**:`budget_amount`/`total_cost` 等后端 `Decimal` 序列化为字符串,聚合函数 `Number(v) || 0`,负数 remaining(budget<actual)原样显示红色(`itemStyle.color` 按 value 条件着色)。
7. **测试环境无 canvas**:用 `renderer: "svg"` + vitest jsdom,断言组件渲染不抛错 + option 结构正确,不断言像素。
8. **loading 态**:父组件 `loading=true` 时显示骨架;API error 时页面已有错误条,图表区块隐藏(沿用现有 `error` 分支)。

## 非目标

- 不做实时刷新(无 WebSocket/SSE 轮询,数据按现有 `load()` 触发)。
- 不做图表导出图片(ECharts toolbox `saveAsImage` 不启用)。
- 不做主题切换 / 暗色模式适配(保持浅色)。
- 不改后端 API(stat-by-user/project 已就绪;成本字段已在 `PsProjectPlan`)。
- 不做 `@ant-design/plots` / `recharts` 备选(已按 D-013 定 echarts-for-react)。
- 不改 work-hour-statistics 的筛选/维度切换/合计逻辑(仅替换可视化层)。
- 不改 project-plans 的 CRUD/抽屉(仅新增只读图表区块)。

## 参考

- echarts-for-react 官方用法:`import ReactECharts from "echarts-for-react"` + `option` prop,Next.js 需 dynamic ssr:false(官方 README SSR 段落)。
- 现有 ppm 组件风格:`components/ppm-*.tsx`(`PpmUserSelect`/`ppm-sub-table` 等)统一从 `@/components/ppm-*` 导入;图表组件放独立 `components/charts/` 目录,与 ppm 业务组件解耦(可被 ppm 以外模块复用)。
- 现有零依赖实现:`work-hour-statistics/page.tsx` 第 130–167 行(Progress 柱状列)、第 281–369 行(`PiePanel` + `PIE_COLORS`)— 作为待替换的对照。
- 后端端点:`backend/app/modules/ppm/task/router.py` 的 `/api/ppm/work-hour/stat-by-user|stat-by-project`(work-hour 属 task 子域);前端 client `lib/ppm/task.ts` 第 229–249 行。
- 类型:`lib/ppm/types.ts` `WorkHourStatResponse`(L957)、`PsProjectPlan`(L294,含 budget_amount/total_cost/remaining_cost)。
- 测试范式:`components/__tests__/admin-organization-tree.test.tsx`(vitest + testing-library + jsdom)。

## TDD 步骤

1. **聚合函数先行**(`aggregations.test.ts`):
   - `toBarSeries`:给定 3 行,断言 `option.xAxis.data` 长度 3、`option.series[0].data` 等于 hours 数组、`option.series[0].type === "bar"`。
   - `toPieSeries`:给定 7 行,断言 slice 数 = 6(Top5 + 其他)、其他 slice hours = 第 6+7 行之和;`totalHours=0` 时返回空 series 不抛错。
   - `toCostSeries`:给定 2 个 plan(含 null 字段),断言 Y 轴 2 项、三系列各 2 值、null → 0、字符串 `"100.5"` → 100.5。
   - 空输入:三个函数对 `[]` 返回合法 option(空数组),不抛异常。
2. **组件渲染测试**(jsdom + svg renderer):
   - `WorkHourBarChart`:渲染含数据的 rows → DOM 出现 `.echarts-for-react` 容器,不抛错;`rows=[]` → 出现「暂无数据」文本。
   - `WorkHourPieChart`:同上,断言空数据显示占位。
   - `ProjectPlanCostBarChart`:`plans=[]` → 占位;有数据 → 容器挂载。
   - 因 dynamic ssr:false,测试中直接 import 具体组件文件(`./WorkHourBarChart`)而非 `charts/index` 桶,绕过 dynamic。
3. **页面集成**(手动/e2e):
   - work-hour-statistics 切 user/project 维度,柱状图与饼图同步刷新。
   - project-plans 页底部出现成本条形图,hover 项目显示 tooltip 三元组。
4. **回归**:work-hour-statistics 筛选/合计行/重新加载按钮行为不变。
5. **运行**:`pnpm test`(vitest) + `pnpm typecheck`(tsc --noEmit) + `pnpm lint`(next lint)。

## 验收标准

| AC | 验收点 | 验证方式 | 通过标准 |
|---|---|---|---|
| AC1 | echarts 依赖安装 | `grep echarts frontend/package.json` + `pnpm install` 无错 | `echarts ^5.5.0` + `echarts-for-react ^3.0.2` 出现在 dependencies,lockfile 更新 |
| AC2 | 聚合函数纯函数可单测 | `pnpm test aggregations` | toBarSeries/toPieSeries/toCostSeries 用例全过,含空数据/字符串/null 兜底 |
| AC3 | WorkHourBarChart 渲染 | 组件测试 + 页面手测 | 有数据挂载 `.echarts-for-react`,空数据显示「暂无数据」 |
| AC4 | WorkHourPieChart 替换 CSS 饼图 | 页面手测 + `PiePanel` 已删除 | grep `conic-gradient` 在 page.tsx 无残留,饼图由 ECharts 渲染 |
| AC5 | ProjectPlanCostBarChart 渲染 | 页面手测 | project-plans 页 Table 下方出现成本条形图,三系列 budget/actual/remaining |
| AC6 | SSR 不报错 | `pnpm build` | next build 成功,无 `window is not defined`;dynamic ssr:false 生效 |
| AC7 | dynamic import 写法正确 | 阅 `charts/index.ts` | 三个组件经 `dynamic(..., { ssr: false, loading })` 导出 |
| AC8 | 空数据占位 | 三组件 `rows=[]`/`plans=[]` | 不渲染 ECharts,显示占位文本,不报错 |
| AC9 | typecheck 通过 | `pnpm typecheck` | tsc --noEmit 无新增错误 |
| AC10 | lint 通过 | `pnpm lint` | next lint 无新增 error |
| AC11 | 现有 work-hour 功能回归 | 手测维度切换/筛选/合计 | 合计 h、记录数、占比列行为与改造前一致(饼图可视化升级除外) |
