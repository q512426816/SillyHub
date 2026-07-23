---
author: qinyi
created_at: 2026-07-16 00:21:38
scale: large
---

# 设计文档（Design）— 工作台日历左点负载：过去实际 / 未来剩余

## 1. 背景

个人工作台 `/ppm/workbench` 的「工作日历」（`WorkCalendarPanel`）每日双圆点：

- 左点 = 负载（`load_level`：饱和 / 有空余 / 过载）
- 右点 = 进度（`alert_level`：正常 / 临期 / 延期）

现状 `backend/app/modules/ppm/workbench/service.py` 的 `get_calendar()`（service.py:329-400）两个点**都只查 `PlanTask`**：

- 左点 `load_level`：`_parse_workload_hours(plan_task.work_load)` 累加 + `_load_level_workload` 分档（service.py:377）
- 右点 `alert_level`：`_task_alert(plan_task)`（service.py:378）

问题：左点整月都按「计划工时」算，过去的日子也按计划显示、不能反映「实际干了多少」；未来的日子简单按计划平摊、不能反映「扣掉已用后还剩多少压力」。

用户要求（v2 最终）：左点负载以「今天」分界——过去看实际工时（做完才知道真实工时），今天及以后看「剩余负载」(计划总量 − 已用) ÷ 剩余天数；右点单纯按计划（现状满足，不动）。

## 2. 设计目标

- 左点 `load_level` 改为以「今天」分界（今天归未来侧）：
  - **过去（day < today）**：实际工时 `TaskExecute.time_spent` 平摊到 actual 区间每一天 ×8h 分档（D-001~005）
  - **今天及未来（day ≥ today）**：**剩余负载** = (计划总工时 − 已实际使用工时) ÷ 剩余天数 ×8h 分档（D-007，用户 v2 确认）
- 右点 `alert_level` 零改动，维持纯计划 `_task_alert`
- 复用现有 helper（`_load_level_workload` / `_to_aware` / `_parse_workload_hours` / `_task_alert`），新增 2 个平摊 helper
- 前端仅图例加一行口径说明，三态颜色映射不变

## 3. 非目标

- 不改 `CalendarDay` schema / API 契约 / 前端组件结构
- 不改右点 `alert_level` 任何逻辑
- 不改数据库 / 无 migration
- 不引入新抽象类（不走方案 B `LoadCalculator`，YAGNI）
- 不改前端分档计算（不走方案 C，后端聚合架构不变）
- 未来侧不再恢复「计划工时简单平摊」（已被 D-007 取代）

## 4. 拆分判断

单一模块（`workbench.get_calendar`）内改动，无多角色 / 跨页面状态流转。用户选定走 quick 流程（见 §13）；任务粒度在 quick execute 阶段按本 design 直接实现，无独立 plan 文件。

## 5. 总体方案（方案 A：`get_calendar` 内扩展）

### 5.1 数据流

保留现有当月 `plan_task` 查询（供 `daily_count` 与右点 `alert`，零改动）。新增两类查询：过去实际 `task_execute`、未来未完成 `plan_task`（剩余负载）。每日 `load` 按过去 / 未来分别取实际 / 剩余小时：

```python
today = now(UTC).date()
for day in 当月每日:
    count = daily_count.get(day, 0)
    # 左点 load：不受 count==0 短路（过去可能仅有实际执行、无计划落点；见 Grill X-001）
    if day_日期 < today:
        load = _load_level_workload(daily_actual_hours.get(day, 0.0))     # 过去看实际
    else:  # day ≥ today
        load = _load_level_workload(daily_remaining_hours.get(day, 0.0))  # 未来看剩余负载
    # 右点 alert：保持现状(count==0→none,否则取最严重),零改动
    alert = "none" if count == 0 else daily_alert.get(day, "normal")
```

> 跨月自动收敛：看过去月（整月 < today）→ 全走实际侧；看未来月（整月 ≥ today）→ 全走剩余侧；看当月 → 按天分界。`day_日期 < today` 的 date 比较天然处理。

### 5.2 未来侧 — 剩余负载（新增 `_spread_remaining_hours`，D-007）

查未完成 `plan_task`（`user_id == me`、`status != '已完成'`、计划区间与当月未来相交：`start_time <= month_end` 且 `(end_time >= today 或 end_time IS NULL)`）。对每个：

1. 计划总量小时 = `_parse_workload_hours(work_load)`；work_load 空 → 0，该任务无负载贡献，跳过
2. 已用人天 = `sum(其 task_execute.time_spent)`（一次性按 `plan_task_id IN (...)` 聚合）
3. 剩余人天 = `max(0, 计划总量小时/8 − 已用人天)`
4. 剩余天数区间 = `[max(today, start_date), end_date]`：
   - `end_date` 为 None 或 `< today` → 无法定剩余天数 → 兜底跳过（R-05）
   - 否则剩余天数 = `(end_date − max(today, start_date)).days + 1`
