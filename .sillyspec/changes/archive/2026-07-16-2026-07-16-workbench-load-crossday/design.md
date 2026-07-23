---
author: qinyi
created_at: 2026-07-16 10:41:26
revised_at: 2026-07-16 10:52:00
scale: large
---

# 设计文档（Design）— 工作台日历负载修正 + 实际执行流程重设计（禁止跨天）

> **Design Grill 修订（2026-07-16 10:52）**：修正 3 P0 + 5 P1（子代理交叉审查）：P0-1 problem 无 real_start_time 字段→actual 单点 now；P0-2 跨天校验从 ExecutePlanReq 死代码移到 service 内部读 exc.actual_start_time；P0-3 删 submit bool 不做反向兼容；P1-2 action 分支强制回填 actual_end_time=now；P1-1 补 work-calendar-panel.tsx 零改动声明；P1-3 补 test_router.py；P1-4 task 详情复用 /task-execute/page + problem 扩 problem_task_id 过滤；P1-5 删批量端点改前端循环。

## 1. 背景

### 1.1 起因（标黄 bug）
个人工作台 `/ppm/workbench` 的「工作日历」过去日期左点负载标黄错误。账号 180024（覃艺）2025-07 某天实际执行「1人天 + 0人天」本应饱和标绿，却标黄。

根因（已用本地 PG 真实数据验证）：`backend/app/modules/ppm/workbench/service.py` 的 `_spread_actual_hours`（service.py:110-147）把每条 `TaskExecute.time_spent` **按 actual 区间天数平均平摊**——跨多天的记录被稀释到当天不足 8h → 标黄。而详情 `execute_items`（service.py:663-672）按「区间覆盖该天」显示**原始整条** time_spent，两套口径打架。

本地 180024 数据印证：`07-11 23:53 ~ 07-21 21:09 (1人天)` 跨 11 天，平摊 0.73h/天 → 标黄。

### 1.2 前序变更
`2026-07-15-workbench-calendar-load-actual`（brainstorm 完成、代码已 commit、流程卡 plan 前）：其 design §5.3 平摊方案 = 当前 service.py 现状。本变更为**修正变更**：推翻过去侧平摊改求和，并扩展到完整执行流程重设计。

### 1.3 用户完整期望
- **task-plans**：未开始 → 启动(记 actual_start) → 进行中 → 执行弹窗填【耗时+说明】→ **完成**(→已完成+记结束) / **提交**(→重置未开始+记结束，多次填报)。每次一条单日执行记录。
- **跨天禁止**：起止同日；跨天前端拆多天每天单独填，后端拒绝跨天。
- **problem-list 处置**：逻辑同理（提交/完成）。
- **执行记录在列表详情可见**。
- **历史跨天数据**：不清理（规则11）。

### 1.4 现状 gap
- `ExecuteTaskDialog` 只填耗时+说明，**不填起止时间**；新录入 TaskExecute actual 区间为空（仅若依迁移数据有）。
- `task-plans/page.tsx`：单「执行」按钮 + submit checkbox，无启动/双按钮/拆分。
- `problem/service.py:580 done_task`：只追加 handle_info + 累加 time_spent，**不产生 TaskExecute**。
- **P1-2 关键**：当前 execute_plan（task/service.py:264-267）只在 `req.actual_end_time is not None` 才写结束时间，前端不传则永远空 → 即使改求和，新录入记录仍无 actual 区间 → 日历左侧仍不显示。本变更必须强制回填。

## 2. 设计目标

6 模块：① task 执行流程(启动/提交/完成，1:N) ② 跨天校验+前端拆分 ③ problem 处置镜像 ④ workbench 过去侧求和 ⑤ 执行记录详情可见 ⑥ 无表结构变更。

## 3. 非目标

- 不改 workbench **未来侧**负载（剩余负载平摊保留）。
- 不改右点 alert_level。
- 不清理历史跨天迁移数据。
- 不改 TaskExecute / PpmProblemList 表结构（字段已齐；P0-1 确认 PpmProblemList 仅 real_end_time，本变更不补 real_start_time，actual 用单点 now）。
- 不引入新抽象层。
- 不做批量 execute 端点（P1-5，前端循环单条）。

## 4. 拆分判断

大变更（前后端 ~12 文件、跨 task/problem/workbench 三子域、含状态机改造），按 CLAUDE.md 规则3走完整 SillySpec。按 Wave 拆分（§5）。

