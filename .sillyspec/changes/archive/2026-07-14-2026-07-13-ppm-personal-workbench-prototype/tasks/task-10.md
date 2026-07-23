---
id: task-10
title: "TodoListPanel 待办列表 + WorkbenchTaskTable 任务操作表（复用 personal-task-plan，当日完成二次确认）（覆盖：FR-06, FR-07, D-005@v1, D-006@v1）"
title_zh: "待办列表与任务操作表组件"
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P0
depends_on: [task-07, task-08]
blocks: [task-12]
requirement_ids: [FR-06, FR-07]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/workbench/_components/todo-list-panel.tsx
  - frontend/src/app/(dashboard)/ppm/workbench/_components/workbench-task-table.tsx
expects_from:
  - contract: WorkbenchTodoItem
    needs: [id, name, type, source]
  - contract: PlanTask
    needs: [id, content, project_name, module_name, status, user_id]
  - contract: workbenchClient
    needs: []
  - contract: taskClient
    needs: [listPersonalPlanTasks, executePlanTask]
goal: >
  待办列表（来自 WorkbenchSummary.todos，name + type 徽标）+ 任务操作表（复用 personal-task-plan 数据，
  列：序号/项目/模块/内容/状态/操作；「当日完成」二次确认后调 execute-plan 复用 lib/ppm/task.ts）。
implementation:
  - "新建 frontend/src/app/(dashboard)/ppm/workbench/_components/todo-list-panel.tsx：`\"use client\";` + JSDoc（待办列表 派生 来自 summary.todos，type 徽标）；import：`SectionCard` from `@/components/layout`、`Badge` from `@/components/ui/badge`（badge.tsx，variant: default/info/success/warning/destructive/error/outline）、type `WorkbenchTodoItem` from `@/lib/ppm/types`（task-07 产出，字段 id/name/type/source）；props：`{ todos: WorkbenchTodoItem[] | null; loading?: boolean }`"
  - "TodoListPanel type→Badge variant 映射（参照原型 type 标签「计划/缺陷/工时/任务」）：source=\"plan_task\"→`warning` 标「任务」；source=\"problem_audit\"/\"problem_change\"→`destructive` 标「缺陷」；type 含「工时」→`info` 标「工时」；type 含「计划」→`default` 标「计划」；其余→`outline` 标 type 原文（type 字段是后端给的标签字符串按内容分支兜底，source 是结构化来源）"
  - "TodoListPanel 渲染：SectionCard（title=\"我的待办\"，extra 可放计数 `{todos?.length ?? 0}`，bodyPadding=\"p-0\" 或 \"p-2\"）内列表——todos 为空/null：渲染 `<EmptyState title=\"暂无待办\" />`（@/components/ui/empty-state.tsx，独立展示不绑 antd Table）；非空：`<ul className=\"divide-y divide-border\">` 每项 `<li className=\"flex items-center gap-2 px-3 py-2\">`：`<Badge variant={variant}>{label}</Badge>` + `<span className=\"text-sm\">{todo.name}</span>`（name 任务/问题主题，ellipsis 截断）"
  - "新建 frontend/src/app/(dashboard)/ppm/workbench/_components/workbench-task-table.tsx：`\"use client\";` + JSDoc（任务操作表，复用 personal-task-plan 接口数据 + execute-plan 完成动作，不重写任务接口 D-005@v1）；import：`DataTable` from `@/components/layout`（data-table.tsx，antd Table 包装层，泛型 `<T extends object>`，透传 columns/dataSource/pagination）、`Button` from `@/components/ui/button`、`Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter` from `@/components/ui/dialog`（dialog.tsx，radix 包装）、`Tag` from `antd`（状态标签 参照 task-plans/page.tsx:332）、`executePlanTask` from `@/lib/ppm/task`（task.ts:91）、type `PlanTask` from `@/lib/ppm/types`、`taskStatusTag, useToast, Toast` from `../../shared`（shared.tsx，taskStatusTag(status)→{text,color} / useToast()/Toast）、`ApiError` from `@/lib/api`"
  - "WorkbenchTaskTable props：`{ tasks: PlanTask[]; loading?: boolean; onChanged: () => void }`（tasks 由 page.tsx 装配 personal-task-plan 数据后下传，onChanged 回调触发 page 重载）；本地 state：`confirmTask: PlanTask | null`（二次确认目标）+ `busy: boolean` + `{ toast, showToast } = useToast()`"
  - "WorkbenchTaskTable 列定义（columns，参照原型任务表 + task-plans/page.tsx:286 columns 范式，不依赖 PlanTask 不存在的 project_code/plan_type，D-005@v1）：序号列 render `(_v, _t, idx) => idx + 1`（width 50）；项目名 dataIndex=\"project_name\" render `(v: string|null) => v ?? \"—\"`（width 120，project_name 兼作原型「项目编码」列 D-005@v1 R-01 不扩接口）；模块 dataIndex=\"module_name\" render `(v: string|null) => v ?? \"—\"`（width 120，module_name 近似原型「平台子系统/计划类型」列 D-005@v1）；任务内容 dataIndex=\"content\" ellipsis render `(v: string|null) => v ?? \"—\"`（width 240）；状态 dataIndex=\"status\" render `(v: string) => { const t = taskStatusTag(v); return <Tag color={t.color}>{t.text}</Tag> }`（width 90，taskStatusTag 来自 shared.tsx:52，10/20/30/40/50→待执行/执行中/待验证/已完成/已关闭）；操作 render `(_v, t) => <Button size=\"sm\" variant=\"default\" disabled={t.status===\"40\"||t.status===\"50\"} onClick={() => setConfirmTask(t)}>当日完成</Button>`（width 100，已完成/已关闭禁用）"
  - "WorkbenchTaskTable 二次确认 Dialog（用 ui/dialog 非自造遮罩）：confirmTask 非 null 时渲染 `<Dialog open onOpenChange={(o)=>!o&&setConfirmTask(null)}>`，DialogContent 内 DialogHeader/DialogTitle「确认完成当前任务？」/ DialogDescription「该操作会把任务标记为当日完成，将同步执行记录（execute-plan）。」，DialogFooter 放取消 Button(variant=outline) + 确认完成 Button(variant=default, disabled=busy, onClick=handleComplete)"
  - "WorkbenchTaskTable handleComplete：`if (!confirmTask) return; setBusy(true);` 后 `try { await executePlanTask({ plan_task_id: confirmTask.id, submit: true }); showToast(true, \"任务已标记当日完成\"); setConfirmTask(null); onChanged(); }`（executePlanTask 入参 ExecutePlanReq {plan_task_id, submit, execute_info?, time_spent?}，submit=true 推进到待验证，参照 task-plans/page.tsx:256 handleExecute 范式，onChanged 触发 page.tsx 重载任务列表），`catch (err) { showToast(false, err instanceof ApiError ? err.message : \"完成失败\"); }`，`finally { setBusy(false); }`"
  - "WorkbenchTaskTable DataTable 配置：`rowKey=\"id\"` size=\"small\" bordered scroll={{x:\"max-content\"}} dataSource=tasks loading=loading locale={{emptyText:\"暂无任务\"}}（DataTable emptyText prop 亦可）；不放分页（page.tsx 控制条数，或前端简单分页由 page 下传 page/pageSize，本组件只渲染传入 tasks 数组，分页留 page 层）；`<Toast toast={toast} />` 渲染在组件根部（shared.tsx:92）"
