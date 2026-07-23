---
author: qinyi
created_at: 2026-07-16 11:05:00
plan_level: heavy
---

# 实现计划（Plan）— 工作台日历负载修正 + 实际执行流程重设计

## 概述

5 Wave / 13 task，依据 `design.md`（D-001~D-010）+ `tasks.md`。前后端 ~12 文件，跨 task/problem/workbench 三子域。

## 依赖图

```
W1(后端task状态机+跨天) ──→ W2(task前端) ──┐
        │                                 ├──→ W5(详情整合+端到端)
        └──→ W4(workbench求和,依赖W1的actual强制回填)
W3(problem镜像) ──────────────────────────┘
```

- W1 基础（无依赖）
- W2 依赖 W1（前端用 action/start 契约）
- W3 独立（problem 链路）
- W4 依赖 W1 的 D-005 强制回填 actual_end_time（新录入有 actual 才能求和显示）
- W5 依赖 W1~W4

---

## Wave 1 — 后端 task 状态机 + 跨天校验

### - [ ] task-01: task/schema.py 改造
- **目标**：ExecutePlanReq 删 submit 加 action；TaskExecuteCreate/Update 加跨天 validator；TaskExecutePageReq 加 problem_task_id 过滤。
- **文件**：`backend/app/modules/ppm/task/schema.py`
- **steps**：
  1. ExecutePlanReq：删 `submit: bool`，加 `action: Literal["submit","complete"]` + `task_execute_id: uuid`（必填）
  2. TaskExecuteCreate / TaskExecuteUpdate 加 `@model_validator(mode="after")`：actual_start_time 与 actual_end_time 均非空时 `.date()` 必须相等，否则 ValueError（D-004）
  3. TaskExecutePageReq 加 `problem_task_id: uuid | None = None`
- **依赖**：无
- **验收**：ruff + mypy 绿；validator 单测（跨天拒、同日过、单端过）

### - [ ] task-02: task/service.py execute_plan + start
- **目标**：execute_plan 改 action 分支 + 强制回填 actual_end + service 内跨天校验；新增 start。
- **文件**：`backend/app/modules/ppm/task/service.py`
- **steps**：
  1. 新增 `async def start(self, plan_task_id, execute_user_id)`：plan 未开始→进行中；创建 TaskExecute(actual_start_time=now, status=STATUS_DOING, execute_user_id)；plan.actual_start_time 回填（若空）；返回 TaskExecute
  2. execute_plan 改：读 `req.action`（替代 submit）；`exc = get(req.task_execute_id)`；**强制 `exc.actual_end_time = req.actual_end_time or now`**（D-005）；写 time_spent/execute_info
  3. service 内跨天校验（D-004）：`if exc.actual_start_time and exc.actual_start_time.date() != exc.actual_end_time.date(): raise TaskError(422)`
  4. action=complete：exc.status=STATUS_END(90) + plan→已完成 + plan.actual_end_time 回填；action=submit：exc.status=90 + plan→未开始
- **依赖**：task-01
- **验收**：start/submit/complete 状态机正确；跨天抛 422；actual_end 强制回填（前端不传也写 now）

### - [ ] task-03: task/router.py 端点
- **目标**：新增 POST /start；execute 适配 action；/task-execute/page 加 problem_task_id。
- **文件**：`backend/app/modules/ppm/task/router.py`
- **steps**：
  1. 新增 `POST /api/ppm/task-plan/{id}/start`（body: execute_user_id 可选，默认当前用户）→ 调 service.start → 201 TaskExecuteResponse
  2. execute_plan_task 端点：ExecutePlanReq 适配 action（删 submit）
  3. task-execute/page 端点 query 加 problem_task_id
- **依赖**：task-02
- **验收**：test_router 覆盖（记忆 backend-router-change-run-router-tests）

