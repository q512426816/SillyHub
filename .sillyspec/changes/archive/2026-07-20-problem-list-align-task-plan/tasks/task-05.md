---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-05
title: schema 删废弃 + 新增 StartReq/ExecuteProblemReq
wave: 1
blockedBy: [task-03]
allowed_paths: [backend/app/modules/ppm/problem/schema.py]
acceptance: [FR-5, FR-7]
---

## 目标
删 6 个废弃 schema + `ProblemListCreate.submit` 字段，新增 `StartReq` + `ExecuteProblemReq`。

## 实现步骤
1. 删：`NextProcessReq:208` / `RejectProcessReq:214` / `DoneTaskReq:220` / `CloseTaskReq:231` / `ProcessTaskResp:163` / `ProcessLogResp:182`。
2. `ProblemListCreate:49-51`：删 `submit: bool = False` 字段（G2，create 不再按 submit 触发审批）。
3. 新增 `StartReq`：`problem_id: uuid.UUID` / `execute_user_id: uuid.UUID | None = None` / `actual_start_time: datetime | None = None`。
4. 新增 `ExecuteProblemReq`：`problem_id: uuid.UUID` / `task_execute_id: uuid.UUID` / `action: Literal["submit","complete"]` / `execute_info: str | None = None` / `time_spent: float | None = None` / `actual_end_time: datetime | None = None` / `execute_user_id: uuid.UUID | None = None`。
5. `ProblemListResp:79-80` `effective_status` 字段**保留**（=status，G3），注释更新为「简化后恒等于 status」。
6. 更新 `__all__`。

## 测试点
- `StartReq` / `ExecuteProblemReq` 可实例化；`action` Literal 校验非法值报错。
- `ProblemListCreate()` 无 `submit` 字段。

## 验收
- schema 无废弃类；router import 新 schema 成功；ruff/mypy 绿。
