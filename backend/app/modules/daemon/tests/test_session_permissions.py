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
  - duplicate response after timeout → 404 (timer already gone);
  - task-09（2026-09-09-askuser-pi-cursor / D-004@v2 / D-006@v2 / R-08）：群聊
    影子会话（kind='group_member'）ask_user dialog 答题授权放开——群成员可答
    （answered_by=实际答题人 + SSE answered_by_actual_user）、manual_approval
    守卫对 dialog 应答豁免（普通权限审批不豁免）、越权反例（非群成员/已移除
    成员/普通单聊非属主/跨会话 request_id 借道一律 404，已答 409 幂等）。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
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
        # ql-20260904-023：payload 携带 runtime_id（daemon ack 归属桶键）。
        assert ws_arg.args[1]["runtime_id"] == str(rt.id)
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
        # ql-20260904-023：deny+message 路径同样携带 runtime_id。
        assert ws_arg.args[1]["runtime_id"] == str(rt.id)

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

    @pytest.mark.asyncio
    async def test_dialog_response_payload_carries_runtime_id(
        self, db_session, mocked_redis
    ) -> None:
        """ql-20260904-023：dialog 应答（_respond_dialog）WS payload 携带
        runtime_id——daemon WS 消费后 ack 按 runtime 桶立即冲刷的归属键
        （事故会话 e148364e：旧 payload 无此键，ack 落 UNKNOWN 桶等不到捎带，
        backend GC 把等用户回答的活轮按 delivered-未-ack 判死）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(
            rt.id, _make_dialog_payload(sess, run, request_id="dlg-rt-1")
        )

        result = await perm.respond_permission(
            uid,
            sess.id,
            "dlg-rt-1",
            "allow",
            dialog_result={"answers": [{"question": "q", "answer": "A"}]},
        )
        assert result.accepted is True
        hub.send_permission_response.assert_awaited_once()
        ws_arg = hub.send_permission_response.await_args
        assert ws_arg.args[1]["runtime_id"] == str(rt.id)
        assert ws_arg.args[1]["dialog_result"] == {"answers": [{"question": "q", "answer": "A"}]}


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
        # timeout 调小：本测试直接 await _on_timeout，其内部第一行
        # asyncio.sleep(_timeout_sec)，30.0 会真等 30s（top30 慢点之一）。
        # 0.01 仍走完整 deny + publish 路径，仅免真等。
        perm = DaemonPermissionService(svc, hub, timeout_sec=0.01)
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
        # ql-20260904-023：超时 deny 路径携带 runtime_id（daemon ack 归属桶键）。
        assert any(c.args[1].get("runtime_id") == str(rt.id) for c in ws_calls)
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
        # 同 test_timeout_auto_denies：直接 await _on_timeout，调小免真等 30s。
        perm = DaemonPermissionService(svc, hub, timeout_sec=0.01)
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

    async def test_list_dialog_history_returns_pending_and_answered(
        self, db_session, mocked_redis
    ) -> None:
        """ql-20260801-003：list_dialog_history 返回 pending+answered 全部（历史展示）。

        ``list_pending_dialogs`` 只返回 pending（页面刷新恢复用）；历史端点需返回
        全部，否则已答问答在卡片移除后、failed/ended 会话里都不可见。插 2 个
        dialog，手动把 1 个标 answered，断言 history 含两者、pending 只含未答那个。
        """
        from sqlalchemy import update

        from app.modules.daemon.model import SessionDialogRequest

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)

        await perm.handle_permission_request(
            rt.id,
            _make_dialog_payload(sess, run, request_id="hist-1", dialog_kind="AskUserQuestion"),
        )
        await perm.handle_permission_request(
            rt.id,
            _make_dialog_payload(sess, run, request_id="hist-2", dialog_kind="AskUserQuestion"),
        )

        # 手动把 hist-1 标 answered + 回填 answer（模拟已答历史，绕过 respond 全链路）。
        await db_session.execute(
            update(SessionDialogRequest)
            .where(SessionDialogRequest.request_id == "hist-1")
            .values(
                status="answered",
                answer={"answers": [{"question": "q", "answer": "a"}]},
            )
        )
        await db_session.commit()

        history = await perm.list_dialog_history(uid, sess.id)
        assert {d.request_id for d in history} == {"hist-1", "hist-2"}
        answered = next(d for d in history if d.request_id == "hist-1")
        assert answered.status == "answered"
        assert answered.answer is not None

        # 对比：pending 端点只返回未答的 hist-2（刷新恢复语义不变）。
        pending = await perm.list_pending_dialogs(uid, sess.id)
        assert {d.request_id for d in pending} == {"hist-2"}


# ── ql-20260815-003：run 终止后孤儿 pending dialog 作废 ─────────────────────────


class TestOrphanDialogCancellation:
    """run 终止（后端重启清 stale / daemon 重启 converge）后 pending dialog 作废。

    根因实测：backend 容器重启把 in-flight run 标 failed（"Run interrupted:
    service restarted..."），同期弹出的 AskUserQuestion 卡片永久停在 pending，
    用户点卡只得到 "no active run to approve"。
    """

    @pytest.mark.asyncio
    async def test_cancel_pending_dialogs_for_run_marks_cancelled(
        self, db_session, mocked_redis
    ) -> None:
        """模块级 helper：pending 行置 cancelled；answered 行不动。"""
        from sqlalchemy import select, update

        from app.modules.daemon.model import SessionDialogRequest
        from app.modules.daemon.permission_service import cancel_pending_dialogs_for_run

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)
        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)

        await perm.handle_permission_request(
            rt.id, _make_dialog_payload(sess, run, request_id="cx-1")
        )
        await perm.handle_permission_request(
            rt.id, _make_dialog_payload(sess, run, request_id="cx-2")
        )
        await db_session.execute(
            update(SessionDialogRequest)
            .where(SessionDialogRequest.request_id == "cx-2")
            .values(status="answered")
        )
        await db_session.commit()

        cancelled = await cancel_pending_dialogs_for_run(db_session, run.id)
        await db_session.commit()

        assert cancelled == 1
        rows = {
            r.request_id: r.status
            for r in ((await db_session.execute(select(SessionDialogRequest))).scalars().all())
        }
        assert rows == {"cx-1": "cancelled", "cx-2": "answered"}

    @pytest.mark.asyncio
    async def test_cleanup_stale_runs_cancels_pending_dialogs(
        self, db_session, mocked_redis
    ) -> None:
        """后端重启恢复路径：_cleanup_stale_runs_impl 把 stale run 标 failed 的
        同时，作废其 pending dialog（no commit 依赖：函数末尾统一 commit）。"""
        from sqlalchemy import select

        from app.modules.agent.service import _cleanup_stale_runs_impl
        from app.modules.daemon.model import SessionDialogRequest

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)  # run status=running
        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(
            rt.id, _make_dialog_payload(sess, run, request_id="stale-1")
        )

        cleaned = await _cleanup_stale_runs_impl(db_session)

        assert cleaned == 1
        await db_session.refresh(run)
        assert run.status == "failed"
        row = (
            (
                await db_session.execute(
                    select(SessionDialogRequest).where(SessionDialogRequest.request_id == "stale-1")
                )
            )
            .scalars()
            .one()
        )
        assert row.status == "cancelled"

    @pytest.mark.asyncio
    async def test_converge_crashed_run_cancels_pending_dialogs(
        self, db_session, mocked_redis
    ) -> None:
        """daemon 重启恢复路径：_converge_crashed_run 把 run 收敛 failed 时
        同步作废其 pending dialog（随调用方事务一起 commit）。"""
        from sqlalchemy import select

        from app.modules.daemon.model import SessionDialogRequest

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)
        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(
            rt.id, _make_dialog_payload(sess, run, request_id="conv-1")
        )

        result = await svc._sess._converge_crashed_run(session_id=sess.id, run_id=run.id)
        await db_session.commit()

        assert result == "failed"
        row = (
            (
                await db_session.execute(
                    select(SessionDialogRequest).where(SessionDialogRequest.request_id == "conv-1")
                )
            )
            .scalars()
            .one()
        )
        assert row.status == "cancelled"

    @pytest.mark.asyncio
    async def test_list_pending_dialogs_hides_dialog_of_terminal_run(
        self, db_session, mocked_redis
    ) -> None:
        """读侧兜底：run 已终态（cancelled 之外的漏网路径）时 pending 卡不出现在
        session 级 pending 列表（list_dialog_history 不受影响，仍可见历史）。"""
        from sqlalchemy import update

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)
        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(
            rt.id, _make_dialog_payload(sess, run, request_id="term-1")
        )
        # 模拟未经作废路径的终止（如普通 stream 收尾）。
        await db_session.execute(
            update(AgentRun).where(AgentRun.id == run.id).values(status="completed")
        )
        await db_session.commit()

        pending = await perm.list_pending_dialogs(uid, sess.id)
        assert all(d.request_id != "term-1" for d in pending)
        history = await perm.list_dialog_history(uid, sess.id)
        assert any(d.request_id == "term-1" for d in history)

    @pytest.mark.asyncio
    async def test_respond_cancelled_dialog_gives_clear_404(self, db_session, mocked_redis) -> None:
        """respond 校验顺序：终态（cancelled）dialog 行先于 current_run 检查解析——
        点孤儿卡得到明确「was cancelled」404，而非 no active run。"""
        from sqlalchemy import update

        from app.modules.daemon.model import SessionDialogRequest
        from app.modules.daemon.permission_service import DaemonDialogNotFound

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)
        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(
            rt.id, _make_dialog_payload(sess, run, request_id="orphan-1")
        )
        # run 直接终态 + dialog 手动置 cancelled（模拟恢复路径产物）。
        await db_session.execute(
            update(AgentRun).where(AgentRun.id == run.id).values(status="failed")
        )
        await db_session.execute(
            update(SessionDialogRequest)
            .where(SessionDialogRequest.request_id == "orphan-1")
            .values(status="cancelled")
        )
        await db_session.commit()

        with pytest.raises(DaemonDialogNotFound) as exc_info:
            await perm.respond_permission(
                uid,
                sess.id,
                "orphan-1",
                "allow",
                dialog_result={"answers": []},
            )
        assert "cancelled" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_list_dialog_history_capped_to_latest(
        self, db_session, mocked_redis, monkeypatch
    ) -> None:
        """ql-20260826-012：历史固定取最近 N 条再反转为创建序（原无界全量）。

        常量降到 3，种 5 个 dialog（created_at 显式递增）→ 只返回最新 3 个
        且按创建序（旧 → 新）排列。
        """
        from datetime import UTC as _UTC
        from datetime import datetime as _datetime
        from datetime import timedelta as _timedelta

        from sqlalchemy import update

        from app.modules.daemon import permission_service as perm_mod
        from app.modules.daemon.model import SessionDialogRequest

        monkeypatch.setattr(perm_mod, "_DIALOG_HISTORY_MAX", 3)

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)

        for i in range(5):
            await perm.handle_permission_request(
                rt.id,
                _make_dialog_payload(
                    sess, run, request_id=f"cap-{i}", dialog_kind="AskUserQuestion"
                ),
            )
        # created_at 显式递增，规避 rapid-insert 微秒碰撞导致的裁剪不确定。
        base = _datetime.now(_UTC) - _timedelta(minutes=5)
        for i in range(5):
            await db_session.execute(
                update(SessionDialogRequest)
                .where(SessionDialogRequest.request_id == f"cap-{i}")
                .values(created_at=base + _timedelta(seconds=i))
            )
        await db_session.commit()

        history = await perm.list_dialog_history(uid, sess.id)
        assert [d.request_id for d in history] == ["cap-2", "cap-3", "cap-4"], (
            "只返回最新 3 条且按创建序（旧 → 新）"
        )


# ── task-09（2026-09-09-askuser-pi-cursor）：影子会话 dialog 答题授权放开 ──────


async def _seed_group_shadow(
    db_session: AsyncSession,
    *,
    shadow_manual_approval: bool = True,
    user_member_removed: bool = False,
    with_user_member: bool = True,
) -> SimpleNamespace:
    """种一套群聊影子答题底座：workspace + 群会话（kind='group'）+ 群行 +
    agent 成员（影子反向指针）+ 影子会话（kind='group_member'，manual_approval
    可控）+ 影子 run + 用户成员行（答题人，可移除/缺省）。

    答题链路：影子会话（弹 ask_user dialog）→ 用户成员（``member_uid``）经
    respond_permission 影子放行分支作答；``outsider_uid`` 是无任何成员关系的
    路人（越权反例用）。影子会话 user_id=群主（``owner_uid``，归属同源）。
    """
    from app.modules.agent.model import AgentGroupChat, AgentGroupMember
    from app.modules.workspace.model import Workspace

    owner_uid = await _create_user(db_session)
    member_uid = await _create_user(db_session)
    outsider_uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, owner_uid)

    ws = Workspace(
        id=uuid.uuid4(),
        name="shadow-answer-ws",
        slug=f"shadow-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/shadow-ws",
        status="active",
    )
    db_session.add(ws)
    await db_session.flush()

    now = datetime.now(UTC)
    group_session_id = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=group_session_id,
            user_id=owner_uid,
            provider="group",
            status="active",
            turn_count=0,
            created_at=now,
            session_kind="group",
        )
    )
    await db_session.flush()
    db_session.add(
        AgentGroupChat(
            id=group_session_id,
            session_id=group_session_id,
            workspace_id=ws.id,
            title="影子答题测试群",
            created_by=owner_uid,
        )
    )

    # 影子会话：user_id=群主；manual_approval 可控——False 模拟「恒关」历史
    # 现状（守卫二豁免的对象），True 为现行懒建口径（shadow.py config）。
    shadow_id = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=shadow_id,
            user_id=owner_uid,
            runtime_id=rt.id,
            provider="claude",
            status="active",
            config={"manual_approval": shadow_manual_approval, "ask_user_only": True},
            turn_count=1,
            created_at=now,
            session_kind="group_member",
            workspace_id=ws.id,
        )
    )
    await db_session.flush()

    # agent 成员行（影子反向指针——resolve_shadow_member 的入口）。
    db_session.add(
        AgentGroupMember(
            group_id=group_session_id,
            member_type="agent",
            display_name="小码",
            runtime_id=rt.id,
            workspace_id=ws.id,
            provider="claude",
            shadow_status="active",
            shadow_session_id=shadow_id,
            invited_by=owner_uid,
            joined_at=now,
        )
    )
    # 用户成员行（答题人；removed_at 非空=已移除，不该再放行）。
    if with_user_member:
        db_session.add(
            AgentGroupMember(
                group_id=group_session_id,
                member_type="user",
                display_name="答题人",
                user_id=member_uid,
                invited_by=owner_uid,
                joined_at=now,
                removed_at=now if user_member_removed else None,
            )
        )

    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="running",
        spec_strategy="interactive",
        agent_session_id=shadow_id,
        user_id=owner_uid,
    )
    db_session.add(run)
    await db_session.commit()
    return SimpleNamespace(
        owner_uid=owner_uid,
        member_uid=member_uid,
        outsider_uid=outsider_uid,
        runtime_id=rt.id,
        group_session_id=group_session_id,
        shadow_id=shadow_id,
        shadow_run_id=run.id,
    )


async def _insert_pending_dialog_row(
    db_session: AsyncSession,
    seed: SimpleNamespace,
    *,
    request_id: str = "sd-1",
) -> None:
    """直插 pending dialog 行——绕过 handle_permission_request 的 manual 门
    （影子 manual_approval=False 时上行不落行，这里模拟存量/待自愈行，正是
    守卫二豁免要兜住的形态）。"""
    from app.modules.daemon.model import SessionDialogRequest

    db_session.add(
        SessionDialogRequest(
            session_id=seed.shadow_id,
            run_id=seed.shadow_run_id,
            request_id=request_id,
            tool_name="AskUserQuestion",
            dialog_kind="ask_user_question",
            dialog_payload={"question": "选哪个方案？", "options": []},
            status="pending",
        )
    )
    await db_session.commit()


class TestShadowDialogAnswerAuthorization:
    """task-09 / D-004@v2 / D-006@v2 / R-08：群聊影子会话 dialog 答题授权。

    - 放行：该群未移除用户成员可答影子会话 pending ask_user dialog，
      answered_by=实际答题成员（修正原先记群主的归属失真），SSE
      permission_resolved 携带 answered_by_actual_user；manual_approval 守卫
      对影子 dialog 应答豁免（True/False 两形态，False=「恒关」历史现状）；
    - 越权反例（R-08）：非群成员 / 已移除成员 404；普通单聊非属主 404；
      跨会话 request_id 借道 404；已答 409 幂等（:1119 既有语义覆盖影子路径）；
    - 边界（D-006@v2 唯一例外）：影子会话普通权限审批（无 dialog 行）不豁免
      manual_approval 守卫，普通单聊授权语义零变化。
    """

    @staticmethod
    def _make_perm(db_session: AsyncSession) -> tuple[DaemonPermissionService, MagicMock]:
        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        return DaemonPermissionService(svc, hub, timeout_sec=30.0), hub

    @pytest.mark.asyncio
    @pytest.mark.parametrize("shadow_manual_approval", [True, False])
    async def test_group_member_answers_shadow_dialog(
        self, db_session, mocked_redis, shadow_manual_approval: bool
    ) -> None:
        """群成员（非群主）答影子会话 pending dialog：两道守卫双放行
        （manual=False 形态同时证明守卫二豁免），answered_by=答题成员，
        SSE 携带 answered_by_actual_user（前端「×× 答」渲染数据源）。"""
        from sqlalchemy import select

        from app.modules.daemon.model import SessionDialogRequest

        seed = await _seed_group_shadow(db_session, shadow_manual_approval=shadow_manual_approval)
        await _insert_pending_dialog_row(db_session, seed, request_id="sd-1")
        perm, hub = self._make_perm(db_session)

        result = await perm.respond_permission(
            seed.member_uid,
            seed.shadow_id,
            "sd-1",
            "allow",
            dialog_result={"answers": [{"question": "选哪个方案？", "answer": "A"}]},
        )
        assert result.accepted is True

        # 行翻 answered；answered_by=实际答题成员（非影子属主/群主——修正失真）。
        row = (
            await db_session.execute(
                select(SessionDialogRequest).where(SessionDialogRequest.request_id == "sd-1")
            )
        ).scalar_one()
        assert row.status == "answered"
        assert row.answered_by == seed.member_uid
        assert row.answered_by != seed.owner_uid

        # WS 下发照走（dialog_result 透传 daemon，payload 形状不变）。
        hub.send_permission_response.assert_awaited_once()
        ws_arg = hub.send_permission_response.await_args
        assert ws_arg.args[1]["dialog_result"] == {
            "answers": [{"question": "选哪个方案？", "answer": "A"}]
        }
        assert ws_arg.args[1]["runtime_id"] == str(seed.runtime_id)

        # SSE permission_resolved 携带实际答题人标识（契约 answered_by_actual_user）。
        resolved = [
            c.args[1]
            for c in mocked_redis.publish.await_args_list
            if c.args[0] == f"agent_session:{seed.shadow_id}" and "permission_resolved" in c.args[1]
        ]
        assert resolved, "expected permission_resolved SSE on shadow session channel"
        assert "answered_by_actual_user" in resolved[0]
        assert str(seed.member_uid) in resolved[0]
        assert str(seed.owner_uid) not in resolved[0]

    @pytest.mark.asyncio
    async def test_owner_answers_shadow_dialog_manual_off_exempt(
        self, db_session, mocked_redis
    ) -> None:
        """守卫二豁免与答题人身份无关：群主（影子属主，过守卫一首查）答
        manual_approval=False 影子会话的 dialog 同样放行（「恒关」现状对
        dialog 提问类不再一律拒答），answered_by=群主本人。"""
        from sqlalchemy import select

        from app.modules.daemon.model import SessionDialogRequest

        seed = await _seed_group_shadow(db_session, shadow_manual_approval=False)
        await _insert_pending_dialog_row(db_session, seed, request_id="sd-owner-1")
        perm, _hub = self._make_perm(db_session)

        result = await perm.respond_permission(
            seed.owner_uid, seed.shadow_id, "sd-owner-1", "allow", dialog_result={"answers": []}
        )
        assert result.accepted is True
        row = (
            await db_session.execute(
                select(SessionDialogRequest).where(SessionDialogRequest.request_id == "sd-owner-1")
            )
        ).scalar_one()
        assert row.status == "answered"
        assert row.answered_by == seed.owner_uid

    @pytest.mark.asyncio
    async def test_non_member_answer_shadow_dialog_404(self, db_session, mocked_redis) -> None:
        """R-08 越权反例：非群成员（路人）答影子会话 dialog → 404 不放行
        （也不泄露影子会话存在性）。"""
        from app.modules.daemon.service import DaemonSessionNotFound

        seed = await _seed_group_shadow(db_session)
        await _insert_pending_dialog_row(db_session, seed, request_id="sd-out-1")
        perm, hub = self._make_perm(db_session)

        with pytest.raises(DaemonSessionNotFound):
            await perm.respond_permission(
                seed.outsider_uid,
                seed.shadow_id,
                "sd-out-1",
                "allow",
                dialog_result={"answers": []},
            )
        hub.send_permission_response.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_removed_member_answer_shadow_dialog_404(self, db_session, mocked_redis) -> None:
        """R-08 越权反例：已移除成员（removed_at 置位）不再算「未移除用户
        成员」→ 404。"""
        from app.modules.daemon.service import DaemonSessionNotFound

        seed = await _seed_group_shadow(db_session, user_member_removed=True)
        await _insert_pending_dialog_row(db_session, seed, request_id="sd-rm-1")
        perm, _hub = self._make_perm(db_session)

        with pytest.raises(DaemonSessionNotFound):
            await perm.respond_permission(
                seed.member_uid,
                seed.shadow_id,
                "sd-rm-1",
                "allow",
                dialog_result={"answers": []},
            )

    @pytest.mark.asyncio
    async def test_plain_chat_non_owner_dialog_answer_404(self, db_session, mocked_redis) -> None:
        """普通单聊授权语义不变：非属主答单聊 dialog（kind='chat'，影子分支
        不适用）→ 404。"""
        from app.modules.daemon.service import DaemonSessionNotFound

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)
        other_uid = await _create_user(db_session)

        perm, _hub = self._make_perm(db_session)
        # 经正规上行落 pending dialog 行（manual=True 单聊）。
        await perm.handle_permission_request(
            rt.id, _make_dialog_payload(sess, run, request_id="chat-dlg-1")
        )

        with pytest.raises(DaemonSessionNotFound):
            await perm.respond_permission(
                other_uid,
                sess.id,
                "chat-dlg-1",
                "allow",
                dialog_result={"answers": []},
            )

    @pytest.mark.asyncio
    async def test_shadow_plain_approval_still_manual_disabled(
        self, db_session, mocked_redis
    ) -> None:
        """D-006@v2 唯一例外边界：影子会话普通权限审批（无 dialog 行）不豁免
        manual_approval 守卫——群主（守卫一首查命中）对 canUseTool 审批仍被
        DaemonPermissionManualDisabled 拒。"""
        seed = await _seed_group_shadow(db_session, shadow_manual_approval=False)
        perm, _hub = self._make_perm(db_session)

        with pytest.raises(DaemonPermissionManualDisabled):
            await perm.respond_permission(
                seed.owner_uid,
                seed.shadow_id,
                "req-no-dialog",
                "allow",
            )

    @pytest.mark.asyncio
    async def test_shadow_dialog_already_answered_409_idempotent(
        self, db_session, mocked_redis
    ) -> None:
        """已答 409 幂等（:1119 既有语义）覆盖影子路径：成员重复应答第二枪
        DaemonDialogAlreadyResolved，行保持 answered/answered_by 不被改写。"""
        from sqlalchemy import select

        from app.modules.daemon.model import SessionDialogRequest
        from app.modules.daemon.permission_service import DaemonDialogAlreadyResolved

        seed = await _seed_group_shadow(db_session, shadow_manual_approval=False)
        await _insert_pending_dialog_row(db_session, seed, request_id="sd-409-1")
        perm, _hub = self._make_perm(db_session)

        first = await perm.respond_permission(
            seed.member_uid, seed.shadow_id, "sd-409-1", "allow", dialog_result={"answers": []}
        )
        assert first.accepted is True

        with pytest.raises(DaemonDialogAlreadyResolved):
            await perm.respond_permission(
                seed.member_uid,
                seed.shadow_id,
                "sd-409-1",
                "allow",
                dialog_result={"answers": []},
            )
        row = (
            await db_session.execute(
                select(SessionDialogRequest).where(SessionDialogRequest.request_id == "sd-409-1")
            )
        ).scalar_one()
        assert row.status == "answered"
        assert row.answered_by == seed.member_uid

    @pytest.mark.asyncio
    async def test_cross_session_request_id_not_allowed(self, db_session, mocked_redis) -> None:
        """R-08 借道反例：群成员持**别会话**的 request_id 打影子会话——
        is_dialog_answer 判定要求行归属本会话，影子分支不触发 → 404，
        不能借成员身份翻别会话的 dialog。"""
        from app.modules.daemon.service import DaemonSessionNotFound

        seed = await _seed_group_shadow(db_session)
        # 别会话（普通单聊）的 pending dialog 行。
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, run = await _create_session(db_session, uid, rt.id)
        perm, _hub = self._make_perm(db_session)
        await perm.handle_permission_request(
            rt.id, _make_dialog_payload(sess, run, request_id="foreign-dlg-1")
        )

        with pytest.raises(DaemonSessionNotFound):
            await perm.respond_permission(
                seed.member_uid,
                seed.shadow_id,
                "foreign-dlg-1",
                "allow",
                dialog_result={"answers": []},
            )
