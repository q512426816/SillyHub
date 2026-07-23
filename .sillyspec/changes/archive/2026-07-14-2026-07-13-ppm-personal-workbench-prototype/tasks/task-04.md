---
id: task-04
title: "summary 指标 + 待办派生（start_time 区间过滤 5 指标 + now_handle_user split 匹配 + 非终态 plan_task）（覆盖：FR-05, FR-06, FR-09, FR-10, D-006@v1, D-008@v1, D-010@v1）"
title_zh: 工作台指标与待办聚合
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P0
depends_on: [task-02]
blocks: [task-09, task-10]
requirement_ids: [FR-05, FR-06, FR-09, FR-10]
decision_ids: [D-006@v1, D-008@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/ppm/workbench/service.py
  - backend/app/modules/ppm/workbench/router.py
provides:
  - contract: WorkbenchSummary
    fields: [metrics, todos]
  - contract: WorkbenchMetrics
    fields: [task_count, completion_rate, delay_rate, work_hours, defect_count]
  - contract: WorkbenchTodoItem
    fields: [id, name, type, source]
expects_from:
  - contract: WorkbenchSummary
    needs: [WorkbenchMetrics/WorkbenchTodoItem/WorkbenchSummary DTO 定义]
goal: >
  实现 WorkbenchService.get_summary(session, user, range)，按 PlanTask.start_time 区间聚合 5 指标 + 派生待办列表。
implementation:
  - "在 WorkbenchService 实现 async def get_summary(self, session, user, range_) -> WorkbenchSummary，range_ ∈ {'week','month','all'}"
  - "区间计算（本地时间）：week=本周一 00:00 ~ 本周日 23:59:59（today - timedelta(days=today.weekday()) 算周一）；month=当月 1 日 00:00 ~ 下月 1 日 00:00（calendar.monthrange 算月末）；all=start_time 不加区间过滤。注意 datetime 带 tz 与 PlanTask.start_time(DateTime(timezone=True)) 对齐，参照 [[backend-test-sqlite-vs-pg]] naive/tz 处理"
  - "task_count = count(PlanTask where PlanTask.user_id == user.id AND PlanTask.start_time ∈ [区间])（week/month 加 start_time>=start AND start_time<end；all 不加）。区间内任务总数，作为 completion_rate/delay_rate 分母"
  - "completion_rate：分子 = count(同范围 PlanTask where status == '已完成')；task_count==0 时 completion_rate=0.0；否则分子/task_count（float，保留合理小数）"
  - "delay_rate：分子 = count(同范围 PlanTask where end_time < now AND status != '已完成')（D-010@v1 口径，end_time 为空不计延期）；task_count==0 时 delay_rate=0.0"
  - "work_hours：复用 stat_by_user 口径——数据源 TaskExecute.time_spent（非 ppm_work_hour，D-008@v1），select(func.sum(TaskExecute.time_spent)).where(TaskExecute.execute_user_id == user.id)；week/month 按 TaskExecute.actual_start_time/actual_end_time 加区间过滤（对齐 task/service.py:499 stat_by_user 的 actual_start_time/actual_end_time 过滤口径）；SUM 为 NULL（无记录）时 work_hours=0.0"
  - "defect_count = count(PpmProblemList where PpmProblemList.duty_user_id == user.id AND PpmProblemList.status != '4')；不受 range 影响（全量未关闭缺陷，status='4' 为已关闭，见 problem/model.py:117 status 枚举）"
  - "待办派生 ①（问题在办）：select(PpmProblemList) 取所有记录后 Python 端过滤——split_now = (p.now_handle_user or '').split(',') 过滤空白，if str(user.id) in split_now 则纳入；每条 WorkbenchTodoItem(id=str(p.id), name=p.pro_desc or p.project_name or '问题待处理', type='缺陷', source='problem_audit')。Python 端 split 不依赖 SQL like（R-02 方言安全）"
  - "待办派生 ②（任务待办）：select(PlanTask).where(PlanTask.user_id == user.id).where(PlanTask.status != '已完成')，按 start_time 升序取前 N（N=20）；每条 WorkbenchTodoItem(id=str(t.id), name=t.content or t.project_name or '任务待办', type='任务', source='plan_task')"
  - "router handler：GET /api/ppm/workbench/summary，Query range_: Literal['week','month','all'] = 'month'，调用 service.get_summary(session, user, range_) 返回 WorkbenchSummary"
acceptance:
  - "task_count=0（区间内无任务）→ completion_rate=0.0 且 delay_rate=0.0（不触发除零）"
  - "PpmProblemList.now_handle_user='uid1,uid2' 能匹配 str(user.id)（user.id 为 uid1 或 uid2 时纳入待办，Python split 过滤）"
  - "now_handle_user 为 NULL 或空串 → 不纳入待办（不报错）"
  - "defect_count 不受 range 参数影响（week/month/all 返回同一值，只看 duty_user_id+status!='4'）"
  - "work_hours 无 TaskExecute 记录时返回 0.0（不为 None，UI 显示「0 天」）"
  - "待办每条带正确 type 标签（问题='缺陷'/source='problem_audit'，任务='任务'/source='plan_task'）"
  - "delay_rate 用 end_time<now 口径（D-010），end_time 为 NULL 的任务不计入延期分子"
verify:
  - "cd backend && uv run pytest -q app/modules/ppm/workbench -k summary"
  - "cd backend && uv run ruff check app/modules/ppm/workbench && uv run mypy app/modules/ppm/workbench"
constraints:
  - "now_handle_user 匹配用 Python 端 split(',') 过滤，不依赖 SQL like（R-02 SQLite/PG 方言差异规避）"
  - "range 统一按 PlanTask.start_time 区间过滤，不依赖 month/week 字符串字段（X-001：PlanTask.month 可空过滤不可靠）"
  - "工时数据源 = TaskExecute.time_spent（D-008@v1，非 ppm_work_hour——该表为空）；过滤用 actual_start_time/actual_end_time 对齐 stat_by_user 口径"
  - "延期口径 = end_time<now AND status!='已完成'（D-010@v1，problem 的延期用 is_delay_plan 但本任务 defect_count 只看 status!='4' 不判延期）"
  - "completion_rate/delay_rate 分母 = task_count（同范围任务总数），task_count=0 返回 0.0（X-002）"
  - "待办只读派生，不写任何表；不新建 todo 表（§3 非目标）"
  - "defect_count status!='4'（'4'=已关闭，problem/model.py:117）；不读 is_delay_plan"
---
