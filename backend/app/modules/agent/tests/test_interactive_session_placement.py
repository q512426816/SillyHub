"""Tests for RunPlacementService interactive two-phase dispatch (task-05, D-005@v1).

Covers the D-005@v1 triple contract:
- interactive lease has agent_run_id=NULL
- kind='interactive'
- lease_expires_at=NULL (so expire_leases naturally skips it — AC-15)
- first turn run_id/prompt live in lease metadata only
- batch dispatch_to_daemon() signature/behaviour unchanged (FR-09, AC-14)

Uses the in-memory SQLite session fixture from backend/conftest.py.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import (
    NoOnlineDaemonError,
    RunPlacementService,
)
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"test-{uid}@example.com",
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


async def _bootstrap_workspace_binding(
    session: AsyncSession, user_id: uuid.UUID, runtime_id: uuid.UUID
) -> uuid.UUID:
    """2026-07-10-remove-server-local-workspace-mode: dispatch_to_daemon 走
    per-member binding 解析 runtime，必须建 daemon_instance + workspace + binding。
    runtime 必须关联 daemon_instance_id 才能被 placement 按 daemon 查到。
    返回 workspace_id。"""
    from app.modules.daemon.model import DaemonInstance
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
    from app.modules.workspace.model import Workspace

    di = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=f"host-{uuid.uuid4().hex[:6]}",
        server_url="http://localhost:8000",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(di)
    await session.flush()
    # 把 runtime 关联到这个 daemon_instance（placement 按 daemon_instance_id 查 provider）
    rt = await session.get(DaemonRuntime, runtime_id)
    if rt is not None and rt.daemon_instance_id is None:
        rt.daemon_instance_id = di.id
        await session.flush()
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        default_agent="claude",
        status="active",
        created_by=user_id,
    )
    session.add(ws)
    await session.flush()
    session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=user_id,
            daemon_id=di.id,
            runtime_id=runtime_id,
            root_path="/tmp/binding",
            path_source="daemon-client",
        )
    )
    await session.commit()
    return ws.id


# ── prepare_interactive_dispatch ─────────────────────────────────────────────


class TestPrepareInteractiveDispatch:
    @pytest.mark.asyncio
    async def test_creates_interactive_lease_with_null_run_fk(
        self, db_session: AsyncSession
    ) -> None:
        """D-005@v1: lease.agent_run_id must be NULL even though we know the run id."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        session_id = uuid.uuid4()
        run_id = uuid.uuid4()
        placement = RunPlacementService(db_session)
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=session_id,
            agent_run_id=run_id,
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
            manual_approval=False,
        )

        assert dispatch.run_id == run_id
        assert dispatch.runtime_id == rt.id

        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        assert lease is not None
        # D-005@v1 core contract
        assert lease.agent_run_id is None
        assert lease.kind == "interactive"
        assert lease.lease_expires_at is None
        assert lease.status == "pending"
        assert lease.runtime_id == rt.id

        # First-turn parameters live in metadata only
        meta = lease.metadata_ or {}
        assert meta["session_id"] == str(session_id)
        assert meta["run_id"] == str(run_id)
        assert meta["prompt"] == "hi"
        assert meta["provider"] == "claude"
        assert meta["manual_approval"] is True
        assert meta["ask_user_only"] is True

    @pytest.mark.asyncio
    async def test_model_field_stored_in_metadata(self, db_session: AsyncSession) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        placement = RunPlacementService(db_session)
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model="claude-sonnet-4",
            manual_approval=True,
        )
        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        meta = lease.metadata_ or {}
        assert meta["model"] == "claude-sonnet-4"
        assert meta["manual_approval"] is True

    @pytest.mark.asyncio
    async def test_no_online_runtime_raises(self, db_session: AsyncSession) -> None:
        """No online runtime → NoOnlineDaemonError (create_session must converge)."""
        uid = await _create_user(db_session)
        # no runtime created
        placement = RunPlacementService(db_session)
        with pytest.raises(NoOnlineDaemonError):
            await placement.prepare_interactive_dispatch(
                agent_session_id=uuid.uuid4(),
                agent_run_id=uuid.uuid4(),
                user_id=uid,
                provider="claude",
                prompt="hi",
                model=None,
            )

    @pytest.mark.asyncio
    async def test_does_not_commit_caller_controls_transaction(
        self, db_session: AsyncSession
    ) -> None:
        """prepare only flushes; if the caller rolls back the lease vanishes."""
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
        # lease is flushed and visible in this session
        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        assert lease is not None

        await db_session.rollback()
        # after rollback the lease is gone
        lease_after = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        assert lease_after is None

    @pytest.mark.asyncio
    async def test_prepare_interactive_dispatch_passes_workspace_and_cwd(
        self, db_session: AsyncSession
    ) -> None:
        """2026-07-09-change-detail-session task-05 / D-003@v1：变更会话 dispatch
        的 lease metadata 必须含 workspace_id + cwd，让 context.build_claim_payload
        的 ws_id 分支命中解析 spec_root/root_path；未传时与现状一致（零回归）。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        ws_id = uuid.uuid4()
        placement = RunPlacementService(db_session)

        # 1) 传 workspace_id + cwd → metadata 必含两者
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
            workspace_id=ws_id,
            cwd="/tmp/proj",
        )
        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        meta = lease.metadata_ or {}
        assert meta["workspace_id"] == str(ws_id)
        assert meta["cwd"] == "/tmp/proj"

        # 2) 不传 workspace_id/cwd → metadata 不得含 workspace_id 键（零回归）
        dispatch2 = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
        )
        lease2 = await db_session.get(DaemonTaskLease, dispatch2.lease_id)
        meta2 = lease2.metadata_ or {}
        assert "workspace_id" not in meta2
        assert "cwd" not in meta2


# ── task-04（2026-08-26-team-subsession-recursion）：worker_depth 透传 ─────────


class TestWorkerDepthMetadata:
    """task-04 / design §5.C / FR-04：``prepare_interactive_dispatch`` 的
    ``worker_depth`` 可选参数写 lease ``metadata.worker_depth``。

    写法对齐 stage 先例（真值才写键）：None 不写——存量 quick-chat / 主控 / 普通
    会话 / 旧 lease 的 metadata 无 worker_depth 键（undefined 全链穿透不伪造默认
    值，零回归）。守卫用 ``is not None``（int 字段 0 是合法值不被吞，对齐
    timeout_seconds 先例）。调用方接线（mcp_tools 派发传 tree_depth+1）归 task-02。
    """

    @pytest.mark.asyncio
    async def test_worker_depth_written_to_metadata(self, db_session: AsyncSession) -> None:
        """传 worker_depth=1（分身）→ metadata["worker_depth"] == 1。"""
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
            worker_depth=1,
        )
        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        meta = lease.metadata_ or {}
        assert meta["worker_depth"] == 1

    @pytest.mark.asyncio
    async def test_worker_depth_grandchild_layer_two(self, db_session: AsyncSession) -> None:
        """孙层 depth=2 同样落键（递归派工链路）。"""
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
            worker_depth=2,
        )
        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        meta = lease.metadata_ or {}
        assert meta["worker_depth"] == 2

    @pytest.mark.asyncio
    async def test_worker_depth_zero_is_written(self, db_session: AsyncSession) -> None:
        """``is not None`` 守护：0 是合法深度值不被真值判断吞掉。"""
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
            worker_depth=0,
        )
        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        meta = lease.metadata_ or {}
        assert meta["worker_depth"] == 0

    @pytest.mark.asyncio
    async def test_worker_depth_absent_by_default(self, db_session: AsyncSession) -> None:
        """不传 / 显式 None → metadata 无 worker_depth 键（存量会话零回归）。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        placement = RunPlacementService(db_session)
        # 1) 缺省不传
        dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
        )
        lease = await db_session.get(DaemonTaskLease, dispatch.lease_id)
        meta = lease.metadata_ or {}
        assert "worker_depth" not in meta
        # 2) 显式 None 同样不写键
        dispatch2 = await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            prompt="hi",
            model=None,
            worker_depth=None,
        )
        lease2 = await db_session.get(DaemonTaskLease, dispatch2.lease_id)
        meta2 = lease2.metadata_ or {}
        assert "worker_depth" not in meta2


