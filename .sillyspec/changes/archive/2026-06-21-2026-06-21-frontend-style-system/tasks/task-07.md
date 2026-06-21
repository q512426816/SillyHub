---
id: task-07
title: 共享布局组件 (PageContainer / PageHeader / SectionCard / DataTable / SearchBar / FormLayout)
status: pending
priority: P0
depends_on: [task-05]
blocks: [task-08, task-09, task-10]
covers_fr: [FR-04]
allowed_paths:
  - frontend/src/components/layout/**
created_at: 2026-06-22T00:18:09
author: qinyi
---

## 现状

无统一容器层。各页面自行堆 Tailwind 类,出现 4 种 max-w 写法:

| 文件 | 写法 |
|---|---|
| `ppm-resource-table.tsx` | `max-w-7xl ... px-6 py-6` |
| `ppm/project-plans/page.tsx` | `max-w-[1400px] ... px-6 py-6` |
| 其他页面 | `max-w-5xl` / `max-w-[420px]` |

Card 零散:`rounded border bg-card p-3` 无 shadow、无 hover;PageHeader 四处重复 `<header><h1>{title}</h1><p className="text-muted-foreground">{subtitle}</p></header>`;DataTable 直接散用 antd `Table`,分页/空态配置每次重写。

## 目标

新建 `frontend/src/components/layout/` 目录,落地 6 个展示型布局组件,消除 4 种 max-w,给 task-08/09/10 (AppShell + 页面迁移) 提供统一容器 API。

## 实现要点

### 1. PageContainer

统一最外层容器。props:`size?`(默认 `default`)、`className?`、`children`。

| size | max-w |
|---|---|
| `narrow` | `max-w-[420px]` |
| `default` | `max-w-[1400px]` |
| `full` | `max-w-none` |

基础类:`mx-auto flex flex-col gap-4 px-6 py-6`,与 `className` 经 `cn()` 合并。

### 2. PageHeader

props:`title`(h1)、`subtitle?`(muted)、`actions?`(右侧 ReactNode slot)、`className?`。

结构:`<header className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</div>{actions && <div className="flex gap-2">{actions}</div>}</header>`。替代 project-plans/resource-table 里重复的 header 块。

### 3. SectionCard

替代零散 `<div className="rounded border bg-card p-3">`。props:`title?`、`extra?`(标题右侧 slot)、`bodyPadding?`(默认 `p-4`,可传 `p-5`)、`hover?: "none" | "lift"`(默认 `none`)、`className?`、`children`。

基础类:`bg-card border rounded-lg shadow-sm`(`rounded-lg` 对齐 task-03 token;不直接写 `rounded-lg-12` 字面量,由 tailwind config 的 radius 映射)。hover=lift 追加 `transition hover:shadow-md hover:-translate-y-0.5`。

复用 task-05 的 Card/Button 变体,不重新定义颜色 token。

### 4. DataTable

封装 antd `Table`,透传 props。签名:

```ts
interface DataTableProps<T> extends TableProps<T> {
  /** 空态文案,默认 "暂无数据" */
  emptyText?: string;
  /** 是否显示分页(默认 true)。false 时传 pagination=false。 */
  paginate?: boolean;
  className?: string;
}
```

实现:`<Table {...rest} locale={{ emptyText: emptyText ?? "暂无数据", ...rest.locale }} />`,外层包 `<div className={cn("overflow-hidden", className)}>`。

**边界:不改 antd Table API**(D-006 业务组件边界)。不接管 columns/dataSource,只补默认 locale 和样式包装;分页行为由调用方通过 pagination prop 控制(headerBg 已由 task-03 token 控制,不在此覆盖)。

### 5. SearchBar

横向 filter 容器。props:`className?`、`children`。内部不强制 Form,允许调用方塞 antd `Form layout="inline"` 或裸输入控件。

基础类:`flex flex-wrap items-center gap-2`。配套 `SearchBarActions` 子组件可选(右侧对齐区,`ml-auto`)。

### 6. FormLayout

表单字段网格。props:`columns?: 1 | 2`(默认 1)、`className?`、`children`。

基础类:`grid gap-4` + `grid-cols-1` / `sm:grid-cols-2`。内部不渲染 antd `Form`,只提供栅格;调用方在外层用 antd `Form` 包。

## 边界

1. **DataTable 不改 antd API**(D-006):只做样式/locale 包装,columns/dataSource/pagination/render 全透传,不接管业务列构造逻辑。
2. **纯展示组件,零业务数据流**:6 个组件不持有 state、不调 API、不引入 store。SearchBar/FormLayout 不强制包 antd Form,由调用方决定。
3. **PageContainer max-w 单值收敛**:默认 `max-w-[1400px]`,仅通过 `size` prop 在 narrow(420)/default(1400)/full(无限制) 三档切换;不在组件外部再手写 max-w。
4. **SectionCard hover 可选**:默认无 hover(纯静态卡片),仅 `hover="lift"` 时追加阴影/位移过渡。不全局默认 hover 造成列表抖动。
5. **className 透传用 cn() 合并**:所有组件接受外部 className,经 `@/lib/utils` 的 `cn()` 与内部默认类合并,外部类可覆盖(供 task-09/10 页面定制)。

## 非目标

- 不改业务逻辑、不动数据加载/分页计算/搜索 debounce(留 PpmResourceTable 自身)。
- 不替换 antd Table/Form,不重写 Drawer/Modal/分页交互。
- 不写 AppShell(Sidebar/Header/顶栏布局)—— task-08 范围。
- 不在本任务里迁移具体页面(留 task-09/10)。

## 验收

| ID | 验收项 | 验证方式 |
|---|---|---|
| AC-01 | 6 个布局组件文件存在且导出 | `ls frontend/src/components/layout/{page-container,page-header,section-card,data-table,search-bar,form-layout}.tsx` 全部命中 |
| AC-02 | PageContainer 统一 max-w,grep 全仓无 `max-w-5xl`/`max-w-7xl` 散落(本任务范围限定 layout 目录,页面级迁移由 task-09/10 消除) | `grep -rn "max-w-5xl\|max-w-7xl" frontend/src/components/layout` 无命中 |
| AC-03 | DataTable 封装 antd Table 并透传 props(`extends TableProps<T>`) | 读 `data-table.tsx` 确认 props 类型签名 + `{...rest}` 透传 |
| AC-04 | SectionCard 带 `shadow-sm` / `border` / `rounded-lg` 三个类 | grep `section-card.tsx` 命中三关键字 |
| AC-05 | 各组件 props 含 `className?: string` 且用 `cn()` 合并 | grep `cn(` + `className` 在 6 个文件均命中 |

## 依赖说明

- **depends_on task-05 (Card/Button 基础组件)**:SectionCard 复用 task-05 的 Card 视觉变体;DataTable/搜索态/空态可能在 task-05 Button 上对齐。必须 task-05 落地后开工。
- **blocks task-08 (AppShell)**:AppShell 内的内容区会引用 PageContainer。
- **blocks task-09 / task-10 (页面迁移)**:页面迁移依赖 6 个布局组件 API 稳定。

## 风险

- antd Table 的 `TableProps` 泛型透传 TypeScript 类型可能报错(antd 6 类型较严),需用 `<T extends object>` 并在导出处 `forwardRef` 或泛型函数组件(参考 `ppm-resource-table.tsx` 的泛型组件写法)。
- `rounded-lg` 是否映射到 task-03 定义的 12px radius,需确认 `tailwind.config.ts` 的 `borderRadius.lg` token;若 task-03 用 CSS 变量 `--radius`,则 `rounded-lg` 应已对齐。
