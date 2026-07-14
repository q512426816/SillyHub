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
- 导出 Excel 走 lib-ppm 的 `downloadExcel`，前端拼参数触发后端生成。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260714-003-f53e | milestone-details 新建明细必填校验补全（仅要求/附件/所属模块可空）+ 所属模块仅实施阶段显示
- ql-20260714-004-e884 | milestone-details 明细所有状态可删（去 draft 限制）+ 所属模块（实施阶段）改必填
- ql-20260714-005-34d7 | 修 ql-004 遗漏：handleDelete 残留 status!==draft 守卫致删除按钮点击无反应
