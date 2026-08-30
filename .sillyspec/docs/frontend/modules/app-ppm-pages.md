---
schema_version: 1
doc_type: module-card
module_id: app-ppm-pages
author: qinyi
created_at: 2026-08-18 01:45:00
---

# PPM 业务页面（app-ppm-pages）

## 定位
PPM（项目管理）业务页面集合，挂在 `/ppm/*` 路由组下（17 个 page.tsx），覆盖工作台、项目、计划、里程碑、任务、客户、成员、干系人、问题、工时、周报汇总、看板等。页面以"列表 + 详情/表单"模式为主，统一用 components-layout 的 `PageContainer/PageHeader/DataTable` 与 components-ppm 业务组件搭骨架，数据走 lib-ppm 子模块（15 个子文件），看板筛选态由 stores-kanban 承载。

## 契约摘要
- `PpmIndexPage`（`/ppm`）：server 组件，直接 `redirect("/ppm/workbench")`——PPM 域真正的首页是工作台。
- `WorkbenchPage`（`/ppm/workbench`）：个人工作台，三栏聚合——左（ProfileSummaryCard 个人信息+切换用户 / TodoListPanel 我的待办自带分页 / 消息位）+ 中（PersonalMetricStrip 本月指标 / WorkbenchTaskTable 我的任务自包含 fetch+筛选）+ 右（WorkCalendarPanel 工作日历 / QuickEntryGrid 快捷入口）。切换用户：经理与 super_admin（`profile.can_view_others`）可切他人视角，`targetUserId` 透传全部 fetch 接口，查看他人时顶部提示条 + 返回我自己。自有 layout 强制 force-dynamic（见 app-layouts 卡）。
- `PpmProjectsPage`（`/ppm/projects`）：项目 CRUD，走 `lib/ppm/project.ts`；行操作「成员管理」跳 project-members 带项目名查询、「关联工作区」开 LinkWorkspaceDialog、「发起团队」跳 `/sessions?new=1`（ql-20260823-005：门户自动进预会话直达新建，免手动点组头「＋」）。
- `ProjectPlansPage`（`/ppm/project-plans`）：`PageContainer size="full"` + `DataTable`（12 列 + 操作 + 合计行），支持导出。
- `KanbanPage`（`/ppm/kanban`，495 行）：任务看板，数据全部来自 `useKanbanStore`（users/tasks/filters），分组过滤在 store selector 完成；点卡片开任务详情抽屉（Tabs：执行记录 / 评论 / 附件；执行记录复用 `listTaskExecutes({plan_task_id})` 只读表，对齐任务计划/问题清单详情）；2026-07-30-kanban-workload-heatmap 起页面为双视图 Segmented（默认任务看板 + 人员工时热力网格 kanban-workload-grid，切热力才调 fetchWorkloadGrid，workloadCellColor 锚点偏离式配色，helpers 13 单测）。
- `WeeklyPlanPage`（`/ppm/weekly-plan`，691 行）：实施计划汇总——所有项目实施阶段（三级里程碑 has_module=true）下的明细 + 任务计划（PlanTask），19 列两级表头 + 项目分组行（colSpan=19 独占一行，虚拟列表不支持 rowSpan）+ 虚拟列表 + 导出（`listWeeklyPlan` / `exportWeeklyPlan`，lib/ppm/weekly-plan.ts）。
- `MilestoneDetailsPage`（`/ppm/milestone-details`）：里程碑详情 + 子表展开（新建/删除校验见人工备注变更索引）。
- 其余：`customers`、`project-members`、`project-stakeholders`、`plan-nodes`、`task-execute`、`task-plans`、`problem-list`、`work-hours`、`work-hour-statistics`（`WorkHourBarChart` / `WorkHourPieChart` 可视化）。
- 移动端镜像页（app-mobile-pages 域）：/m/ppm/workbench、project-plans、milestone-details、problem-list、task-plans 共 5 页。

