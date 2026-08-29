"""task-03（2026-08-24-sessions-live-updates）：跨模块列表信号埋点单测。

design §3 生命周期契约表的 6 个跨模块写入点各自发布 created / status_changed，
且「不发路径」（last_active-only / 幂等未变更 / 命中已有 tool_report 会话）零发布。
每模块 monkeypatch 其 import 的 ``publish_sessions_changed`` 捕获调用（不打真 Redis，
容错语义已由 task-01 ``test_session_events.py`` 独立覆盖）：

- run_sync/service.py close_interactive_run：run 终态翻 session ended/failed →
  status_changed；多轮对话仅刷 last_active_at → 不发；
- sweep.py 两档（reconnect / offline）：批量 UPDATE 后逐行 status_changed，
  无命中零发布；offline 档 task-05 改挂起语义——active→suspended 非终态只发
  status_changed（无 session_ended），超龄 24h GC 置 failed 才发终态
  session_ended（reason=suspended_expired）；
- lease_service.py cancel_lease：session 实际翻 ended → status_changed，
  幂等（已 ended/failed）零发布；
- platform_sync/service.py tool_report upsert：仅新 INSERT 分支 created，
  命中已有会话只刷 last_active_at → 不发；
- agent/service.py start_scan_dispatch：INSERT + 激活 → created + status_changed；
- agent/placement.py dispatch_to_daemon：raw INSERT → created。

fixture 范式分别参照 test_close_interactive_run_session_status.py /
test_session_reconnect_sweep.py / test_cancel_lease_session.py /
test_agent_log_push.py（platform_sync/tests）/ test_start_scan_dispatch_daemon_client.py
/ test_dispatch_workspace_routing.py（agent/tests）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.agent.service import AgentService
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import RECONNECTING_RETRY_WINDOW_SEC
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace

# ── 通用 helpers ──────────────────────────────────────────────────────────────


async def _make_user(db: AsyncSession, *, prefix: str = "cross") -> User:
    """User 行（FK 基座；镜像 test_session_reconnect_sweep 轻量写法）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"{prefix}-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name="cross",
        status="active",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _capture_publish(monkeypatch: pytest.MonkeyPatch, module_path: str) -> list[tuple]:
    """把 ``module_path.publish_sessions_changed`` 换成捕获桩，返回调用记录。"""
    calls: list[tuple] = []

    async def _fake_publish(event, session_id, user_id):
        calls.append((event, session_id, user_id))

    monkeypatch.setattr(f"{module_path}.publish_sessions_changed", _fake_publish)
    return calls


# ── 1. run_sync/service.py close_interactive_run ─────────────────────────────


async def _seed_interactive_run(
    db_session: AsyncSession,
    user: User,
    rt: DaemonRuntime,
    *,
    spec_strategy: str | None,
    change_id: uuid.UUID | None,
    session_status: str = "active",
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID]:
    """lease（带 claim_token）+ session + run，返回 (lease_id, run_id, token, session_id)。

    镜像 test_close_interactive_run_session_status.py 的 _seed_session_and_run。
    """
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await RunPlacementService(db_session).prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=user.id,
        provider="claude",
        prompt="hi",
        model=None,
    )
    now = datetime.now(UTC)
    db_session.add_all(
        [
            AgentSession(
                id=session_id,
                user_id=user.id,
                provider="claude",
                status=session_status,
                config={},
                turn_count=1,
                runtime_id=rt.id,
                lease_id=dispatch.lease_id,
                last_active_at=now,
                created_at=now,
            ),
            AgentRun(
                id=run_id,
                agent_type="claude_code",
                provider="claude",
                status="running",
                spec_strategy=spec_strategy,
                agent_session_id=session_id,
                change_id=change_id,
            ),
        ]
    )
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token, session_id


@pytest.fixture()
def mocked_redis():
    """close_interactive_run 双路 Redis publish 的 mock（对齐 lifecycle_patch 范式）。"""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


