---
schema_version: 1
doc_type: module-card
module_id: components-layout
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 页面骨架布局组件（components-layout）

## 定位
页面骨架级布局组件（`components/layout/`，5 组件文件 + index.ts barrel）：页面容器 /
页头 / 区块卡片 / 搜索栏 / 数据表格的标准拼装件，统一全站（PPM / admin / 设置页为主）
的页面结构。全部是对现有原语（antd Table / 原生 div）的薄封装 + tailwind 类收敛——
固化 max-w 档位、空态文案、overflow 包装等约定，减少各页重复样板。

## 契约摘要
- `PageContainer`（`page-container.tsx`）：页面最外层容器，`forwardRef<HTMLDivElement>`。
  - `size: "narrow"(max-w-[420px]) | "default"(max-w-[1400px]) | "full"(max-w-none)`，
    默认 default；收敛此前散落的 4 种 max-w 写法。
  - 基础类：`mx-auto flex flex-col gap-4 px-6 py-6`。
- `PageHeader`（`page-header.tsx`）：统一页头，`forwardRef<HTMLElement>`
  （标题 / subtitle / 操作区）。
- `SectionCard`（`section-card.tsx`）：区块卡片容器；
  `SectionCardHover: "none" | "lift"` 控制 hover 效果。
- `SearchBar` / `SearchBarActions`（`search-bar.tsx`）：横向筛选容器
  （`flex flex-wrap items-center gap-2`，内部不强制 Form，可塞 antd inline Form 或裸控件）
  + 右侧对齐区（`ml-auto`）；均 `forwardRef<HTMLDivElement>`。
- `DataTable<T>`（`data-table.tsx`）：antd Table 的样式/locale 包装层。
  - `DataTableProps<T> extends TableProps<T>` + `emptyText?`（默认"暂无数据"）+
    `className?`；columns/dataSource/pagination/render 全透传。
  - 泛型函数组件写法（非 forwardRef，规避 antd 6 严格类型下的泛型穿透问题）。
- `index.ts`：桶导出上述全部组件与类型。

## 关键逻辑
- DataTable 包装（D-006 业务组件边界：不改 antd Table API）：
  ```
  <div className={cn("overflow-hidden", className)}>
    <Table<T> {...rest} locale={{ emptyText, ...locale }} />
  </div>
  ```
- 页面拼装典型顺序：
  `PageContainer > (PageHeader, SearchBar(+Actions), SectionCard / DataTable)`。

## 注意事项
- `FormLayout` 已删除（index.ts 不再导出，module-map 基线已剔除）——旧引用须清理，
  勿按历史文档找回。
- 旧卡所述 DataTable「固化合计行 summary」已不成立：现实现只补 emptyText + overflow
  包装；合计行由调用方经 Table 原生 summary 自理（PPM 计划列表等场景）。
- PageContainer 的 size 档位影响整页留白节奏（PPM 列表页多 full、表单页 default/
  narrow），调整需全局回归。
- 这些组件刻意保持薄：自定义需求优先透传 `...rest`（HTMLAttributes / TableProps），
  不要往里加业务 prop。
- 改 PageHeader / PageContainer 样式会级联几乎所有业务页头/容器，需整页级回归。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
