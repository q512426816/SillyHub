---
id: task-05
title: "calendar 日历聚合（start_time 落点计数 + load/alert 分档 + 延期预警）（覆盖：FR-08, D-010@v1）"
title_zh: 工作日历聚合查询
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P1
depends_on: [task-02]
blocks: [task-11]
requirement_ids: [FR-08]
decision_ids: [D-010@v1]
allowed_paths:
  - backend/app/modules/ppm/workbench/service.py
  - backend/app/modules/ppm/workbench/router.py
provides:
  - contract: WorkbenchCalendar
    fields: [year_month, days]
  - contract: CalendarDay
    fields: [date, task_count, load_level, alert_level]
expects_from:
  - contract: WorkbenchCalendar
    needs: [WorkbenchCalendar/CalendarDay DTO 定义]
goal: >
  实现 WorkbenchService.get_calendar(session, user, year_month)，返回当月每日任务负载与延期预警双圆点。
implementation:
  - "在 WorkbenchService 实现 async def get_calendar(self, session, user, year_month: str) -> WorkbenchCalendar，year_month 格式 'YYYY-MM'"
  - "解析 year_month：year, month = map(int, year_month.split('-'))；month_start = 当月 1 日 00:00（本地带 tz）；month_end = 下月 1 日 00:00；days_in_month = calendar.monthrange(year, month)[1]"
  - "查询当月任务：select(PlanTask).where(PlanTask.user_id == user.id).where(PlanTask.start_time >= month_start).where(PlanTask.start_time < month_end)；只取 start_time 落在当月的任务"
  - "按 start_time 当日落点计数：dict[date_int, count]，每条 task 按 task.start_time.day（本地日）+1 计入当日 task_count。跨多日任务只计 start_time 当日，不展开 end_time 区间（X-004 避免虚高）"
  - "延期标记 dict[date_int, is_alert]：遍历任务，若 task.end_time < now AND task.status != '已完成'（D-010 口径），则 task.start_time.day 当日 is_alert=True"
  - "load_level 分档（X-003）：task_count==0 → 'none'；1-2 → 'normal'；3-4 → 'mid'；>=5 → 'over'"
  - "alert_level：当日 is_alert=True → 'over'；否则 'normal'（task_count=0 的日期 alert_level='normal'，load_level='none'）"
  - "构造 days：for day in range(1, days_in_month+1)：CalendarDay(date=f'{year_month}-{day:02d}', task_count=count_dict.get(day,0), load_level=按分档, alert_level=按标记)"
  - "router handler：GET /api/ppm/workbench/calendar，Query year_month: str（格式校验 YYYY-MM，非法返回 422 或兜底取当月），调用 service.get_calendar(session, user, year_month) 返回 WorkbenchCalendar"
acceptance:
  - "跨多日任务（start_time=7/3, end_time=7/10）只计入 7/3 当日 task_count，7/4~7/10 不计（不虚高负载，X-004）"
  - "load_level 分档正确：0→none / 1-2→normal / 3-4→mid / >=5→over（X-003）"
  - "当日有任务 end_time<now AND status!='已完成' → 该日 alert_level='over'（延期预警）"
  - "无任何任务的日期 task_count=0, load_level='none', alert_level='normal'"
  - "返回 days 长度 == 当月天数（calendar.monthrange，含 28/29/30/31 边界）"
  - "start_time 为 NULL 的任务不计入任何当日（查询已用 start_time>=month_start 过滤排除 NULL）"
verify:
  - "cd backend && uv run pytest -q app/modules/ppm/workbench -k calendar"
  - "cd backend && uv run ruff check app/modules/ppm/workbench && uv run mypy app/modules/ppm/workbench"
constraints:
  - "只计 start_time 当日，不展开 end_time 区间（X-004：避免跨周/跨月任务虚高每日负载）"
  - "load_level 分档阈值固定 0/1-2/3-4/>=5（X-003）"
  - "alert 用 end_time<now AND status!='已完成' 口径（D-010@v1，与 summary delay_rate 同口径）"
  - "start_time 为 NULL 的任务被查询条件 start_time>=month_start 自动排除（SQL NULL 比较返回 false）"
  - "只读聚合不写表；year_month 格式非法时兜底（取当月或 422），不 crash"
---
