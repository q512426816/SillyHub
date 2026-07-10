"""Tests for close_interactive_run gate enqueue (task-05 / FR-4 / design §5.1).

P3 Driver Gate Pilot — Wave 2 task-05：

- close_interactive_run 终态映射后、commit 时把 gate_status='pending' 随终态
  原子落库（仅 change_id 非空 + completed 场景）。
- commit 后 _fire_background_task enqueue gate 决策任务，立即返回 HTTP（<30s，
  daemon notifyRunResult 不重试）。不 await gate 任务。
- _run_gate_decision_task 为 task-07（Wave 3）的 stub；本 task 仅接通调用点。
- 删 v4 R2 callback：close 方法体内无 _trigger_stage_callback 新增调用。

复用 test_interactive_lifecycle_patch._seed_active_interactive_session 的 fixture
模式（in-memory SQLite + mocked Redis/hub，无 live infra）。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.run_sync.service import RunSyncService
from app.modules.daemon.service import DaemonService  # RunSyncService 供 patch.object 用

# ── Fixtures（对齐 test_interactive_lifecycle_patch.py） ──────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"gate-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    """patch facade + run_sync + session 三处 get_redis 指向同一 mock。

    对齐 test_interactive_lifecycle_patch.mocked_redis（:101）。
    """
    redis = _mock_redis()
    with (
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
    ):
        yield redis


async def _seed_active_interactive_session(
    db_session: AsyncSession,
    *,
    run_status: str = "running",
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """建 active interactive session + lease + run + claim_token。

    返回 (lease_id, run_id, claim_token)。session_id 内部用，caller 只需三者驱动 close。
    """
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    placement = RunPlacementService(db_session)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=uid,
        provider="claude",
        prompt="hi",
        model=None,
    )
    session = AgentSession(
        id=session_id,
        user_id=uid,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=rt.id,
        lease_id=dispatch.lease_id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status=run_status,
        spec_strategy="interactive",
        agent_session_id=session_id,
    )
    db_session.add_all([session, run])
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token


async def _attach_change(db_session: AsyncSession, run_id: uuid.UUID) -> uuid.UUID:
    """给 run 挂 change_id（verify 等 stage dispatch 特征）并返回 (change_id, workspace_id)。

    Change.workspace_id 是 close_interactive_run 推导 workspace_id 的稳定来源
    （对齐 _trigger_stage_completion_callback:1029 的策略）。
    """
    from app.modules.change.model import Change

    workspace_id = uuid.uuid4()
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=f"gate-{uuid.uuid4().hex[:6]}",
        title="gate enqueue test",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/gate-enqueue",
        current_stage="verify",
        stages={
            "last_dispatch": {
                "stage": "verify",
                "user_id": str(uuid.uuid4()),
                "at": "2026-07-10T10:00:00Z",
                "config": {},
                "run_id": str(run_id),
                "status": "running",
            }
        },
    )
    db_session.add(change)
    run_row = await db_session.get(AgentRun, run_id)
    run_row.change_id = change.id
    await db_session.commit()
    return workspace_id


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestCloseInteractiveRunGateEnqueue:
    """task-05：close_interactive_run enqueue gate 决策任务（design §5.1 / §M2）。"""

    @pytest.mark.asyncio
    async def test_change_completed_sets_gate_status_pending_and_enqueues(
        self, db_session, mocked_redis
    ) -> None:
        """change_id 非空 + completed：gate_status=pending 随 commit；enqueue gate 任务。"""
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        workspace_id = await _attach_change(db_session, run_id)

        svc = DaemonService(db_session)
        # spy：_fire_background_task 替成同步 MagicMock —— 不真起后台 task（测试里
        # 不应跑 gate stub 的 NotImplementedError），仅断言被调用一次 + coro 来源正确。
        fire_spy = MagicMock(return_value=asyncio.Future())
        # _run_gate_decision_task 是 stub（raise NotImplementedError），patch 成
        # AsyncMock 记录调用参数；其返回值作为 coro 传给 _fire_background_task。
        gate_spy = AsyncMock(name="_run_gate_decision_task")
        with (
            patch.object(RunSyncService, "_fire_background_task", fire_spy),
            patch.object(RunSyncService, "_run_gate_decision_task", gate_spy),
        ):
            run = await svc.close_interactive_run(
                lease_id,
                run_id,
                token,
                status="success",
                is_error=False,
                subtype="success",
            )

        # M2：gate_status=pending 随终态原子落库
        assert run.status == "completed"
        assert run.gate_status == "pending"

        # enqueue：_run_gate_decision_task 被调用一次构造 coro（参数含三者）
        gate_spy.assert_called_once()
        call_kwargs = gate_spy.call_args.kwargs
        assert call_kwargs["agent_run_id"] == run_id
        assert call_kwargs["workspace_id"] == workspace_id
        assert call_kwargs["change_id"] is not None
        # _fire_background_task 被调用一次（接收 coro）
        fire_spy.assert_called_once()

    @pytest.mark.asyncio
    async def test_change_completed_gate_status_persisted_to_db(
        self, db_session, mocked_redis
    ) -> None:
        """gate_status=pending 真落库（commit 生效），重读 DB 确认（非仅内存对象）。"""
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        await _attach_change(db_session, run_id)

        svc = DaemonService(db_session)
        gate_spy = AsyncMock()
        with (
            patch.object(RunSyncService, "_fire_background_task", MagicMock()),
            patch.object(RunSyncService, "_run_gate_decision_task", gate_spy),
        ):
            await svc.close_interactive_run(
                lease_id, run_id, token, status="success", is_error=False
            )

        # 规避 identity map，重读确认 commit 真把 gate_status 落库
        db_session.expire_all()
        persisted = await db_session.get(AgentRun, run_id)
        assert persisted.gate_status == "pending"

    @pytest.mark.asyncio
    async def test_conversational_run_no_change_id_skips_enqueue(
        self, db_session, mocked_redis
    ) -> None:
        """change_id=None（对话 turn / 非 verify stage）：不设 gate_status、不 enqueue。"""
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        # 不 attach change → change_id 保持 None（对话 run）

        svc = DaemonService(db_session)
        fire_spy = MagicMock()
        gate_spy = AsyncMock()
        with (
            patch.object(RunSyncService, "_fire_background_task", fire_spy),
            patch.object(RunSyncService, "_run_gate_decision_task", gate_spy),
        ):
            run = await svc.close_interactive_run(
                lease_id, run_id, token, status="success", is_error=False
            )

        assert run.status == "completed"
        assert run.gate_status is None  # 不设
        gate_spy.assert_not_called()  # 不构造 gate coro
        fire_spy.assert_not_called()  # 不 enqueue

    @pytest.mark.asyncio
    async def test_failed_run_skips_enqueue_even_with_change_id(
        self, db_session, mocked_redis
    ) -> None:
        """change_id 有但 status=failed：gate 只核验完成 turn，不 enqueue、不设 gate_status。"""
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        await _attach_change(db_session, run_id)  # 有 change_id

        svc = DaemonService(db_session)
        fire_spy = MagicMock()
        gate_spy = AsyncMock()
        with (
            patch.object(RunSyncService, "_fire_background_task", fire_spy),
            patch.object(RunSyncService, "_run_gate_decision_task", gate_spy),
        ):
            run = await svc.close_interactive_run(
                lease_id,
                run_id,
                token,
                status="error_during_execution",
                is_error=True,
            )

        assert run.status == "failed"
        assert run.gate_status is None  # failed 不设 pending
        gate_spy.assert_not_called()
        fire_spy.assert_not_called()

    @pytest.mark.asyncio
    async def test_close_does_not_await_gate_task_returns_immediately(
        self, db_session, mocked_redis
    ) -> None:
        """HTTP 立即返回：close 不 await gate 任务。

        证法：让 _run_gate_decision_task coro 内部挂起（await 一个永不 resolve 的
        Future）。若 close await 了它，测试会 hang/超时；close 立即返回则正常结束。
        _fire_background_task 真起 task（不复用 spy），证明 enqueue 真创建后台 task。
        """
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        await _attach_change(db_session, run_id)

        hang_future: asyncio.Future = asyncio.Future()

        async def _hanging_gate(self_, *, agent_run_id, workspace_id, change_id) -> None:
            await hang_future  # 永不 resolve

        svc = DaemonService(db_session)
        fired_tasks: list[asyncio.Task] = []

        real_fire = RunSyncService._fire_background_task

        def _capture_fire(self_, coro, **kwargs):
            task = real_fire(self_, coro, **kwargs)
            fired_tasks.append(task)
            return task

        with (
            patch.object(RunSyncService, "_run_gate_decision_task", _hanging_gate),
            patch.object(RunSyncService, "_fire_background_task", _capture_fire),
        ):
            # 若 close await 了 gate，此处会 hang 到 pytest timeout
            await asyncio.wait_for(
                svc.close_interactive_run(
                    lease_id, run_id, token, status="success", is_error=False
                ),
                timeout=2.0,
            )

        # close 已返回（<2s），后台 task 仍挂起（证明 enqueue 且未 await）
        assert len(fired_tasks) == 1
        assert not fired_tasks[0].done()
        # 清理：取消挂起的后台 task
        hang_future.set_result(None)
        await asyncio.sleep(0)
        for t in fired_tasks:
            t.cancel()
