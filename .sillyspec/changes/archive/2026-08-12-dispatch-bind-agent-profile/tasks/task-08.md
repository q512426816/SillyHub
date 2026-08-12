---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-08
title: dispatch_worker 补调 _apply_profile_to_lease（修 GAP-6）
---

# task-08: dispatch_worker 补调 _apply_profile_to_lease（修 GAP-6）

- **allowed_paths**: `backend/app/modules/agent/execution.py`
- **改动**：`MissionExecutionService.dispatch_worker`（:153）：worker profile 按 `worker_preset[i].profile_id` 解析（复用 AgentProfileService.resolve_profile，actor=触发用户）；`dispatch_to_daemon`（:275）拿到 lease_id 后**补调** `AgentService._apply_profile_to_lease(lease_id, profile)`（本体在 `agent/service.py:638`，已实现，本 task 仅在 execution.py 调用）。profile 解析失败（被删/越权）→ `mark_worker_run_failed`（execution.py 内）+ return None（对齐 worktree 失败语义，:250）。
- **完成标准**：worker lease.metadata 含档案字段；worker profile 失败标 failed 不崩 mission；单测覆盖。
- **依赖**：task-07（profile_id 字段先有）+ W1 task-03（dispatch 已透传）。
