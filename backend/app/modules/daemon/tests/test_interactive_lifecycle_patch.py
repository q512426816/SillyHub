"""Tests for the interactive daemon lifecycle patch (gap-2/3/4).

Covers the D-002@v3 follow-up patch (change 2026-06-19-fix-interactive-daemon-lifecycle):
- gap-2: claim_token propagation chain
    * prepare_interactive_dispatch writes claim_token into lease metadata
    * claim_lease REUSES the pre-generated token (no rotation on claim)
    * SESSION_INJECT payload (first turn + inject_session) carries claim_token
- gap-3: run terminal close REST protocol
    * POST /leases/{lease_id}/runs/{run_id}/result (X-Claim-Token header auth)
    * service.close_interactive_run terminal mapping + idempotency + bind check
- gap-4: session end daemon uplink (covered indirectly via notifySessionEnd on the
    daemon side; backend reuses the existing end_session route — see test_session_service
    for end_session coverage). This file asserts the daemon uplink contract is honored
    by end_session under api-key auth semantics.

Uses the in-memory SQLite session fixture from backend/conftest.py. WS hub and
Redis are mocked so no live infra is required.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.protocol import (
    DAEMON_MSG_SESSION_INJECT,
    SessionInjectPayload,
)
from app.modules.daemon.service import (
    DaemonAgentRunNotFound,
    DaemonInvalidClaimToken,
    DaemonLeaseNotFound,
    DaemonService,
)

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"patch-{uid}@example.com",
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


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    with patch("app.modules.daemon.service.get_redis", return_value=redis):
        yield redis


# ── gap-2: claim_token propagation ───────────────────────────────────────────


class TestGap2ClaimTokenPropagation:
    @pytest.mark.asyncio
    async def test_prepare_interactive_dispatch_writes_claim_token(
        self, db_session: AsyncSession
    ) -> None:
        """gap-2 design §3: lease metadata must carry claim_token at prepare time."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        placement = RunPlacementService(db_session)
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
        )

        # claim_token exposed on InteractiveDispatch (gap-2)
        assert dispatch.claim_token
        assert len(dispatch.claim_token) == 64  # secrets.token_hex(32)

        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        meta = lease.metadata_ or {}
        assert meta["claim_token"] == dispatch.claim_token

    @pytest.mark.asyncio
    async def test_claim_lease_reuses_pre_generated_claim_token(
        self, db_session: AsyncSession
    ) -> None:
        """gap-2: claim_lease must NOT rotate the token that prepare wrote (cross-turn stable)."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        placement = RunPlacementService(db_session)
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
        )
        pre_token = dispatch.claim_token

        svc = DaemonService(db_session)
        lease, _payload = await svc.claim_lease(dispatch.lease_id, rt.id)

        # Same token reused (not rotated)
        meta = lease.metadata_ or {}
        assert meta["claim_token"] == pre_token

    @pytest.mark.asyncio
    async def test_claim_lease_generates_token_for_batch_lease(
        self, db_session: AsyncSession
    ) -> None:
        """gap-2 regression: batch lease has no pre-generated token → claim generates one."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # ql-004 起 batch lease 必须 agent_run_id 非空：_build_claim_payload 对
        # kind!=interactive 且 agent_run_id IS NULL 的 lease fail-fast 抛
        # DaemonLeaseNoAgentRun（防 daemon 发空 agent_run_id → backend 422 风暴 →
        # 连接池耗尽）。故 batch lease fixture 必须挂一个真实 AgentRun，本用例才能
        # 走完 claim → 验证「无预生成 claim_token 时 claim_lease 生成新 token」。
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="pending",
            spec_strategy="oneshot",
        )
        batch_lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=run.id,
            kind="batch",
            status="pending",
            lease_expires_at=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db_session.add_all([run, batch_lease])
        await db_session.commit()

        svc = DaemonService(db_session)
        lease, _payload = await svc.claim_lease(batch_lease.id, rt.id)
        meta = lease.metadata_ or {}
        assert meta["claim_token"]
        assert len(meta["claim_token"]) == 64

    @pytest.mark.asyncio
    async def test_first_turn_session_inject_carries_claim_token(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """gap-2 design §3: first turn SESSION_INJECT payload must carry claim_token."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        await svc.create_session(uid, provider="claude", prompt="hello")

        assert mocked_hub.send_session_control.await_count == 1
        _rt, msg_type, payload = mocked_hub.send_session_control.await_args.args
        assert msg_type == DAEMON_MSG_SESSION_INJECT
        assert payload["claim_token"]
        assert len(payload["claim_token"]) == 64

        # SessionInjectPayload schema accepts claim_token (gap-2 protocol)
        parsed = SessionInjectPayload(
            session_id=payload["session_id"],
            lease_id=payload["lease_id"],
            run_id=payload["run_id"],
            prompt=payload["prompt"],
            claim_token=payload["claim_token"],
        )
        assert parsed.claim_token == payload["claim_token"]

    @pytest.mark.asyncio
    async def test_inject_session_carries_lease_claim_token(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """gap-2: subsequent inject_session SESSION_INJECT reuses the lease claim_token."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="hello")

        # Simulate daemon turn completion: mark the first run terminal so inject can proceed
        first_run = created.agent_run
        first_run.status = "completed"
        first_run.finished_at = datetime.now(UTC)
        db_session.add(first_run)
        await db_session.commit()

        mocked_hub.send_session_control.reset_mock()
        await svc.inject_session(created.agent_session.id, uid, prompt="turn 2")

        assert mocked_hub.send_session_control.await_count == 1
        _rt, msg_type, payload = mocked_hub.send_session_control.await_args.args
        assert msg_type == DAEMON_MSG_SESSION_INJECT
        assert payload["claim_token"]
        # Same lease → same token as the first turn
        lease = await db_session.get(DaemonTaskLease, created.lease_id)
        assert payload["claim_token"] == (lease.metadata_ or {})["claim_token"]


# ── gap-3: close_interactive_run ─────────────────────────────────────────────


async def _seed_active_interactive_session(
    db_session: AsyncSession,
    *,
    run_status: str = "running",
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """Build an active interactive session + lease + run + claim_token.

    Returns (lease_id, run_id, claim_token). The session_id is internal — callers
    only need the lease/run/token to drive close_interactive_run.
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
    # Backfill the triple as create_session would (minimal: session + run row).
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


class TestGap3CloseInteractiveRun:
    @pytest.mark.asyncio
    async def test_success_marks_completed(self, db_session, mocked_redis) -> None:
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        run = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            subtype="success",
        )
        assert run.status == "completed"
        assert run.exit_code == 0
        assert run.finished_at is not None

    @pytest.mark.asyncio
    async def test_error_during_execution_marks_failed_interrupted(
        self, db_session, mocked_redis
    ) -> None:
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        run = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error_during_execution",
            is_error=True,
            subtype="error_during_execution",
        )
        assert run.status == "failed"
        assert run.error_code == "interactive_interrupted"
        assert run.finished_at is not None

    @pytest.mark.asyncio
    async def test_generic_error_marks_failed(self, db_session, mocked_redis) -> None:
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        run = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error_max_turns",
            is_error=True,
        )
        assert run.status == "failed"
        assert run.error_code == "interactive_failed"

    @pytest.mark.asyncio
    async def test_idempotent_on_already_terminal_run(self, db_session, mocked_redis) -> None:
        """Daemon retry safety: closing an already-terminal run is a no-op."""
        lease_id, run_id, token = await _seed_active_interactive_session(
            db_session, run_status="completed"
        )
        svc = DaemonService(db_session)
        run = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
        )
        # Stays completed — not flipped, not double-written
        assert run.status == "completed"

    @pytest.mark.asyncio
    async def test_wrong_claim_token_rejected(self, db_session, mocked_redis) -> None:
        lease_id, run_id, _token = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        with pytest.raises(DaemonInvalidClaimToken):
            await svc.close_interactive_run(
                lease_id,
                run_id,
                "wrong-token",
                status="success",
                is_error=False,
            )

    @pytest.mark.asyncio
    async def test_run_not_bound_to_lease_session_rejected(self, db_session, mocked_redis) -> None:
        """Cross-session run injection guard: run must belong to lease's session."""
        lease_id1, _run_id1, token1 = await _seed_active_interactive_session(db_session)
        # Second independent session + lease + run
        _lease_id2, run_id2, _token2 = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        # Try to close run_id2 (session2) using lease1's token → must 404.
        with pytest.raises(DaemonAgentRunNotFound):
            await svc.close_interactive_run(
                lease_id1,
                run_id2,
                token1,
                status="success",
                is_error=False,
            )

    @pytest.mark.asyncio
    async def test_missing_lease_rejected(self, db_session, mocked_redis) -> None:
        svc = DaemonService(db_session)
        with pytest.raises(DaemonLeaseNotFound):
            await svc.close_interactive_run(
                uuid.uuid4(),
                uuid.uuid4(),
                "any",
                status="success",
                is_error=False,
            )

    @pytest.mark.asyncio
    async def test_result_summary_redacted_and_stored(self, db_session, mocked_redis) -> None:
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        run = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            result_summary="Task completed with output",
        )
        assert run.output_redacted == "Task completed with output"

    @pytest.mark.asyncio
    async def test_usage_cost_duration_persisted(self, db_session, mocked_redis) -> None:
        """SDKResultSuccess 透传字段（total_cost_usd/num_turns/duration_ms/
        duration_api_ms/input_tokens/output_tokens）必须写入 AgentRun，
        否则 interactive 路径这些列全 NULL（对齐 batch completeLease）。"""
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        run = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            total_cost_usd=0.0123,
            num_turns=3,
            duration_ms=4567,
            duration_api_ms=3900,
            input_tokens=1024,
            output_tokens=512,
        )
        assert run.total_cost_usd == pytest.approx(0.0123)
        assert run.num_turns == 3
        assert run.duration_ms == 4567
        assert run.duration_api_ms == 3900
        assert run.input_tokens == 1024
        assert run.output_tokens == 512
        # reload from db to be sure commit stuck
        reloaded = await db_session.get(AgentRun, run_id)
        assert reloaded is not None
        assert reloaded.total_cost_usd == pytest.approx(0.0123)
        assert reloaded.input_tokens == 1024
        assert reloaded.output_tokens == 512
        assert reloaded.num_turns == 3
        assert reloaded.duration_ms == 4567
        assert reloaded.duration_api_ms == 3900

    @pytest.mark.asyncio
    async def test_usage_cost_duration_none_leaves_row_unchanged(
        self, db_session, mocked_redis
    ) -> None:
        """Daemon 未传 usage 字段（None）时不应覆盖 AgentRun 既有值（向后兼容）。"""
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        # Pre-set some values to ensure None args don't clobber them.
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        run.total_cost_usd = 0.05
        run.input_tokens = 999
        run.output_tokens = 888
        await db_session.commit()

        svc = DaemonService(db_session)
        run2 = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            # all usage/cost/duration fields omitted (default None)
        )
        assert run2.total_cost_usd == pytest.approx(0.05)
        assert run2.input_tokens == 999
        assert run2.output_tokens == 888

    @pytest.mark.asyncio
    async def test_publishes_terminal_redis_event(self, db_session, mocked_redis) -> None:
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
        )
        # Redis publish attempted on the run channel（close 还会向
        # agent_session:{session_id} 发 turn_completed，故不假设末次/顺序）。
        assert mocked_redis.publish.await_count >= 1
        channels = [call.args[0] for call in mocked_redis.publish.await_args_list]
        assert f"agent_run:{run_id}" in channels

    @pytest.mark.asyncio
    async def test_publishes_turn_completed_to_session_channel(
        self, db_session, mocked_redis
    ) -> None:
        """design §6 step3 / §8.2：close 必须往 agent_session:{session_id} 发
        turn_completed（带 status/exit_code），否则前端 SSE onTurnCompleted 收不
        到、currentRunId 不清空、输入框永远 disabled —— 即用户报告「turn 在后端
        已完成但前端卡在运行中、发不了下一条」。契约见 frontend/src/lib/daemon.ts
        SessionStreamEnvelope（event=turn_completed + status + exit_code）。"""
        import json as _json

        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        await svc.close_interactive_run(lease_id, run_id, token, status="success", is_error=False)

        run = await db_session.get(AgentRun, run_id)
        session_id = run.agent_session_id
        session_pubs = [
            call.args[1]
            for call in mocked_redis.publish.await_args_list
            if call.args[0] == f"agent_session:{session_id}"
        ]
        assert session_pubs, "turn_completed 未发到 session channel"

        payload = _json.loads(session_pubs[0])
        assert payload["event"] == "turn_completed"
        assert payload["session_id"] == str(session_id)
        assert payload["run_id"] == str(run_id)
        assert payload["status"] == "completed"
        assert payload["exit_code"] == 0

    @pytest.mark.asyncio
    async def test_publishes_turn_completed_failed_status(self, db_session, mocked_redis) -> None:
        """turn_completed 在 failed turn 也要发，且 status/exit_code 反映失败
        （前端据此把 turn 渲染成失败并解锁输入）。"""
        import json as _json

        lease_id, run_id, token = await _seed_active_interactive_session(db_session)
        svc = DaemonService(db_session)
        await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="error_during_execution",
            is_error=True,
        )

        run = await db_session.get(AgentRun, run_id)
        session_pubs = [
            call.args[1]
            for call in mocked_redis.publish.await_args_list
            if call.args[0] == f"agent_session:{run.agent_session_id}"
        ]
        assert session_pubs
        payload = _json.loads(session_pubs[0])
        assert payload["event"] == "turn_completed"
        assert payload["status"] == "failed"
        assert payload["exit_code"] == 1