## 5. 总体方案

### 5.1 Wave 1 — 后端：执行状态机 + 跨天校验（task）

**删 `submit: bool`，改 `action` 枚举**（P0-3，不做反向兼容——规则11允许重置数据+前端测试同步改）：

- **POST `/api/ppm/task-plan/{id}/start`**（新增）：plan.status=="未开始"→"进行中"；创建 TaskExecute（`actual_start_time=now`, `status=STATUS_DOING(30)`, `execute_user_id=me`）；plan.actual_start_time 回填（若空）。**返回 task_execute_id**（前端后续 execute 要带）。
- **POST `/api/ppm/task-plan/{id}/execute`**（现有 execute_plan 改造）：`ExecutePlanReq` 删 `submit`，加 `action: Literal["submit","complete"]` + `task_execute_id`（必填，start 返回的 in-flight 记录）。
  - 公共：`exc = get(task_execute_id)`；**强制回填 `exc.actual_end_time = req.actual_end_time or now`**（P1-2 关键，让新录入有 actual 区间）；写 time_spent/execute_info。
  - `action="complete"`：`exc.status=STATUS_END(90)`；plan → 已完成；plan.actual_end_time 回填。
  - `action="submit"`：`exc.status=STATUS_END(90)`；plan → **重置"未开始"**（支持再次 start 多次填报）。
- 多次填报：每次 start 创建新 TaskExecute；submit/complete 收口当前条。1 plan : N TaskExecute。

**跨天校验**（P0-2 修正：service 内部，不依赖 schema validator）：
- `execute_plan` 内部：`exc` 已含 actual_start_time（start 写入），强制回填 actual_end_time 后，**`if exc.actual_start_time.date() != exc.actual_end_time.date(): raise TaskError(422, "执行起止时间不可跨天，请拆成每天单独填报")`**。
- start 端点不校验（只写 start，无 end）。
- `TaskExecuteCreate`/`TaskExecuteUpdate`（看板 `kanban/page.tsx` CRUD 路径）保留 model_validator（actual 双非空时同日），覆盖直连 CRUD。
- **跨天判定统一按 UTC date**（actual 存 UTC，P2-6）：本地凌晨（CST 00:30=UTC 前日 16:30）可能误判，接受（沿用现有 _to_aware UTC 口径，内部自洽）。

### 5.2 Wave 2 — task 前端：启动按钮 + 双按钮 + 跨天拆分

**`task-plans/page.tsx`**：行按钮按 status——未开始→「启动」(调 /start，存返回的 task_execute_id)；进行中→「执行」(开弹窗，带 task_execute_id)；已完成→「查看记录」。移除 submit checkbox。

**`ExecuteTaskDialog` 改造**：
- 表单：本次耗时 + 执行情况说明（起止时间后端记）。
- 双按钮：**提交**(action=submit) + **完成**(action=complete)。
- **跨天检测**：若 in-flight 记录的 actual_start_time 与 now 不同天 → 拆分 UI：按日期边界生成多行（每天：日期+耗时输入+说明输入，**留空用户单独填** D-用户确认）。
- **提交**：前端**循环单条调用 /start.../execute**（P1-5，YAGNI 批量端点）；每条构造单日 actual（start=当日0点或实际, end=当日或实际）；失败则提示已成功 N 条/失败 M 条，不自动回滚（R-03）。

### 5.3 Wave 3 — problem 处置镜像

**`problem/service.py:580 done_task` 改造**：在现有「追加 handle_info + 累加 time_spent + 状态推进」基础上，**额外创建一条 TaskExecute**：
- `problem_task_id=problem.id`, `execute_user_id=actor_id`, `actual_start_time=now`, `actual_end_time=now`（**P0-1 修正：单点当天，不取不存在的 real_start_time**）, `time_spent`, `execute_info=handle_info`, `status=90`。
- 单点当天 → 跨天校验天然不触发（start.date==end.date）。
- 完成(completed=true) → 待验证(6) + TaskExecute；提交(completed=false) → 保持处置中(3) + TaskExecute。
- 保留 handle_info 追加（兼容现有展示/日志）。

### 5.4 Wave 4 — workbench 过去侧负载求和（推翻平摊）

