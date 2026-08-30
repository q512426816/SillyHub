---
author: qinyi
created_at: 2026-07-16 00:21:38
---

# 决策台账 — 工作台日历左点负载按今天分界

## D-001@v1: 过去日期实际负载数据源用 TaskExecute

- type: architecture
- status: accepted
- source: code + user
- priority: P0
- question: 过去日期「实际负载」取自 `PlanTask` 的 actual 字段还是 `TaskExecute` 表？
- answer: `TaskExecute` 表（`ppm_task_execute`），对齐「团队实际工作表」`KanbanActualGantt` 数据源 `listTaskExecutesWithPlanByDateRange`（kanban/page.tsx:146）。`execute_plan` 联动写 `TaskExecute`（model.py:129 注释）。注意 `PlanTask` 自身也有 actual_start/end_time/time_spent 字段（model.py:95-107），但团队实际工作表口径用 `TaskExecute`。
- normalized_requirement: 过去日期负载查询 `TaskExecute where execute_user_id == user.id`
- impacts: [design §5.3, §8, 实现主任务, verify 抽查]
- evidence: frontend kanban/page.tsx:146; backend task/model.py:128-193; 用户「参考团队实际工作表」

## D-002@v1: 实际侧人员过滤字段

- type: boundary
- status: accepted
- source: code
- priority: P1
- question: 实际负载按哪个用户字段过滤（`plan_task.user_id` vs `task_execute.execute_user_id`）？
- answer: `task_execute.execute_user_id == me`（我实际执行的）；与计划侧 `plan_task.user_id == me`（计划分给我的）独立。两侧可能不完全对应（计划给别人执行 / 执行别人的计划）。个人工作台「我的」语义：过去 = 我实际执行了多少，未来 = 计划分给我多少。
- normalized_requirement: 实际侧 `where TaskExecute.execute_user_id == user.id`
- impacts: [design §5.3, 实现主任务]
- evidence: task/model.py:166; KanbanActualGantt 按 execute_user_id 分人（kanban-actual-gantt.tsx:87）

## D-003@v1: actual 区间缺失兜底

- type: boundary
- status: accepted
- source: AI（合理默认，无业务判断）
- priority: P1
- question: `task_execute` 的 `actual_start_time` / `actual_end_time` 缺失时怎么落天？
- answer: 三档——双端有 → 平摊 `[start_date, end_date]` 每个日历日；仅一端 → 落该端点单日；都无 → 跳过（不计入负载）。
- normalized_requirement: 区间判定三档兜底（双端/单端/都无）
- impacts: [design §5.3 步骤 2, 实现主任务, 测试用例]
- evidence: design §5.3

## D-004@v1: time_spent 单位与缺失

- type: boundary
- status: accepted
- source: code
- priority: P1
- question: `time_spent`（人天）如何转小时？为 None 怎么办？
- answer: `× 8` 转小时（1 工作日 = 8h，对齐 `_parse_workload_hours` 的 1d=8h，service.py:65-66）；None → 视为 0（不计入）。
- normalized_requirement: `hours = (time_spent or 0) * 8`
- impacts: [design §5.3 步骤 4, 实现主任务]
- evidence: service.py:50-67 (_parse_workload_hours); task/model.py:152

## D-005@v1: 跨月平摊口径

- type: boundary
- status: accepted
- source: user（「平摊到实际干活的每一天」）
- priority: P1
- question: actual 区间跨月时如何分配工时到当月？
- answer: 日均 = `time_spent / 区间总天数`（分母含非当月天）；遍历区间每个日历日，仅累加落在当月且 `< today` 的那天的日均份额。
- normalized_requirement: 按区间总天数日均，只累加当月可见的过去天
- impacts: [design §5.3 步骤 5, 实现主任务, 测试用例]
- evidence: 用户确认「平摊到实际干活的每一天（推荐）」

## D-006@v1: 时区与「今天」口径

