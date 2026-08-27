"""Tests for DaemonService interactive session orchestration (task-05).

Covers create/inject/interrupt/end_session, the D-005@v1 triple, currentRun
uniqueness, concurrency conflict detection (single-threaded logic + the
``with_for_update`` query), end-session single reconciliation, idempotency,
offline convergence, and the lease-kind invariant guard.

The WS hub is mocked via ``get_daemon_ws_hub`` so no live WebSocket is needed;
Redis is mocked via ``get_redis`` so no live Redis is needed. SQLite ignores
``FOR UPDATE`` but the row-lock query + error branches are still exercised
(AC-04/AC-17 PostgreSQL concurrency proof is environment-gated, see report).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import (
    DaemonOffline,
    DaemonRuntimeOffline,
    DaemonService,
    DaemonSessionInvariantViolation,
    DaemonSessionNoAgentSession,
    DaemonSessionNoCurrentRun,
    DaemonSessionNotActive,
    DaemonSessionNotFound,
    DaemonSessionResumeUnsupported,
    DaemonSessionTurnConflict,
)
from app.modules.daemon.session.service import DaemonSessionWorkspaceNotFound

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"svc-{uid}@example.com",
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
    hub.connected_daemon_ids = []
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
    # Both service.create_session (via placement.notify_interactive_dispatch)
    # and the service control senders call get_daemon_ws_hub. Patch at source.
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


# ── create_session ───────────────────────────────────────────────────────────


class TestCreateSession:
    @pytest.mark.asyncio
    async def test_creates_triple_and_activates(self, db_session, mocked_hub, mocked_redis) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid, provider="claude", prompt="hello", model="claude-sonnet-4"
        )

        s = result.agent_session
        run = result.agent_run
        assert s.status == "active"
        assert s.turn_count == 1
        assert s.runtime_id is not None
        assert s.lease_id == result.lease_id
        # first run bound to session, pending, interactive strategy
        assert run.agent_session_id == s.id
        assert run.status == "pending"
        assert run.spec_strategy == "interactive"

        # D-005@v1: lease agent_run_id NULL, kind interactive, no expiry
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease.agent_run_id is None
        assert lease.kind == "interactive"
        assert lease.lease_expires_at is None

    @pytest.mark.asyncio
    async def test_first_turn_control_message_sent(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider="claude", prompt="hi there")

        # Exactly one SESSION_INJECT control message for the first turn
        assert mocked_hub.send_session_control.await_count == 1
        call = mocked_hub.send_session_control.await_args
        msg_type, payload = call.args[1], call.args[2]
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT

        assert msg_type == DAEMON_MSG_SESSION_INJECT
        assert payload["prompt"] == "hi there"
        assert payload["session_id"] == str(result.agent_session.id)
        assert payload["run_id"] == str(result.agent_run.id)
        assert payload["lease_id"] == str(result.lease_id)

    @pytest.mark.asyncio
    async def test_empty_prompt_rejected(self, db_session, mocked_hub) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        with pytest.raises(Exception):  # DaemonSessionNotActive
            await svc.create_session(uid, provider="claude", prompt="   ")

    @pytest.mark.asyncio
    async def test_offline_daemon_converges_to_failed(self, db_session, mocked_redis) -> None:
        """AC-12: first-turn wake-up failure → run=failed, session=failed, lease=completed."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        offline_hub = _mock_hub(connected=False)
        # notify_interactive_dispatch checks is_connected + connected_runtime_ids
        offline_hub.is_connected.return_value = False
        offline_hub.connected_runtime_ids = []
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=offline_hub):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonRuntimeOffline):
                await svc.create_session(uid, provider="claude", prompt="hello")

        # No active session/run/lease lingering — all converged
        sessions = (await db_session.execute(select(AgentSession))).scalars().all()
        assert len(sessions) == 1
        assert sessions[0].status == "failed"
        assert sessions[0].ended_at is not None

        runs = (await db_session.execute(select(AgentRun))).scalars().all()
        assert len(runs) == 1
        assert runs[0].status == "failed"

        leases = (await db_session.execute(select(DaemonTaskLease))).scalars().all()
        assert len(leases) == 1
        assert leases[0].status == "completed"

    @pytest.mark.asyncio
    async def test_create_session_with_valid_workspace_id(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """FR-05/D-001@v1：有 WORKSPACE_READ 权限的用户传 workspace_id → 创建成功"""
        from app.modules.workspace.model import Workspace

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        ws = Workspace(
            id=uuid.uuid4(),
            name="test-ws",
            slug="test-ws",
            root_path="/tmp/test-ws",
            created_by=uid,
        )
        db_session.add(ws)
        await db_session.flush()

        with patch(
            "app.modules.daemon.session.service.allowed_workspace_ids",
            new_callable=AsyncMock,
            return_value={ws.id},
        ):
            svc = DaemonService(db_session)
            result = await svc.create_session(
                uid,
                provider="claude",
                prompt="test",
                runtime_id=str(rt.id),
                workspace_id=ws.id,  # create_session 签名是 uuid.UUID
            )

        assert result.agent_session is not None
        session = await db_session.get(AgentSession, result.agent_session.id)
        assert session is not None
        assert session.workspace_id == ws.id

    @pytest.mark.asyncio
    async def test_create_session_workspace_not_in_allowed(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """FR-05/D-001@v1：无权限用户传 workspace_id → 404"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        fake_ws_id = uuid.uuid4()

        with patch(
            "app.modules.daemon.session.service.allowed_workspace_ids",
            new_callable=AsyncMock,
            return_value=set(),
        ):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonSessionWorkspaceNotFound):
                await svc.create_session(
                    uid,
                    provider="claude",
                    prompt="test",
                    runtime_id=str(rt.id),
                    workspace_id=str(fake_ws_id),
                )

    @pytest.mark.asyncio
    async def test_create_session_workspace_not_found(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """FR-05：workspace_id 指向不存在的工作区 → 404（同语义不泄露存在性）"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        fake_ws_id = uuid.uuid4()

        with patch(
            "app.modules.daemon.session.service.allowed_workspace_ids",
            new_callable=AsyncMock,
            return_value=set(),
        ):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonSessionWorkspaceNotFound):
                await svc.create_session(
                    uid,
                    provider="claude",
                    prompt="test",
                    runtime_id=str(rt.id),
                    workspace_id=str(fake_ws_id),
                )

    @pytest.mark.asyncio
    async def test_create_session_no_workspace_zero_regression(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """FR-04：不传 workspace_id → allowed_workspace_ids 未被调用，session.workspace_id=None"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        with patch(
            "app.modules.daemon.session.service.allowed_workspace_ids",
            new_callable=AsyncMock,
        ) as mock_allowed:
            svc = DaemonService(db_session)
            result = await svc.create_session(
                uid,
                provider="claude",
                prompt="test",
                runtime_id=str(rt.id),
                # 不传 workspace_id
            )

        mock_allowed.assert_not_called()
        session = await db_session.get(AgentSession, result.agent_session.id)
        assert session is not None
        assert session.workspace_id is None


# ── inject_session ───────────────────────────────────────────────────────────


class TestInjectSession:
    @pytest.mark.asyncio
    async def test_inject_creates_new_run(self, db_session, mocked_hub, mocked_redis) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        first_run_id = created.agent_run.id
        # mark first run as completed (turn done) so inject can proceed
        created.agent_run.status = "completed"
        created.agent_run.finished_at = datetime.now(UTC)
        await db_session.commit()

        result = await svc.inject_session(created.agent_session.id, uid, prompt="second")

        assert result.agent_run.id != first_run_id
        assert result.agent_run.agent_session_id == created.agent_session.id
        assert result.agent_run.status == "pending"
        # turn_count incremented
        await db_session.refresh(created.agent_session)
        assert created.agent_session.turn_count == 2

    @pytest.mark.asyncio
    async def test_inject_conflict_when_active_run(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-05: pending/running run present → 409 DaemonSessionTurnConflict."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        # first run is still pending → inject must conflict
        with pytest.raises(DaemonSessionTurnConflict):
            await svc.inject_session(created.agent_session.id, uid, prompt="second")

    @pytest.mark.asyncio
    async def test_inject_on_non_active_session(self, db_session, mocked_hub, mocked_redis) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        created.agent_session.status = "ended"
        await db_session.commit()

        with pytest.raises(DaemonSessionNotActive):
            await svc.inject_session(created.agent_session.id, uid, prompt="again")

    @pytest.mark.asyncio
    async def test_inject_wrong_user_returns_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-11: cross-user access → 404 (existence not leaked)."""
        uid = await _create_user(db_session)
        other = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        with pytest.raises(DaemonSessionNotFound):
            await svc.inject_session(created.agent_session.id, other, prompt="x")

    @pytest.mark.asyncio
    async def test_inject_ws_send_failure_converges_run(self, db_session, mocked_redis) -> None:
        """AC-13: control send fails → new run=failed but session stays active."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        # create succeeds (hub connected)
        good_hub = _mock_hub(connected=True)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=good_hub):
            svc = DaemonService(db_session)
            created = await svc.create_session(uid, provider="claude", prompt="first")
        created.agent_run.status = "completed"
        created.agent_run.finished_at = datetime.now(UTC)
        await db_session.commit()

        # Now break the WS send for the inject path
        bad_hub = _mock_hub(connected=True)
        bad_hub.send_session_control = AsyncMock(return_value=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=bad_hub):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonRuntimeOffline):
                await svc.inject_session(created.agent_session.id, uid, prompt="second")

        # session still active, run failed
        await db_session.refresh(created.agent_session)
        assert created.agent_session.status == "active"
        runs = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == created.agent_session.id)
                )
            )
            .scalars()
            .all()
        )
        failed = [r for r in runs if r.status == "failed"]
        assert len(failed) == 1
        assert failed[0].output_redacted is not None  # auditable


# ── inject 绑定字段（task-07 / 2026-08-26-session-input-mention）──────────────


async def _make_bind_workspace(db_session: AsyncSession, uid: uuid.UUID, name: str):
    """建一个普通工作区行（供会话挂 workspace_id / 造跨工作区 change 行）。"""
    from app.modules.workspace.model import Workspace

    suffix = uuid.uuid4().hex[:6]
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"{name}-{suffix}",
        # root_path 有 UNIQUE 约束——每次调用取唯一值
        root_path=f"/tmp/{name}-{suffix}",
        created_by=uid,
    )
    db_session.add(ws)
    await db_session.flush()
    return ws


async def _create_bindable_session(
    db_session: AsyncSession, *, with_workspace: bool = True
) -> tuple[DaemonService, uuid.UUID, AgentSession, object | None]:
    """建一个（可选挂工作区的）活跃会话并完结首 turn，供 inject 绑定用例复用。"""
    uid = await _create_user(db_session)
    await _create_runtime(db_session, uid)
    ws = await _make_bind_workspace(db_session, uid, "bind-ws") if with_workspace else None
    create_kwargs: dict = {}
    if ws is not None:
        create_kwargs["workspace_id"] = ws.id
    with patch(
        "app.modules.daemon.session.service.allowed_workspace_ids",
        new_callable=AsyncMock,
        return_value={ws.id} if ws is not None else set(),
    ):
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first", **create_kwargs)
    created.agent_run.status = "completed"
    created.agent_run.finished_at = datetime.now(UTC)
    await db_session.commit()
    return svc, uid, created.agent_session, ws


class TestInjectSessionBinding:
    """task-07（FR-06 / D-003~D-005）：inject 携带 bind 字段经幂等 binder 落
    M:N link——真实 DB 副作用断言（link 行 / placeholder 行存在性）。"""

    @pytest.mark.asyncio
    async def test_bind_change_key_creates_placeholder_and_link(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """bind_change_key → 会话工作区建 placeholder Change + ChangeSessionLink。"""
        from app.modules.change.model import Change, ChangeSessionLink

        svc, uid, session, ws = await _create_bindable_session(db_session)

        result = await svc.inject_session(
            session.id, uid, prompt="绑定变更", bind_change_key="2026-08-27-demo-change"
        )
        assert result.agent_run is not None  # 消息照常派发

        change = (
            (
                await db_session.execute(
                    select(Change).where(
                        Change.workspace_id == ws.id,
                        Change.change_key == "2026-08-27-demo-change",
                    )
                )
            )
            .scalars()
            .one()
        )
        assert change.status == "draft"  # placeholder 行
        link = (
            (
                await db_session.execute(
                    select(ChangeSessionLink).where(
                        ChangeSessionLink.change_id == change.id,
                        ChangeSessionLink.session_id == session.id,
                    )
                )
            )
            .scalars()
            .one()
        )
        assert link is not None

    @pytest.mark.asyncio
    async def test_bind_idempotent_on_repeat(self, db_session, mocked_hub, mocked_redis) -> None:
        """同 key 重复 inject（含 quicklog）→ 不重复建 link / placeholder 行。"""
        from app.modules.change.model import Change, ChangeSessionLink, QuicklogSessionLink

        svc, uid, session, _ws = await _create_bindable_session(db_session)
        ql_id = "ql-20260827-001-bind"

        for _ in range(2):
            result = await svc.inject_session(
                session.id,
                uid,
                prompt="重复绑定",
                bind_change_key="2026-08-27-repeat",
                bind_quick_id=ql_id,
            )
            assert result.agent_run is not None
            # 完结本轮，允许下一轮 inject
            result.agent_run.status = "completed"
            result.agent_run.finished_at = datetime.now(UTC)
            await db_session.commit()

        changes = (
            (
                await db_session.execute(
                    select(Change).where(Change.change_key == "2026-08-27-repeat")
                )
            )
            .scalars()
            .all()
        )
        assert len(changes) == 1  # placeholder 不重复建
        change_links = (
            (
                await db_session.execute(
                    select(ChangeSessionLink).where(ChangeSessionLink.session_id == session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(change_links) == 1
        ql_links = (
            (
                await db_session.execute(
                    select(QuicklogSessionLink).where(QuicklogSessionLink.session_id == session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(ql_links) == 1

    @pytest.mark.asyncio
    async def test_bind_quick_id_writes_quicklog_link(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """bind_quick_id → QuicklogSessionLink（不要求条目行存在，D-001@v1）。"""
        from app.modules.change.model import QuicklogSessionLink

        svc, uid, session, ws = await _create_bindable_session(db_session)

        await svc.inject_session(
            session.id, uid, prompt="绑定快速修复", bind_quick_id="ql-20260827-002-bind"
        )

        link = (
            (
                await db_session.execute(
                    select(QuicklogSessionLink).where(
                        QuicklogSessionLink.workspace_id == ws.id,
                        QuicklogSessionLink.ql_id == "ql-20260827-002-bind",
                        QuicklogSessionLink.session_id == session.id,
                    )
                )
            )
            .scalars()
            .one()
        )
        assert link is not None

    @pytest.mark.asyncio
    async def test_bind_ppm_item_alongside_change_and_quicklog(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """task-02（2026-08-28-session-ppm-task-binding / FR-02）对照断言：
        bind_ppm_item_* 与既有 bind_change_key / bind_quick_id 同轮携带——三类
        link 各落一行互不干扰（ppm 分支在 change/quicklog 分支之后独立执行）。"""
        from app.modules.change.model import ChangeSessionLink, QuicklogSessionLink
        from app.modules.ppm.common.session_binding import PpmItemSessionLink
        from app.modules.ppm.task.model import PlanTask

        svc, uid, session, ws = await _create_bindable_session(db_session)
        task = PlanTask(
            id=uuid.uuid4(), user_id=uid, content="ppm 对照任务", status="进行中", file_urls=[]
        )
        db_session.add(task)
        await db_session.commit()

        result = await svc.inject_session(
            session.id,
            uid,
            prompt="三类绑定同轮",
            bind_change_key="2026-08-28-ppm-compare",
            bind_quick_id="ql-20260828-001-ppm",
            bind_ppm_item_kind="plan_task",
            bind_ppm_item_id=task.id,
        )
        assert result.agent_run is not None  # 消息照常派发

        ppm_links = (
            (
                await db_session.execute(
                    select(PpmItemSessionLink).where(PpmItemSessionLink.session_id == session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(ppm_links) == 1
        assert ppm_links[0].kind == "plan_task"
        assert ppm_links[0].item_id == task.id
        assert ppm_links[0].workspace_id == ws.id  # 快照取会话自身 workspace_id
        # 既有两通道不受 ppm 分支影响（对照：各仍一行）
        assert (
            len(
                (
                    await db_session.execute(
                        select(ChangeSessionLink).where(ChangeSessionLink.session_id == session.id)
                    )
                )
                .scalars()
                .all()
            )
            == 1
        )
        assert (
            len(
                (
                    await db_session.execute(
                        select(QuicklogSessionLink).where(
                            QuicklogSessionLink.session_id == session.id
                        )
                    )
                )
                .scalars()
                .all()
            )
            == 1
        )

    @pytest.mark.asyncio
    async def test_bind_skipped_when_session_has_no_workspace(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """session.workspace_id None → 记 warning 跳过绑定，消息仍正常下发。

        structlog 直写 stderr，caplog 抓不到（见 test_terminating_at_lifecycle
        同款说明）——照抄该先例替换模块级 ``log`` 为 MagicMock 断言 warning。
        """
        from app.modules.change.model import Change, ChangeSessionLink, QuicklogSessionLink

        svc, uid, session, _ws = await _create_bindable_session(db_session, with_workspace=False)

        with patch("app.modules.daemon.session.service.log") as mock_log:
            result = await svc.inject_session(
                session.id,
                uid,
                prompt="无工作区的绑定",
                bind_change_key="2026-08-27-nows",
                bind_quick_id="ql-20260827-003-nows",
            )

        assert result.agent_run is not None  # 消息仍正常派发
        mock_log.warning.assert_called_once()
        # 零副作用：无 placeholder、无任何 link 行
        assert (
            await db_session.execute(select(Change).where(Change.change_key == "2026-08-27-nows"))
        ).scalars().all() == []
        assert (await db_session.execute(select(ChangeSessionLink))).scalars().all() == []
        assert (await db_session.execute(select(QuicklogSessionLink))).scalars().all() == []

    @pytest.mark.asyncio
    async def test_bind_cross_workspace_only_placeholder_in_session_workspace(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """跨 workspace change_key → 只在会话自有工作区建 placeholder（D-004）。"""
        from app.modules.change.model import Change, ChangeSessionLink

        svc, uid, session, ws_a = await _create_bindable_session(db_session)
        # 另一个工作区已有同名 change_key 真实行
        ws_b = await _make_bind_workspace(db_session, uid, "bind-ws-other")
        other_change = Change(
            id=uuid.uuid4(),
            workspace_id=ws_b.id,
            change_key="shared-key",
            title="别的工作区的变更",
            status="active",
            location="active",
            path="changes/shared-key",
        )
        db_session.add(other_change)
        await db_session.commit()

        await svc.inject_session(
            session.id, uid, prompt="跨工作区绑定", bind_change_key="shared-key"
        )

        rows = (
            (await db_session.execute(select(Change).where(Change.change_key == "shared-key")))
            .scalars()
            .all()
        )
        assert len(rows) == 2  # ws_b 原行 + ws_a placeholder
        by_ws = {row.workspace_id: row for row in rows}
        assert set(by_ws) == {ws_a.id, ws_b.id}
        # link 只连到会话自有工作区的 placeholder 行（不跨区串扰）
        link = (
            (
                await db_session.execute(
                    select(ChangeSessionLink).where(ChangeSessionLink.session_id == session.id)
                )
            )
            .scalars()
            .one()
        )
        assert link.change_id == by_ws[ws_a.id].id
        assert link.change_id != other_change.id

    @pytest.mark.asyncio
    async def test_bind_failure_does_not_block_message(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """binder 内部失败（savepoint 语义吞掉）→ 绑定落空但消息仍正常下发。"""
        from app.modules.change.model import Change, ChangeSessionLink

        svc, uid, session, _ws = await _create_bindable_session(db_session)

        # 让 binder 的首个查询就抛错 → binding.py 自身 except 捕获记 warning，
        # 设计要求 SessionService 不再包 try/except，注入流程不应被打断。
        with patch("app.modules.change.binding.select", side_effect=RuntimeError("db down")):
            result = await svc.inject_session(
                session.id, uid, prompt="绑定失败也要发", bind_change_key="2026-08-27-boom"
            )

        assert result.agent_run is not None
        assert result.agent_run.status == "pending"
        assert mocked_hub.send_session_control.await_count >= 1
        assert (
            await db_session.execute(select(Change).where(Change.change_key == "2026-08-27-boom"))
        ).scalars().all() == []
        assert (await db_session.execute(select(ChangeSessionLink))).scalars().all() == []


# ── interrupt_session ────────────────────────────────────────────────────────


class TestInterruptSession:
    @pytest.mark.asyncio
    async def test_interrupt_sends_message_keeps_session_active(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-06: interrupt sends SESSION_INTERRUPT, session stays active, lease untouched."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")

        # reset mock to inspect the interrupt call cleanly
        mocked_hub.send_session_control.reset_mock()
        result = await svc.interrupt_session(created.agent_session.id, uid)

        assert result.current_run_id == created.agent_run.id
        # exactly one control message after reset
        assert mocked_hub.send_session_control.await_count == 1
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INTERRUPT

        call = mocked_hub.send_session_control.await_args
        assert call.args[1] == DAEMON_MSG_SESSION_INTERRUPT

        # session/lease NOT mutated
        await db_session.refresh(created.agent_session)
        assert created.agent_session.status == "active"
        lease = await db_session.get(DaemonTaskLease, created.agent_session.lease_id)
        assert lease.status == "pending"
        # run NOT locally killed (daemon result drives terminal state)
        await db_session.refresh(created.agent_run)
        assert created.agent_run.status == "pending"

    @pytest.mark.asyncio
    async def test_interrupt_no_current_run(self, db_session, mocked_hub, mocked_redis) -> None:
        """AC-07: no active run → DaemonSessionNoCurrentRun."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        created.agent_run.status = "completed"
        created.agent_run.finished_at = datetime.now(UTC)
        await db_session.commit()

        with pytest.raises(DaemonSessionNoCurrentRun):
            await svc.interrupt_session(created.agent_session.id, uid)

    @pytest.mark.asyncio
    async def test_interrupt_offline_raises(self, db_session, mocked_redis) -> None:
        """AC-08 boundary: WS send fails → DaemonRuntimeOffline, no state change."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        good_hub = _mock_hub(connected=True)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=good_hub):
            svc = DaemonService(db_session)
            created = await svc.create_session(uid, provider="claude", prompt="first")

        bad_hub = _mock_hub(connected=True)
        bad_hub.send_session_control = AsyncMock(return_value=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=bad_hub):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonRuntimeOffline):
                await svc.interrupt_session(created.agent_session.id, uid)

        # session unchanged
        await db_session.refresh(created.agent_session)
        assert created.agent_session.status == "active"


# ── end_session ──────────────────────────────────────────────────────────────


class TestEndSession:
    @pytest.mark.asyncio
    async def test_end_reconciles_three_entities(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-08: single transaction kills run + ends session + completes lease."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")

        result = await svc.end_session(created.agent_session.id, uid)
        assert result.agent_session.status == "ended"
        assert result.current_run_id == created.agent_run.id

        await db_session.refresh(created.agent_session)
        await db_session.refresh(created.agent_run)
        lease = await db_session.get(DaemonTaskLease, created.agent_session.lease_id)

        assert created.agent_session.status == "ended"
        assert created.agent_session.ended_at is not None
        assert created.agent_run.status == "killed"
        assert created.agent_run.finished_at is not None
        assert lease.status == "completed"

        # SESSION_END was sent exactly once
        end_calls = [c for c in mocked_hub.send_session_control.await_args_list]
        from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END

        assert any(c.args[1] == DAEMON_MSG_SESSION_END for c in end_calls)

    @pytest.mark.asyncio
    async def test_end_idempotent(self, db_session, mocked_hub, mocked_redis) -> None:
        """AC-10: double end → no second WS, no ended_at change."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")
        await svc.end_session(created.agent_session.id, uid)
        await db_session.refresh(created.agent_session)
        first_ended_at = created.agent_session.ended_at

        mocked_hub.send_session_control.reset_mock()
        await svc.end_session(created.agent_session.id, uid)
        await db_session.refresh(created.agent_session)
        assert created.agent_session.ended_at == first_ended_at
        # no WS sent on idempotent path
        assert mocked_hub.send_session_control.await_count == 0

    @pytest.mark.asyncio
    async def test_end_offline_still_reconciles(self, db_session, mocked_redis) -> None:
        """AC-09: daemon offline → local reconciliation still succeeds, warning logged."""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        good_hub = _mock_hub(connected=True)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=good_hub):
            svc = DaemonService(db_session)
            created = await svc.create_session(uid, provider="claude", prompt="first")

        # break WS for the end path
        bad_hub = _mock_hub(connected=True)
        bad_hub.send_session_control = AsyncMock(return_value=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=bad_hub):
            svc = DaemonService(db_session)
            # must NOT raise — end is best-effort on WS
            result = await svc.end_session(created.agent_session.id, uid)

        assert result.agent_session.status == "ended"
        await db_session.refresh(created.agent_run)
        assert created.agent_run.status == "killed"

    @pytest.mark.asyncio
    async def test_end_batch_lease_invariant_violation(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-19: session.lease_id pointing at a batch lease → invariant violation, rollback."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # craft an active session bound to a BATCH lease (data corruption case)
        batch_lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="batch",  # wrong kind!
            status="pending",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            runtime_id=rt.id,
            lease_id=batch_lease.id,
            provider="claude",
            status="active",
            turn_count=1,
        )
        db_session.add_all([batch_lease, session])
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionInvariantViolation):
            await svc.end_session(session.id, uid)

        # session unchanged (rolled back), batch lease NOT completed
        await db_session.refresh(session)
        await db_session.refresh(batch_lease)
        assert session.status == "active"
        assert batch_lease.status == "pending"

    @pytest.mark.asyncio
    async def test_end_daemon_actor_by_runtime_owner_success(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """ql-20260623-004: daemon 身份（X-API-Key owner=runtime owner）能 end
        绑定到自己 runtime 的 session——admin 共享 runtime 场景 creator≠owner。

        复现 404 根因：session 创建者 creator ≠ runtime/api-key owner。修复前
        end_session(session_id, owner) 走 user_id 校验
        （AgentSession.user_id==creator）→ 404；修复后 actor_runtime_owner_id=owner
        走 runtime 归属校验（session.runtime.user_id==owner）→ 成功收口。
        """
        creator = await _create_user(db_session)
        owner = await _create_user(db_session)
        rt = await _create_runtime(db_session, owner)  # runtime 归属 owner
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=creator,  # 创建者 ≠ runtime owner
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
        )
        db_session.add_all([lease, session])
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.end_session(session.id, owner, actor_runtime_owner_id=owner)
        assert result.agent_session.status == "ended"
        await db_session.refresh(session)
        assert session.status == "ended"

    @pytest.mark.asyncio
    async def test_end_daemon_actor_wrong_owner_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """ql-20260623-004: daemon api-key owner ≠ runtime owner → 404，session 不变。"""
        creator = await _create_user(db_session)
        owner = await _create_user(db_session)
        intruder = await _create_user(db_session)
        rt = await _create_runtime(db_session, owner)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=creator,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
        )
        db_session.add_all([lease, session])
        await db_session.commit()

        svc = DaemonService(db_session)
        # intruder 不是 runtime owner（rt.user_id=owner≠intruder）→ 404
        with pytest.raises(DaemonSessionNotFound):
            await svc.end_session(session.id, intruder, actor_runtime_owner_id=intruder)
        await db_session.refresh(session)
        assert session.status == "active"  # 未被改动

    @pytest.mark.asyncio
    async def test_end_frontend_actor_path_unchanged(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """ql-20260623-004 回归：前端身份（不传 actor_runtime_owner_id）仍走 user_id 校验。"""
        creator = await _create_user(db_session)
        rt = await _create_runtime(db_session, creator)
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=creator,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            status="active",
            turn_count=1,
        )
        db_session.add_all([lease, session])
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.end_session(session.id, creator)
        assert result.agent_session.status == "ended"


