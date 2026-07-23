---
author: qinyi
created_at: 2026-07-16 00:21:38
---

# 需求规格（Requirements）— 工作台日历左点负载：过去实际 / 未来剩余

## 角色

| 角色 | 说明 |
|---|---|
| 当前登录用户 | 在个人工作台查看自己当月日历的每日负载（左点）与进度（右点） |

## 功能需求

### FR-01: 左点负载按今天分界 — 过去看实际工时

覆盖决策：D-001@v1, D-002@v1, D-004@v1, D-006@v1

**Given** 当月存在当前用户执行过的 `TaskExecute`（`execute_user_id == me`），其 actual 区间覆盖过去某天（`day < today`）
**When** 调用 `get_calendar(year_month)`
**Then** 该过去天的 `load_level = _load_level_workload(actual 平摊小时)`，其中每天小时 = `time_spent × 8 / actual 区间天数`

**Given** actual 区间跨月
**When** 计算平摊
**Then** 只累加落在当月且 `< today` 的天；区间天数分母含全区间（D-005）

### FR-02: 过去无实际记录 → 灰点

**Given** 过去某天无 `TaskExecute` actual 区间覆盖
**Then** 该天 `load_level = none`（灰）；不受 `daily_count==0` 短路影响（Grill X-001）

### FR-03: 未来侧剩余负载

覆盖决策：D-007@v1

**Given** 未完成 `plan_task`（`status != '已完成'`，`work_load='10d'`，计划 1\~20 号），今天 = 10 号，该任务已用 2 人天
**When** 计算 10\~20 号每天的负载
**Then** 每天 `load` 按 `剩余 8 人天 × 8 / 11 天 ≈ 5.8h` 分档（`_load_level_workload`）

**Given** 该未来天不在任务剩余天数区间 `[max(today,start), end]` 内
**Then** 该任务不对该天贡献

### FR-04: 已用 ≥ 计划总量 → 剩余 0

**Given** 未完成任务的已用工时 ≥ 计划总量
**Then** `剩余人天 = max(0, …) = 0`，该任务对未来天无负载贡献

### FR-05: 右点零回归

**Given** 任意数据
**Then** `alert_level` 计算逻辑（`_task_alert` + `daily_alert` + count 短路）与现状完全一致

### FR-06: actual 区间缺失兜底

覆盖决策：D-003@v1

**Given** `task_execute` 的 `actual_start_time` / `actual_end_time`
**Then** 双端有 → 平摊 `[start,end]`；仅一端 → 落该端点单日；都无 → 跳过

### FR-07: 未来侧兜底（无 work_load / 无 end_time）

覆盖决策：D-007 兜底，R-05/R-06

**Given** 未完成任务 `work_load` 为空 → 该任务无负载贡献
**Given** 未完成任务 `end_time` 为 None 或 `< today` → 无法定剩余天数，跳过（右点仍可预警）

### FR-08: 前端图例口径说明

**Then** `work-calendar-panel.tsx` 图例「左·负载」下增加一行：「过去按实际工时 · 今天及以后按剩余负载」；三态颜色映射不变

## 非功能需求

- **兼容性**：API 契约、`CalendarDay` 字段、前端 props 不变，前后端无需同步部署
- **可回退**：过去数据缺失 → `none`；未来 `work_load` 空 / 无 `end_time` → 该任务不贡献，退化为 `none`
- **可测试**：过去 / 未来剩余 / 已用扣减 / 跨月 / 兜底 / 右点回归各有单测
- **时区**：沿用现有 `get_calendar` UTC 口径，内部自洽

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 过去实际数据源 = `TaskExecute` |
| D-002@v1 | FR-01 | 实际侧按 `execute_user_id == me` 过滤 |
| D-003@v1 | FR-06 | actual 区间缺失三档兜底 |
| D-004@v1 | FR-01 | `time_spent × 8` 转小时、None→0 |
| D-005@v1 | FR-01 | 跨月平摊分母含全区间 |
| D-006@v1 | FR-01, FR-03 | UTC 口径、今天归未来侧 |
| D-007@v1 | FR-03, FR-04, FR-07 | 未来侧剩余负载算法 |