### - [ ] task-04: task 测试
- **目标**：重写 execute_plan 用例（submit→action）+ 新建 test_router.py。
- **文件**：`backend/app/modules/ppm/task/tests/test_task.py`（改）、`backend/app/modules/ppm/task/tests/test_router.py`（新）
- **steps**：
  1. test_task.py：现有 execute_plan 用例 submit bool → action；加 start 单测、多次填报 1:N、强制回填 actual_end、跨天 TaskError
  2. 新建 test_router.py：POST /start（201+返回 task_execute_id）、/execute action=submit/complete、跨天 422、/task-execute/page?problem_task_id
- **依赖**：task-03
- **验收**：`cd backend && uv run pytest app/modules/ppm/task -q` 全绿

---

## Wave 2 — task 前端

### - [ ] task-05: ExecuteTaskDialog 改造
- **目标**：双按钮（提交/完成）+ 跨天拆分 UI + 循环单条提交。
- **文件**：`frontend/src/app/(dashboard)/ppm/_components/execute-task-dialog.tsx`
- **steps**：
  1. 移除 submit checkbox；加「提交」「完成」双按钮
  2. 跨天检测：若 in-flight actual_start_time 与 now 不同天 → 渲染多行（每天：日期标签 + 耗时输入 + 说明输入，留空 D-006）
  3. 提交：循环单条调 start...execute（每条单日 actual）；失败提示「成功 N/失败 M」不自动回滚（R-03）
- **依赖**：task-07（API 类型）
- **验收**：vitest 组件测试（双按钮渲染、跨天拆分行数、提交循环）

### - [ ] task-06: task-plans/page.tsx
- **目标**：行按钮按状态 + 移除 submit checkbox + 执行记录详情区。
- **文件**：`frontend/src/app/(dashboard)/ppm/task-plans/page.tsx`
- **steps**：
  1. 行按钮：未开始→「启动」(调 start，存 task_execute_id)；进行中→「执行」(开弹窗带 id)；已完成→「查看记录」
  2. 移除 submit checkbox 相关
  3. 执行记录详情区：调 `GET /task-execute/page?plan_task_id`，表格列（开始/结束/耗时/说明/结果）
- **依赖**：task-05、task-07
- **验收**：vitest（按钮按状态显隐、详情列表渲染）

### - [ ] task-07: lib/ppm/plan.ts + types.ts
- **目标**：start/execute(action) API + 类型（删 submit）。
- **文件**：`frontend/src/lib/ppm/plan.ts`、`frontend/src/lib/ppm/types.ts`
- **steps**：
  1. 加 `startTask(plan_id)` → POST /start
  2. executePlanTask 改 body：删 submit，加 action + task_execute_id
  3. types 对齐（ExecutePlanReq 删 submit 加 action）
- **依赖**：task-03（后端契约）
- **验收**：tsc 绿

---

## Wave 3 — problem 处置镜像

### - [ ] task-08: problem/service.py done_task
- **目标**：done_task 额外创建 TaskExecute（actual 单点 now）。
- **文件**：`backend/app/modules/ppm/problem/service.py`
- **steps**：
  1. done_task 在现有「追加 handle_info + 累加 time_spent + 状态推进」后，同事务创建 TaskExecute(problem_task_id=problem.id, execute_user_id=actor_id, actual_start_time=now, actual_end_time=now, time_spent, execute_info=handle_info, status=90)（D-007）
  2. 保留 handle_info 追加 + _replace_list_task + _write_list_log 不变
- **依赖**：task-01（TaskExchange model 已有 problem_task_id 字段，无需 schema 改）
- **验收**：done_task 后 DB 有对应 TaskExecute（problem_task_id 匹配）

### - [ ] task-09: problem 测试
- **目标**：done_task 创建 TaskExecute 断言 + router 测试。
- **文件**：`backend/app/modules/ppm/problem/tests/test_problem_flow.py`（改）、`backend/app/modules/ppm/problem/tests/test_router.py`（新/补）
- **steps**：
  1. test_problem_flow.py：done_task（completed=true/false）后断言 TaskExecute 创建（problem_task_id + actual 单点 + time_spent + execute_info）
  2. problem/tests/test_router.py：POST /done 端点落库 TaskExecute