@pytest.mark.asyncio
async def test_close_interactive_run_terminal_flip_publishes_status_changed(
    db_session: AsyncSession, mocked_redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    """单轮任务 run completed → session ended：commit 后发一条 status_changed。"""
    calls = _capture_publish(monkeypatch, "app.modules.daemon.run_sync.service")
    user = await _make_user(db_session, prefix="runsync")
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    lease_id, run_id, token, session_id = await _seed_interactive_run(
        db_session, user, rt, spec_strategy="interactive", change_id=uuid.uuid4()
    )

    await DaemonService(db_session).close_interactive_run(
        lease_id, run_id, token, status="success", is_error=False
    )

    assert calls == [("status_changed", session_id, user.id)]


@pytest.mark.asyncio
async def test_close_interactive_run_multi_turn_last_active_only_no_publish(
    db_session: AsyncSession, mocked_redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    """多轮对话（interactive + change_id=None）仅刷 last_active_at：零发布。"""
    calls = _capture_publish(monkeypatch, "app.modules.daemon.run_sync.service")
    user = await _make_user(db_session, prefix="runsync-mt")
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    lease_id, run_id, token, _session_id = await _seed_interactive_run(
        db_session, user, rt, spec_strategy="interactive", change_id=None
    )

    await DaemonService(db_session).close_interactive_run(
        lease_id, run_id, token, status="success", is_error=False
    )

    assert calls == []


# ── 2. sweep.py 两档 ─────────────────────────────────────────────────────────


async def _make_lease(
    db: AsyncSession, runtime_id: uuid.UUID, *, status: str = "pending"
) -> DaemonTaskLease:
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status=status,
        claimed_at=now if status == "claimed" else None,
        lease_expires_at=None,
        attempt_number=1,
        metadata_={"session_id": "sdk-sess", "claim_token": f"tok-{uuid.uuid4().hex[:8]}"},
        created_at=now,
        updated_at=now,
    )
    db.add(lease)
    await db.commit()
    return lease


async def _make_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    *,
    status: str,
    lease_id: uuid.UUID | None,
    last_active_at: datetime | None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=lease_id,
        provider="claude",
        status=status,
        agent_session_id=f"sdk-{uuid.uuid4().hex[:8]}",
        config={},
        turn_count=1,
        created_at=now,
        last_active_at=last_active_at,
        ended_at=now if status in ("ended", "failed") else None,
    )
    db.add(sess)
    await db.commit()
    return sess


