---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-04
title: router 删废弃端点 + 新增 start/execute
wave: 1
blockedBy: [task-03]
allowed_paths: [backend/app/modules/ppm/problem/router.py]
acceptance: [FR-5, FR-7, FR-14]
---

## 目标
删 7 个废弃审批/处置端点，新增 `POST /{id}/start` + `PUT /{id}/execute`，problem-change 端点保留。

## 实现步骤
1. 删端点：`next_process:232` / `submit_problem:246` / `reject_process:264` / `done_task:278` / `close_task:297` / `list_tasks:315` / `list_logs:325`。
2. 新增 `POST /problem-list/{item_id}/start`：body `StartReq`，权限 `PPM_PROBLEM_WRITE`，调 `ProblemService.start(item_id, execute_user_id=user.id, actual_start_time=body.actual_start_time)`，返回 `TaskExecute`（序列化为 dict 或新增 TaskExecuteResp；前端要 id）。
3. 新增 `PUT /problem-list/{item_id}/execute`：body `ExecuteProblemReq`，调 `execute_problem`，返回 `ProblemListResp`（problem 已变）。
4. 清理 import（删 `NextProcessReq` / `RejectProcessReq` / `DoneTaskReq` / `CloseTaskReq` / `ProcessTaskResp` / `ProcessLogResp`，加 `StartReq` / `ExecuteProblemReq`）。
5. **保留** problem-change 全部端点（`:340-483`，D-005 deprecated）。
6. router docstring 更新（删审批端点描述）。

## 测试点
- `test_router`（MEMORY `backend-router-change-run-router-tests`）：start/execute 路由可达；废弃端点 404；参数顺序无 SyntaxError。
- 重建容器 main.py import 无 crash-loop。

## 验收
- `GET /openapi.json` 含 start/execute，不含 next/submit/reject/done/close/tasks/logs；router 测试绿。
