---
schema_version: 1
doc_type: module-card
module_id: app-ppm-pages
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# app-ppm-pages

## 定位
PPM（项目管理）业务页面集合，挂在 `/ppm/*` 路由组下，覆盖项目、计划、里程碑、任务、客户、成员、干系人、问题变更、工时、看板等。页面以"列表 + 详情/表单"模式为主，统一用 components-layout 的 `PageContainer/PageHeader/DataTable` 与 components-ppm 业务组件搭骨架，数据走 lib-ppm 子模块，看板筛选态由 stores-kanban 承载。

## 契约摘要
- `PpmIndexPage`（`/ppm`）：PPM 入口/首页。
- `PpmProjectsPage`（`/ppm/projects`）：项目列表 + CRUD，走 `lib/ppm/project.ts` 的 list/create/update 接口；DataTable 列对齐源 dept_project_front。
- `ProjectPlansPage`（`/ppm/project-plans`）：项目计划列表，`PageContainer size="full"` + `DataTable<PsProjectPlan>`（12 列 + 操作 + 合计行），支持导出。
- `MilestoneDetailsPage`（`/ppm/milestone-details`）：里程碑详情，含子表展开。
- `KanbanPage`（`/ppm/kanban`）：任务看板，数据全部来自 `useKanbanStore`（tasks 含 user_id + deadline），按 filters 做分组/筛选，用户列表由 store 的 `fetchUsers` 提供。
- `WorkHourStatisticsPage`（`/ppm/work-hour-statistics`）：工时统计，用 `WorkHourBarChart` + `WorkHourPieChart` 可视化。
- 其余：`/ppm/customers`、`/ppm/project-members`、`/ppm/project-stakeholders`、`/ppm/plan-nodes`、`/ppm/task-execute`、`/ppm/task-plans`、`/ppm/work-hours`、`/ppm/problem-list`、`/ppm/problem-changes`（含 `_forms` 子目录）。

## 关键逻辑
- 列表页统一骨架：
  ```
  <PageContainer size="full">
    <PageHeader .../>
    <SearchBar>...筛选...</SearchBar>
    <DataTable<T> columns={...} dataSource={rows} />
  </PageContainer>
  ```
- 看板页是纯消费 store 的展示组件：`const { users, tasks, loading, filters } = useKanbanStore()`，分组/过滤在 store selector 内完成。
- 工时统计页：拉取工时 rows → `useMemo` 聚合 → 传 `WorkHourBarChart(rows,color)` / `WorkHourPieChart(rows,totalHours)`。

## 注意事项
- 页面普遍较长（project-plans 600+ 行），DataTable 列定义与合计行逻辑集中，改列时同步改合计。
- 看板筛选态跨页保留在 stores-kanban，离开看板再回来不丢失；如需重置需显式调 store reset。
- 子表（plan-nodes / project-members 等）复用 `PpmSubTable` 展开编辑模式，列定义走 `PpmSubEditableColumn`。
- plan-nodes 展开行内子表（明细 `PpmSubTable` editable / 模块 AntD `Table`）保留原始 `scroll.x:max-content`，**不外加限宽 overflow 容器**（ql-003 曾加 `calc(100vw-340px)` 容器、ql-005 加 `min-w-0`，2K 屏反而引入母表/模块多余滚动条，ql-007 已回退）。明细 7 列列宽压缩（合计 790px）。子表内容 < 可视宽度时 fits 不滚；仅极窄屏超宽时按 antd 默认 max-content 自处理。仅 plan-nodes 本地，未改 `PpmSubTable` 通用组件。
- 导出 Excel 走 lib-ppm 的 `downloadExcel`，前端拼参数触发后端生成。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260714-003-f53e | milestone-details 新建明细必填校验补全（仅要求/附件/所属模块可空）+ 所属模块仅实施阶段显示
- ql-20260714-004-e884 | milestone-details 明细所有状态可删（去 draft 限制）+ 所属模块（实施阶段）改必填
- ql-20260714-005-34d7 | 修 ql-004 遗漏：handleDelete 残留 status!==draft 守卫致删除按钮点击无反应
- ql-20260714-006-a98a | 计划工作量输入框宽度 100% + 工作日联动跳 2026 节假日/调休 + 完成日改「开始日算第1天」口径（workday helper 重写）
- ql-20260714-008-be21 | milestone-details 明细子表 DataTable overflow-hidden 截断表头/尾部 → 加 overflow-visible 覆盖
- ql-20260716-003-8b3e | plan-nodes 子表（明细/模块）外层限宽 overflow-x 容器隔离母表横向滚动 + 明细列宽压缩（920→790）
- ql-20260716-005-c2a7 | 修 ql-003 R-02：明细限宽容器加 `[&_.ant-table-wrapper]:min-w-0`，解决 PpmSubTable flex 包裹致明细无独立滚动条
- ql-20260716-007-d4e9 | 回退 ql-003/005 限宽 overflow 容器（2K 屏引入母表/模块多余滚动条），只保留列宽压缩
