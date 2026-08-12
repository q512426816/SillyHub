---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-04
title: router 端点透传（body + Query 双形态）
---

# task-04: router 端点透传（body + Query 双形态）

- **allowed_paths**: `backend/app/modules/change/router.py`
- **改动**：
  - `/advance-stage`（:499）、`/transition` 端点：从 body `TransitionRequest` 取 `agent_profile_id` 透传给 `transition_with_dispatch`。
  - `/dispatch`（`manual_dispatch`，:855）：**Query 参数**风格（对齐 :861-862 provider/model），新增 `agent_profile_id: uuid.UUID | None = Query(default=None)`，透传给 `dispatch()`（:882）。
- **完成标准**：三个端点都能收到并透传 agent_profile_id；HTTP 测试覆盖。
- **依赖**：task-01（body schema）+ task-02 + task-03。
