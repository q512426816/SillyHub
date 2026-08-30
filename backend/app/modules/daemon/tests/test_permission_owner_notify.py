"""task-06（2026-08-29-approval-notify-push / FR-06 / §7.3③）owner 定向通知测试.

覆盖：
  - canUseTool 请求 → owner（AgentSession.user_id，非 runtime owner）收
    permission_request 通知，ref_type=session_permission、ref_id=session_id；
  - AskUserQuestion dialog 请求 → 通知且 ref_type=session_dialog；
  - _on_timeout 超时 → permission_timeout 通知（owner 以重查会话为准）；
  - respond_permission（owner 自响应，D-008@v1）不产生任何通知；
  - 通知异常（notify_user 抛错）不影响主流程（D-001@v1 旁路原则）。

fixture 惯例复用 test_session_permissions.py（mocked_redis patch 到
session.service 模块；conftest `_isolate_permission_timers` 全局隔离 timer）。
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
from app.modules.daemon.permission_service import DaemonPermissionService
from app.modules.daemon.protocol import PermissionRequestPayload
from app.modules.daemon.service import DaemonService

# ── Fixtures（对齐 test_session_permissions.py）──────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"notify-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_workspace(session: AsyncSession) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    wid = uuid.uuid4()
    session.add(
        Workspace(
            id=wid,
            name=f"ws-{wid.hex[:8]}",
            slug=f"ws-{wid.hex[:8]}",
            root_path=f"/tmp/{wid.hex}",
            status="active",
            created_at=datetime.now(UTC),
        )
    )
    await session.commit()
    return wid


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
    workspace_id: uuid.UUID,
    manual_approval: bool = True,
) -> tuple[AgentSession, AgentRun]:
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude",
        status="active",
        config={"manual_approval": manual_approval, "model": "claude"},
        turn_count=1,
        runtime_id=runtime_id,
        workspace_id=workspace_id,
        lease_id=uuid.uuid4(),
        created_at=datetime.now(UTC),
    )
    session.add(sess)
    await session.flush()
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
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
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


@pytest.fixture()
def notify_user_mock():
    """Monkeypatch NotificationService.notify_user，记录调用参数。"""
    with patch(
        "app.modules.notification.service.NotificationService.notify_user",
        new_callable=AsyncMock,
    ) as m:
        yield m


def _request_payload(sess: AgentSession, run: AgentRun) -> PermissionRequestPayload:
    return PermissionRequestPayload(
        session_id=sess.id,
        run_id=run.id,
        request_id="req-1",
        tool_name="Bash",
        input={"command": "ls"},
    )


def _dialog_payload(sess: AgentSession, run: AgentRun) -> PermissionRequestPayload:
    return PermissionRequestPayload(
        session_id=sess.id,
        run_id=run.id,
        request_id="dlg-1",
        tool_name="AskUserQuestion",
        input={},
        dialog_kind="ask_user_question",
        dialog_payload={"question": "Which?", "options": [{"label": "A"}]},
    )


async def _setup(db_session: AsyncSession):
    """owner（会话创建者）≠ runtime owner：覆盖 D-010@v1 口径。"""
    owner = await _create_user(db_session)
    runtime_owner = await _create_user(db_session)
    ws = await _create_workspace(db_session)
    rt = await _create_runtime(db_session, runtime_owner)
    sess, run = await _create_session(db_session, owner, rt.id, workspace_id=ws)
    return owner, runtime_owner, rt, sess, run


# ── permission_request 通知（双 kind）───────────────────────────────────────


class TestPermissionRequestNotify:
    @pytest.mark.asyncio
    async def test_canusetool_request_notifies_session_owner(
        self, db_session, mocked_redis, notify_user_mock
    ) -> None:
        owner, runtime_owner, rt, sess, run = await _setup(db_session)

        perm = DaemonPermissionService(DaemonService(db_session), MagicMock(), timeout_sec=30.0)
        accepted = await perm.handle_permission_request(rt.id, _request_payload(sess, run))
        assert accepted is True

        notify_user_mock.assert_awaited_once()
        kwargs = notify_user_mock.await_args.kwargs
        # 收件人 = 会话 user_id（D-010@v1），非 runtime owner
        assert kwargs["recipient_user_id"] == owner
        assert kwargs["recipient_user_id"] != runtime_owner
        assert kwargs["type"] == "permission_request"
        assert kwargs["ref_type"] == "session_permission"
        assert kwargs["ref_id"] == str(sess.id)
        assert kwargs["workspace_id"] == sess.workspace_id
        assert kwargs["body"] == "请求使用工具：Bash"
        # 深链直达会话面板（ql 修复：点击通知跳转对应会话）
        assert kwargs["link"] == f"/sessions?session={sess.id}"

        _task = perm._timers["req-1"]
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass

    @pytest.mark.asyncio
    async def test_dialog_request_notifies_with_session_dialog_ref(
        self, db_session, mocked_redis, notify_user_mock
    ) -> None:
        owner, _rt_owner, rt, sess, run = await _setup(db_session)

        perm = DaemonPermissionService(DaemonService(db_session), MagicMock(), timeout_sec=30.0)
        accepted = await perm.handle_permission_request(rt.id, _dialog_payload(sess, run))
        assert accepted is True

        notify_user_mock.assert_awaited_once()
        kwargs = notify_user_mock.await_args.kwargs
        assert kwargs["recipient_user_id"] == owner
        assert kwargs["type"] == "permission_request"
        assert kwargs["ref_type"] == "session_dialog"
        assert kwargs["ref_id"] == str(sess.id)
        # body 放提问预览（兼容顶层 question 旧形态），不再与标题逐字重复。
        assert kwargs["body"] == "Which?"

    @pytest.mark.asyncio
    async def test_notify_failure_does_not_break_request_flow(
        self, db_session, mocked_redis
    ) -> None:
        _owner, _rt_owner, rt, sess, run = await _setup(db_session)
        with patch(
            "app.modules.notification.service.NotificationService.notify_user",
            new_callable=AsyncMock,
            side_effect=RuntimeError("boom"),
        ):
            perm = DaemonPermissionService(DaemonService(db_session), MagicMock(), timeout_sec=30.0)
            accepted = await perm.handle_permission_request(rt.id, _request_payload(sess, run))
        # best-effort：通知异常不影响受理（D-001@v1）
        assert accepted is True
        assert "req-1" in perm._timers

        _task = perm._timers["req-1"]
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass


# ── permission_timeout 通知 ─────────────────────────────────────────────────


class TestPermissionTimeoutNotify:
    @pytest.mark.asyncio
    async def test_timeout_notifies_owner(self, db_session, mocked_redis, notify_user_mock) -> None:
        owner, _rt_owner, rt, sess, run = await _setup(db_session)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=0.01)
        await perm.handle_permission_request(rt.id, _request_payload(sess, run))
        # handle_permission_request 已发一条 permission_request 通知
        assert notify_user_mock.await_count == 1

        # 直接 await _on_timeout（既有 fake-clock 惯例：cancel 掉真 timer）
        task = perm._timers["req-1"]
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        perm._timers.pop("req-1", None)
        await perm._on_timeout(sess.id, run.id, "req-1", rt.id)

        assert notify_user_mock.await_count == 2
        kwargs = notify_user_mock.await_args.kwargs
        assert kwargs["type"] == "permission_timeout"
        # owner 以重查的 AgentSession.user_id 为准（D-010@v1）
        assert kwargs["recipient_user_id"] == owner
        assert kwargs["ref_type"] == "session_permission"
        assert kwargs["ref_id"] == str(sess.id)
        # 超时通知不带 body（title 已表达，避免逐字重复）
        assert kwargs["body"] is None


# ── respond 不通知（owner 自响应豁免，D-008@v1）─────────────────────────────


class TestRespondNoNotify:
    @pytest.mark.asyncio
    async def test_respond_permission_does_not_notify(
        self, db_session, mocked_redis, notify_user_mock
    ) -> None:
        owner, _rt_owner, rt, sess, run = await _setup(db_session)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(rt.id, _request_payload(sess, run))
        assert notify_user_mock.await_count == 1  # 仅请求通知

        # ControlCommandService.enqueue_and_push 走真实落库 + hub 推送；
        # hub 是 MagicMock，send 侧由 enqueue_and_push 内部处理——用真实路径。
        await perm.respond_permission(
            user_id=owner,
            session_id=sess.id,
            request_id="req-1",
            decision="allow",
        )
        # respond 之后没有新增通知
        assert notify_user_mock.await_count == 1

    @pytest.mark.asyncio
    async def test_respond_dialog_does_not_notify(
        self, db_session, mocked_redis, notify_user_mock
    ) -> None:
        owner, _rt_owner, rt, sess, run = await _setup(db_session)

        svc = DaemonService(db_session)
        hub = MagicMock()
        hub.send_permission_response = AsyncMock(return_value=True)
        perm = DaemonPermissionService(svc, hub, timeout_sec=30.0)
        await perm.handle_permission_request(rt.id, _dialog_payload(sess, run))
        assert notify_user_mock.await_count == 1

        await perm.respond_permission(
            user_id=owner,
            session_id=sess.id,
            request_id="dlg-1",
            decision="allow",
            dialog_result={"selected": "A"},
        )
        assert notify_user_mock.await_count == 1
