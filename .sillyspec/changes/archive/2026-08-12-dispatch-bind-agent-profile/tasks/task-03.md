---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-03
title: dispatch/dispatch_next_step 加参数
---

# task-03: dispatch/dispatch_next_step 加参数

- **allowed_paths**: `backend/app/modules/change/dispatch.py`
- **改动**：`dispatch()`（:462）+ `dispatch_next_step`（:1270）签名加 `agent_profile_id`；两者调 `start_stage_dispatch`（:534 / :1373）时传入 `agent_profile_id=agent_profile_id`。
- **完成标准**：`start_stage_dispatch` 终于收到 run 显式 profile id（兜底链 run_profile_id 分支激活）。
- **依赖**：task-02。
