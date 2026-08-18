---
schema_version: 1
doc_type: module-card
module_id: lib-ppm
author: qinyi
created_at: 2026-08-18 01:45:00
---

# PPM 域客户端（lib-ppm）

## 定位
PPM（项目过程管理）域的浏览器侧 API 客户端集合 + 看板/工时聚合、工作日推算、格式化等纯函数（`frontend/src/lib/ppm/` 16 文件：15 个 .ts + 1 个测试）。五大 API 子域：项目/客户/成员/干系人、计划节点/项目计划/里程碑明细 + 流程审批、问题清单（含 Excel 导入导出）、任务计划/执行/工时、看板；另有工作台、实施计划汇总（weekly-plan）两个后加子域。请求经 `lib-api` 的 `apiFetch`，错误统一抛 `ApiError`。

## 契约摘要
barrel `index.ts` re-export：`types` / `format` / `project` / `plan` / `problem` / `task` / `kanban` 全量 + `downloadExcel` + `statusLabel`。
**workbench / weekly-plan / workday / aggregations / execute-time 不在 barrel**，消费方按 `@/lib/ppm/<file>` 深路径引入（已核实 charts/stores/页面均如此）。

- `types.ts`（约 90 个 interface）：
  - 分页基座 `PageReq` / `PageResp<T>`；各实体 `*Maintenance` / `*Create` / `*Update` / `*PageReq`。
  - Excel 导入 `ImportPreviewRow/Sheet/Resp` / `ImportCommitSheet/Req` / `ImportResultResp`（plan 域模块 + problem 域问题两套）。
  - 看板 `KanbanQueryReq` / `KanbanUserColumn` / `KanbanOrgGroup` / `KanbanTaskCard` / `KanbanTask*Req` / `KanbanComment*` / `KanbanSubtask`。
  - 工作台 `Workbench*`（Profile/Metrics/TodoItem/SwitchableUser/Summary）+ `Calendar*`（Plan/Problem/ExecuteItem/Day/WorkbenchCalendar）。
  - `WeeklyPlanRow` / `WeeklyPlanPageReq`。
- `project.ts` — 四组同构 CRUD + 分页 + 导出：
  - 项目：`pageProjects` / `listProjects` / `getProject` / `createProject` / `updateProject` / `deleteProject` / `listSimpleProjects` / `exportProjects` / `pageProjectMemberSummary`。
  - 客户：`pageCustomers` / `listCustomers` / CRUD / `exportCustomers`。
  - 项目成员：`pageProjectMembers` / `listProjectMembers` / CRUD。
  - 干系人：`pageProjectStakeholders` / `listProjectStakeholders` / CRUD。
- `plan.ts` — 计划域最重子域：
  - 计划节点/明细模板/模块 CRUD + `importModulesPreview/Commit`（Excel 导入）+ `listModulesByProject`。
  - PS 项目计划：`listProjectPlans` / `getProjectPlan` / CRUD / `getProjectPlanThreeLevel`（三级树）。
  - PS 节点：`list/create/update/deletePsPlanNode` 与 `…PsPlanNodeDetail` 系列 + `listPsPlanNodeDetailVersions`。
  - 明细流程审批：`savePlanNodeDetailProcess` / `rejectPlanNodeDetailProcess` / `changePlanNodeDetailProcess` / `listPlanNodeDetailProcesses`。
  - 导出：`exportPlanNodes` / `exportProjectPlans` / `exportMilestoneDetails`。
- `problem.ts` — 问题清单 CRUD + 流程（`startProblem` / `executeProblem`）+ `exportProblems` / `downloadImportTemplate` / `importProblemsPreview/Commit`。
- `task.ts`：
  - 任务计划：`listPlanTasks` / `getPlanTask` / `updatePlanTask` / `executePlanTask` / `startPlanTask` / `listPersonalPlanTasks` / `exportPlanTasks`。
  - 任务执行：`listTaskExecutes` / `updateTaskExecute` / `listTaskExecutesWithPlanByDateRange`。
  - 工时：`listWorkHours` / `createWorkHour` / `updateWorkHour` / `deleteWorkHour` / 统计 `statWorkHoursByUser` / `statWorkHoursByProject` / `exportWorkHours`。