# ── currentRun invariant ─────────────────────────────────────────────────────


class TestCurrentRunInvariant:
    @pytest.mark.asyncio
    async def test_multiple_active_runs_raises_invariant(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """AC-07 boundary: >1 active run → DaemonSessionInvariantViolation (never guess)."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            runtime_id=rt.id,
            provider="claude",
            status="active",
            turn_count=2,
        )
        run1 = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            status="running",
            agent_session_id=session.id,
        )
        run2 = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            status="pending",
            agent_session_id=session.id,
        )
        db_session.add_all([session, run1, run2])
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionInvariantViolation):
            await svc.interrupt_session(session.id, uid)


# ── task-07 (codex reopen parity, design §5.6 / FR-06 / D-003@v1 / D-007@v1) ──


async def _make_ended_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    *,
    provider: str = "codex",
    agent_session_id: str | None = "codex-thread-abc",
    status: str = "ended",
) -> tuple[AgentSession, DaemonTaskLease]:
    """Create a terminal AgentSession bound to a completed interactive lease.

    Mirrors the pre-reopen state: the original ``completed`` lease (design
    §6.2) must stay untouched; reopen creates a brand-new pending lease.
    """
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status="completed",
        claimed_at=now,
        lease_expires_at=None,
        attempt_number=1,
        metadata_={
            "session_id": agent_session_id or "",
            "provider": provider,
            "claim_token": "old-codex-token-deadbeef",
        },
        created_at=now,
        updated_at=now,
    )
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=lease.id,
        provider=provider,
        status=status,
        agent_session_id=agent_session_id,
        config={"model": "gpt-5"},
        turn_count=1,
        cwd="/workspace/codex-proj",
        created_at=now,
        last_active_at=now,
        ended_at=now if status in ("ended", "failed") else None,
    )
    session.add_all([lease, sess])
    await session.commit()
    await session.refresh(lease)
    await session.refresh(sess)
    return sess, lease


class TestReopenCodexSession:
    """task-07 / design §5.6: backend 放开 Codex reopen (provider gate {claude,codex}).

    D-003@v1 复用 backend session 控制面；D-007@v1 agent_session_id 即 Codex
    threadId，原样作为 resume key 保留，不伪造。
    """

    @pytest.mark.asyncio
    async def test_reopen_ended_codex_session_returns_reconnecting(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _old_lease = await _make_ended_session(db_session, uid, rt.id)

        svc = DaemonService(db_session)
        result = await svc.reopen_session(sess.id, uid)

        assert result.session_id == str(sess.id)
        assert result.status == "reconnecting"

        # DB-level via column projection (bypass identity-map copy written by
        # the service's own session).
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "reconnecting"

    @pytest.mark.asyncio
    async def test_reopen_codex_creates_new_lease_preserves_threadid(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, old_lease = await _make_ended_session(
            db_session, uid, rt.id, agent_session_id="codex-thread-xyz"
        )

        svc = DaemonService(db_session)
        await svc.reopen_session(sess.id, uid)

        sess_row = (
            await db_session.execute(
                select(
                    AgentSession.status,
                    AgentSession.agent_session_id,
                    AgentSession.lease_id,
                    AgentSession.runtime_id,
                ).where(AgentSession.id == sess.id)
            )
        ).one()
        assert sess_row.status == "reconnecting"
        # D-007@v1: threadId preserved verbatim as the resume key.
        assert sess_row.agent_session_id == "codex-thread-xyz"
        assert sess_row.lease_id is not None
        new_lease_id = sess_row.lease_id
        assert new_lease_id != old_lease.id

        new_lease = (
            await db_session.execute(
                select(
                    DaemonTaskLease.kind,
                    DaemonTaskLease.status,
                    DaemonTaskLease.metadata_,
                ).where(DaemonTaskLease.id == new_lease_id)
            )
        ).one()
        assert new_lease.kind == "interactive"
        assert new_lease.status == "pending"
        meta = new_lease.metadata_ or {}
        # lease metadata 四字段齐 (design §5.6.3)。
        assert meta["session_id"] == str(sess.id)
        assert meta["agent_session_id"] == "codex-thread-xyz"
        assert meta["provider"] == "codex"
        new_token = meta["claim_token"]
        assert isinstance(new_token, str) and len(new_token) >= 32
        assert new_token != "old-codex-token-deadbeef"

        # design §6.2: 旧 completed lease 不动。
        old_status = (
            await db_session.execute(
                select(DaemonTaskLease.status).where(DaemonTaskLease.id == old_lease.id)
            )
        ).scalar_one()
        assert old_status == "completed"

    @pytest.mark.asyncio
    async def test_reopen_unsupported_provider_still_409(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # 非 {claude, codex} provider（如 cursor/openclaw/gemini）仍拦截。
        sess, _lease = await _make_ended_session(
            db_session, uid, rt.id, provider="gemini", agent_session_id="g-1"
        )

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionResumeUnsupported) as exc_info:
            await svc.reopen_session(sess.id, uid)
        # 文案锁：only claude/codex（design §5.6.2）。
        assert "claude/codex" in str(exc_info.value)
        assert exc_info.value.code == "HTTP_409_DAEMON_SESSION_RESUME_UNSUPPORTED"
        # session 未被 mutate（pre-flight 第一道即拦）。
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "ended"

    @pytest.mark.asyncio
    async def test_reopen_codex_null_agent_session_id_409(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """D-007@v1: Codex ended 但 threadId=NULL 不得伪造，仍 NO_AGENT_SESSION。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _lease = await _make_ended_session(db_session, uid, rt.id, agent_session_id=None)

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionNoAgentSession):
            await svc.reopen_session(sess.id, uid)
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "ended"

    @pytest.mark.asyncio
    async def test_reopen_codex_active_session_409_not_active(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """状态机一致：codex active session reopen → NOT_ACTIVE（应走 inject）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _lease = await _make_ended_session(db_session, uid, rt.id, status="active")

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionNotActive):
            await svc.reopen_session(sess.id, uid)

    @pytest.mark.asyncio
    async def test_reopen_codex_offline_runtime_409(self, db_session, mocked_redis) -> None:
        """FR-06 边界：codex runtime 未连 WS → DaemonOffline（409 OFFLINE）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _lease = await _make_ended_session(db_session, uid, rt.id)

        # offline hub: is_connected False.
        hub = _mock_hub(connected=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonOffline):
                await svc.reopen_session(sess.id, uid)


# ── DS-4（2026-08-21-session-reopen-resume）：confirm/mark-failed 可选 lease_id ──


class TestRecoveryLeaseGuard:
    """DS-4：可选 lease_id 陈旧确认防误翻 + 既有翻转语义守门（service 层）。

    端点层（SessionRuntimeRequest 透传）见 test_session_reopen.py
    TestReopenConfirmLinkage；无 lease_id 的 confirm 向后兼容由
    test_session_readiness.py 既有用例守门。
    """

    @pytest.mark.asyncio
    async def test_reconnecting_retry_window_constant(self) -> None:
        """DS-4/DS-5：RECONNECTING_RETRY_WINDOW_SEC=180 唯一落点可 import。"""
        from app.modules.daemon.session.service import RECONNECTING_RETRY_WINDOW_SEC

        assert isinstance(RECONNECTING_RETRY_WINDOW_SEC, int)
        assert RECONNECTING_RETRY_WINDOW_SEC == 180

    @pytest.mark.asyncio
    async def test_mark_failed_reconnecting_without_lease_flips_failed(
        self, db_session, mocked_redis
    ) -> None:
        """向后兼容：不带 lease_id → reconnecting → failed（recover 链路现状）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _lease = await _make_ended_session(db_session, uid, rt.id, status="reconnecting")

        svc = DaemonService(db_session)
        result = await svc.mark_session_recovery_failed(sess.id, runtime_id=rt.id)

        assert result == "failed"
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "failed"

    @pytest.mark.asyncio
    async def test_mark_failed_active_without_lease_still_flips_failed(
        self, db_session, mocked_redis
    ) -> None:
        """守门（禁止收窄）：无 lease_id 时保留「非 ended/failed → failed」翻转。

        daemon.ts markRecoveredSessionFailed async-fail 桥接在 confirm 翻
        active 后仍依赖 active→failed 收敛（DS-4 复审 gap 明文保留）。
        """
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _lease = await _make_ended_session(db_session, uid, rt.id, status="active")

        svc = DaemonService(db_session)
        result = await svc.mark_session_recovery_failed(sess.id, runtime_id=rt.id)

        assert result == "failed"
        row = (
            await db_session.execute(
                select(AgentSession.status, AgentSession.ended_at).where(AgentSession.id == sess.id)
            )
        ).one()
        assert row.status == "failed"
        assert row.ended_at is not None

    @pytest.mark.asyncio
    async def test_mark_failed_active_with_matching_lease_flips_failed(
        self, db_session, mocked_redis
    ) -> None:
        """active + 匹配当前 lease 的 lease_id → 照常翻 failed（桥接 + 防误翻双持）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, lease = await _make_ended_session(db_session, uid, rt.id, status="active")

        svc = DaemonService(db_session)
        result = await svc.mark_session_recovery_failed(
            sess.id, runtime_id=rt.id, lease_id=lease.id
        )

        assert result == "failed"
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert status_row == "failed"

    @pytest.mark.asyncio
    async def test_mark_failed_active_with_stale_lease_skips(
        self, db_session, mocked_redis
    ) -> None:
        """active + 陈旧 lease_id → 幂等跳过：返回当前状态、不翻转、不报错。

        陈旧失败确认不得误杀已被第二次 reopen 重新激活的会话。
        """
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess, _lease = await _make_ended_session(db_session, uid, rt.id, status="active")
        stale_lease_id = uuid.uuid4()  # 与 session.lease_id 不匹配
        # id 预取：幂等早退路径现在 rollback 释放 FOR UPDATE 行锁（2026-08-25
        # 会话审查 P2），rollback 过期 ORM 属性后再访问会触发异步 lazy load 报错。
        sess_id = sess.id

        svc = DaemonService(db_session)
        result = await svc.mark_session_recovery_failed(
            sess_id, runtime_id=rt.id, lease_id=stale_lease_id
        )

        assert result == "active"
        status_row = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess_id))
        ).scalar_one()
        assert status_row == "active"