5. 日均小时 = `剩余人天 × 8 / 剩余天数`；对该区间内、落在当月且 `≥ today` 的每个日历日，累加到 `daily_remaining_hours[day]`

> 用户原例验证：计划 10 人天（1\~20 号）、今天 10 号、已用 2 → 剩余 8 人天 ÷ (20−10+1)=11 天 = 8/11 人天/天 ≈ 5.8h/天 ✓

### 5.3 过去侧 — 实际平摊（新增 `_spread_actual_hours`，D-001~005）

查 `TaskExecute`（`execute_user_id == me`、actual 区间与当月过去相交）。对每条：

1. `_to_aware` 解析 `actual_start_time` / `actual_end_time`
2. 区间判定三档（D-003）：双端有 → `[start,end]`；仅一端 → 单日；都无 → 跳过
3. 区间天数 = `(end − start).days + 1`；日均小时 = `(time_spent or 0) × 8 / 区间天数`（D-004）
4. 遍历区间每个日历日 `d`：若 `d` 落在当月 且 `d < today`，累加日均到 `daily_actual_hours[d.day]`（D-005 跨月分母含全区间）

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/ppm/workbench/service.py | `get_calendar()` 左点按今天分界；新增 `_spread_actual_hours`（过去）+ `_spread_remaining_hours`（未来剩余）+ 两类查询（task_execute / 未完成 plan_task + 已用聚合） |
| 修改 | backend/app/modules/ppm/workbench/tests/test_workbench_service.py | 过去实际 / 未来剩余 / 已用扣减 / 剩余天数 / 跨月 / actual 缺失 / 无 end 兜底 / 今天落未来侧 / 右点回归保护 |
| 修改 | frontend/src/app/(dashboard)/ppm/workbench/_components/work-calendar-panel.tsx | 图例「左·负载」下加一行口径说明：「过去按实际工时 · 今天及以后按剩余负载」 |

## 7. 接口定义

### 新增 helper（module-private）

```python
def _spread_actual_hours(
    rows: list[TaskExecute], year: int, month: int, today: date,
) -> dict[int, float]:
    """过去侧：把 TaskExecute 实际工时平摊到 actual 区间内、落在 (year,month) 且 < today 的日历日。"""

def _spread_remaining_hours(
    plan_tasks: list[PlanTask],
    spent_by_plan: dict[uuid.UUID, float],  # plan_task_id -> 已用人天
    year: int, month: int, today: date,
) -> dict[int, float]:
    """未来侧：未完成任务的剩余负载(计划总量-已用)/剩余天数 摊到当月 ≥ today 的日历日。"""
```

### `get_calendar` 内部数据结构（不变对外）

- 新增 `daily_actual_hours` / `daily_remaining_hours: dict[int, float]`
- `daily_workload`（计划简单累加）**不再用于 load**（被剩余负载取代），右点 `daily_alert` 不变
- `load_level` 取值按过去 / 未来分支

### 对外 API / DTO（不变）

`GET /api/ppm/workbench/calendar?year_month=YYYY-MM` → `WorkbenchCalendar`，`CalendarDay.load_level` 仍是 `none|leisure|full|over` 字符串，`alert_level` 不变。

## 8. 数据模型

无变更。复用 `PlanTask`（`ppm_plan_task`）、`TaskExecute`（`ppm_task_execute`）现有表与字段：

- `PlanTask.work_load`（计划工时字符串）、`PlanTask.status`、`PlanTask.start_time`/`end_time`
- `TaskExecute.time_spent`（Numeric 人天，model.py:152）、`actual_start_time`/`actual_end_time`（model.py:156-161）、`execute_user_id`（model.py:166）、`plan_task_id`（model.py:146）

## 9. 兼容策略（brownfield）

- 未上线项目，允许数据重置（CLAUDE.md 规则 11），无历史兼容负担
- API 契约、`CalendarDay` 字段、前端组件 props 全部不变 → 前后端无需同步部署
- 右点 `alert_level` 逻辑零改动 → 现有右点行为完全保留
- 回退路径：过去日期实际数据缺失 → `none`（灰）；未来侧 `work_load` 空 / 无 `end_time` → 该任务不贡献，退化为 `none`

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 历史实际数据若误写 `PlanTask.actual_*` 而非 `TaskExecute`，过去负载全灰 | P2 | 团队实际工作表已验证 `TaskExecute` 有数据；verify 抽查 |
| R-02 | `time_spent` 为 None（进行中未填）→ 过去日 0、未来剩余不减 | P2 | `(time_spent or 0)` 兜底；语义正确，图例引导填工时 |
| R-03 | 跨月 actual 区间分母含非当月天，日均值偏低 | P2 | 符合用户确认的「平摊到实际干活每一天」 |
| R-04 | UTC vs 本地日期边界（凌晨跨天）今天判定偏差 | P2 | 沿用现有 UTC 口径（service.py:352-353），内部自洽 |
| R-05 | 未完成任务 `end_time` 为 None 或已过期（< today）→ 无法定剩余天数，该任务未来负载漏显 | P2 | 兜底跳过（不贡献）；这些任务右点 `_task_alert` 仍标临期/延期，用户仍能从右点察觉 |
| R-06 | `work_load` 为 None 的未完成任务无负载贡献 | P2 | 跳过；语义合理（无计划工时=无负载基线） |