# ── notify_interactive_dispatch ──────────────────────────────────────────────


class TestNotifyInteractiveDispatch:
    @pytest.mark.asyncio
    async def test_returns_true_when_connected(self, db_session: AsyncSession) -> None:
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
        from unittest.mock import MagicMock

        mock_hub = MagicMock()
        mock_hub.is_connected.return_value = True
        mock_hub.send_wakeup = AsyncMock()
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=mock_hub):
            ok = await placement.notify_interactive_dispatch(dispatch)
        assert ok is True
        mock_hub.send_wakeup.assert_awaited()

    @pytest.mark.asyncio
    async def test_returns_false_when_offline(self, db_session: AsyncSession) -> None:
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
        from unittest.mock import MagicMock

        mock_hub = MagicMock()
        mock_hub.is_connected.return_value = False
        mock_hub.connected_daemon_ids = []
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=mock_hub):
            ok = await placement.notify_interactive_dispatch(dispatch)
        assert ok is False


# ── dispatch_to_daemon lease 守护（bfaa9256 起 stage 改 interactive） ────────


class TestDispatchToDaemonBindsRun:
    """dispatch_to_daemon 创建的 interactive lease 必须绑定 agent_run_id（非 NULL）。

    bfaa9256 起 dispatch_to_daemon 的 lease kind 从 batch 改为 interactive（让
    daemon 走 SessionManager 实时转发）。它与 prepare_interactive_dispatch 的对话
    lease 同为 kind='interactive'，区别在 agent_run_id：dispatch_to_daemon 非 NULL
    （stage dispatch 绑定 run，close_interactive_run 据此定位 + stage 回写），
    prepare_interactive_dispatch 为 NULL（D-005@v1，首 turn run_id 仅存 metadata）。
    """

    @pytest.mark.asyncio
    async def test_dispatch_to_daemon_interactive_lease_binds_run(
        self, db_session: AsyncSession
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        ws_id = await _bootstrap_workspace_binding(db_session, uid, rt.id)
        # dispatch_to_daemon 只写 lease 行引用 agent_run_id；FK 在 delete 时 SET NULL，
        # SQLite 默认不强制 FK，插入悬空 id 也可容忍。插入 run 保持真实。
        run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="pending")
        db_session.add(run)
        await db_session.commit()

        from unittest.mock import MagicMock

        mock_hub = MagicMock()
        mock_hub.is_connected.return_value = True
        mock_hub.send_wakeup = AsyncMock()
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=mock_hub):
            placement = RunPlacementService(db_session)
            lease_id = await placement.dispatch_to_daemon(
                agent_run_id=run.id,
                user_id=uid,
                workspace_id=ws_id,
                provider="claude",
                prompt="batch job",
            )
        assert lease_id is not None
        lease = await db_session.get(DaemonTaskLease, lease_id)
        # dispatch_to_daemon 产 interactive lease（bfaa9256 起），与 prepare 同 kind，
        # 但 agent_run_id 非 NULL —— 这是 stage lease 区别于对话 lease 的关键。
        assert lease.kind == "interactive"
        assert lease.agent_run_id == run.id  # stage dispatch 绑定 FK

    @pytest.mark.asyncio
    async def test_dispatch_to_daemon_session_config_has_manual_approval(
        self, db_session: AsyncSession
    ) -> None:
        """dispatch_to_daemon 建的 agent_sessions.config 必须带 manual_approval=True。

        ql-20260813-003 回归：stage dispatch 的 agent 调 AskUserQuestion 时提问传不到
        前端、死等。根因是 dispatch_to_daemon 用 raw SQL INSERT 建 agent_sessions 时漏
        config 列（只写了 lease.metadata 的 manual_approval，没同步到 session.config），
        被 permission_service.py:320 硬门控 `manual_approval is not True` 吞掉。本测试
        守护 session.config 不再缺失——scan（service.py:1645）/ interactive（488）已设，
        stage 也必须设。
        """
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        ws_id = await _bootstrap_workspace_binding(db_session, uid, rt.id)
        run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="pending")
        db_session.add(run)
        await db_session.commit()

        from unittest.mock import MagicMock

        mock_hub = MagicMock()
        mock_hub.is_connected.return_value = True
        mock_hub.send_wakeup = AsyncMock()
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=mock_hub):
            placement = RunPlacementService(db_session)
            await placement.dispatch_to_daemon(
                agent_run_id=run.id,
                user_id=uid,
                workspace_id=ws_id,
                provider="claude",
                prompt="batch job",
            )

        # session 经 raw SQL INSERT 写入；run.agent_session_id 经 raw SQL UPDATE
        # （placement.py:511-514）。ORM 对象在 expire_on_commit=False 下不自动刷新，
        # 显式 refresh(run) 从 DB 重读 agent_session_id，再 get session 验 config。
        await db_session.refresh(run)
        assert run.agent_session_id is not None
        sess = await db_session.get(AgentSession, run.agent_session_id)
        assert sess is not None
        assert (sess.config or {}).get("manual_approval") is True
        assert (sess.config or {}).get("ask_user_only") is True

    @pytest.mark.asyncio
    async def test_expire_leases_skips_interactive_lease(self, db_session: AsyncSession) -> None:
        """AC-15: an interactive lease with NULL lease_expires_at is never expired."""
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # interactive lease: lease_expires_at NULL even though status=pending
        interactive = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="pending",
            lease_expires_at=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        # batch lease already past expiry → must be expired
        expired_batch = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="batch",
            status="pending",
            lease_expires_at=datetime.now(UTC) - timedelta(minutes=5),
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db_session.add_all([interactive, expired_batch])
        await db_session.commit()

        svc = DaemonService(db_session)
        expired = await svc.expire_leases()
        expired_ids = {str(e.id) for e in expired}

        assert str(expired_batch.id) in expired_ids
        # the interactive lease must NOT be in the expired set
        assert str(interactive.id) not in expired_ids

        # And it stays pending
        await db_session.refresh(interactive)
        assert interactive.status == "pending"