# ── PPM 前导 + 附件物化/降级（task-03 / 2026-08-28-session-ppm-task-binding）──
#
# FR-03 / D-003/D-006/D-007，GWT-1（前导全字段）/ GWT-2（物化并入组装链）/
# GWT-3（四类降级各一断言）+ 事务口径守卫（storage 读 IO 与降级决策在写事务外，
# SessionAttachment insert 写事务内 flush-only）。


def _ppm_storage_backend(
    events: list[str] | None = None, *, fail_keys: frozenset[str] | set[str] = frozenset()
) -> MagicMock:
    """file 中心 + session attachment 共用的 storage backend mock。

    - ``get_object_stream``：正常键吐固定 bytes；``fail_keys`` 命中键首块抛
      RuntimeError（模拟 MinIO 读失败 → 降级）；
    - ``head_object``：恒抛（store_bytes 未命中 → 走 put）；``put_object``：
      AsyncMock 吸收；
    - ``events`` 提供时记录 storage IO 事件（事务口径守卫用）。
    """
    backend = MagicMock()

    def _recorded_stream(key: str):
        if events is not None:
            events.append(f"storage_read:{key}")

        async def _gen():
            if key in fail_keys:
                raise RuntimeError(f"storage read failed: {key}")
            yield b"ppm-file-bytes-0123456789abcdef"

        return _gen()

    async def _head(key: str) -> None:
        if events is not None:
            events.append(f"storage_head:{key}")
        raise RuntimeError("not found")  # store_bytes 视为未命中 → 走 put

    async def _put(key: str, data: bytes, content_type: str) -> None:
        if events is not None:
            events.append(f"storage_put:{key}")

    backend.get_object_stream = MagicMock(side_effect=_recorded_stream)
    backend.head_object = AsyncMock(side_effect=_head)
    backend.put_object = AsyncMock(side_effect=_put)
    return backend