## 11. 决策追踪

D-001@v1 ~ D-007@v1 全部被本设计覆盖（详见 decisions.md）：

- D-001@v1（数据源 TaskExecute）→ §5.3、§8
- D-002@v1（execute_user_id=me）→ §5.3
- D-003@v1（actual 缺失三档兜底）→ §5.3 步骤 2
- D-004@v1（time_spent×8、None→0）→ §5.3 步骤 3
- D-005@v1（跨月只摊当月过去天）→ §5.3 步骤 4
- D-006@v1（UTC 口径、today 归未来）→ §5.1、R-04
- D-007@v1（未来侧剩余负载：计划总量−已用 / 剩余天数）→ §5.2

无未解决决策。

## 12. 自审

- 需求覆盖：✅ 过去实际平摊 / 未来剩余负载 / 右点不动 / 今天归未来 / 过去无实际=灰，全部覆盖（v2）
- Grill 覆盖：✅ D-001~D-007 全部引用；X-001（count 短路）已修正（§5.1）
- 约束一致性：✅ 后端聚合架构、ruff/mypy/pytest 约定、复用现有 helper
- 真实性：✅ 表名 / 字段名 / 行号均来自真实代码（service.py / model.py / kanban page.tsx）
- YAGNI：✅ 不引入新抽象，不改前端结构
- 验收标准：✅ 可测试（过去 / 未来剩余 / 已用扣减 / 跨月 / 兜底各有用例）
- 非目标清晰：✅ §3 明确
- 兼容策略：✅ §9
- 风险识别：✅ R-01~R-06
- 生命周期契约表：N/A（不涉及 session / lease / agent_run / daemon / lifecycle / claim / heartbeat）

自审通过。

## 13. 增量需求（2026-07-16）：右点进度重写 + 点击详情三类

### 背景
用户反馈右点（进度）显示不对：原 `_task_alert` 按 `plan_task.start_time` 落点取最严重，过期任务的延期标在开始日而非截止日；且点击日历某天只显示计划任务，缺缺陷 + 实际。

### 13.1 右点 alert_level 重写（D-008）
原 alert 逻辑作废。新规则看**计划任务 + 缺陷任务**两类，按区间覆盖该天，取最严重（红 > 黄 > 绿 > none）：

- 过去日期（day < today）：有任务/缺陷覆盖 → 绿；若该天 == 某「延期」任务的截止日 → 红
- 今天（day == today）：有覆盖且「临期」→ 黄；否则有覆盖 → 绿
- 未来日期（day > today）：有覆盖 → 绿
- 无覆盖 → none

判定：
- **延期**：计划任务 `end_time < today` 且 `status != '已完成'`；缺陷 `plan_end_time < today` 且 `status != '4'`（已关闭）
- **临期**：`(计划总量 − 已用) / 剩余天数 > 8h/天`（做不完）。计划任务已用 = `sum(其 task_execute.time_spent)`；缺陷已用 = `time_spent`。剩余天数 = today\~end 含今天
- **覆盖**：计划任务 `[start_time, end_time]` 含 day；缺陷 `[plan_start_time, plan_end_time]` 含 day
- **人员过滤**：计划任务 `user_id == me`；缺陷 `duty_user_id == me`

### 13.2 点击详情三类（D-009）
`CalendarDay` 扩展三个摘要列表字段（每日返回）：

- `plan_items`：计划任务（区间覆盖该天）`[{id, content, project_name, status, start_time, end_time}]`
- `problem_items`：缺陷（区间覆盖）`[{id, pro_desc, project_name, status}]`
- `execute_items`：实际（actual 覆盖该天，**所有**记录不限 status）`[{id, content, status, time_spent}]`

前端 `WorkCalendarPanel` 点击某天渲染这三类（现状只 plan 按 start_time 落点）。

### 13.3 文件变更（增量）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/ppm/workbench/service.py | `get_calendar` 右点重写 + 每日 plan_items/problem_items/execute_items 装配 |
| 修改 | backend/app/modules/ppm/workbench/schema.py | `CalendarDay` 加 3 个列表字段（DTO） |
| 修改 | backend/app/modules/ppm/workbench/tests/test_workbench_service.py | 右点（延期红截止日/临期黄今天/过去绿/未来绿/缺陷参与）+ 详情三类 |
| 修改 | frontend/.../work-calendar-panel.tsx | 点击详情渲染三类 |

### 13.4 非目标（增量）
- 不改左点 `load_level`（上次已改）
- 不改 API 路径（仍是 `GET /workbench/calendar`，响应扩展字段，前端旧逻辑兼容新字段）
