---
id: task-07
title: RunSyncService 新增 _run_gate_decision_task（H1 独立 session + R3 cas + H2 内联 sync+auto_dispatch + 异常 failed/exit 2）
title_zh: gate 决策后台任务（核心）
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: [task-01, task-03, task-04, task-05, task-06]
blocks: [task-08, task-10, task-11]
requirement_ids: [FR-1, FR-4, FR-5, FR-6]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
---

# task-07 · gate 决策后台任务（核心）

> 全图汇点：消费 Wave1 全部产出（run_command / 后台 helper / gate 列 / enqueue 入口 / gate 执行单元），驱动 Wave4 全部消费方（决策 / reconcile / SSE）。design §5.2 + §7 `_run_gate_decision_task` 伪码 + §7.5 生命周期契约表。

## provides

- contract: `_run_gate_decision_task`
  fields: [agent_run_id, workspace_id, change_id, gate_result, gate_status]
  desc: RunSyncService 后台方法；异步跑 gate + 存结果 + 内联推进 stage；签名 `_run_gate_decision_task(self, agent_run_id, workspace_id, change_id)`。

## expects_from

- task-01:
  - contract: HostFsDelegate.run_command
    needs: [command, args, cwd, timeout]
- task-03:
  - contract: RunSyncService._fire_background_task
    needs: [coro]
- task-04:
  - contract: AgentRun.gate_fields
    needs: [gate_result, gate_status]
- task-05:
  - contract: close_interactive_run gate enqueue
    needs: [agent_run_id, workspace_id, change_id]
- task-06:
  - contract: gate execution helpers
    needs: [exit_code, errors, raw_envelope]

## 实现要点（design §7 伪码，逐条硬约束）

`async def _run_gate_decision_task(self, agent_run_id, workspace_id, change_id)`：

1. **H1 独立 session**：`async with get_session_factory()() as gate_session:`（`core/db.py:53`）。全程用 `gate_session`，**禁用 `self._session`**——`RunSyncService.__init__:198` 只接注入 session，无 session_factory 字段，后台任务生命周期独立于 HTTP 请求 session（R6）。
2. **R3 cas pending→running**：`UPDATE agent_runs SET gate_status='running' WHERE id=:id AND gate_status='pending'`，`result.rowcount == 0` → 直接 `return`（防 double-enqueue：reconcile + 原任务并发只一个抢到，R10）。
3. 调 task-06 的 `_run_gate_via_delegate`（走 task-01 `HostFsDelegate.run_command` 在 daemon 跑 `sillyspec gate verify`，27s+）+ `_read_gate_result`（解析 JSON → `{exit_code, errors, raw_envelope}`）。
4. 存 `agent_run.gate_result = {...}` + `gate_status='decided'`；`await gate_session.commit()`。
5. **H2 内联 sync+auto_dispatch**：`SillySpecStageDispatchService(gate_session).sync_stage_status(...)` + `auto_dispatch_next_step(...)`，传同一 `gate_session`。**不调** `_trigger_stage_completion_callback`（`dispatch.py:959/965/969/987` 写死 `self._session`，gate 任务没有它，R7）。
6. **异常分支**：`except Exception as exc:` → `await gate_session.rollback()` + `gate_status='failed'` + `gate_result={exit_code: 2, errors: [str(exc)], raw_envelope: {}}` + commit（fail-loud 不降级）。
7. **H4 调度**：本任务由 task-05 的 `close_interactive_run` 经 `_fire_background_task` enqueue（强引用 `_background_tasks` set 防 GC，task-03 实现；`agent/service.py:358` 范式）。gate 慢（27s+）在后台不阻塞 HTTP。

## acceptance

- [ ] cas 防双发：`gate_status='pending'` 已被抢（rowcount==0）时直接 return，不重复跑 gate。
- [ ] 成功：`gate_status='decided'` + `gate_result` 落库 + 内联 `sync_stage_status` 与 `auto_dispatch_next_step` 被调（用 gate_session），**不调** `_trigger_stage_completion_callback`。
- [ ] 异常：`gate_status='failed'` + `gate_result.exit_code=2` + errors 含异常信息；rollback 已执行。
- [ ] H1：全程用 `get_session_factory()()` 独立 session，不触碰 `self._session`（`__init__:198` 无 session_factory）。
- [ ] H4：被 `_fire_background_task` 调度（强引用 set），GC 不回收。

## verify

```bash
cd backend && uv run pytest -k gate_decision_task && uv run ruff check && uv run mypy app
```

单测覆盖：cas 命中 / cas miss(return) / 成功 decided+内联 sync+auto_dispatch 被调 / 不调 callback / 异常 failed+exit 2 / 用独立 session 不用 self._session。

## constraints

- **H1 / H2 / H4 / R3 四条硬约束**（design §10 R5-R7）：独立 session、内联不调 callback、强引用防 GC、cas 原子。
- gate 慢（27s+）后台异步不阻塞；**fail-loud 不降级**（异常 exit 2 而非吞掉）。
- 只改 `service.py` 一个文件（allowed_paths 强约束）；task-06 的 `_run_gate_via_delegate` / `_read_gate_result` 在 `dispatch.py`，本任务 import 调用。