## 关键逻辑
```
列表页统一骨架: PageContainer(full) → PageHeader → SearchBar 筛选
               → DataTable<T> columns dataSource (+合计行)
看板页: 纯消费 store——const {users, tasks, filters} = useKanbanStore()
        筛选态跨页保留, 重置需显式调 store reset
工作台: apiFetch + useEffect 装配; profile/summary/calendar 各独立
        try/catch + loading/error; 切换用户 = targetUserId 贯穿全部取数
```

## 注意事项
- 页面普遍较长（project-plans / weekly-plan 600+ 行），DataTable 列定义与合计行逻辑集中，改列须同步改合计。
- plan-nodes 子表 `scroll.x` 用固定宽度（明细/模块均 790），不用 `max-content`（防 antd 嵌套测量膨胀撑长母表）；限宽 overflow 容器方案曾两进两退（ql-003/005/007），勿再引入。
- 周报虚拟列表不支持 rowSpan：需要跨行合并的形态改用 colSpan 整行分组（本页项目分组行的既定模式）。
- 导出 Excel 走 lib-ppm `downloadExcel` / `exportWeeklyPlan`，前端拼参数触发后端生成。
- 移动端镜像页与桌面页各自独立实现，改业务口径（列/校验/状态流转）需双向同步，勿只改一侧。
- 子表复用 `PpmSubTable` 展开编辑模式，列定义走 `PpmSubEditableColumn`。

## 人工备注
<!-- MANUAL_NOTES_START -->

## 变更索引
- ql-20260823-005-4fa7 | projects 行操作「发起团队」改跳 /sessions?new=1（门户 ?new=1 直达预会话，免手动新建；详见 components-sessions 卡）
- ql-20260714-003-f53e | milestone-details 新建明细必填校验补全（仅要求/附件/所属模块可空）+ 所属模块仅实施阶段显示
- ql-20260714-004-e884 | milestone-details 明细所有状态可删（去 draft 限制）+ 所属模块（实施阶段）改必填
- ql-20260714-005-34d7 | 修 ql-004 遗漏：handleDelete 残留 status!==draft 守卫致删除按钮点击无反应
- ql-20260714-006-a98a | 计划工作量输入框宽度 100% + 工作日联动跳 2026 节假日/调休 + 完成日改「开始日算第1天」口径（workday helper 重写）
- ql-20260714-008-be21 | milestone-details 明细子表 DataTable overflow-hidden 截断表头/尾部 → 加 overflow-visible 覆盖
- ql-20260716-003-8b3e | plan-nodes 子表（明细/模块）外层限宽 overflow-x 容器隔离母表横向滚动 + 明细列宽压缩（920→790）
- ql-20260716-005-c2a7 | 修 ql-003 R-02：明细限宽容器加 `[&_.ant-table-wrapper]:min-w-0`，解决 PpmSubTable flex 包裹致明细无独立滚动条
- ql-20260716-007-d4e9 | 回退 ql-003/005 限宽 overflow 容器（2K 屏引入母表/模块多余滚动条），只保留列宽压缩
- ql-20260716-008-e5f1 | plan-nodes 子表 scroll.x 改固定宽度（790）替代 max-content，根本避免嵌套测量膨胀撑母表
- ql-20260722-003-f7d9 | problem-list 列表页改造（归属默认全部/问题类型查询入展开区/列表重排 17 列+操作冻列：问题类型 bug 标红、责任人&处置人合并列(处置人空或同人只显示一个)、预估/已消耗(人天)合并列、默认 plan_start_time 正序；_forms 编辑回填 now_handle_user_name；PpmUserSelect 加 extraOptions prop 支持编辑回填姓名）
- ql-20260722-004 | 问题详情弹窗（problem-detail-modal）问题信息区加「创建人/创建时间」两行（创建人取后端反查的 created_by_name，创建时间精确到秒）；types ProblemList 加 created_by_name
- ql-20260722-005 | 看板任务详情抽屉（kanban-task-detail-drawer）「子任务」tab → 「执行记录」tab（只读，复用 listTaskExecutes(plan_task_id) 对齐任务计划/问题清单详情；删子任务死代码——ppm_kanban_subtask 表只做一半无录入入口恒空）；补 test/setup.ts ResizeObserver polyfill（antd Drawer 在 jsdom 需要）

<!-- MANUAL_NOTES_END -->