- `kanban.ts`：
  - `listKanbanUsers` — 返回 `KanbanUserColumn[] | KanbanOrgGroup[]` 联合（人员列 / 组织分组两视图）。
  - `listKanbanTasks` / `assignKanbanTask` / `reorderKanbanTasks` / `createKanbanTask` / `deleteKanbanTask`。
  - `fetchWorkloadGrid` — 负载网格；类型直接引用 OpenAPI 生成 `WorkloadGridResponse` / `WorkloadGridUserRow`。
  - 评论 `listKanbanComments` / `addKanbanComment`。
- `workbench.ts` — `fetchWorkbenchProfile` / `fetchWorkbenchSummary` / `fetchWorkbenchCalendar` / `fetchWorkbenchTodos` / `fetchWorkbenchSwitchableUsers`（桌面 + 移动端工作台共用数据源）。
- `weekly-plan.ts` — `listWeeklyPlan` / `exportWeeklyPlan`；re-export 本域 `PageReq` / `PageResp` / `WeeklyPlanPageReq` / `WeeklyPlanRow`。
- `aggregations.ts` — 图表聚合纯函数：`toBarSeries` / `toPieSeries`（产出 EChartsOption）、`CHART_COLORS` 调色板、`toNumber` 安全转换、`BarRow` 行类型。
- `format.ts` — `fmtDate`（YYYY-MM-DD） / `fmtDateTime`（YYYY-MM-DD HH:mm；非法返回 fallback 不抛错）、`parseWorkLoadPersonDays`、`isOverEstimate`。
- `status-label.ts` — `statusLabel(value)` 状态码转中文。
- `workday.ts` — 工作日推算：
  - `addWorkingDaysMs` / `addWorkingDaysDate`（`WorkdayStart` 三态入参）——「起点算第 1 天，完成 = 第 N 个工作日」语义，跳周末 + 法定假日，调休补班视为工作日；内置 2026 节假日/调休数据。
  - `getDayStatus` / `isRestDay` / `DayStatus` — kanban 甘特 re-export 前两者，单一数据源。
- `execute-time.ts` — `localDayTimeToIso` / `pickExecuteEndIso`（执行时间本地 → ISO 换算，有独立单测 `execute-time.test.ts`）。
- `export.ts` — `downloadExcel(path, params?, filename?)`（Bearer token、401 刷新重试一次、数组参数重复 key 编码）+ `uploadExcelWithAuth`（Excel 上传同鉴权范式）。

## 关键逻辑
```
分页约定（全域一致）:
  pageXxx(params: *PageReq extends PageReq) → PageResp<T> 形态
  PageReq = { page?, page_size?, <过滤字段> }
downloadExcel: 401 → refresh → retry once；数组参数 ?k=a&k=b
listKanbanUsers 返回联合类型，调用方按视图（人员列/组织分组）分支
```

## 注意事项
- 旧卡的 `kanban-grouping.ts` / `toCostSeries` / `addWorkingDaysISO` / `nextProcessProblem` 系列已不存在，勿按旧名引用。
- barrel 用 `export *`，子文件勿重名导出；kanban 虽在 barrel，stores-kanban 等仍走深路径引入，两种方式并存。
- 看板 workload 网格类型走 gen:types 生成类型（规则 20），其余手写——后端 schema 改动时注意两处同步路径不同。
- ppm 域菜单权限（`ppm:*:read/view`）是前端可见性语义，后端 plan 域仅认证不授权，勿当安全边界。
- 工时统计结果由 `aggregations.ts` 聚合后供 `components-charts` 柱/饼图消费。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260714-006-a98a | workday.ts 内置 2026 节假日 + addWorkingDaysMs 重写为「第 N 个工作日」语义（开始日算第 1 天，跳法定假日/调休）
