"""Tests for DaemonPermissionService (task-08 / FR-07 / D-007@v1).

Covers:
  - handle_permission_request: happy path publishes permission_request SSE +
    arms a 5min timer; validation matrix (missing session / runtime mismatch /
    session not active / manual=false / run mismatch / no current run) drops
    silently without publishing;
  - respond_permission: happy allow/deny path sends WS + cancels timer +
    publishes permission_resolved; offline (504) + not-found (404) +
    manual-disabled + non-active-session branches;
  - 5min timeout (fake-clock) auto-denies via ws_hub + publishes
    permission_resolved{reason:timeout};
  - duplicate response after timeout → 404 (timer already gone).
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.permission_service import (
    DaemonPermissionManualDisabled,
    DaemonPermissionNotFound,
    DaemonPermissionService,
)
from app.modules.daemon.protocol import PermissionRequestPayload
from app.modules.daemon.service import DaemonRuntimeOffline, DaemonService
from app.modules.daemon.ws_hub import DaemonWsHub

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"perm-{uid}@example.com",
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


async def _create_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    *,
    manual_approval: bool = True,
    status: str = "active",
    provider: str = "claude",
) -> tuple[AgentSession, AgentRun]:
    """Create a manual_approval AgentSession + running AgentRun + active lease."""
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider=provider,
        status=status,
        config={"manual_approval": manual_approval, "model": provider},
        turn_count=1,
        runtime_id=runtime_id,
        lease_id=uuid.uuid4(),
        created_at=datetime.now(UTC),
    )
    session.add(sess)
    await session.flush()
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code" if provider == "claude" else "codex",
        provider=provider,
        status="running",
        spec_strategy="interactive",
        agent_session_id=sess.id,
    )
    session.add(run)
    await session.commit()
    await session.refresh(sess)
    await session.refresh(run)
    return sess, run


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    # task-05：_publish_session_event 已迁入 SessionService，get_redis 从
    # session.service 模块取；permission_service 经 facade._publish_session_event
    # 委托到 SessionService，patch 必须跟随到 session 子包模块。
    with (
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


# _permission_timers isolation is handled globally by the
# `_isolate_permission_timers` autouse fixture in backend/conftest.py.


def _make_request_payload(
    session: AgentSession, run: AgentRun, *, request_id: str = "req-1"
) -> PermissionRequestPayload:
    return PermissionRequestPayload(
        session_id=session.id,
        run_id=run.id,
        request_id=request_id,
        tool_name="Bash",
        input={"command": "ls"},
    )


def _make_dialog_payload(
    session: AgentSession,
    run: AgentRun,
    *,
    request_id: str = "dlg-1",
    dialog_kind: str = "ask_user_question",
) -> PermissionRequestPayload:
    """AskUserQuestion-style payload: dialog_kind set + question/options blob."""
    return PermissionRequestPayload(
        session_id=session.id,
        run_id=run.id,
        request_id=request_id,
        tool_name="AskUserQuestion",
        input={},
        dialog_kind=dialog_kind,
        dialog_payload={
            "question": "Which approach do you prefer?",
            "options": [
                {"label": "A", "description": "do thing A"},
                {"label": "B", "description": "do thing B"},
            ],
        },
    )


# ── handle_permission_request ────────────────────────────────────────────────


class TestHandlePermissionRequest:
    @pytest.mark.asyncio
    async def test_happy_path_publishes_sse_and_arms_timer(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)

        await perm.handle_permission_request(rt.id, _make_request_payload(sess, run))

        # SSE permission_request published
        calls = [c for c in mocked_redis.publish.await_args_list]
        assert any(
            c.args[0] == f"agent_session:{sess.id}" and "permission_request" in c.args[1]
            for c in calls
        ), f"expected permission_request publish, got: {[c.args for c in calls]}"
        # Timer armed
        assert "req-1" in perm._timers
        # Cleanup — cancel AND await so the timeout task is reaped before loop
        # shutdown (the conftest `_isolate_permission_timers` fixture also does
        # this defensively, but each test should clean up its own tasks).
        _task = perm._timers["req-1"]
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass

    @pytest.mark.asyncio
    async def test_manual_false_drops_without_publishing(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id, manual_approval=False)

        svc = DaemonService(db_session)
        perm = DaemonPermissionService(svc, MagicMock(), timeout_sec=30.0)

        await perm.handle_permission_request(rt.id, _make_request_payload(sess, run))

        assert all(
            "permission_request" not in c.args[1] for c in mocked_redis.publish.await_args_list
        )
        assert len(perm._timers) == 0

    @pytest.mark.asyncio
    async def test_runtime_mismatch_drops(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        perm = DaemonPermissionService(svc, MagicMock(), timeout_sec=30.0)

        # Different runtime_id
        await perm.handle_permission_request(uuid.uuid4(), _make_request_payload(sess, run))
        assert len(perm._timers) == 0
        assert mocked_redis.publish.await_count == 0

    @pytest.mark.asyncio
    async def test_run_mismatch_drops(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        perm = DaemonPermissionService(svc, MagicMock(), timeout_sec=30.0)

        # Wrong run_id
        bad = PermissionRequestPayload(
            session_id=sess.id,
            run_id=uuid.uuid4(),
            request_id="req-x",
            tool_name="Bash",
            input={"command": "ls"},
        )
        await perm.handle_permission_request(rt.id, bad)
        assert len(perm._timers) == 0

    @pytest.mark.asyncio
    async def test_session_not_active_drops(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id, status="ended")

        svc = DaemonService(db_session)
        perm = DaemonPermissionService(svc, MagicMock(), timeout_sec=30.0)

        await perm.handle_permission_request(rt.id, _make_request_payload(sess, run))
        assert len(perm._timers) == 0


# ── respond_permission ───────────────────────────────────────────────────────


class TestRespondPermission:
    @pytest.mark.asyncio
    async def test_allow_sends_ws_and_cancels_timer(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(rt.id, _make_request_payload(sess, run))
        assert "req-1" in perm._timers

        result = await perm.respond_permission(
            user_id=uid,
            session_id=sess.id,
            request_id="req-1",
            decision="allow",
        )
        assert result.accepted is True
        assert result.decision == "allow"
        hub.send_permission_response.assert_awaited_once()
        ws_arg = hub.send_permission_response.await_args
        assert ws_arg.args[0] == rt.id
        assert ws_arg.args[1]["decision"] == "allow"
        assert ws_arg.args[1]["request_id"] == "req-1"
        # Timer removed
        assert "req-1" not in perm._timers

    @pytest.mark.asyncio
    async def test_deny_with_message_propagated(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(rt.id, _make_request_payload(sess, run))

        await perm.respond_permission(
            user_id=uid,
            session_id=sess.id,
            request_id="req-1",
            decision="deny",
            message="no way",
        )
        ws_arg = hub.send_permission_response.await_args
        assert ws_arg.args[1]["message"] == "no way"

    @pytest.mark.asyncio
    async def test_unknown_request_id_raises_not_found(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        perm = DaemonPermissionService(svc, MagicMock(), timeout_sec=30.0)

        with pytest.raises(DaemonPermissionNotFound):
            await perm.respond_permission(
                user_id=uid,
                session_id=sess.id,
                request_id="never",
                decision="allow",
            )

    @pytest.mark.asyncio
    async def test_runtime_offline_raises_504(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=False)  # offline
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(rt.id, _make_request_payload(sess, run))

        with pytest.raises(DaemonRuntimeOffline):
            await perm.respond_permission(
                user_id=uid,
                session_id=sess.id,
                request_id="req-1",
                decision="allow",
            )

    @pytest.mark.asyncio
    async def test_offline_rearms_timer_so_retry_does_not_404(
        self, db_session, mocked_redis
    ) -> None:
        """P1-2：offline 504 后必须 re-arm timer，否则用户重试同一 request_id 会 404。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        # 第一次 send 失败（offline），第二次成功
        hub.send_permission_response = AsyncMock(side_effect=[False, True])
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(rt.id, _make_request_payload(sess, run))

        # 第一次：offline → 504，但 timer 必须 re-arm 留在 dict 里
        with pytest.raises(DaemonRuntimeOffline):
            await perm.respond_permission(
                user_id=uid,
                session_id=sess.id,
                request_id="req-1",
                decision="allow",
            )
        # P1-2 关键断言：re-arm 后 timer 仍在 dict（不是 404 的 None）
        assert "req-1" in perm._timers

        # 第二次重试：send 成功 → accepted，不再 504
        result = await perm.respond_permission(
            user_id=uid,
            session_id=sess.id,
            request_id="req-1",
            decision="allow",
        )
        assert result.accepted is True
        # 重试成功后 timer 被消费
        assert "req-1" not in perm._timers

    @pytest.mark.asyncio
    async def test_manual_disabled_raises(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _run = await _create_session(db_session, uid, rt.id, manual_approval=False)

        svc = DaemonService(db_session)
        perm = DaemonPermissionService(svc, MagicMock(), timeout_sec=30.0)
        with pytest.raises(DaemonPermissionManualDisabled):
            await perm.respond_permission(
                user_id=uid,
                session_id=sess.id,
                request_id="req-1",
                decision="allow",
            )

    @pytest.mark.asyncio
    async def test_non_owner_session_raises_not_found(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _run = await _create_session(db_session, uid, rt.id)
        other_uid = uuid.uuid4()

        svc = DaemonService(db_session)
        perm = DaemonPermissionService(svc, MagicMock(), timeout_sec=30.0)
        # _get_owned_session_for_update raises 404 for non-owner
        from app.modules.daemon.service import DaemonSessionNotFound

        with pytest.raises(DaemonSessionNotFound):
            await perm.respond_permission(
                user_id=other_uid,
                session_id=sess.id,
                request_id="req-1",
                decision="allow",
            )


# ── 5min timeout (fake clock) ────────────────────────────────────────────────


class TestPermissionTimeout:
    @pytest.mark.asyncio
    async def test_timeout_auto_denies_via_ws_and_publishes_timeout(
        self, db_session, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(rt.id, _make_request_payload(sess, run))

        # Fast-forward the timeout task (bypass real 5min sleep).
        task = perm._timers["req-1"]
        # Cancel the sleeping task and re-schedule with 0 delay by calling
        # _on_timeout directly after popping.
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        perm._timers.pop("req-1", None)
        await perm._on_timeout(sess.id, run.id, "req-1", rt.id)

        # WS deny sent
        ws_calls = hub.send_permission_response.await_args_list
        assert any(
            c.args[1]["decision"] == "deny" and c.args[1]["request_id"] == "req-1" for c in ws_calls
        )
        # SSE permission_resolved{reason:timeout} published
        assert any(
            "permission_resolved" in c.args[1] and "timeout" in c.args[1]
            for c in mocked_redis.publish.await_args_list
        )

    @pytest.mark.asyncio
    async def test_duplicate_response_after_timeout_raises_not_found(
        self, db_session, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(rt.id, _make_request_payload(sess, run))

        # Simulate timeout popping the timer
        task = perm._timers.pop("req-1")
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        # User response arrives late → 404
        with pytest.raises(DaemonPermissionNotFound):
            await perm.respond_permission(
                user_id=uid,
                session_id=sess.id,
                request_id="req-1",
                decision="allow",
            )


# ── send_permission_response envelope (ws_hub integration) ───────────────────


class TestWsHubSendPermissionResponse:
    @pytest.mark.asyncio
    async def test_envelope_wraps_send_to_runtime(self) -> None:
        from typing import Any

        hub = DaemonWsHub()
        rid = uuid.uuid4()
        ws = AsyncMock()
        ws.sent = []

        async def _send_json(message: dict[str, Any]) -> None:
            ws.sent.append(message)

        ws.send_json = AsyncMock(side_effect=_send_json)
        ws.close = AsyncMock()
        await hub.connect(rid, ws)

        payload = {
            "session_id": str(uuid.uuid4()),
            "request_id": "req-1",
            "decision": "deny",
        }
        ok = await hub.send_permission_response(rid, payload)
        assert ok is True
        assert ws.sent[0]["type"] == "daemon:permission_response"
        assert ws.sent[0]["payload"] == payload


# ── task-07 / FR-08 / D-006@v1 / D-008@v1: Codex permission/dialog parity ───


class TestCodexPermissionParity:
    """Backend 层 permission/dialog 通道 provider-neutral（FR-08/FR-09, D-006/D-008）.

    D-008@v1：``handle_permission_request`` / ``respond_permission`` 不依赖
    provider == claude；codex session 走相同 DaemonPermissionService 路径，
    策略（manual_approval / ask_user_only / timeout fail-closed）行为一致。
    """

    @pytest.mark.asyncio
    async def test_codex_handle_publishes_sse_and_arms_timer(
        self, db_session, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id, provider="codex")

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)

        payload = _make_request_payload(sess, run, request_id="codex-req-1")
        await perm.handle_permission_request(rt.id, payload)

        # SSE permission_request published on the codex session channel.
        assert any(
            c.args[0] == f"agent_session:{sess.id}" and "permission_request" in c.args[1]
            for c in mocked_redis.publish.await_args_list
        )
        assert "codex-req-1" in perm._timers
        _task = perm._timers["codex-req-1"]
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass

    @pytest.mark.asyncio
    async def test_codex_manual_false_drops_without_publishing(
        self, db_session, mocked_redis
    ) -> None:
        """FR-08：codex manual_approval=false 时 permission request 静默丢弃。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(
            db_session, uid, rt.id, provider="codex", manual_approval=False
        )

        svc = DaemonService(db_session)
        perm = DaemonPermissionService(svc, MagicMock(), timeout_sec=30.0)
        await perm.handle_permission_request(
            rt.id, _make_request_payload(sess, run, request_id="codex-req-2")
        )

        assert all(
            "permission_request" not in c.args[1] for c in mocked_redis.publish.await_args_list
        )
        assert len(perm._timers) == 0

    @pytest.mark.asyncio
    async def test_codex_respond_allow_sends_ws_and_cancels_timer(
        self, db_session, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id, provider="codex")

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(
            rt.id, _make_request_payload(sess, run, request_id="codex-req-3")
        )
        assert "codex-req-3" in perm._timers

        result = await perm.respond_permission(
            user_id=uid,
            session_id=sess.id,
            request_id="codex-req-3",
            decision="allow",
        )
        assert result.accepted is True
        assert result.decision == "allow"
        hub.send_permission_response.assert_awaited_once()
        ws_arg = hub.send_permission_response.await_args
        assert ws_arg.args[0] == rt.id
        assert ws_arg.args[1]["decision"] == "allow"
        assert ws_arg.args[1]["request_id"] == "codex-req-3"
        assert "codex-req-3" not in perm._timers

    @pytest.mark.asyncio
    async def test_codex_timeout_fail_closed_deny(self, db_session, mocked_redis) -> None:
        """FR-08/D-006：codex permission timeout → fail-closed deny（不自动 accept）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id, provider="codex")

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(
            rt.id, _make_request_payload(sess, run, request_id="codex-req-4")
        )

        task = perm._timers["codex-req-4"]
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        perm._timers.pop("codex-req-4", None)
        await perm._on_timeout(sess.id, run.id, "codex-req-4", rt.id)

        ws_calls = hub.send_permission_response.await_args_list
        assert any(
            c.args[1]["decision"] == "deny" and c.args[1]["request_id"] == "codex-req-4"
            for c in ws_calls
        )
        assert any(
            "permission_resolved" in c.args[1] and "timeout" in c.args[1]
            for c in mocked_redis.publish.await_args_list
        )

    @pytest.mark.asyncio
    async def test_codex_dialog_request_treated_provider_neutral(
        self, db_session, mocked_redis
    ) -> None:
        """FR-09/D-008：codex 的 dialog_kind/payload 走同一 permission 通道。

        daemon 侧会把 Codex ``item/tool/requestUserInput`` 归一化为
        dialog_kind 后发到 backend；backend 不因 provider=codex 回退。dialog
        走 long-lived 路径（不 arm 5min timer），断言 SSE 发布 + 持久化 row。
        """
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id, provider="codex")

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)

        payload = _make_dialog_payload(
            sess,
            run,
            request_id="codex-dlg-1",
            dialog_kind="codex_request_user_input",
        )
        await perm.handle_permission_request(rt.id, payload)

        # dialog permission_request SSE published on the codex session channel.
        published = [
            c.args[1]
            for c in mocked_redis.publish.await_args_list
            if c.args[0] == f"agent_session:{sess.id}" and "permission_request" in c.args[1]
        ]
        assert published, "expected permission_request SSE for codex dialog"
        # dialog_kind + dialog_payload 透传（provider-neutral）。
        assert any("codex_request_user_input" in p for p in published)

        # dialog 持久化为 pending row（不走 5min timer）。
        pending = await perm.list_pending_dialogs(uid, sess.id)
        assert any(
            d.request_id == "codex-dlg-1" and d.dialog_kind == "codex_request_user_input"
            for d in pending
        )
        # dialogs 不 arm timer（long-lived）。
        assert "codex-dlg-1" not in perm._timers
