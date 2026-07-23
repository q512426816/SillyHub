---
id: task-03
title: RunSyncService 提取 _fire_background_task + _background_tasks set + _on_bg_task_done（H4 范式）
title_zh: RunSyncService 后台任务 helper（H4）
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: []
blocks: [task-05, task-07]
requirement_ids: [FR-5]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
provides:
  - contract: RunSyncService._fire_background_task
    fields: [coro, workspace_id, run_id, asyncio_Task]
expects_from: {}
---

# task-03 RunSyncService 后台任务 helper（H4）

## 目标
把 AgentService 的后台任务生命周期范式（H4 / R5 防 GC + 异常不静默）原样提取到 RunSyncService，为 task-05（gate 内联 sync）、task-07（gate 任务派发）提供可复用 helper。

## 依据
- design §5.2 H4：复用 `_fire_background_task`（agent/service.py:358 强引用 set 防 GC + 异常静默兜底）
- design §10 R5：后台任务必须强引用 + 异常 log
- 源码范式（逐字对齐）：`backend/app/modules/agent/service.py:347-386`
- 接入点：`backend/app/modules/daemon/run_sync/service.py:195-205`（RunSyncService.__init__ 当前仅 self._session + self._facade）

## 实现
1. RunSyncService 类体顶部加类属性（对齐 agent/service.py:349）：
   ```python
   # 后台任务引用集 — 防止 asyncio.Task 被 GC 回收
   _background_tasks: set[asyncio.Task] = set()
   ```
2. 加方法 `_fire_background_task(self, coro, *, workspace_id=None, run_id=None) -> asyncio.Task`：
   create_task → add to set → add_done_callback → log.info → return task（抄 agent/service.py:358-375，类名改为本类）
3. 加 staticmethod `_on_background_task_done(task)`：discard set + 取 exception（InvalidStateError/CancelledError 早返回）+ 非 None 时 `log.exception`（抄 :377-386）

## acceptance
- fire 后 task 存在 _background_tasks set 中（强引用防 GC）
- done callback 执行后从 set 移除（discard）
- task 抛异常时被 log.exception 捕获，不静默
- 与 AgentService 范式逐字一致（仅类名替换）

## verify
```bash
cd backend && uv run pytest -k fire_background && uv run ruff check && uv run mypy app
```

## constraints
- 仅提取 helper，不实现 gate 业务逻辑（gate 派发留给 task-07）
- 不改动现有 close/submit/merge 系列方法行为
- 不接通调用点（task-05/07 才接线），本 task 只提供能力