**`workbench/service.py`**：
- `_spread_actual_hours` → `_sum_actual_hours`：遍历 TaskExecute（execute_user_id=me），对 `_covers_date(actual_start, actual_end, day)` 且 `day < today` 的，`time_spent×8` **直接累加**（不除 span_days）。
- `_load_level_workload` 分档不变（<8 leisure / 8-10 full / >10 over）。
- 效果：1人天+0人天=8h → full（饱和标绿）。
- **P1-2 联动**：因 Wave 1 强制回填 actual_end_time + start 写 actual_start_time，新录入记录有 actual 区间 → `_covers_date` 返回 True → 日历正常显示（修复 P1-2 口径断裂）。
- 历史 migration 跨天数据：覆盖日全计入 → 虚高饱和（接受 R-01）。

### 5.5 Wave 5 — 执行记录详情可见

**后端**（P1-4 修正：复用 + 扩展，不重复造）：
- **task 侧**：复用现有 `GET /api/ppm/task-execute/page?plan_task_id={id}`（router.py:348，已支持按 plan_task_id 分页，返回 TaskExecuteResponse 含 actual/耗时/说明/status）。前端直接调。
- **problem 侧**：扩 `TaskExecutePageReq`（task/schema.py）加 `problem_task_id: uuid | None` 过滤 + service page 方法 + router query 参数（problem 详情调 /task-execute/page?problem_task_id={id}）。

**前端**：
- `task-plans` 详情/抽屉：表格列历次执行记录（开始/结束/耗时/说明/结果）。
- `problem-list` 详情：同构表格（结果=完成→待验证 / 提交→保持处置中）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/ppm/task/service.py | execute_plan 删 submit 改 action(submit/complete)+强制回填 actual_end_time+跨天校验(service内部)；新增 start 逻辑 |
| 修改 | backend/app/modules/ppm/task/schema.py | ExecutePlanReq 删 submit 加 action+task_execute_id(必填)；TaskExecuteCreate/Update 加跨天 model_validator；TaskExecutePageReq 加 problem_task_id 过滤(P1-4) |
| 修改 | backend/app/modules/ppm/task/router.py | 新增 POST /task-plan/{id}/start；execute 端点 action 适配；/task-execute/page 加 problem_task_id query |
| 修改 | backend/app/modules/ppm/problem/service.py | done_task 额外创建 TaskExecute(problem_task_id, actual单点now) |
| 修改 | backend/app/modules/ppm/problem/router.py | done 端点适配 |
| 修改 | backend/app/modules/ppm/workbench/service.py | _spread_actual_hours → _sum_actual_hours(过去侧求和) |
| 修改 | backend/app/modules/ppm/task/tests/test_task.py | **重写** execute_plan 用例：submit bool → action(P0-3)；+ start 端点 + 跨天拒绝 + 多次填报 1:N + 强制回填 actual_end |
| 新增 | backend/app/modules/ppm/task/tests/test_router.py | POST /start + /execute action + 跨天 422（router 层契约，记忆 backend-router-change-run-router-tests） |
| 修改 | backend/app/modules/ppm/problem/tests/test_problem_flow.py | done_task 创建 TaskExecute 断言 |
| 新增 | backend/app/modules/ppm/problem/tests/test_router.py | done 端点 + TaskExecute 落库（如 problem 侧有独立 router 测试需求） |
| 修改 | backend/app/modules/ppm/workbench/tests/test_workbench_service.py | 过去侧求和（覆盖日累加、跨天历史虚高、1人天饱和、**新录入有 actual 区间也显示**）+ 平摊用例改写 |
| 修改 | frontend/.../task-plans/page.tsx | 行按钮按状态(启动/执行/查看记录)；移除 submit checkbox；执行记录详情(调 /task-execute/page) |
| 修改 | frontend/.../_components/execute-task-dialog.tsx | 双按钮(提交/完成) + 跨天拆分 UI(每天单独填) + 循环单条提交 |
| 修改 | frontend/src/lib/ppm/plan.ts + types.ts | start/execute(action) API + 类型（删 submit） |
| 修改 | frontend/.../problem-list/page.tsx + _forms.tsx | 处置提交/完成 + 执行记录详情(调 /task-execute/page?problem_task_id) |
| **零改动** | frontend/.../workbench/_components/work-calendar-panel.tsx | **P1-1 声明**：load_level 颜色映射(none/leisure/full/over)不变，仅后端 daily_actual 求和值变；前端消费 load_level 字符串不变，无需改 |

## 7. 接口定义