@pytest.fixture()
def ppm_storage():
    """物化/降级用例的 storage 打桩（patch 工厂，service 内函数级 import 命中）。"""
    backend = _ppm_storage_backend()
    with patch(
        "app.modules.storage.factory.get_storage_backend", return_value=backend
    ) as mock_factory:
        yield mock_factory, backend


async def _make_ppm_file_row(
    db_session: AsyncSession,
    *,
    uploaded_by: uuid.UUID,
    name: str = "设计说明.pdf",
    mime_type: str = "application/pdf",
    deleted: bool = False,
) -> uuid.UUID:
    from app.modules.file.model import File

    fid = uuid.uuid4()
    ext = name.rsplit(".", 1)[-1].lower()
    db_session.add(
        File(
            id=fid,
            owner_type="ppm_plan_task",
            owner_id=None,
            original_name=name,
            stored_key=f"2026/08/{fid}.{ext}",
            mime_type=mime_type,
            size=128,
            uploaded_by=uploaded_by,
            deleted_at=datetime.now(UTC) if deleted else None,
        )
    )
    await db_session.commit()
    return fid


async def _make_plan_task_row(
    db_session: AsyncSession, *, user_id: uuid.UUID, file_urls: list
) -> uuid.UUID:
    from app.modules.ppm.task.model import PlanTask

    tid = uuid.uuid4()
    db_session.add(
        PlanTask(
            id=tid,
            user_id=user_id,
            content="PPM 物化测试任务",
            task_description="完成会话上下文注入改造",
            status="进行中",
            project_name="智慧园区二期",
            module_name="会话模块",
            user_name="张三",
            start_time=datetime(2026, 8, 1, tzinfo=UTC),
            end_time=datetime(2026, 8, 15, tzinfo=UTC),
            file_urls=file_urls,
        )
    )
    await db_session.commit()
    return tid


