---
author: qinyi
created_at: 2026-07-30 10:30:00
scale: large
risk_level: contract-required
---

# 设计文档（Design）— ppm/kanban 人员工时热力网格

## 1. 背景

`/ppm/kanban` 看板的"人员工时统计"现状是**甘特图**：任务条横跨日期，工时按人聚合后显示在左侧行头（"工时 X 人天 + 饱和度进度条"），存在三个问题：

1. **看不到逐日明细**：只能看到一个人在整个 dateRange 内的工时总和，无法看出"哪天排满了、哪天过载、哪天闲着"。
2. **无人员×日期单元格**：代码里完全没有"每个(人,日)格子"的渲染，更谈不上按当日工时强度染色。
3. **两 tab 不一致**：计划tab 行头有饱和度条，实际tab 连饱和度条都没有。

用户诉求（原始）：参考个人工作台"工作日历"小点的逻辑，给看板加逐人逐日的工时单元格，按当日工时强度染色——计划tab 和实际tab 都要。

## 2. 设计目标

- 在计划tab（团队计划排程表）和实际tab（团队实际工作表）内，各新增一个**「工时热力」视图**：人员×日期网格，格内显示当日工时（人天）+ 按强度染色。
- 颜色规则采用**锚点偏离式**（基准 1 人天 = 8h）：`=1` 无色（达标）、`<1` 越少越绿（0=绿）、`>1` 越大越红→黑。
- 工时口径与工作台工作日历**同源**（后端统一计算），避免两个页面同一"当日工时"算出不同值。
- 保留现有甘特图，用视图切换并存，不破坏现有功能。

## 3. 非目标（Non-Goals）

- **不删除/改动现有甘特图**（kanban-gantt.tsx / kanban-actual-gantt.tsx 保持原样，仅加视图切换）。
- **不改任务条配色、行头饱和度条、右侧工时联动图**（kanban-work-hour-chart.tsx 不动）。
- **不做单元格点击下钻**（点格子看当日任务明细留待后续；本期纯展示）。
- **不引入工作日天数摊算**：剩余负载摊天沿用 workbench 的**日历日**口径，不跳周末（与工作日历一致，避免口径分叉）。
- **不做 displayMode 细分**：工时热力 actual 口径固定为"全部"（plan+problem 执行工时都计入；project 过滤时 problem 对齐现状被排除），不提供 全部/计划任务/问题任务 切换（现有甘特 actual tab 的 displayMode 仅作用于甘特视图，不带入热力网格）。
- **后端不维护节假日表**：周末/法定/调休判断由前端 `workday.ts` 单一数据源负责。

## 4. 拆分判断

单一功能（工时热力网格视图），可一次交付，不拆分。任务数 < 10，无"模板×数据"重复模式，不走批量模式。

## 5. 总体方案（方案A：后端新接口 + 前端独立网格组件）

```
┌─ 后端 (口径统一, 与工作日历同源) ────────────────────────────┐
│ GET /api/ppm/kanban/workload-grid?start_date&end_date       │
│     &project_id&user_ids                                    │
│   ├─ 人员: 复用 _query_visible_members (与甘特行一致)        │
│   ├─ plan_hours:  剩余负载摊天 (>=today, 日历日, 人天)       │
│   └─ actual_hours: time_spent 覆盖日求和(人天)              │
└──────────────────────────┬───────────────────────────────────┘
                           │ WorkloadGridResponse (JSON)
┌──────────────────────────▼───────────────────────────────────┐
│ 前端 (渲染 + 染色)                                            │
│ page.tsx: 计划/实际tab 各加 [甘特图|工时热力] Segmented 切换  │
│ KanbanWorkloadGrid: 人员×日期网格, mode=plan/actual          │
│   ├─ 工作日状态: workday.ts getDayStatus → 休息态灰底        │
│   └─ workloadCellColor(hours): 锚点偏离式 HSL 渐变           │
└───────────────────────────────────────────────────────────────┘
```