### 7.1 task start（新增）
```
POST /api/ppm/task-plan/{id}/start
Body: { execute_user_id?: uuid }
→ 201 TaskExecuteResponse { id(task_execute_id), plan_task_id, actual_start_time, status:"30", execute_user_id }
前置: plan.status=="未开始"  后置: plan→进行中
```

### 7.2 task execute（改造，删 submit 改 action）
```
POST /api/ppm/task-plan/{id}/execute
Body ExecutePlanReq {
  plan_task_id: uuid,
  action: "submit" | "complete",     # 删 submit bool(P0-3)
  task_execute_id: uuid,              # 必填,start 返回的 in-flight 记录
  time_spent?: float, execute_info?: str,
  actual_end_time?: datetime          # 默认 now,service 强制回填(P1-2)
}
service 内部: exc.actual_end_time = req.actual_end_time or now(强制)
跨天校验(service): exc.actual_start_time.date() != exc.actual_end_time.date() → 422
submit   → exc.status=90 + plan→未开始
complete → exc.status=90 + plan→已完成
```

### 7.3 跨天校验位置（P0-2 修正）
- **execute_plan service 内部**（主路径）：读 exc.actual_start_time（start 写入）比 actual_end_time（强制回填），跨天抛 TaskError(422)。
- **TaskExecuteCreate/TaskExecuteUpdate model_validator**（看板 CRUD 路径）：actual 双非空时同日校验。
- **ExecutePlanReq 不加 validator**（无 actual_start_time 字段，加了是死代码）。
- **DoneTaskReq 不加 validator**（无 actual 字段，done_task service 内部构造单点 actual 后天然同日）。

```python
# TaskExecuteCreate/Update model_validator
@model_validator(mode="after")
def _no_crossday(self):
    if self.actual_start_time and self.actual_end_time \
       and self.actual_start_time.date() != self.actual_end_time.date():
        raise ValueError("执行起止时间不可跨天，请拆成每天单独填报")
    return self
```

### 7.4 workbench 负载求和
```python
def _sum_actual_hours(rows, year, month, today) -> dict[int, float]:
    import calendar as _cal
    days_in_month = _cal.monthrange(year, month)[1]
    daily = {}
    for ex in rows:
        for d in range(1, days_in_month + 1):
            day_date = date(year, month, d)
            if day_date < today and _covers_date(ex.actual_start_time, ex.actual_end_time, day_date):
                daily[d] = daily.get(d, 0.0) + float(ex.time_spent or 0.0) * 8.0
    return daily
```

### 7.5 problem done_task（改造）
```
POST /api/ppm/problem-list/{id}/done  (现有,不改路径)
Body DoneTaskReq { handle_info?, time_spent?, completed: bool }
行为增量(同事务): 创建 TaskExecute(problem_task_id=problem.id, execute_user_id=actor,
  actual_start_time=now, actual_end_time=now, time_spent, execute_info=handle_info, status=90)
P0-1: 不取 real_start_time(字段不存在),用单点 now(同日,跨天校验不触发)
```

### 7.6 执行记录查询（P1-4：复用+扩展）
```
task   复用: GET /api/ppm/task-execute/page?plan_task_id={id}        (现有 router.py:348)
problem 扩展: GET /api/ppm/task-execute/page?problem_task_id={id}    (TaskExecutePageReq 加字段)
→ TaskExecuteResponse[] (含 actual_start/end, time_spent, execute_info, status)
```

## 8. 数据模型

**无表结构变更、无 migration**（P0-1 确认后成立）：
- `TaskExecute`（ppm_task_execute）：actual_start_time/actual_end_time/time_spent/status/plan_task_id/problem_task_id/execute_user_id（model.py:128-193 齐全）。
- `PlanTask`：status/actual_start_time/actual_end_time。
- `PpmProblemList`：status(1-6)/real_end_time/handle_info/time_spent（**仅 real_end_time，无 real_start_time**；本变更 actual 用单点 now，不补字段）。

## 9. 兼容策略