acceptance:
  - "TodoListPanel 渲染 todos（name + type 徽标），type 徽标颜色按来源/类型分支（任务/缺陷/工时/计划）；todos 为空显示 EmptyState「暂无待办」不报错"
  - "WorkbenchTaskTable 用 DataTable 渲染任务列（序号/项目名/模块/任务内容/状态/操作），数据来自下传的 PlanTask[]（page.tsx 调 listPersonalPlanTasks 装配）"
  - "「当日完成」点击弹 Dialog（ui/dialog）二次确认，确认后调 executePlanTask（submit=true），成功 Toast + 触发 onChanged 重载；失败 Toast 错误"
  - "不访问 PlanTask 不存在的 project_code/plan_type 字段（D-005@v1：project_name 兼作项目列，module_name 近似平台列），无字段缺失报错"
  - "已完成(status=40)/已关闭(status=50)任务「当日完成」按钮禁用"
  - "`cd frontend && pnpm typecheck && pnpm test` 通过"
verify:
  - "cd frontend && pnpm typecheck && pnpm test"
constraints:
  - "复用 DataTable（@/components/layout/data-table.tsx，antd Table 包装，不改 antd API）、personal-task-plan 接口（listPersonalPlanTasks，task.ts:112，后端按当前 token 注入 user_id）、executePlanTask（task.ts:91）——不重写任务接口（D-005@v1，契约不变）"
  - "二次确认用 ui/dialog（Dialog/DialogContent/DialogHeader/DialogTitle/DialogDescription/DialogFooter），不自造遮罩弹窗"
  - "type 徽标用 Badge（ui/badge.tsx），参照原型 type 标签（计划/缺陷/工时/任务）"
  - "状态标签复用 shared.tsx taskStatusTag（10/20/30/40/50 中文映射），不重复定义"
  - "待办来源 WorkbenchTodoItem 由后端 task-04 派生（now_handle_user split 匹配，D-006@v1），前端只展示不派生"
  - "数据由 page.tsx（task-08）装配后 props 下传，组件内不再独立 fetch（避免双重请求）"
---
