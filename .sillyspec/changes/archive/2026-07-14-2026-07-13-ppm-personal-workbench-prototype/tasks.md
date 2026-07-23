---
author: qinyi
created_at: 2026-07-14 09:13:35
change: 2026-07-13-ppm-personal-workbench-prototype
---

# 任务清单（Tasks）

> 只列任务名与归属 Wave，细节（依赖、验收点、文件级改动）在 `sillyspec run plan` 阶段展开。

## Wave 0：后端数据层（工号字段）
- task-01：users 表加 employee_no 列（alembic migration + User ORM + UserRead schema）

## Wave 1：后端 workbench 聚合子域
- task-02：workbench schema（WorkbenchProfile / WorkbenchMetrics / WorkbenchSummary / WorkbenchTodoItem / WorkbenchCalendar / CalendarDay DTO）
- task-03：workbench service · profile 聚合（工号直取 + user_organizations JOIN organizations 取部门 + workspaces role_name）
- task-04：workbench service · summary 指标 + 待办派生（start_time 区间过滤 + now_handle_user split 匹配 + 非终态 plan_task）
- task-05：workbench service · calendar 日历聚合（start_time 落点计数 + load/alert 分档）
- task-06：workbench router（3 个 GET 接口 + main.py 挂载到 /api/ppm）
- task-07：workbench service 单测（指标口径 / task_count=0 边界 / now_handle_user 派生 / 日历分档）

## Wave 2：前端页面与组件
- task-08：lib/ppm/workbench.ts API client + types.ts 加 workbench 类型
- task-09：/ppm/workbench 页面容器（page.tsx）+ 数据装配（apiFetch + useEffect）
- task-10：ProfileSummaryCard 个人信息卡（SectionCard + Avatar）
- task-11：PersonalMetricStrip 5 指标卡片条
- task-12：TodoListPanel 待办列表
- task-13：WorkbenchTaskTable 任务操作表（DataTable + personal-task-plan + 当日完成二次确认）
- task-14：WorkCalendarPanel 工作日历双圆点（从零实现）
- task-15：QuickEntryGrid + RuleNotePanel 快捷入口与规则说明
- task-16：app-shell 菜单加「个人工作台」项 + 消息通知/绩效考评 EmptyState 占位

## Wave 3：联调与验收
- task-17：前端 api-types 重生成（UserRead.employee_no）+ 类型对齐
- task-18：端到端验证（页面渲染 / 指标与库数据一致 / 待办派生 / 日历 / 占位）