async def _lease_prompt_of(db_session: AsyncSession, lease_id: uuid.UUID) -> str:
    lease = await db_session.get(DaemonTaskLease, lease_id)
    assert lease is not None
    return (lease.metadata_ or {}).get("prompt", "")


class TestPpmCreatePreamble:
    """GWT-1：绑定条目创建会话 → dispatch prompt 前导全字段，展示层干净。"""

    @pytest.mark.asyncio
    async def test_plan_task_preamble_full_fields(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """Given 全字段 PlanTask；When 成对 ppm 字段创建；Then lease prompt 含
        【PPM 任务上下文】标题/描述/状态/项目/模块/责任人/周期全字段且在用户
        消息之前；AgentRunLog(user_input) 干净（仅用户原文）。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        tid = await _make_plan_task_row(db_session, user_id=uid, file_urls=[])

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt="帮我跟进这个任务",
            ppm_item_kind="plan_task",
            ppm_item_id=tid,
        )

        meta_prompt = await _lease_prompt_of(db_session, result.lease_id)
        assert "【PPM 任务上下文】" in meta_prompt
        for field in (
            "标题：PPM 物化测试任务",
            "描述：完成会话上下文注入改造",
            "状态：进行中",
            "项目：智慧园区二期",
            "模块：会话模块",
            "责任人：张三",
            "周期：2026-08-01 ~ 2026-08-15",
        ):
            assert field in meta_prompt, field
        assert meta_prompt.index("【PPM 任务上下文】") < meta_prompt.index("帮我跟进这个任务")
        assert "\n\n---\n\n" in meta_prompt
        # 无降级条目 → 不渲染附件清单段。
        assert "附件清单" not in meta_prompt

        from app.modules.agent.model import AgentRunLog

        log = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == result.agent_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert log is not None
        assert "【PPM 任务上下文】" not in (log.content_redacted or "")
        assert "帮我跟进这个任务" in (log.content_redacted or "")

    @pytest.mark.asyncio
    async def test_problem_preamble_full_fields(self, db_session, mocked_hub, mocked_redis) -> None:
        """Given 全字段 PpmProblemList；When problem 绑定创建；Then 前导为
        【问题上下文】且各字段齐全（标题取 pro_desc）。"""
        from app.modules.ppm.problem.model import PpmProblemList

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        pid = uuid.uuid4()
        db_session.add(
            PpmProblemList(
                id=pid,
                project_id=uuid.uuid4(),
                project_name="智慧园区三期",
                model_name="登录模块",
                pro_desc="登录偶发 502",
                status="新建",
                duty_user_name="李四",
                plan_start_time=datetime(2026, 8, 2, tzinfo=UTC),
                plan_end_time=datetime(2026, 8, 9, tzinfo=UTC),
                file_urls=[],
            )
        )
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt="看下这个问题",
            ppm_item_kind="problem",
            ppm_item_id=pid,
        )

        meta_prompt = await _lease_prompt_of(db_session, result.lease_id)
        assert "【问题上下文】" in meta_prompt
        for field in (
            "标题：登录偶发 502",
            "状态：新建",
            "项目：智慧园区三期",
            "模块：登录模块",
            "责任人：李四",
            "周期：2026-08-02 ~ 2026-08-09",
        ):
            assert field in meta_prompt, field

    @pytest.mark.asyncio
    async def test_item_missing_no_preamble_session_created(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """Given 条目不存在；When 成对字段创建；Then 会话创建成功且 prompt 无
        任何 PPM 前导（查无返回 None 跳过注入，不报错）。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt="普通提问",
            ppm_item_kind="plan_task",
            ppm_item_id=uuid.uuid4(),
        )

        assert result.agent_session.status == "active"
        meta_prompt = await _lease_prompt_of(db_session, result.lease_id)
        assert meta_prompt == "普通提问"


