---
id: task-02
title: service get_workload_grid 含 plan 剩余负载摊天与 actual 覆盖日求和（覆盖 FR-02/03/04）
title_zh: 看板工时网格聚合 service
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: [task-01]
blocks: [task-03, task-04]
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/kanban/service.py
expects_from:
  task-01:
    - contract: WorkloadGridResponse
      needs: [start_date, end_date, days, users]
    - contract: WorkloadGridUserRow
      needs: [user_id, username, plan_hours, actual_hours]
provides:
  - contract: WorkloadGridResponse
    fields: [start_date, end_date, days, users]
goal: >
  实现工时网格聚合，按计划剩余负载摊天与实际覆盖日求和两口径产出逐人逐日人天，与工作日历同源。
implementation:
  - 复用 _query_visible_members 取人员集合保证与甘特行一致
  - 新增 _spread_plan_person_days 对未完成 PlanTask 按计划减已用除以剩余日历天数摊到今天及以后
  - 新增 _sum_actual_person_days 把 TaskExecute 的 time_spent 计入实际起止覆盖的每个日历日
  - project 过滤时 join PlanTask 按项目过滤，problem 执行无 plan_task_id 被排除对齐现有
  - 组装 WorkloadGridResponse 返回
acceptance:
  - plan 口径仅落到今天及以后日期，过去为 0
  - actual 口径含今天，跨天记录覆盖日全计入
  - 无 project 过滤时计入全部 plan 与 problem 执行
  - dateRange 超 62 天收口拒绝或截断
verify:
  - cd backend && uv run pytest app/modules/ppm/kanban -q --no-cov
constraints:
  - 剩余负载按日历日摊不跳周末
  - today 取后端当前日期与 workbench 一致
  - 只读聚合不写任何表
---
