---
id: task-01
title: task/schema.py 改造（删 submit 加 action + 跨天 validator + problem_task_id）
phase: W1
priority: P0
status: draft
owner: qinyi
estimated_hours: 2
affected_components: [backend]
allowed_paths:
  - backend/app/modules/ppm/task/schema.py
depends_on: []
blocks: [task-02]
goal: "task/schema.py 改造：删 submit 加 action + 跨天 validator + problem_task_id"
implementation:
  - "ExecutePlanReq 删 submit:bool，加 action:Literal[submit,complete] + task_execute_id:uuid 必填"
  - "TaskExecuteCreate/Update 加 model_validator：actual 双非空时同日校验"
  - "TaskExecutePageReq 加 problem_task_id: uuid | None"
acceptance:
  - "ruff + mypy 绿"
  - "validator 单测：跨天拒/同日过/单端过/双None过"
verify:
  - "cd backend && uv run pytest app/modules/ppm/task -q（validator 用例）"
  - "uv run ruff check . && uv run mypy app"
constraints:
  - "不破坏 TaskExecuteResponse 现有字段"
  - "action 枚举 submit/complete 对齐 D-003"
---

## 目标
ExecutePlanReq 删 `submit: bool` 加 `action: Literal["submit","complete"]` + `task_execute_id`；TaskExecuteCreate/Update 加跨天 model_validator；TaskExecutePageReq 加 problem_task_id 过滤。

## 依据
design §5.1 / §7.2 / §7.3；D-003（删 submit 不兼容）/ D-004（跨天 validator）/ D-008（problem_task_id 过滤）。

## steps
1. ExecutePlanReq：删 `submit: bool = False`，加 `action: Literal["submit","complete"]` + `task_execute_id: uuid`（必填）
2. TaskExecuteCreate / TaskExecuteUpdate 加 `@model_validator(mode="after")`：actual_start_time 与 actual_end_time 均非空时 `.date()` 必须相等，否则 raise ValueError
3. TaskExecutePageReq 加 `problem_task_id: uuid | None = None`

## 验收标准
- `cd backend && uv run ruff check . && uv run mypy app` 绿
- validator 单测：跨天拒、同日过、单端过、双 None 过