- 未上线，允许数据重置（规则11），**无历史兼容负担**。
- **P0-3**：`ExecutePlanReq` 删 `submit` bool，改 `action` 枚举——**不做反向兼容**（submit 旧/新语义相反会埋坑）；前端 task-plans/ExecuteTaskDialog/lib + 后端 test_task.py 同步改。
- API 路径不变（execute 仍 POST /task-plan/{id}/execute，仅 body 字段变）；start 为新增端点。
- 右点 alert_level、未来侧剩余负载零改动。
- 历史 migration 跨天数据：求和后虚高饱和，接受（R-01）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 历史跨天数据求和后多日虚高饱和 | P2 | 用户确认接受（规则11）；仅新数据准确 |
| R-02 | problem 处置无独立启动，actual 用单点 now（不反映处置跨多天） | P2 | 单点当天语义合理（一次 done=一次处置）；多次处置=多条记录；不影响负载求和 |
| R-03 | 跨天拆分前端循环单条，部分成功部分失败 | P2 | 不自动回滚，提示已成功 N/失败 M 条；用户手动处理失败条 |
| R-04 | ~~action 兼容 submit bool 映射~~ | ~~P2~~ | **已消除**（P0-3 改为删 submit 不兼容） |
| R-05 | UTC 跨天判定本地凌晨误判 | P2 | 沿用 _to_aware UTC 口径，内部自洽；接受边界 case |
| R-06 | 多次填报产生大量 TaskExecute，详情列表性能 | P3 | 现有 /task-execute/page 已分页；YAGNI |
| R-07 | problem done_task 创建 TaskExecute 与 handle_info 追加双写一致性 | P2 | 同事务；execute_info=handle_info 同步 |

## 11. 决策追踪

- **D-001** 过去侧负载改求和 → §5.4（推翻 07-15 平摊）
- **D-002** task 执行：未开始→(start)→进行中→(execute.submit 回未开始 | execute.complete 转已完成)；1:N TaskExecute → §5.1
- **D-003** 删 submit bool 改 action 枚举，**不反向兼容**（P0-3） → §5.1、§9
- **D-004** 跨天校验在 execute_plan service 内部（读 exc.actual_start_time）+ TaskExecuteCreate/Update validator（看板路径）；ExecutePlanReq 不加（P0-2） → §5.1、§7.3
- **D-005** action 分支强制回填 actual_end_time=now（P1-2，让新录入有 actual 区间） → §5.1
- **D-006** 跨天前端拆分（每天单独填）+ 循环单条提交（P1-5，YAGNI 批量端点） → §5.2
- **D-007** problem done_task 创建 TaskExecute（actual 单点 now，P0-1 不取 real_start_time） → §5.3
- **D-008** 执行记录详情：task 复用 /task-execute/page；problem 扩 problem_task_id 过滤（P1-4） → §5.5
- **D-009** work-calendar-panel.tsx 零改动（load_level 映射不变，P1-1） → §6
- **D-010** 历史跨天数据不清理（规则11） → §3、R-01

无未解决决策。

## 12. 自审

- 需求覆盖：✅ 6 模块全覆盖；用户补充（执行记录可见、跨天每天单独填）已纳入。
- **Design Grill 修订**：✅ P0-1（real_start_time→单点 now）/ P0-2（跨天校验移 service 内部）/ P0-3（删 submit 不兼容）/ P1-1（work-calendar-panel 零改动）/ P1-2（强制回填 actual_end_time）/ P1-3（补 test_router.py + 重写 test_task）/ P1-4（复用 /task-execute/page + problem_task_id）/ P1-5（删批量端点）全部修正。
- Grill 覆盖：✅ D-001~D-010 全引用。
- 约束一致性：✅ ruff line-length=100 / pytest asyncio / 复用 _covers_date/_load_level_workload/_to_aware / 双层 commit hook / 改 router 必跑 test_router。
- 真实性：✅ 表名/字段/行号均来自真实代码（P0-1 已核实 PpmProblemList 仅 real_end_time；P0-2 已核实 execute_plan service.py:261 直构不经 schema）。
- YAGNI：✅ 不引新抽象、不改表、不批量端点、暂不分页。
- 验收可测：✅ start/submit/complete 状态机、跨天 422（router+service）、多次填报 1:N、强制回填 actual_end、过去侧求和（新录入也显示）、problem 创建 TaskExecute、详情列表（复用端点）。
- 非目标清晰：✅ §3。
- 兼容策略：✅ §9（删 submit 不兼容，规则11）。
- 风险识别：✅ R-01~R-07（R-04 已消除）。
- 生命周期契约表：N/A（任务/问题状态机，非 session/lease/agent_run/daemon/lifecycle/claim/heartbeat）。

自审通过（含 Design Grill 修订）。