@pytest.mark.asyncio
async def test_reconnect_sweep_publishes_per_row(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """两行超时 reconnecting 收敛 failed → 逐行各发一条 status_changed（含 user_id）。"""
    from app.modules.daemon.sweep import session_reconnect_sweep_once

    calls = _capture_publish(monkeypatch, "app.modules.daemon.sweep")
    user = await _make_user(db_session, prefix="sweep")
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    stale = datetime.now(UTC) - timedelta(seconds=RECONNECTING_RETRY_WINDOW_SEC + 120)
    s1 = await _make_session(
        db_session,
        user.id,
        rt.id,
        status="reconnecting",
        lease_id=(await _make_lease(db_session, rt.id)).id,
        last_active_at=stale,
    )
    s2 = await _make_session(
        db_session,
        user.id,
        rt.id,
        status="reconnecting",
        lease_id=(await _make_lease(db_session, rt.id)).id,
        last_active_at=stale,
    )

    converged = await session_reconnect_sweep_once(db_session)

    assert converged == 2
    assert sorted(calls, key=lambda c: str(c[1])) == sorted(
        [
            ("status_changed", s1.id, user.id),
            ("status_changed", s2.id, user.id),
        ],
        key=lambda c: str(c[1]),
    )


@pytest.mark.asyncio
async def test_reconnect_sweep_no_hit_no_publish(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """窗口内 reconnecting 不收敛：零发布（列表无变化）。"""
    from app.modules.daemon.sweep import session_reconnect_sweep_once

    calls = _capture_publish(monkeypatch, "app.modules.daemon.sweep")
    user = await _make_user(db_session, prefix="sweep-fresh")
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    await _make_session(
        db_session,
        user.id,
        rt.id,
        status="reconnecting",
        lease_id=None,
        last_active_at=datetime.now(UTC) - timedelta(seconds=30),
    )

    assert await session_reconnect_sweep_once(db_session) == 0
    assert calls == []


@pytest.mark.asyncio
async def test_offline_sweep_publishes_per_row(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """runtime 离线的 active 会话收敛 **suspended**（task-05 / design A5，原
    failed）→ 逐行 status_changed；suspended 非终态——per-session 频道不发
    session_ended（SSE 会话流不收尾）。"""
    from app.modules.daemon import sweep as sweep_mod
    from app.modules.daemon.sweep import RUNTIME_OFFLINE_GRACE_SEC, session_offline_sweep_once

    calls = _capture_publish(monkeypatch, "app.modules.daemon.sweep")
    per_session_publishes: list[tuple[str, str]] = []

    class _FakeRedis:
        async def publish(self, channel: str, payload: str) -> int:
            per_session_publishes.append((channel, payload))
            return 1

    monkeypatch.setattr(sweep_mod, "get_redis", lambda: _FakeRedis())

    user = await _make_user(db_session, prefix="sweep-off")
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="daemon",
        provider="claude",
        status="online",  # 心跳超窗即视为离线（status 条件外还查 last_heartbeat_at）
        last_heartbeat_at=datetime.now(UTC) - timedelta(seconds=RUNTIME_OFFLINE_GRACE_SEC + 300),
    )
    db_session.add(rt)
    await db_session.commit()
    offline = await _make_session(
        db_session,
        user.id,
        rt.id,
        status="active",
        lease_id=None,
        last_active_at=datetime.now(UTC),
    )

    converged = await session_offline_sweep_once(db_session)

    assert converged == 1
    assert calls == [("status_changed", offline.id, user.id)]
    # 非终态：无 session_ended（终态事件只属于 failed 收敛路径）
    events = [
        json.loads(p) for ch, p in per_session_publishes if ch == f"agent_session:{offline.id}"
    ]
    assert not any(e.get("event") == "session_ended" for e in events)


@pytest.mark.asyncio
async def test_offline_sweep_gc_publishes_terminal_events(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """suspended 超 24h（SUSPENDED_MAX_AGE_SEC）GC 置 failed → 此时才发终态
    session_ended（reason=suspended_expired）+ status_changed（task-05）。"""
    from app.modules.daemon import sweep as sweep_mod
    from app.modules.daemon.sweep import SUSPENDED_MAX_AGE_SEC, session_offline_sweep_once

    calls = _capture_publish(monkeypatch, "app.modules.daemon.sweep")
    per_session_publishes: list[tuple[str, str]] = []

    class _FakeRedis:
        async def publish(self, channel: str, payload: str) -> int:
            per_session_publishes.append((channel, payload))
            return 1

    monkeypatch.setattr(sweep_mod, "get_redis", lambda: _FakeRedis())

    user = await _make_user(db_session, prefix="sweep-gc")
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="daemon",
        provider="claude",
        status="online",  # GC 纯年龄驱动，与 runtime 在线状态无关
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    aged = await _make_session(
        db_session,
        user.id,
        rt.id,
        status="suspended",
        lease_id=None,
        last_active_at=datetime.now(UTC) - timedelta(seconds=SUSPENDED_MAX_AGE_SEC + 3600),
    )

    converged = await session_offline_sweep_once(db_session)

    assert converged == 1
    assert calls == [("status_changed", aged.id, user.id)]
    events = [json.loads(p) for ch, p in per_session_publishes if ch == f"agent_session:{aged.id}"]
    assert any(
        e.get("event") == "session_ended" and e.get("reason") == "suspended_expired" for e in events
    )


# ── 3. lease_service.py cancel_lease ─────────────────────────────────────────


async def _seed_cancel_target(
    db_session: AsyncSession,
    user: User,
    rt: DaemonRuntime,
    *,
    session_status: str,
) -> tuple[uuid.UUID, uuid.UUID]:
    """claimed interactive lease + session + run，返回 (run_id, session_id)。

    镜像 test_cancel_lease_session.py 的 _create_interactive_run（最小集）。
    """
    now = datetime.now(UTC)
    run_id = uuid.uuid4()
    sess_id = uuid.uuid4()
    db_session.add_all(
        [
            DaemonTaskLease(
                id=uuid.uuid4(),
                runtime_id=rt.id,
                agent_run_id=run_id,
                status="claimed",
                kind="interactive",
                claimed_at=now,
                lease_expires_at=None,
                metadata_={"claim_token": "tok", "session_id": str(sess_id)},
                created_at=now,
                updated_at=now,
            ),
            AgentSession(
                id=sess_id,
                user_id=user.id,
                provider="claude",
                status=session_status,
                config={},
                turn_count=1,
                runtime_id=rt.id,
                lease_id=None,
                last_active_at=now,
                created_at=now,
            ),
            AgentRun(
                id=run_id,
                agent_type="claude_code",
                provider="claude",
                status="running",
                spec_strategy="interactive",
                agent_session_id=sess_id,
            ),
        ]
    )
    await db_session.commit()
    return run_id, sess_id


def _patch_ws_hub(monkeypatch: pytest.MonkeyPatch) -> None:
    """ws_hub 换空 hub（cancel 的 WS 下发是 best-effort，测试只关心埋点）。"""
    from app.modules.daemon import ws_hub as ws_hub_mod

    class _FakeHub:
        async def send_session_control(self, daemon_id, msg_type, payload):
            return True

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _FakeHub())


@pytest.mark.asyncio
async def test_cancel_lease_flip_publishes_status_changed(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """active session 被 cancel 翻 ended → 发一条 status_changed。"""
    from app.modules.daemon.lease_service import DaemonLeaseService

    calls = _capture_publish(monkeypatch, "app.modules.daemon.lease_service")
    user = await _make_user(db_session, prefix="cancel")
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    run_id, sess_id = await _seed_cancel_target(db_session, user, rt, session_status="active")
    _patch_ws_hub(monkeypatch)

    await DaemonLeaseService(db_session).cancel_lease(run_id)

    assert calls == [("status_changed", sess_id, user.id)]


@pytest.mark.asyncio
async def test_cancel_lease_idempotent_no_publish(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """session 已 ended（幂等未变更）→ 零发布。"""
    from app.modules.daemon.lease_service import DaemonLeaseService

    calls = _capture_publish(monkeypatch, "app.modules.daemon.lease_service")
    user = await _make_user(db_session, prefix="cancel-idem")
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    run_id, _sess_id = await _seed_cancel_target(db_session, user, rt, session_status="ended")
    _patch_ws_hub(monkeypatch)

    await DaemonLeaseService(db_session).cancel_lease(run_id)

    assert calls == []


# ── 4. platform_sync/service.py tool_report upsert ───────────────────────────


@pytest.fixture()
async def _platform_log_table(db_engine):
    """建 platform_agent_logs 表（daemon/tests 无 platform_sync conftest，自包含）。"""
    from app.modules.platform_sync.model import AgentSessionLogORM

    async with db_engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: AgentSessionLogORM.__table__.create(sync_conn, checkfirst=True)
        )


@pytest.mark.asyncio
async def test_tool_report_insert_publishes_created(
    db_session: AsyncSession, _platform_log_table, monkeypatch: pytest.MonkeyPatch
) -> None:
    """首推未命中 → 新 INSERT tool_report 会话 → 发一条 created。"""
    from app.modules.platform_sync.schema import AgentLogEntry
    from app.modules.platform_sync.service import PlatformSyncService

    calls = _capture_publish(monkeypatch, "app.modules.platform_sync.service")
    user = await _make_user(db_session, prefix="toolrep")
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()

    upserted = await PlatformSyncService(db_session).upsert_agent_log_entries(
        ws.id,
        [AgentLogEntry(harness="codex", log_path="C:/x/rollout.jsonl")],
        pushed_at=None,
        scan_run_id=None,
        user_id=user.id,
    )

    assert upserted == 1
    assert len(calls) == 1
    event, session_id, user_id = calls[0]
    assert event == "created"
    assert user_id == user.id
    row = (
        await db_session.execute(select(AgentSession).where(AgentSession.id == session_id))
    ).scalar_one()
    assert row.origin == "tool_report"
    assert row.status == "pending"


@pytest.mark.asyncio
async def test_tool_report_hit_refresh_only_no_publish(
    db_session: AsyncSession, _platform_log_table, monkeypatch: pytest.MonkeyPatch
) -> None:
    """二推命中已有会话只刷 last_active_at → 零发布（列表无变化）。"""
    from app.modules.platform_sync.schema import AgentLogEntry
    from app.modules.platform_sync.service import PlatformSyncService

    calls = _capture_publish(monkeypatch, "app.modules.platform_sync.service")
    user = await _make_user(db_session, prefix="toolrep2")
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    svc = PlatformSyncService(db_session)

    await svc.upsert_agent_log_entries(
        ws.id,
        [AgentLogEntry(harness="codex", log_path="C:/x/rollout.jsonl")],
        pushed_at=None,
        scan_run_id=None,
        user_id=user.id,
    )
    assert len(calls) == 1  # 首推 created（前置 sanity）
    calls.clear()

    await svc.upsert_agent_log_entries(
        ws.id,
        [AgentLogEntry(harness="codex", log_path="C:/x/rollout.jsonl", invocations=2)],
        pushed_at=None,
        scan_run_id=None,
        user_id=user.id,
    )

    assert calls == []


@pytest.mark.asyncio
async def test_tool_report_hub_branch_no_publish(
    db_session: AsyncSession, _platform_log_table, monkeypatch: pytest.MonkeyPatch
) -> None:
    """hub_session_id 分支只把 entries 挂到已有会话（无 INSERT）→ 零发布。"""
    from app.modules.platform_sync.schema import AgentLogEntry
    from app.modules.platform_sync.service import PlatformSyncService

    calls = _capture_publish(monkeypatch, "app.modules.platform_sync.service")
    user = await _make_user(db_session, prefix="toolrep-hub")
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    hub_session = AgentSession(
        id=uuid.uuid4(),
        user_id=user.id,
        workspace_id=ws.id,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
    )
    db_session.add(hub_session)
    await db_session.commit()

    upserted = await PlatformSyncService(db_session).upsert_agent_log_entries(
        ws.id,
        [AgentLogEntry(harness="codex", log_path="C:/x/rollout.jsonl")],
        pushed_at=None,
        scan_run_id=None,
        user_id=user.id,
        hub_session_id=hub_session.id,
    )

    assert upserted == 1
    assert calls == []


# ── 5. agent/service.py start_scan_dispatch ──────────────────────────────────


def _make_pass_delegate() -> MagicMock:
    """root_path 校验放行的 HostFsDelegate（镜像 scan daemon-client 测试）。"""
    delegate = MagicMock()

    async def _stat(workspace, path):
        if ".sillyspec" in path:
            return {"exists": False, "is_dir": False, "size": 0}
        return {"exists": True, "is_dir": True, "size": 0}

    delegate.stat = AsyncMock(side_effect=_stat)
    delegate.list_dir = AsyncMock(return_value=[])
    return delegate


@pytest.mark.asyncio
async def test_start_scan_dispatch_publishes_created_and_status_changed(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """scan 会话 INSERT + 激活（pending→active）落库 → created + status_changed。"""
    calls = _capture_publish(monkeypatch, "app.modules.agent.service")
    user = await _make_user(db_session, prefix="scan")
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()

    fake_dispatch = SimpleNamespace(
        runtime_id=uuid.uuid4(),
        lease_id=uuid.uuid4(),
        daemon_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        claim_token="tok",
    )

    class _FakeHub:
        async def send_session_control(self, daemon_id, msg_type, payload):
            return True

    from app.modules.daemon import ws_hub as ws_hub_mod

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _FakeHub())

    with (
        patch.object(AgentService, "_get_host_fs_delegate", return_value=_make_pass_delegate()),
        patch(
            "app.modules.agent.context_builder.build_scan_bundle",
            new=AsyncMock(return_value=SimpleNamespace(step_prompt="scan", runtime_root="/tmp/rt")),
        ),
        patch.object(
            RunPlacementService,
            "prepare_scan_interactive_dispatch",
            new=AsyncMock(return_value=fake_dispatch),
        ),
        patch.object(
            RunPlacementService,
            "notify_interactive_dispatch",
            new=AsyncMock(return_value=True),
        ),
    ):
        run = await AgentService(db_session).start_scan_dispatch(
            workspace_id=ws.id,
            user_id=user.id,
            root_path=ws.root_path,
            spec_root="/data/spec-workspaces/demo",
        )

    assert run.status == "pending"
    assert run.agent_session_id is not None
    assert calls == [
        ("created", run.agent_session_id, user.id),
        ("status_changed", run.agent_session_id, user.id),
    ]
    sess = await db_session.get(AgentSession, run.agent_session_id)
    assert sess is not None
    assert sess.status == "active"  # 激活已同 commit 落库


# ── 6. agent/placement.py dispatch_to_daemon raw INSERT ──────────────────────


@pytest.mark.asyncio
async def test_dispatch_to_daemon_insert_publishes_created(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """stage 派发的 raw INSERT INTO agent_sessions → 发一条 created（→pending）。"""
    calls = _capture_publish(monkeypatch, "app.modules.agent.placement")
    user = await _make_user(db_session, prefix="stage")
    di = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user.id,
        hostname=f"host-{uuid.uuid4().hex[:6]}",
        server_url="http://localhost:8000",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(di)
    await db_session.flush()
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        daemon_instance_id=di.id,
        name=f"daemon-{uuid.uuid4().hex[:6]}",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        default_agent="claude_code",
        status="active",
        created_by=user.id,
    )
    db_session.add(ws)
    await db_session.flush()
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=user.id,
            runtime_id=None,
            daemon_id=di.id,
            root_path="/tmp/binding",
            path_source="daemon-client",
        )
    )
    run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="pending")
    db_session.add(run)
    await db_session.commit()

    lease_id = await RunPlacementService(db_session).dispatch_to_daemon(
        run.id, user.id, workspace_id=ws.id
    )

    assert lease_id is not None
    assert len(calls) == 1
    event, session_id, user_id = calls[0]
    assert event == "created"
    assert user_id == user.id
    sess = await db_session.get(AgentSession, session_id)
    assert sess is not None
    assert sess.status == "pending"
    assert sess.lease_id == lease_id