# ── gap-3: router endpoint contract ──────────────────────────────────────────


class TestGap3RouterEndpoint:
    """Smoke-test the router wiring via TestClient (header auth + status mapping)."""

    @pytest.fixture()
    def app_client(self, db_session, mocked_hub, mocked_redis):
        from fastapi import FastAPI

        from app.modules.daemon.router import router

        app = FastAPI()
        app.include_router(router, prefix="/api")

        # Override get_session to use the test session
        async def _override():
            yield db_session

        from app.core.db import get_session

        app.dependency_overrides[get_session] = _override
        return app

    @pytest.mark.asyncio
    async def test_endpoint_closes_run_via_header_claim_token(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        # Seed first, then build client (session already populated)
        lease_id, run_id, token = await _seed_active_interactive_session(db_session)

        from fastapi import FastAPI
        from starlette.testclient import TestClient

        from app.core.db import get_session
        from app.modules.daemon.router import router

        app = FastAPI()
        app.include_router(router, prefix="/api")

        async def _override():
            yield db_session

        app.dependency_overrides[get_session] = _override
        # Bypass get_current_principal (daemon api-key path) for unit test
        from app.core.auth_deps import get_current_principal
        from app.modules.auth.model import User

        stub_user = User(
            id=uuid.UUID(int=1),
            email="daemon@test",
            password_hash="x",
            display_name="daemon",
            status="active",
        )

        async def _stub_principal():
            return stub_user

        app.dependency_overrides[get_current_principal] = _stub_principal

        with TestClient(app) as client:
            resp = client.post(
                f"/api/daemon/leases/{lease_id}/runs/{run_id}/result",
                headers={"X-Claim-Token": token},
                json={"status": "success", "is_error": False},
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["agent_run_id"] == str(run_id)
        assert body["status"] == "completed"

    @pytest.mark.asyncio
    async def test_endpoint_rejects_missing_claim_token_header(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        # lease_id unused here (endpoint 422s on header validation before service)
        _lease_id, run_id, _token = await _seed_active_interactive_session(db_session)

        from fastapi import FastAPI
        from starlette.testclient import TestClient

        from app.core.auth_deps import get_current_principal
        from app.core.db import get_session
        from app.modules.auth.model import User
        from app.modules.daemon.router import router

        app = FastAPI()
        app.include_router(router, prefix="/api")

        async def _override():
            yield db_session

        async def _stub_principal():
            return User(
                id=uuid.UUID(int=1),
                email="daemon@test",
                password_hash="x",
                display_name="daemon",
                status="active",
            )

        app.dependency_overrides[get_session] = _override
        app.dependency_overrides[get_current_principal] = _stub_principal

        with TestClient(app) as client:
            # No X-Claim-Token header → 422 (Fastapi Header min_length=1 validation)
            resp = client.post(
                f"/api/daemon/leases/{_lease_id}/runs/{run_id}/result",
                json={"status": "success", "is_error": False},
            )
        assert resp.status_code == 422


# ── gap-4: session end daemon uplink (end_session reuse) ─────────────────────


class TestGap4SessionEndUplink:
    """gap-4 / design §5: daemon → backend session end via POST /sessions/{id}/end.

    Backend reuses the existing end_session route (task-05). The daemon-side
    notifySessionEnd is covered in tests/hub-client.test.ts (TS). Here we verify
    end_session converges session + lease under the ownership model that a daemon
    api-key-authenticated caller would satisfy (the api-key resolves to the same
    user_id that owns the session).
    """

    @pytest.mark.asyncio
    async def test_end_session_converges_triple(self, db_session, mocked_hub, mocked_redis) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="hi")

        result = await svc.end_session(created.agent_session.id, uid, reason="manual")
        assert result.agent_session.status == "ended"

        lease = await db_session.get(DaemonTaskLease, created.lease_id)
        assert lease.status == "completed"

    @pytest.mark.asyncio
    async def test_end_session_idempotent(self, db_session, mocked_hub, mocked_redis) -> None:
        """Daemon retry safety: ending an already-ended session is a no-op."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="hi")

        await svc.end_session(created.agent_session.id, uid, reason="manual")
        # Second end → no error, stays ended
        result = await svc.end_session(created.agent_session.id, uid, reason="idle_timeout")
        assert result.agent_session.status == "ended"


class TestGap4SessionEndRouterBody:
    """gap-4: end_session endpoint accepts daemon body {status, reason}.

    Daemon notifySessionEnd POSTs a JSON body; the front-end keeps using
    ``?reason=`` query. Body reason must take precedence when present.
    """

    @pytest.mark.asyncio
    async def test_body_reason_overrides_query(self, db_session, mocked_hub, mocked_redis) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="hi")

        from fastapi import FastAPI
        from starlette.testclient import TestClient

        from app.core.auth_deps import get_current_principal
        from app.core.db import get_session
        from app.modules.auth.model import User
        from app.modules.daemon.router import router

        app = FastAPI()
        app.include_router(router, prefix="/api")

        async def _override():
            yield db_session

        stub_user = User(
            id=uid,
            email=f"u-{uid}@x",
            password_hash="x",
            display_name="daemon",
            status="active",
        )

        async def _stub_principal():
            return stub_user

        app.dependency_overrides[get_session] = _override
        app.dependency_overrides[get_current_principal] = _stub_principal

        # Bypass RBAC for the stub user (no role rows) — this test targets the
        # router body/query reason merge, not authorization.
        with patch("app.core.auth_deps.has_permission", new=AsyncMock(return_value=True)):
            with TestClient(app) as client:
                resp = client.post(
                    f"/api/daemon/sessions/{created.agent_session.id}/end",
                    params={"reason": "manual"},
                    json={"status": "ended", "reason": "idle_timeout"},
                )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "ended"

    @pytest.mark.asyncio
    async def test_query_only_still_works(self, db_session, mocked_hub, mocked_redis) -> None:
        """Front-end path (query param, no body) must keep working."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="hi")

        from fastapi import FastAPI
        from starlette.testclient import TestClient

        from app.core.auth_deps import get_current_principal
        from app.core.db import get_session
        from app.modules.auth.model import User
        from app.modules.daemon.router import router

        app = FastAPI()
        app.include_router(router, prefix="/api")

        async def _override():
            yield db_session

        stub_user = User(
            id=uid,
            email=f"u-{uid}@x",
            password_hash="x",
            display_name="daemon",
            status="active",
        )

        async def _stub_principal():
            return stub_user

        app.dependency_overrides[get_session] = _override
        app.dependency_overrides[get_current_principal] = _stub_principal

        with patch("app.core.auth_deps.has_permission", new=AsyncMock(return_value=True)):
            with TestClient(app) as client:
                resp = client.post(
                    f"/api/daemon/sessions/{created.agent_session.id}/end",
                    params={"reason": "user_clicked"},
                )
        assert resp.status_code == 200, resp.text
