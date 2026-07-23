---
author: qinyi
created_at: 2026-07-16 00:21:38
---

# 任务清单（Tasks）— 工作台日历左点负载：过去实际 / 未来剩余

quick 流程，按 `design.md` v2 实现（无独立 plan 文件）。

## T1: 后端 `get_calendar` 改造（service.py）

- 新增 module-private helper `_spread_actual_hours(rows, year, month, today)`：过去侧 actual 平摊（D-001~005）
- 新增 module-private helper `_spread_remaining_hours(plan_tasks, spent_by_plan, year, month, today)`：未来侧剩余负载（D-007）
- `get_calendar` 改造：
  - 新增查询 `TaskExecute`（`execute_user_id == user.id`，actual 区间与当月相交）
  - 新增查询未完成 `PlanTask`（`user_id == me`、`status != '已完成'`、`start_time <= month_end` 且 `(end_time >= today 或 end_time IS NULL)`），并按 `plan_task_id` 聚合已用 `time_spent`
  - 每日 `load`：`day < today` → `daily_actual_hours`；`day ≥ today` → `daily_remaining_hours`；`load` 脱离 `count==0` 短路（X-001）
  - 右点 `alert` 与 `daily_count` 逻辑零改动
- 复用 `_load_level_workload` / `_to_aware` / `_parse_workload_hours` / `_task_alert`

## T2: 后端测试（test_workbench_service.py）

- 过去日期有 actual 覆盖 → 按平摊分档（FR-01）
- 过去无 actual → `none`（FR-02）
- 未来剩余负载：用户原例 10 人天 1\~20 号、今天 10 号、已用 2 → 8/11 人天/天（FR-03）
- 已用 ≥ 计划 → 剩余 0 不贡献（FR-04）
- 跨月 actual / 跨月计划区间平摊（FR-01/FR-03 + D-005）
- actual 缺失三档兜底（FR-06）
- 未来 `work_load` 空 / `end_time` None/过期 → 跳过（FR-07）
- 今天落未来侧（计划）、看过去月/未来月的跨月分界收敛
- 右点 `alert_level` 回归保护（FR-05）

## T3: 前端图例（work-calendar-panel.tsx）

- 图例「左·负载」下增加一行口径说明：「过去按实际工时 · 今天及以后按剩余负载」（FR-08）
- 三态颜色映射、组件结构不变

## T4: 验证

- backend：`cd backend && uv run pytest app/modules/ppm/workbench -q`（module 测试）+ ruff + mypy
- frontend：`cd frontend && pnpm test`（若触及 work-calendar-panel 测试）+ lint + typecheck
- 对照 design §5 逐条核对 FR-01~FR-08