分两个 Wave：
- **Wave 1（后端）**：schema + service 聚合 + router 端点 + 后端测试 + `pnpm gen:types`。
- **Wave 2（前端）**：api client + 颜色 helper + 网格组件 + page 切换 + 前端测试。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/ppm/kanban/schema.py` | 新增 `WorkloadGridUserRow` / `WorkloadGridResponse` |
| 修改 | `backend/app/modules/ppm/kanban/service.py` | 新增 `get_workload_grid()` + `_spread_plan_person_days()` / `_sum_actual_person_days()` 内部聚合 |
| 修改 | `backend/app/modules/ppm/kanban/router.py` | 新增 `GET /kanban/workload-grid` 端点 |
| 新增 | `backend/app/modules/ppm/kanban/tests/test_kanban_workload_grid.py` | 聚合逻辑 + 端点测试 |
| 顺带修复 | `backend/app/modules/ppm/plan/tests/test_service.py` | 修复 ql-20260728-007「一项目一计划」唯一约束留的 2 个旧测试债（`test_list_plan_node_details_for_export_filters_by_plan` / `test_create_plan_fills_project_name_from_project` 改用独立 project 保留核心测试意图）。main 分支已证为预存债、与本变更无关；不修则 verify 跑 `pytest app/modules/ppm` 全量会撞此债阻断。属 CLAUDE.md 规则20「顺手补无关旧测试债」。 |
| 修改 | `frontend/src/lib/ppm/kanban.ts` | 新增 `fetchWorkloadGrid()` |
| 新增 | `frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-workload-helpers.ts` | `workloadCellColor()` 等纯函数 |
| 新增 | `frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-workload-helpers.test.ts` | 颜色映射单测 |
| 新增 | `frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-workload-grid.tsx` | 工时热力网格组件 |
| 修改 | `frontend/src/app/(dashboard)/ppm/kanban/page.tsx` | 计划/实际tab 加视图切换 + 热力取数渲染 |
| 修改 | `frontend/src/lib/api-types.ts` | `pnpm gen:types` 生成（禁手写） |
| 修改 | `backend/openapi.json` | `pnpm gen:types` 同步生成 |

## 7. 接口定义

### 7.1 后端 REST

```
GET /api/ppm/kanban/workload-grid
Query:
  start_date  str  必填  YYYY-MM-DD (dateRange 起)
  end_date    str  必填  YYYY-MM-DD (dateRange 止, 含当天)
  project_id  str  可选  项目过滤 (与甘特一致)
  user_ids    list[str] 可选 人员范围 (多次传参, 与甘特一致)
权限: Depends(get_current_principal) (与 kanban 其他端点一致)
```

### 7.2 响应 schema

```python
class WorkloadGridUserRow(BaseModel):
    user_id: uuid.UUID
    username: str | None                 # project_member 冗余名 (与 UserColumnVO.username 同源)
    plan_hours: dict[str, float]         # {YYYY-MM-DD: 人天} 剩余负载摊天; 缺省日期视为 0
    actual_hours: dict[str, float]       # {YYYY-MM-DD: 人天} time_spent 覆盖日求和; 缺省视为 0

class WorkloadGridResponse(BaseModel):
    start_date: str
    end_date: str
    days: list[str]                      # dateRange 内每日 YYYY-MM-DD (升序)
    users: list[WorkloadGridUserRow]
