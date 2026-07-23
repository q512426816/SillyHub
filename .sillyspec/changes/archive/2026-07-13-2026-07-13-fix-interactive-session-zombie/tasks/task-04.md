---
author: qinyi
created_at: 2026-07-13 20:56:24
priority: P0
depends_on: [task-01]
requirement_ids: [FR-2]
decision_ids: [D-003, D-008]
allowed_paths:
  - backend/app/modules/daemon/lease_service.py
  - backend/app/modules/daemon/tests/test_cancel_lease_session.py
---

# task-04 — cancel_lease interactive 分支收口 session + 单测

## goal

`cancel_lease`（lease_service.py:281）interactive 分支在 set `run.status='killed'` + `lease.status='cancelled'`（含 :337 `_mark_agent_run_killed_if_pending`、:345-346 WS SESSION_INTERRUPT）之后补 UPDATE `session.status='ended'`（D-003 kill=正常终止，非 failed）。门控 `lease.kind=='interactive'` 覆盖**所有 interactive-kind lease**——对话/stage/scan/quick-chat 的 lease kind 均为 interactive（D-008，placement.py:264 注释+bfaa9256 起改 interactive）。`MissionControl.cancel`（control.py:108）经 `cancel_lease(r.id)` 自动覆盖，无需单独改 control.py。

## implementation

**先写测试** `test_cancel_lease_session.py`，再补收口段。

### 收口段（lease_service.py cancel_lease，紧随 :346 WS 之后）

门控：`if lease.kind == "interactive" and agent_run.agent_session_id is not None`

```python
# D-003 kill=正常终止；D-005 幂等守卫（仅 pending/active/reconnecting 才收口）
session = await self._session.get(AgentSession, agent_run.agent_session_id)
if session is not None and session.status in ("pending", "active", "reconnecting"):
    session.status = "ended"
    session.ended_at = now
    self._session.add(session)
    await self._session.commit()
```

`agent_run` 取自 :357 `_mark_agent_run_killed_if_pending` 已 `self._session.get` 的同一对象（实现时确认是否复用或新 query，同事务即可）。`now` 复用 :297 `datetime.now(UTC)`。

### 单测 case（test_cancel_lease_session.py）

1. **interactive 收口**：claimed interactive lease + run pending/running + session active → cancel_lease 后 run=killed、lease=cancelled、**session=ended**（非 failed，D-003）
2. **幂等**：session 已 ended/failed → cancel_lease 不覆盖 session.status、不重写 ended_at（D-005）
3. **stage cancel 回归**（D-008）：dispatch_to_daemon 路径 lease kind=interactive + session=pending → cancel_lease 收口 session=ended，不破坏 stage 生命周期（不触碰 stage 状态机/不双写 complete_lease）
4. **scan cancel 回归**（D-008）：platform-managed run 的 interactive lease → cancel_lease 收口 session=ended，守护 test_interactive_lifecycle_patch 行为
5. **mission cancel 集成**：MissionControl.cancel 遍历 worker_runs 调 cancel_lease → 每个 worker session=ended（control.py:108 透传，无需单独改）

## 验收标准

- kill 交互式 session 后 `session.status='ended'`（非 failed，D-003）
- stage cancel / scan cancel 回归：session 收口 ended，不破坏现有 stage/scan 生命周期（D-008 + R-03）
- 幂等：已 ended/failed 的 session 不被 cancel 覆盖（D-005）
- MissionControl.cancel 经 cancel_lease 自动收口 worker session（control.py:108 透传，不改 control.py）

## verify

```bash
cd backend && uv run pytest app/modules/daemon/tests/test_cancel_lease_session.py -q
cd backend && uv run mypy app/modules/daemon/lease_service.py
cd backend && uv run ruff check app/modules/daemon/lease_service.py
cd backend && uv run pytest app/modules/daemon/tests/test_interactive_lifecycle_patch.py -q   # stage/scan 生命周期回归
cd backend && uv run pytest app/modules/agent/tests/ -q                                       # control.py mission cancel 守护
```

## constraints

- 门控 `lease.kind=='interactive'`，不区分 batch/对话（D-008 全覆盖 stage/scan/quick-chat）
- kill → `session=ended` 非 failed（D-003）
- 幂等守卫 `session.status in ('pending','active','reconnecting')`（D-005）
- 不改 cancel_lease 的 run/lease 终态逻辑、不改 WS SESSION_INTERRUPT（:345 现有 best-effort）、不改 control.py
