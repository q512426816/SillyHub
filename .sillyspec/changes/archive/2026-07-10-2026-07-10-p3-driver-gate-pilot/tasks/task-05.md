---
id: task-05
title: 改 close_interactive_run:684——删 v4 R2 callback；gate_status=pending 随 commit；commit 后 _fire_background_task enqueue gate 任务 → 快速返回 HTTP（<30s）
title_zh: close_interactive_run 改造 enqueue gate 任务
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: [task-03, task-04]
blocks: [task-07]
requirement_ids: [FR-4]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
provides:
  - contract: close_interactive_run gate enqueue
    fields: [agent_run_id, workspace_id, change_id]
expects_from:
  task-03:
    - contract: RunSyncService._fire_background_task
      needs: [coro]
  task-04:
    - contract: AgentRun.gate_fields
      needs: [gate_status]
---

# task-05 close_interactive_run enqueue gate 任务

## 目标
`close_interactive_run`（service.py:684-935）终态映射后、commit 时把 `gate_status` 一起落库，commit 后 `_fire_background_task` enqueue gate 任务，立即 return HTTP（<30s，daemon notifyRunResult 不重试）。删 v4 R2 末尾补 callback 的设计。

## 改动点（仅 service.py:684 方法体内）

1. **gate_status='pending'（M2，随 commit）**：终态映射后（:801 附近，`agent_run.status` 决定完成/失败之后），仅当 `agent_run.change_id is not None` 时设 `agent_run.gate_status = 'pending'`。位置在 usage 透传（:849-866）之前、last_dispatch 回写（:806-842）之后，确保 `:876` commit 把它和终态原子落库——gate 任务读到的快照一致（design §M2 / §170 行）。
2. **commit 后 enqueue（:876 commit / :877 refresh 之后）**：
   ```python
   if agent_run.change_id is not None and agent_run.status == "completed":
       self._fire_background_task(
           self._run_gate_decision_task(
               agent_run_id=run_id,
               workspace_id=<lease 推导>,
               change_id=agent_run.change_id,
           )
       )
   ```
   - 不 await，立即继续到 Redis publish + session event + return。
   - `workspace_id` 从 lease/session 推导（lease.metadata 或 agent_run.agent_session → session.workspace_id），实现在本任务内确定（若 lease 无现成字段，读 `agent_run` 关联 session）。
3. **删 v4 R2 callback**：不补 `_trigger_stage_callback` 之类末尾 callback（design §3 非目标 / §10 R2 已否决）。gate 推进完全交给后台任务（task-06/07 内联 sync + auto_dispatch）。

## 不动（既有逻辑零回归）
- 终态映射（:783-800）、last_dispatch 回写（:806-842）、usage/cost/cache 透传（:849-866）、redact（:867-873）、commit/refresh（:875-877）、Redis publish（:879-900）、session turn_completed event（:902-924）、log/return（:926-935）全部保持。

## 守门
- `change_id is None`（scan / 非 verify stage）→ 不设 gate_status、不 enqueue。
- `status != 'completed'`（failed）→ 不 enqueue gate（gate 只核验完成的 turn）。
- enqueue 失败不得影响已 commit 的终态行（`_fire_background_task` H4 已吞异常，task-03 提供）。

## 依赖
- task-03 `_fire_background_task(coro)`（H4 强引用 set + add_done_callback 防静默 GC）。
- task-04 `AgentRun.gate_status` 列（pending/running/decided/failed，nullable）。

## acceptance
- close 后 `agent_run.gate_status == 'pending'`（change_id 非 None + completed 场景）。
- mock `_run_gate_decision_task` 断言被 `_fire_background_task` 调用一次，参数含 agent_run_id/workspace_id/change_id。
- HTTP 立即返回（<30s，无 await gate 任务）。
- 无 callback 补丁代码（grep `_trigger_stage_callback` 在 close 方法体内无新增调用）。
- 非 change 场景（change_id None）或 failed → 不 enqueue、不设 gate_status。

## verify
```bash
cd backend && uv run pytest -k close_interactive && uv run ruff check && uv run mypy app
```

## constraints
- 仅 change_id 非 None 的 verify stage 场景 enqueue。
- 不改 close 的终态映射 / usage 透传 / Redis publish 既有逻辑。
- close 改动可独立回退（只删 gate_status 赋值 + enqueue 两块）。
