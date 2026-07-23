---
author: qinyi
created_at: 2026-07-16 10:55:00
---

# 任务清单（Tasks）— 工作台日历负载修正 + 执行流程重设计

> 5 Wave / 13 task。详细 step 拆分在 plan 阶段（`sillyspec run plan`）细化。每 task 含验收标准。

## Wave 1 — 后端 task 状态机 + 跨天校验

### task-01 task/schema.py 改造
- ExecutePlanReq 删 `submit: bool`，加 `action: Literal["submit","complete"]` + `task_execute_id: uuid`（必填）
- TaskExecuteCreate / TaskExecuteUpdate 加跨天 model_validator（actual 双非空时同日 → ValueError）
- TaskExecutePageReq 加 `problem_task_id: uuid | None` 过滤（D-008）
- **验收**：ruff+mypy 绿；跨天 validator 单测。

### task-02 task/service.py execute_plan + start
- execute_plan 改 action 分支：强制回填 `exc.actual_end_time = req.actual_end_time or now`（D-005）；写 time_spent/execute_info；service 内部跨天校验（exc.actual_start_time.date != actual_end_time.date → TaskError 422，D-004）；submit→status90+plan未开始 / complete→status90+plan已完成
- 新增 `start(plan_task_id, execute_user_id)`：plan 未开始→进行中，创建 TaskExecute(actual_start=now, status=30)，返回 id
- **验收**：start/submit/complete 状态机 + 跨天拒绝 + 强制回填 actual_end 单测。

### task-03 task/router.py 端点
- 新增 `POST /api/ppm/task-plan/{id}/start`
- execute 端点适配 action（删 submit）
- `/task-execute/page` 加 problem_task_id query 参数
- **验收**：test_router.py 覆盖（记忆 backend-router-change-run-router-tests）。

### task-04 task 测试
- test_task.py 重写 execute_plan 用例（submit bool → action，D-003）
- 新建 test_task/tests/test_router.py：POST /start、/execute action、跨天 422
- **验收**：backend pytest 全绿。

## Wave 2 — task 前端

### task-05 ExecuteTaskDialog 改造
- 双按钮（提交/完成）+ 移除 submit checkbox
- 跨天拆分 UI：检测跨天→多行每天单独填（耗时+说明输入）
- 循环单条提交（D-006）
- **验收**：vitest 组件测试。

### task-06 task-plans/page.tsx
- 行按钮按 status（未开始→启动 / 进行中→执行 / 已完成→查看记录）
- 移除 submit checkbox
- 执行记录详情区（调 /task-execute/page?plan_task_id）
- **验收**：vitest。

### task-07 lib/ppm/plan.ts + types.ts
- start / execute(action) API + 类型（删 submit）
- **验收**：tsc 绿。

## Wave 3 — problem 处置镜像

### task-08 problem/service.py done_task
- done_task 额外创建 TaskExecute（problem_task_id, execute_user_id, actual单点now, time_spent, execute_info=handle_info, status=90）（D-007）
- 保留 handle_info 追加 + 状态推进
- **验收**：done_task 创建 TaskExecute 断言。

### task-09 problem 测试
- test_problem_flow.py：done_task 创建 TaskExecute + actual 单点
- problem/tests/test_router.py：done 端点 TaskExecute 落库
- **验收**：pytest 绿。

### task-10 problem-list 前端
- problem-list/page.tsx + _forms.tsx：处置提交/完成 + 执行记录详情（调 /task-execute/page?problem_task_id）
- **验收**：vitest。

## Wave 4 — workbench 负载求和

### task-11 workbench/service.py + 测试
- _spread_actual_hours → _sum_actual_hours（覆盖日 time_spent×8 累加，不平摊）
- test_workbench_service.py 改写：过去侧求和、跨天历史虚高、1人天饱和、**新录入有 actual 区间也显示**（D-005 联动）
- **验收**：标黄 bug 用例（1人天+0人天→饱和绿）通过。

## Wave 5 — 执行记录详情 + 端到端

### task-12 执行记录详情前端整合
- task-plans + problem-list 详情区表格（开始/结束/耗时/说明/结果）
- **验收**：详情可见历次记录。

### task-13 端到端验收
- 账号 180024 工作日历：过去日期标色正确（1人天饱和绿）
- task 多次填报 + 跨天拆分 + problem 处置记录可见
- backend pytest + frontend vitest 全绿
- **验收**：对照 proposal 成功标准 1-7。

## 依赖
- Wave 1 → Wave 2（前端依赖后端 action/start 契约）
- Wave 3 独立（problem 链路）
- Wave 4 依赖 Wave 1 的 actual 强制回填（D-005，新录入有 actual 才能求和显示）
- Wave 5 依赖 Wave 1-4
