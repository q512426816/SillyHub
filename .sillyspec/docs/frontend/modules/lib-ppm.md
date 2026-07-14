---
schema_version: 1
doc_type: module-card
module_id: lib-ppm
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# lib-ppm

## 定位
PPM（项目过程管理，Project Process Management）域的浏览器侧 API 客户端集合 + 看板分组/图表聚合/格式化/Excel 导出等纯函数。barrel 入口 `index.ts` 统一 re-export，页面统一从 `@/lib/ppm` 引入避免深路径。覆盖「项目/客户/成员/干系人、计划节点/项目计划/里程碑/明细 + 审批流、问题清单/问题变更 + 审批流、任务计划/任务执行/工时 + 统计、看板（人员列/任务卡片/分配/排序/搜人）」五大子域。请求经 `lib-api` 的 `apiFetch`，错误统一抛 `ApiError`；Excel 导出走 `export.ts` 的 `downloadExcel`（带 token + 401 刷新）。

## 契约摘要
子文件与职责：

- `types.ts` — 全域 TS 类型：`PageReq` / `PageResp<T>`（分页）、各实体 `*Maintenance` / `*Create` / `*Update` / `*PageReq`、`KanbanTaskCard` / `KanbanUserColumn` 等。
- `project.ts` — 项目/客户/成员/干系人 CRUD + 分页 + 导出（`pageProjects` / `listProjects` / `getProject` / `createProject` / `updateProject` / `deleteProject` / `listSimpleProjects` / `exportProjects`；客户 `pageCustomers` 系列同构；成员 `pageProjectMembers` 系列；干系人 `pageProjectStakeholders` 系列）。
- `plan.ts` — 计划节点（`listPlanNodes` 等）、项目计划（`listProjectPlans` / `getProjectPlanThreeLevel` 等）、计划明细模板、明细流程审批（`savePlanNodeDetailProcess` / `reject…` / `change…`）、PS 三级节点（`listPsPlanNodes` 等系列）。
- `problem.ts` — 问题清单 CRUD + 审批流（`nextProcessProblem` / `rejectProcessProblem` / `doneTaskProblem` / `closeTaskProblem`）、问题变更 CRUD + 审批流、日志/任务查询、导出。
- `task.ts` — 任务计划（`listPlanTasks` 等）、任务执行（`executePlanTask` / `listTaskExecutes` 等）、工时（`listWorkHours` / `createWorkHour` 等）、统计（`statWorkHoursByUser` / `statWorkHoursByProject`）、按日期范围查询、导出。
- `kanban.ts` — 看板：`listKanbanUsers` / `listKanbanTasks` / `assignKanbanTask` / `reorderKanbanTasks` / `searchKanbanUsers` / `createKanbanTask` / `updateKanbanTask` / `deleteKanbanTask` / `listKanbanComments` / `addKanbanComment` / `listKanbanSubtasks` / `toggleKanbanSubtask`。
- `kanban-grouping.ts` — 纯函数：按用户/日期分桶（`groupByUserAndDate` / `groupByUserAndExecuteDate` / `groupTasksByDate`）、日期 key 生成（`taskDateKey` / `dateRangeKeys` / `weekdayMeta`）、矩阵单元 `MatrixCell`。
- `aggregations.ts` — 图表聚合纯函数：`toBarSeries` / `toPieSeries` / `toCostSeries`（产出 ECharts option），`CHART_COLORS` 调色板，`toNumber` 安全转换。
- `format.ts` — `fmtDate(v, fallback)` → `YYYY-MM-DD`；`fmtDateTime(v, fallback)` → `YYYY-MM-DD HH:mm`（空/非法返回 fallback，基于 dayjs）。
- `status-label.ts` — `statusLabel(value)` 状态码转中文。
- `workday.ts` — 工作日计算：`addWorkingDaysMs` / `addWorkingDaysDate` / `addWorkingDaysISO`；内置 2026 节假日/调休数据 + `getDayStatus` / `isRestDay`（kanban 甘特 re-export `getDayStatus` / `DayStatus`，单一数据源）。语义「起点算第 1 天，完成 = 第 N 个工作日」，跳休息日（周末 + 法定假日；调休补班视为工作）。
- `export.ts` — `downloadExcel(path, params?, filename?)`：通用 Excel 下载，带 Bearer token、401 自动 refresh+retry、数组参数用重复 key 编码。
- `index.ts` — barrel re-export（页面统一入口）。

## 关键逻辑
分页约定（全域一致）：
```
pageXxx(params: *PageReq extends PageReq) → *ListResponse | T[]
  PageReq = { page?, page_size?, <过滤字段> }
  PageResp<T> = { items: T[], total, page, page_size }
```
Excel 导出 token + 刷新（与 apiFetch 对齐）：
```
downloadExcel(path, params, filename):
  url = new URL(path, apiBase); params 填 query（数组重复 key）
  resp = fetch(url, { headers: { Authorization: bearer(token) } })
  if resp.status === 401: refresh → retry once
  blob → 触发下载（Content-Disposition 优先，否则用 filename）
```
看板分组：`groupByUserAndDate(tasks)` → `{user, date, items}[]`，`dateRangeKeys(start,end)` 生成连续日期 key 填空列。

## 注意事项
- 子文件众多但入口统一：**新代码一律从 `@/lib/ppm` 引入**，禁止深路径 `@/lib/ppm/project`。
- `index.ts` 用 `export *`，注意子文件间不要有重名 export（已通过子域切分规避）。
- 列表统一默认 20 条（近期 commit `ba87eec` 调整），分页 `page_size` 默认值变化需留意。
- Excel 导出 `params` 中数组用重复 key（`?k=a&k=b`），与 `apiFetch` 多值语义一致；空数组跳过。
- `fmtDate`/`fmtDateTime` 的 fallback 默认值常量在文件内，非法输入返回 fallback 不抛错——UI 直接渲染即可。
- 工时统计（`statWorkHoursByUser` / `statWorkHoursByProject`）结果供 `components-charts` 的柱状/饼图消费，聚合在 `aggregations.ts` 完成。
- 里程碑明细曾出现孤儿 FK 问题（plan_node_id NULL），前端只负责展示，数据修复在迁移层。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260714-006-a98a | workday.ts 内置 2026 节假日 + addWorkingDaysMs 重写为「第 N 个工作日」语义（开始日算第 1 天，跳法定假日/调休）