class TestPpmAttachmentMaterialize:
    """GWT-2：有权 + claude + 限额内 → SessionAttachment 物化并入既有组装链。"""

    @pytest.mark.asyncio
    async def test_materialized_rows_join_assembly_chain(
        self, db_session, mocked_hub, mocked_redis, ppm_storage
    ) -> None:
        """Given 本人上传的 1 图 1 文挂 PlanTask.file_urls；When 成对字段创建；
        Then SessionAttachment 落两行（session_id 回填/user_id=创建者/kind 按
        mime 映射），user_input 带标记行，SESSION_INJECT 携带 attachments。"""
        from app.modules.session_attachment.model import SessionAttachment

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        img_fid = await _make_ppm_file_row(
            db_session, uploaded_by=uid, name="截图.png", mime_type="image/png"
        )
        doc_fid = await _make_ppm_file_row(
            db_session, uploaded_by=uid, name="报告.pdf", mime_type="application/pdf"
        )
        tid = await _make_plan_task_row(
            db_session, user_id=uid, file_urls=[str(img_fid), str(doc_fid)]
        )

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt="分析这两个附件",
            ppm_item_kind="plan_task",
            ppm_item_id=tid,
        )

        rows = (
            (
                await db_session.execute(
                    select(SessionAttachment).where(
                        SessionAttachment.session_id == result.agent_session.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 2
        by_name = {r.name: r for r in rows}
        assert set(by_name) == {"截图.png", "报告.pdf"}
        assert by_name["截图.png"].kind == "image"  # mime image/* → kind=image
        assert by_name["报告.pdf"].kind == "file"
        for row in rows:
            assert row.user_id == uid  # user_id=创建者
            assert row.session_id == result.agent_session.id  # 直接回填（跳过 draft）
            assert row.bytes == len(b"ppm-file-bytes-0123456789abcdef")
            assert row.object_key.startswith(f"attachments/{uid}/")

        # 标记行回显（物化行并入 validated_attachments）。
        from app.modules.agent.model import AgentRunLog

        log = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == result.agent_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert log is not None
        assert f"[附件:{by_name['截图.png'].id}|image|截图.png]" in (log.content_redacted or "")
        assert f"[附件:{by_name['报告.pdf'].id}|file|报告.pdf]" in (log.content_redacted or "")

        # SESSION_INJECT payload 携带 attachments（复用既有组装链，daemon 协议零改动）。
        inject_payloads = [
            c.args[2]
            for c in mocked_hub.send_session_control.call_args_list
            if len(c.args) >= 3 and c.args[2].get("attachments")
        ]
        assert inject_payloads, "首 turn SESSION_INJECT 必须携带物化附件"
        payload_atts = inject_payloads[0]["attachments"]
        assert {a["name"] for a in payload_atts} == {"截图.png", "报告.pdf"}

        # 物化成功 → 前导无附件清单降级段。
        meta_prompt = await _lease_prompt_of(db_session, result.lease_id)
        assert "附件清单" not in meta_prompt


class TestPpmAttachmentDegrade:
    """GWT-3：四类降级各一断言——前导文字清单，会话创建不受阻。"""

    @pytest.mark.asyncio
    async def test_degrade_no_access_name_only(
        self, db_session, mocked_hub, mocked_redis, ppm_storage
    ) -> None:
        """无权（他人上传，创建者非管理员）：仅文件名 + 「无权访问」，不物化。"""
        from app.modules.session_attachment.model import SessionAttachment

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        other = await _create_user(db_session)
        fid = await _make_ppm_file_row(db_session, uploaded_by=other, name="机密方案.pdf")
        tid = await _make_plan_task_row(db_session, user_id=uid, file_urls=[str(fid)])

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid, provider="claude", prompt="看附件", ppm_item_kind="plan_task", ppm_item_id=tid
        )

        meta_prompt = await _lease_prompt_of(db_session, result.lease_id)
        assert "附件清单" in meta_prompt
        assert "机密方案.pdf（无权访问）" in meta_prompt
        assert "GET /api/file/" not in meta_prompt  # 无权条目不给链接
        rows = (
            (
                await db_session.execute(
                    select(SessionAttachment).where(
                        SessionAttachment.session_id == result.agent_session.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []

    @pytest.mark.asyncio
    async def test_degrade_over_limit_get_link(
        self, db_session, mocked_hub, mocked_redis, ppm_storage
    ) -> None:
        """超限：6 张图 → 前 5 张物化，第 6 张降级为文件名 + GET 链接。"""
        from app.modules.session_attachment.model import SessionAttachment

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        fids = [
            await _make_ppm_file_row(
                db_session, uploaded_by=uid, name=f"截图{n}.png", mime_type="image/png"
            )
            for n in range(6)
        ]
        tid = await _make_plan_task_row(db_session, user_id=uid, file_urls=[str(f) for f in fids])

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid, provider="claude", prompt="看图", ppm_item_kind="plan_task", ppm_item_id=tid
        )

        meta_prompt = await _lease_prompt_of(db_session, result.lease_id)
        assert f"截图5.png：GET /api/file/{fids[5]}" in meta_prompt
        assert "截图0.png：" not in meta_prompt  # 前 5 张正常物化不进清单
        rows = (
            (
                await db_session.execute(
                    select(SessionAttachment).where(
                        SessionAttachment.session_id == result.agent_session.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 5

    @pytest.mark.asyncio
    async def test_degrade_non_claude_get_link(
        self, db_session, mocked_hub, mocked_redis, ppm_storage
    ) -> None:
        """provider≠claude：有权条目不物化，降级为文件名 + GET 链接。"""
        from app.modules.session_attachment.model import SessionAttachment

        uid = await _create_user(db_session)
        rt = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=uid,
            name="codex-rt",
            provider="codex",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(rt)
        await db_session.commit()
        fid = await _make_ppm_file_row(db_session, uploaded_by=uid, name="说明.pdf")
        tid = await _make_plan_task_row(db_session, user_id=uid, file_urls=[str(fid)])

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider=None,
            runtime_id=str(rt.id),
            prompt="codex 会话",
            ppm_item_kind="plan_task",
            ppm_item_id=tid,
        )

        meta_prompt = await _lease_prompt_of(db_session, result.lease_id)
        assert f"说明.pdf：GET /api/file/{fid}" in meta_prompt
        assert "无权访问" not in meta_prompt
        rows = (
            (
                await db_session.execute(
                    select(SessionAttachment).where(
                        SessionAttachment.session_id == result.agent_session.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []

    @pytest.mark.asyncio
    async def test_degrade_deleted_and_read_failure_get_link(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """读取失败/已删：软删行走文件名 + GET 链接；storage 读抛错同降级；
        R-03 非 uuid 历史 URL 原样进清单。"""
        from app.modules.session_attachment.model import SessionAttachment

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        deleted_fid = await _make_ppm_file_row(
            db_session, uploaded_by=uid, name="已删文档.pdf", deleted=True
        )
        broken_fid = await _make_ppm_file_row(db_session, uploaded_by=uid, name="坏盘文档.pdf")
        tid = await _make_plan_task_row(
            db_session,
            user_id=uid,
            file_urls=[str(deleted_fid), str(broken_fid), "https://old-cdn/x.png"],
        )
        # 坏盘文档：stored_key 指向读取必抛错的键（fail_keys 命中）。
        from app.modules.file.model import File as _FileModel

        broken_row = await db_session.get(_FileModel, broken_fid)
        assert broken_row is not None
        backend = _ppm_storage_backend(fail_keys={broken_row.stored_key})
        with patch("app.modules.storage.factory.get_storage_backend", return_value=backend):
            svc = DaemonService(db_session)
            result = await svc.create_session(
                uid,
                provider="claude",
                prompt="都坏了也要能开会话",
                ppm_item_kind="plan_task",
                ppm_item_id=tid,
            )

        meta_prompt = await _lease_prompt_of(db_session, result.lease_id)
        # 已删：文件名（软删行回查取得）+ GET 链接。
        assert f"已删文档.pdf：GET /api/file/{deleted_fid}" in meta_prompt
        # 读取失败：同样文件名 + GET 链接。
        assert f"坏盘文档.pdf：GET /api/file/{broken_fid}" in meta_prompt
        # R-03：非 uuid 历史 URL 字符串原样进清单。
        assert "https://old-cdn/x.png" in meta_prompt
        assert "无权访问" not in meta_prompt
        rows = (
            (
                await db_session.execute(
                    select(SessionAttachment).where(
                        SessionAttachment.session_id == result.agent_session.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []
        assert result.agent_session.status == "active"  # 降级不阻塞创建


class TestPpmMaterializeTxnSplit:
    """事务口径：storage 读 IO/降级决策在写事务外；行 insert 写事务内 flush-only。"""

    @pytest.mark.asyncio
    async def test_storage_io_and_degrade_decisions_outside_write_txn(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """Given 本人上传的 file 类附件（assemble 落盘链不触 storage 读，事件
        全部来自物化段）；When ppm 创建；Then 所有 storage 事件（file bytes 读 +
        store_bytes 的 head/put）均早于只读事务收口 commit，首个写 flush 晚于
        该 commit——storage IO/降级决策不落写事务窗口（守卫对齐
        test_session_optimize_round2.py::TestCreateSessionPreambleBeforeWrite）。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        fid = await _make_ppm_file_row(db_session, uploaded_by=uid, name="事务口径.pdf")
        tid = await _make_plan_task_row(db_session, user_id=uid, file_urls=[str(fid)])

        events: list[str] = []
        backend = _ppm_storage_backend(events)
        real_commit = db_session.commit
        real_flush = db_session.flush

        async def _spy_commit():
            events.append("commit")
            return await real_commit()

        async def _spy_flush(*args, **kwargs):
            events.append("flush")
            return await real_flush(*args, **kwargs)

        db_session.commit = _spy_commit
        db_session.flush = _spy_flush

        with patch("app.modules.storage.factory.get_storage_backend", return_value=backend):
            svc = DaemonService(db_session)
            result = await svc.create_session(
                uid,
                provider="claude",
                prompt="事务口径",
                ppm_item_kind="plan_task",
                ppm_item_id=tid,
            )

        storage_idx = [i for i, e in enumerate(events) if e.startswith("storage_")]
        assert storage_idx, "物化必须发生 storage IO"
        first_commit = events.index("commit")
        first_flush = events.index("flush")
        assert max(storage_idx) < first_commit < first_flush, events
        # SessionAttachment 行已落（写事务内 flush-only，共用唯一 commit）。
        from app.modules.session_attachment.model import SessionAttachment

        rows = (
            (
                await db_session.execute(
                    select(SessionAttachment).where(
                        SessionAttachment.session_id == result.agent_session.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
