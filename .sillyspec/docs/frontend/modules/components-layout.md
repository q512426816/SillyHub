---
schema_version: 1
doc_type: module-card
module_id: components-layout
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# components-layout

## 定位
页面骨架级布局组件（`components/layout/*.tsx`），提供"页面容器 + 页头 + 区块卡片 + 搜索栏 + 表单布局 + 数据表格"的标准拼装件，统一全站（尤其 PPM/admin 页面）的页面结构。是对 antd Table/Layout 的二次封装，固化列宽、合计行、页头样式等约定，减少各页面重复样板。

## 契约摘要
- `PageContainer`：`forwardRef<HTMLDivElement>`，`PageContainerProps extends HTMLAttributes`，页面最外层容器，支持 `size` 等控制内边距/宽度（如 PPM 用 `size="full"`）。
- `PageHeader`：`forwardRef<HTMLElement>`，`PageHeaderProps`，统一页头（标题/subtitle/操作区）。
- `SectionCard`：`forwardRef<HTMLDivElement>`，`SectionCardProps`，区块卡片容器（标题 + 内容 + 可选操作）。
- `SearchBar` / `SearchBarActions`：`forwardRef`，搜索/筛选条与右侧操作按钮区，`SearchBarProps extends HTMLAttributes`。
- `FormLayout`：`forwardRef<HTMLDivElement>`，`FormLayoutProps extends HTMLAttributes`，表单字段排版容器。
- `DataTable<T>`：`DataTableProps<T> extends TableProps<T>`，封装 antd Table，固化合计行、列对齐、空态等；泛型约束 `T extends object`。
- `index.ts`：统一 barrel 导出。

## 关键逻辑
- DataTable 封装（伪代码）：
  ```
  export function DataTable<T extends object>({ columns, dataSource, ...rest }: DataTableProps<T>) {
    return <Table<T> columns={columns} dataSource={dataSource}
      pagination={...} summary={合计行} locale={{emptyText:<EmptyState/>}} {...rest} />
  }
  ```
- 页面拼装典型顺序：`PageContainer > (PageHeader, SearchBar(+Actions), SectionCard/DataTable)`。

## 注意事项
- DataTable 的合计行（summary）在 PPM 计划列表等场景是硬性视觉要求，新增列需同步 summary 计算。
- 这些组件是对 antd 的薄封装，props 透传 `...rest`，自定义属性优先透传而非新造 prop。
- PageContainer 的 `size` 取值影响整页留白节奏，PPM 列表页统一 `full`，详情页用默认，改时注意全局一致。
- 改 PageHeader 样式会级联到几乎所有业务页头，需回归。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
