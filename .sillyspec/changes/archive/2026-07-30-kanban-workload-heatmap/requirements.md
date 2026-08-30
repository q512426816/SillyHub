---
author: qinyi
created_at: 2026-07-30 15:50:00
---

# 需求规格（Requirements）— ppm/kanban 人员工时热力网格

## 功能需求

### FR-01 视图切换
计划tab（团队计划排程表）与实际tab（团队实际工作表）各提供「甘特图 / 工时热力」两个视图切换（Segmented）。默认甘特图。切换到「工时热力」时渲染人员×日期工时网格，切回甘特图功能完全不受影响。

### FR-02 工时聚合接口
新增 `GET /api/ppm/kanban/workload-grid`，参数 `start_date`/`end_date`（必填）、`project_id`/`user_ids`（可选）。返回逐人逐日的 `plan_hours` 与 `actual_hours`（单位人天）+ dateRange 每日列表 + 人员列表。人员集合复用 `_query_visible_members`，与甘特图人员行一致。

### FR-03 计划工时口径（剩余负载摊天）
`plan_hours` = 该人未完成 PlanTask 的 `(计划工时 − 已用工时) / 剩余日历天数`，摊到 `[max(today, start), end] ∩ [start_date, end_date] ∩ [today, ∞)` 的每日。计划工时 = `_parse_hours(work_load)`（人天），已用 = 按 `plan_task_id` 聚合 `SUM(TaskExecute.time_spent)`。过去日期（< today）无 plan_hours（=0）。

### FR-04 实际工时口径（覆盖日求和）
`actual_hours` = 该人 TaskExecute 的 `time_spent` 全额计入 `actual_start_time → actual_end_time` 覆盖的每个日历日（∩ dateRange），与 workbench `_sum_actual_hours` 同源。含今天，未来无记录自然为 0。记录选取按 `actual_start_time ∈ [start_date, end_date]`。`project_id` 过滤时 join PlanTask（problem 执行因无 plan_task_id 被排除，对齐现有看板实际 tab）；无 project 过滤时计入全部（plan+problem）。

### FR-05 人员×日期网格展示
`KanbanWorkloadGrid` 组件：行=人员（与甘特一致），列=dateRange 每日，格内显示当日工时数字（人天，1 位小数，0 显示为占位）。`mode=plan` 取 plan_hours，`mode=actual` 取 actual_hours。

### FR-06 锚点偏离式染色
`workloadCellColor(hours, rest)`：
- `rest=true`（周末/法定假日，来自 `getDayStatus`）→ 灰底休息态，不染色。
- `h = round(hours,1)`：`h<=0` 纯绿；`h===1.0` 无色（达标）；`0<h<1` 绿(140°)→黄(45°) HSL 插值 `t=h`；`h>1` 浅红(0°,72%)→黑(0°,8%) `t=min((h-1)/2,1)`，深底文字转白。
- 调休补班日（`adjustedWork=true`）按正常工作日染色。

### FR-07 工作日状态判断
工作日/周末/法定假日/调休补班由前端 `workday.ts` 的 `getDayStatus` 判断（单一数据源），后端不重复维护节假日表。

## 非功能需求

### NFR-01 性能
聚合按记录摊到覆盖日（O(Σ覆盖天数)，非 O(日×任务)）。建议 dateRange ≤ 62 天（实现时收口）。

### NFR-02 兼容性
纯增量：不改任何现有接口签名、表结构、甘特图逻辑。未切换视图时行为不变。响应字段仅新增，无 breaking。

### NFR-03 类型安全
前端接口类型 `frontend/src/lib/api-types.ts` 必须由 `pnpm gen:types` 从后端 OpenAPI 生成，禁止手写（CLAUDE.md 规则20）；同 change 内提交 `api-types.ts` + `backend/openapi.json`。

### NFR-04 可读性
格内始终显示工时数字，颜色仅作辅助；深底色单元格文字转白保证对比度。

## 验收标准映射

| 需求 | 验收 |
|---|---|
| FR-01 | 两 tab 可切换，甘特不受影响 |
| FR-02/03/04 | 后端聚合测试（plan 摊天、actual 覆盖日、project 过滤、problem 排除、人员口径） |
| FR-05 | 网格渲染人员×日期×工时数字 |
| FR-06/07 | 颜色映射单测（0/<1/=1/>1/≥3/休息态/调休） |
| NFR-03 | `pnpm gen:types` 产物提交，类型不手写 |