- type: boundary
- status: accepted
- source: code + user
- priority: P1
- question: 「今天」/ 过去 / 未来按 UTC 还是本地？今天归过去还是未来？
- answer: 沿用现有 `get_calendar` UTC 口径（`month_start` / daily 落点均 UTC，service.py:352-353）；`today = now(UTC).date()`；`day 日期 < today` 视为过去。今天当天归未来侧（用户确认）。
- normalized_requirement: `today = now(UTC).date()`; `day < today → 实际侧`; `day ≥ today → 计划侧`
- impacts: [design §5.1, R-04, 实现主任务]
- evidence: service.py:347-353; 用户确认「今天算未来（看计划）」

## D-007@v1: 未来侧负载用「剩余负载」而非计划简单平摊

- type: architecture
- status: accepted
- source: user（v2 修正，取代原「未来=计划 work_load 简单累加」）
- priority: P0
- question: 今天及未来日期（day ≥ today）的负载怎么算？
- answer: 剩余负载 = `(计划总工时 − 已实际使用工时) ÷ 剩余天数`。已用 = 该 `plan_task` 所有 `task_execute.time_spent` 之和（人天）；剩余天数 = 今天到计划结束日（含今天，`[max(today,start), end]`）；未来每天负载 = 剩余人天 × 8 / 剩余天数（小时）→ `_load_level_workload` 分档。只对未完成（`status != '已完成'`）任务计算。`work_load` 空或 `end_time` 为 None/过期 → 跳过（R-05/R-06）。
- normalized_requirement: 未来 `day ≥ today`：`load = _load_level_workload(sum over 未完成 plan_task 覆盖该天 of max(0, work_load_hours/8 − spent_days) × 8 / remaining_days)`
- impacts: [design §5.2, §7 `_spread_remaining_hours`, 实现主任务, 测试用例]
- evidence: 用户原话「计划 10 人天 1-20 号，今天 10 号，前面只用了 2 人天，后面平均每天 8/11」→ 8=10−2，11=10\~20 含今天

## D-008@v1: 右点 alert_level 重写（计划 + 缺陷，区间覆盖取最严重）

- type: architecture
- status: accepted
- source: user（2026-07-16 增量，取代原 `_task_alert` 按 start_time 落点）
- priority: P0
- question: 右点（进度 正常/临期/延期）怎么算、标在哪天？
- answer: 看**计划任务 + 缺陷任务**两类，按区间覆盖该天，取最严重（红 > 黄 > 绿 > none）。过去日期（day<today）有覆盖→绿；该天==某延期任务截止日（end<today 未完成）→红；今天（day==today）有覆盖且临期→黄，否则→绿；未来（day>today）有覆盖→绿；无覆盖→none。
- 判定细节：延期 = 计划任务 `end_time<today 且 status!='已完成'` / 缺陷 `plan_end_time<today 且 status!='4'`；临期 = `(计划总量−已用)/剩余天数 > 8h`（计划已用=sum 其 task_execute.time_spent，缺陷已用=time_spent）；覆盖 = 计划 `[start,end]` 含 day / 缺陷 `[plan_start,plan_end]` 含 day；人员 = 计划 `user_id==me` / 缺陷 `duty_user_id==me`。
- normalized_requirement: alert 按区间覆盖 + 进度状态（延期/临期/正常）取最严重；延期标截止日、临期标今天、正常标覆盖天
- impacts: [design §13.1, service.py get_calendar 右点重写, 测试]
- evidence: 用户「右点看任务计划和缺陷；已过去日期只要有任务不标黄红就标绿；延期截止那天标红；临期今天标黄」

## D-009@v1: 点击日历某天显示计划/缺陷/实际三类

- type: architecture
- status: accepted
- source: user
- priority: P1
- question: 点击日历某天显示什么？
- answer: 三类——计划任务（区间覆盖该天）/ 缺陷任务（区间覆盖）/ 实际（actual 覆盖该天，**所有**记录不限 status）。`CalendarDay` 扩展 `plan_items` / `problem_items` / `execute_items` 三个摘要列表。
- normalized_requirement: CalendarDay 加三列表；前端点击渲染三类
- impacts: [design §13.2, schema CalendarDay, service 装配, 前端 WorkCalendarPanel]
- evidence: 用户「点击显示计划任务、缺陷任务、实际完成；计划和缺陷范围内都显示；实际按实际日期显示；实际显示所有」