```

### 7.3 工时计算口径（后端，核心）

**人员集合**：`_query_visible_members(user_ids, project_id)`（复用现有，保证与甘特图人员行一致）。

**plan_hours（剩余负载摊天，面向未来）**——对齐 workbench `_spread_remaining_hours`，但单位直接用**人天**（`_parse_hours` 返回人天，不再 ×8）：
- 取该人**未完成** `PlanTask`（`status != "已完成"`，`project_id` 过滤，`end_time` 非空）。
- `spent_by_plan` = 按 `plan_task_id` 聚合 `SUM(TaskExecute.time_spent)`（全量，人天）。
- 每任务：`remaining = _parse_hours(work_load) - spent`；`remaining <= 0` 跳过；`end_time` 空跳过。
- 摊算区间 `[max(today, start_time), end_time]`；日均 `per_day = remaining / 日历日span`。
- 仅落到 `[start_date, end_date] ∩ [today, ∞)` 的日期累加。**过去日期（< today）无 plan_hours（=0）**。

**actual_hours（time_spent 覆盖日计入，面向过去，与 workbench `_sum_actual_hours` 同源）**：
- 取该人 `TaskExecute`（`execute_user_id`），`actual_start_time ∈ [start_date, end_date]`（按落点过滤记录本身）。
- 把每条记录的 `time_spent` **全额计入 `actual_start_time → actual_end_time` 覆盖的每个日历日**（∩ `[start_date, end_date]`）——与 workbench `_sum_actual_hours` 同一"覆盖日求和"口径（workbench/service.py:100-126）。跨天记录各覆盖日均计入全额 → 当日可能虚高（规则同 workbench，接受）。
- **含今天**：已发生的执行记录（含今天）都计入；未来日期无 execute 记录自然为 0。与 workbench 的差异仅在于"workbench 把今天归未来侧剩余负载、看板 actual tab 独立含今天"，**求和逻辑同源**。
- **project_id 过滤（Blocker 2 修复）**：`TaskExecute` **无 project_id 字段**，过滤时 `join PlanTask ON PlanTask.id = TaskExecute.plan_task_id WHERE PlanTask.project_id = ?`。**problem 执行（problem_task_id、无 plan_task_id）因此被排除**——与现有看板实际 tab `/task-execute/list-by-date-range-with-plan` 口径完全一致（task/service.py:507-511 注释"无 plan_task_id 的 problem 执行被排除,对齐源"）。
- **无 project_id 过滤时**：计入全部 TaskExecute（plan + problem），即 displayMode=全部 口径。
- **记录选取窗口**：按 `actual_start_time ∈ [start_date, end_date]` 选取记录（与现有看板端点 `list_by_date_range_with_plan` 一致）；workbench 侧为区间相交三档兜底（含 `actual_start` 在区间前的在途记录），**跨边界在途记录两页可能存边缘差异**——R-01 测试覆盖该边界。

**today 取值**：`datetime.now(UTC).date()`（与 workbench 一致）。

### 7.4 前端颜色映射（锚点偏离式）

`workloadCellColor(hours, rest): { bg, fg }`：
- `rest === true`（周末/法定假日，来自 `getDayStatus`）→ 灰底休息态，不染色。
- `h = round(hours, 1)`：
  - `h <= 0` → 绿（最闲）
  - `h === 1.0` → 无色/达标（`transparent`）
  - `0 < h < 1.0` → 绿(140°)→黄(45°) HSL 插值，`t = h`
  - `h > 1.0` → 浅红(0°,72%)→黑(0°,8%)，`t = min((h-1)/2, 1)`，≥3 人天趋黑；深底色文字转白

调休补班日（`getDayStatus.adjustedWork === true`）按正常工作日染色。

### 7.5 生命周期契约

本变更不涉及生命周期契约（lifecycle contract: N/A）——纯只读聚合查询 + 前端展示，无 session/lease/agent_run/daemon/状态流转。

## 8. 数据模型

无表结构变更。复用现有 `PlanTask`（work_load/start_time/end_time/status/user_id）、`TaskExecute`（time_spent/actual_start_time/execute_user_id）、`PpmProjectMember`（人员）。全部为只读聚合查询。

## 9. 兼容策略

- **纯增量**：新增 1 个后端端点 + 1 个前端组件 + 视图切换，不修改任何现有接口签名、表结构、甘特图逻辑。
- **未切换视图时行为不变**：默认仍为甘特图视图，切到"工时热力"才调新接口。
- **接口加性**：响应字段仅新增，无 breaking；`api-types.ts` 由 `pnpm gen:types` 重新生成。
- **回退路径**：出问题只需隐藏视图切换入口即可完全回退，无数据迁移。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 剩余负载摊天口径与 workbench 工作日历漂移，两页同值不同 | P1 | 直接复用/对齐 workbench 摊算逻辑；后端测试断言与 workbench 同口径用例 |
| R-02 | 计划tab 过去日期全为 0（剩余负载面向未来），用户误解为"过去没排活" | P2 | 网格 caption + 图例明确"计划=今天及未来剩余负载，实际=过去发生"；原型已提示 |
| R-03 | 大 dateRange（如整月）× 多人员，聚合慢 | P2 | 聚合在 SQL/内存按记录摊到覆盖日（O(Σ覆盖天数) 非 O(日×任务)）；建议 dateRange 限制 ≤ 62 天 |
| R-04 | 跨天执行记录 time_spent 覆盖日全计入，当日工时虚高 | P2 | 与 workbench `_sum_actual_hours` 覆盖日口径一致（规则11 用户已确认接受），两页同源；不另做平摊 |
| R-05 | 颜色在色弱/低饱和屏幕下难分辨 | P3 | 格内始终显示工时数字，颜色仅作辅助；深底配白字保证对比度 |
| R-06 | 前端类型落后于后端（手写 api-types） | P1 | 严格遵守 CLAUDE.md 规则20：同 change 内跑 `pnpm gen:types`，提交 api-types.ts + openapi.json |
| R-07 | 工时浮点（0.99 vs 1.0）致"达标无色"闪烁 | P3 | `round(hours,1)` 后判断 `=== 1.0`，整齐值（0.5/1.0/1.5/2.0）稳定命中 |
| R-08 | project 过滤时 problem 执行工时（无 plan_task_id）被排除，与"全部"口径不一致 | P2 | 对齐现有看板实际 tab / 源系统口径（task/service.py:507-511），非回归；图例注明 |

## 11. 决策追踪

| 决策 | 内容 | 来源 |
|---|---|---|
| D-01 | 视图形态 = 可切换（保留甘特，加[甘特/工时热力]切换） | AskUserQuestion 确认 |
| D-02 | 颜色规则 = 锚点偏离式（=1无色/<1绿→黄/>1红→黑） | AskUserQuestion 确认 |
| D-03 | 计划工时口径 = 剩余负载摊天（与工作日历同源） | AskUserQuestion 确认 |
| D-04 | 基准 = 1人天=8h 结合工作日历（周末/法定灰底，调休正常） | AskUserQuestion 确认 |
| D-05 | 实现方案 = 方案A（后端新接口统一口径，前端网格+HSL渐变）；否决B(返回等级字符串做不出连续渐变+按月取数+权限口径不匹配)、C(前端摊天口径漂移) | AskUserQuestion 确认 |
| D-06 | 工作日状态由前端 workday.ts 判断（单一数据源），后端不重复维护节假日表 | 代码调研（workday.ts 注释"kanban 甘特复用以保持单一数据源"） |

## 12. 自审（Self-Review）

- **完整性**：覆盖背景/目标/非目标/方案/文件清单/接口/兼容/风险/决策，四件套之本件。
- **生命周期**：§7.5 已豁免（纯只读聚合，无状态流转）。
- **口径一致性**：plan/actual 口径均锚定 workbench 同源函数（plan=剩余负载摊天、actual=覆盖日求和），R-01 测试兜底覆盖两侧；actual 的 project 过滤 join PlanTask、problem 排除对齐现有看板实际 tab（已修复 Design Grill Blocker 1/2）。
- **可落地性**：文件路径、schema、端点、前端组件均已对照现有代码确认（人员口径复用 `_query_visible_members`，测试布局复用 `kanban/tests/` 与 `_components/*.test.ts`）。
- **规则符合**：遵循 CLAUDE.md 规则19（前端样式参考设计系统）、规则20（api-types 生成不手写）、规则13（跨平台）。
- **遗留确认**：today 的时区处理在实现时对齐 workbench；dateRange 上限在实现时按 R-03 收口。