- **依赖**：task-08
- **验收**：`cd backend && uv run pytest app/modules/ppm/problem -q` 全绿

### - [ ] task-10: problem-list 前端
- **目标**：处置提交/完成 + 执行记录详情。
- **文件**：`frontend/src/app/(dashboard)/ppm/problem-list/page.tsx`、`_forms.tsx`
- **steps**：
  1. 处置交互：提交（completed=false）/ 完成（completed=true）按钮
  2. 执行记录详情：调 `GET /task-execute/page?problem_task_id`，表格（同 task，结果映射完成→待验证 / 提交→处置中）
- **依赖**：task-08（后端 done_task 创建 TaskExecute）、task-03（problem_task_id query）
- **验收**：vitest

---

## Wave 4 — workbench 负载求和

### - [ ] task-11: workbench/service.py + 测试
- **目标**：过去侧平摊 → 求和。
- **文件**：`backend/app/modules/ppm/workbench/service.py`、`backend/app/modules/ppm/workbench/tests/test_workbench_service.py`
- **steps**：
  1. `_spread_actual_hours` → `_sum_actual_hours`：遍历 TaskExecute(execute_user_id=me)，`_covers_date(actual_start, actual_end, day)` 且 day<today 的，`time_spent×8` 直接累加（不除 span_days，D-001）
  2. get_calendar 调用点改 _sum_actual_hours
  3. test_workbench_service.py：改写平摊用例为求和；加「1人天+0人天=8h→full 饱和」「跨天历史 1人天覆盖 11 天→每天 8h」「新录入有 actual 区间也显示」（D-005 联动）
- **依赖**：task-02（D-005 强制回填让新录入有 actual；求和才能显示）
- **验收**：标黄 bug 用例（180024 场景）通过；pytest 全绿

---

## Wave 5 — 执行记录详情整合 + 端到端

### - [ ] task-12: 执行记录详情前端整合
- **目标**：task-plans + problem-list 详情区表格。
- **文件**：task-plans/page.tsx（task-06 已含）、problem-list/page.tsx（task-10 已含）
- **steps**：
  1. 确认 task-06/task-10 详情区已调 /task-execute/page 并渲染表格
  2. 统一表格列（开始/结束/耗时/说明/结果）
- **依赖**：task-06、task-10
- **验收**：两端详情可见历次执行记录

### - [ ] task-13: 端到端验收
- **目标**：对照 proposal 成功标准。
- **steps**：
  1. backend 全量 pytest + frontend vitest 全绿
  2. 手动/脚本验证：180024 工作日历过去日期标色（1人天→饱和绿）；task 多次填报；跨天拆分；problem 处置记录可见
  3. ruff + mypy + lint 全绿
- **依赖**：task-01~12 全完成
- **验收**：proposal 成功标准 1-7 全部满足

---

## 整体验收

- backend `uv run pytest -q` 全绿（含新 test_router.py）
- frontend `pnpm test` + `pnpm typecheck` 全绿
- `uv run ruff check . && uv run mypy app && pnpm lint` 全绿
- 账号 180024 工作日历过去日期：1人天+0人天 → 饱和标绿（标黄 bug 修复）
- task 多次填报 + 跨天拆分 + problem 处置记录 + 详情可见 均工作

## 风险关注（execute 阶段）

- R-03 跨天循环单条失败处理（task-05）
- D-005 强制回填是 W4 求和生效的前提（task-02↔task-11 依赖）
- 改 router 必跑 test_router（task-03/04，记忆 backend-router-change-run-router-tests）
- 复合 git 命令绕 claude hook（commit 时单独 git commit，记忆 pre-commit-ci-check-hook）
