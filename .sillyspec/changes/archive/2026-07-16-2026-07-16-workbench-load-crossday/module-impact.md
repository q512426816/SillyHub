---
author: qinyi
created_at: 2026-07-16 12:10:00
---

# 模块影响分析（Module Impact）— 工作台日历负载修正 + 执行流程重设计

## 影响模块
- **ppm/task**：schema（ExecutePlanReq 删 submit 加 action + TaskExecuteCreate/Update 跨天 validator + TaskExecutePageReq 加 problem_task_id + 新增 StartReq）+ service（execute_plan 改 action + 强制回填 actual_end + service 内跨天校验 + 新增 start）+ router（POST /task-plan/start + execute 适配 action + page 加 problem_task_id query）+ test（test_task 重写 submit→action + 新建 test_router）
- **ppm/problem**：service（done_task 额外创建 TaskExecute，actual 单点 now，D-007）+ test（done_task 创建 TaskExecute 断言）
- **ppm/workbench**：service（`_spread_actual_hours` → `_sum_actual_hours` 过去侧求和，D-001 推翻平摊）+ test（平摊用例改求和 + 标黄修复验证）
- **frontend lib/ppm**：task.ts（新增 startPlanTask）+ types.ts（ExecutePlanReq 改 action + 新增 StartReq + TaskExecutePageReq 加 problem_task_id）
- **frontend 组件**：execute-task-dialog（双按钮 提交/完成 + ExecuteTaskState 加 taskExecuteId + 跨天提示）+ task-plans/page + workbench-task-table（行按钮按 status：启动/执行 + handleStart/handleResume/handleExecute(action)）

## 文件清单（14，git diff 核实）
| 操作 | 文件 |
|---|---|
| 修改 | backend/app/modules/ppm/task/schema.py |
| 修改 | backend/app/modules/ppm/task/service.py |
| 修改 | backend/app/modules/ppm/task/router.py |
| 修改 | backend/app/modules/ppm/task/tests/test_task.py |
| 新增 | backend/app/modules/ppm/task/tests/test_router.py |
| 修改 | backend/app/modules/ppm/problem/service.py |
| 修改 | backend/app/modules/ppm/problem/tests/test_problem_flow.py |
| 修改 | backend/app/modules/ppm/workbench/service.py |
| 修改 | backend/app/modules/ppm/workbench/tests/test_workbench_service.py |
| 修改 | frontend/src/lib/ppm/task.ts |
| 修改 | frontend/src/lib/ppm/types.ts |
| 修改 | frontend/src/app/(dashboard)/ppm/_components/execute-task-dialog.tsx |
| 修改 | frontend/src/app/(dashboard)/ppm/task-plans/page.tsx |
| 修改 | frontend/src/app/(dashboard)/ppm/workbench/_components/workbench-task-table.tsx |

## 三重交叉验证
- **声明范围**（design §6 文件变更清单 13 行 + work-calendar-panel 零改动声明）
- **任务范围**（tasks/ 13 TaskCard allowed_paths）
- **实际改动**（git diff 14 文件）

三者一致。work-calendar-panel.tsx 零改动（D-009）确认——前端日历组件 load_level 映射不变，仅后端 daily_actual 求和值变。

## 未涉及模块
- ppm/plan、ppm/kanban、ppm/milestone 等未改（ExecutePlanReq 改 action 后，kanban 的 actual 时间表单复用 TaskExecuteCreate/Update 的跨天 validator，无破坏——全量 ppm 284 passed 验证）
- daemon / backend 其他子域零改动
