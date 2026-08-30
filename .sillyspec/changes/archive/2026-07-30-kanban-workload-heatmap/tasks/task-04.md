---
id: task-04
title: 后端聚合测试 test_kanban_workload_grid（覆盖 FR-03/04, R-01, R-08）
title_zh: 看板工时网格聚合测试
author: qinyi
created_at: 2026-07-30 15:58:48
priority: P0
depends_on: [task-02, task-03]
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/ppm/kanban/tests/test_kanban_workload_grid.py
goal: >
  用工时聚合测试钉死 plan 摊天与 actual 覆盖日两口径及过滤边界，防止与工作日历口径漂移。
implementation:
  - 造数覆盖计划任务与实际执行，断言 plan 摊天仅落到今天及以后
  - 断言 actual 覆盖日求和含今天且跨天记录覆盖日全计入
  - 覆盖 project 过滤 join PlanTask 与 problem 执行被排除边界
  - 覆盖跨边界在途记录与空数据与人员口径
acceptance:
  - plan 与 actual 两口径断言与 workbench 同源
  - project 过滤与 problem 排除断言通过
  - 全部测试本地通过
verify:
  - cd backend && uv run pytest app/modules/ppm/kanban/tests/test_kanban_workload_grid.py -q --no-cov
constraints:
  - 测试用本地当前日期断言避免模块级时间常量坑
  - 不改被测实现来凑通过
---
