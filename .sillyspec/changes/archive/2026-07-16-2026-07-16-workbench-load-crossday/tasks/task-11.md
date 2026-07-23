---
id: task-11
title: workbench/service.py 过去侧负载求和（平摊→求和）+ 测试改写
phase: W4
priority: P0
status: draft
owner: qinyi
estimated_hours: 3
affected_components: [backend]
allowed_paths:
  - backend/app/modules/ppm/workbench/service.py
  - backend/app/modules/ppm/workbench/tests/test_workbench_service.py
depends_on: [task-02]
blocks: []
goal: "workbench/service.py 过去侧负载求和（平摊→求和）+ 测试改写"
implementation:
  - "_spread_actual_hours → _sum_actual_hours：覆盖日 time_spent×8 直接累加（不除 span_days）"
  - "get_calendar 调用点改 _sum_actual_hours"
  - "test_workbench_service.py 改写平摊用例为求和；加 1人天+0人天=8h→full/跨天历史虚高/新录入有actual也显示"
acceptance:
  - "标黄 bug 场景(180024: 1人天+0人天) → 饱和绿"
  - "cd backend && uv run pytest app/modules/ppm/workbench -q 全绿"
verify:
  - "cd backend && uv run pytest app/modules/ppm/workbench -q"
constraints:
  - "依赖 task-02 的 D-005 强制回填（新录入有 actual 才能求和显示）"
  - "历史跨天数据求和虚高接受（D-010/R-01）"
---

## 目标
`_spread_actual_hours` → `_sum_actual_hours`：过去侧覆盖日 time_spent×8 直接累加（不平摊）。

## 依据
design §5.4 / §7.4；D-001（求和推翻平摊）；D-005 联动（task-02 强制回填 actual_end 让新录入有 actual 区间，求和才能显示）。

## steps
1. workbench/service.py：`_spread_actual_hours`（service.py:110）改为 `_sum_actual_hours`：遍历 TaskExecute（execute_user_id=me），对 `_covers_date(actual_start, actual_end, day)` 且 `day < today` 的，`time_spent×8` 直接累加（**不除 span_days**）
2. get_calendar（service.py:608）调用点改 _sum_actual_hours
3. test_workbench_service.py：改写平摊用例为求和；加「1人天+0人天=8h→full 饱和」「跨天历史 1人天覆盖 N 天→每天 8h（虚高，接受）」「新录入有 actual 区间也显示」（D-005 联动）

## 验收标准
- 标黄 bug 场景（180024：1人天+0人天）→ 饱和绿
- `cd backend && uv run pytest app/modules/ppm/workbench -q` 全绿
