---
author: qinyi
created_at: 2026-07-13T20:56:24
priority: P0
depends_on: [task-01]
requirement_ids: [FR-1]
decision_ids: [D-001, D-009]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py
expects_from:
  task-01:
    contract: _apply_session_terminal_status
    needs: [run: AgentRun, session: AgentSession, return: str|None]
---

# task-03 — close_interactive_run 接入 session 终态回写 + 单测

## goal

`close_interactive_run`（run_sync/service.py:730）收到 daemon run 终态通知后，在 :929 `await self._session.commit()` **之前**新 query `AgentSession`，调 task-01 辅助函数 `_apply_session_terminal_status` 回写 session 终态，与 run 终态同事务原子提交，消除病灶 B（自然覆盖批量路径 A 的 pending session，D-001）。

## implementation

1. 顶部 import：`from app.modules.daemon.session.service import _apply_session_terminal_status`（task-01 产出）。
2. `close_interactive_run` 在 set `agent_run.status`（:829-846）+ stage 回写（:852-888）+ usage/finish（:890-926）+ `self._session.add(agent_run)`（:928）之后、:929 `await self._session.commit()` **之前**插入回写块：
   - `if agent_run.agent_session_id is not None:`
   - 新 query：`session = await self._session.get(AgentSession, agent_run.agent_session_id)`（必须新建 query，见下条禁止项）
   - `if session is not None:`
     - `new_status = _apply_session_terminal_status(agent_run, session)`
     - `if new_status is not None:` → `session.status = new_status`；`ended/failed` 写 `session.ended_at = datetime.now(UTC)`，`active` 写 `session.last_active_at = datetime.now(UTC)`；`self._session.add(session)`
3. **禁止复用 :1039 的 session query**（属 `_resolve_gate_workspace_id` helper，:1042 处，在 close_interactive_run :942 调用，即 :929 commit **之后**，D-009）—— 必须在 commit 前新 query，否则回写不进同一事务。
4. 先写测试 `test_close_interactive_run_session_status.py`，4 case：
   - 单轮任务（change_id 非空 / spec_strategy 非 interactive+None）run completed → session `ended` + `ended_at`
   - 单轮任务 run failed → session `failed` + `ended_at`
   - 多轮对话（`spec_strategy=='interactive' AND change_id is None`）run completed → session 保持 `active` + 刷 `last_active_at`
   - session 已 `ended`/`failed` → 幂等不覆盖（`_apply_session_terminal_status` 返回 None）

## 验收标准

- run 终态与 session 终态同 :929 commit 事务落库（R-01，原子一致性，回滚测试可断言）
- 4 case（单轮 ended / 单轮 failed / 多轮 active 保持 / 幂等不覆盖）单测通过
- :1039 未被复用（代码审查：回写块在 :929 之前 + 新 query）
- 批量路径（dispatch_to_daemon 创建的 pending session）首轮 turn 完成即收口（D-001 病灶 A 被 B 覆盖）

## verify

- `cd backend && uv run pytest app/modules/daemon/tests/test_close_interactive_run_session_status.py -q`
- `cd backend && uv run mypy app/modules/daemon/run_sync/service.py`
- `cd backend && uv run ruff check app/modules/daemon/run_sync/service.py`
- `cd backend && uv run pytest app/modules/daemon/tests/test_interactive_lifecycle_patch.py -q`（回归守护，AC-5）

## constraints

- 回写必须在 :929 commit **同事务**内（不可独立事务 / 独立 commit，防 run/session 不一致）
- 不碰已 `ended`/`failed` 的 session（D-005 幂等，由 `_apply_session_terminal_status` 守卫）
- 不改 run 终态映射逻辑、不改 SSE 推送、不动 gate enqueue（仅加 session 回写块）
- import `_apply_session_terminal_status` from `app.modules.daemon.session.service`
- `AgentSession` 已在文件作用域可见（与 :1039 同模块，无需重复 import 顶层已有则不动）
