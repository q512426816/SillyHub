"""2026-10-21-daemon-zombie-turn FR-03：pending run 启动超时清扫.

僵尸轮兜底链（FR-01 看门狗 / FR-02 打断 no-op 回报之后的最后防线）：
inject 被 daemon ack 但引擎从未启动轮次（打断 abort 收尾竞态吞没）→
run 永停 ``pending``（无 ``started_at``）。清扫收敛条件与跳过面：

- 命中：``status='pending'`` + ``started_at IS NULL`` + ``created_at`` 距今超
  ``daemon_pending_run_start_timeout_sec``（默认 300s）+ 所属会话 runtime 在线
  → ``failed`` + ``error_code=interactive_turn_not_started`` + 中文可读原因
  （output_redacted），commit 后广播 ``turn_completed``（session 频道）与
  ``status_changed``（run 频道）；
- 跳过：未超龄新 run / ``pending_approval``（审批等待非僵尸）/ runtime 离线
  （既有 offline sweep 管辖）；
- 不动会话（保持 active，用户可重发）与 lease。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.sweep import (
    INTERACTIVE_TURN_NOT_STARTED_ERROR_CODE,
    RUNTIME_OFFLINE_GRACE_SEC,
    pending_run_start_sweep_once,
    pending_run_start_timeout_sec,
)


async def _make_user(db: AsyncSession, *, prefix: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{prefix}-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name=prefix,
        status="active",
    )
    db.add(user)
    await db.commit()
    return user


async def _make_runtime(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    online: bool = True,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online" if online else "offline",
        last_heartbeat_at=(
            datetime.now(UTC)
            if online
            else datetime.now(UTC) - timedelta(seconds=RUNTIME_OFFLINE_GRACE_SEC + 300)
        ),
    )
    db.add(rt)
    await db.commit()
    return rt


async def _make_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        provider="claude",
        status="active",
        agent_session_id=f"sdk-{uuid.uuid4().hex[:8]}",
        turn_count=1,
        cwd="/workspace/proj",
        created_at=now,
        last_active_at=now,
    )
    db.add(sess)
    await db.commit()
    return sess


async def _make_run(
    db: AsyncSession,
    session_id: uuid.UUID,
    *,
    status: str = "pending",
    started: bool = False,
    created_at: datetime | None = None,
) -> AgentRun:
    run = AgentRun(
        agent_type="claude_code",
        status=status,
        agent_session_id=session_id,
        started_at=datetime.now(UTC) if started else None,
        created_at=created_at or datetime.now(UTC),
    )
    db.add(run)
    await db.commit()
    return run


def _capture_publish(monkeypatch: pytest.MonkeyPatch):
    """FakeRedis：捕获 (channel, payload) 并返回；publish 永不抛。"""
    from app.modules.daemon import sweep as sweep_mod

    publishes: list[tuple[str, str]] = []

    class _FakeRedis:
        async def publish(self, channel: str, payload: str) -> int:
            publishes.append((channel, payload))
            return 1

    monkeypatch.setattr(sweep_mod, "get_redis", lambda: _FakeRedis())
    return publishes


@pytest.mark.asyncio
async def test_sweeps_stale_pending_run_of_online_runtime(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """主路径：在线 runtime 会话的 pending run 超龄无 started_at → 收敛 failed
    + 新错误码 + 可读原因；会话保持 active；双频道广播终态。"""
    publishes = _capture_publish(monkeypatch)

    user = await _make_user(db_session, prefix="zombie-main")
    rt = await _make_runtime(db_session, user.id, online=True)
    sess = await _make_session(db_session, user.id, rt.id)
    stale = datetime.now(UTC) - timedelta(seconds=pending_run_start_timeout_sec() + 60)
    run = await _make_run(db_session, sess.id, status="pending", started=False, created_at=stale)

    converged = await pending_run_start_sweep_once(db_session)

    assert converged == 1
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code == INTERACTIVE_TURN_NOT_STARTED_ERROR_CODE
    assert run.finished_at is not None
    assert run.output_redacted is not None and "重新发送" in run.output_redacted
    # 会话不动（active 保持，用户可重发）
    await db_session.refresh(sess)
    assert sess.status == "active"
    # run 频道 status_changed + session 频道 turn_completed（close_run_steps 契约）
    run_events = [json.loads(p) for ch, p in publishes if ch == f"agent_run:{run.id}"]
    assert any(
        e.get("event") == "status_changed" and e.get("status") == "failed" for e in run_events
    )
    sess_events = [json.loads(p) for ch, p in publishes if ch == f"agent_session:{sess.id}"]
    assert any(
        e.get("event") == "turn_completed"
        and e.get("status") == "failed"
        and e.get("error_code") == INTERACTIVE_TURN_NOT_STARTED_ERROR_CODE
        and e.get("run_id") == str(run.id)
        for e in sess_events
    )


@pytest.mark.asyncio
async def test_skips_fresh_pending_run(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """未超龄的新 pending run 不扫（正常链路 created→started ~2s）。"""
    _capture_publish(monkeypatch)

    user = await _make_user(db_session, prefix="zombie-fresh")
    rt = await _make_runtime(db_session, user.id, online=True)
    sess = await _make_session(db_session, user.id, rt.id)
    run = await _make_run(db_session, sess.id, status="pending", started=False)

    converged = await pending_run_start_sweep_once(db_session)

    assert converged == 0
    await db_session.refresh(run)
    assert run.status == "pending"


@pytest.mark.asyncio
async def test_skips_pending_approval_and_started_runs(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """pending_approval（审批等待非僵尸）与已启动（started_at 已写）的 run 不扫。"""
    _capture_publish(monkeypatch)

    user = await _make_user(db_session, prefix="zombie-approval")
    rt = await _make_runtime(db_session, user.id, online=True)
    sess = await _make_session(db_session, user.id, rt.id)
    stale = datetime.now(UTC) - timedelta(seconds=pending_run_start_timeout_sec() + 60)
    approval = await _make_run(
        db_session, sess.id, status="pending_approval", started=False, created_at=stale
    )
    started = await _make_run(db_session, sess.id, status="running", started=True, created_at=stale)

    converged = await pending_run_start_sweep_once(db_session)

    assert converged == 0
    await db_session.refresh(approval)
    await db_session.refresh(started)
    assert approval.status == "pending_approval"
    assert started.status == "running"


@pytest.mark.asyncio
async def test_skips_offline_runtime_sessions(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """runtime 离线（心跳超窗）的超龄 pending run 不扫——既有 offline sweep 管辖。"""
    _capture_publish(monkeypatch)

    user = await _make_user(db_session, prefix="zombie-off")
    rt = await _make_runtime(db_session, user.id, online=False)
    sess = await _make_session(db_session, user.id, rt.id)
    stale = datetime.now(UTC) - timedelta(seconds=pending_run_start_timeout_sec() + 60)
    run = await _make_run(db_session, sess.id, status="pending", started=False, created_at=stale)

    converged = await pending_run_start_sweep_once(db_session)

    assert converged == 0
    await db_session.refresh(run)
    assert run.status == "pending"


@pytest.mark.asyncio
async def test_idempotent_rerun_keeps_converged(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """幂等：收敛后再跑一轮 0 命中（status 已 failed 不再匹配）。"""
    publishes = _capture_publish(monkeypatch)

    user = await _make_user(db_session, prefix="zombie-idem")
    rt = await _make_runtime(db_session, user.id, online=True)
    sess = await _make_session(db_session, user.id, rt.id)
    stale = datetime.now(UTC) - timedelta(seconds=pending_run_start_timeout_sec() + 60)
    await _make_run(db_session, sess.id, status="pending", started=False, created_at=stale)

    assert await pending_run_start_sweep_once(db_session) == 1
    publishes.clear()
    assert await pending_run_start_sweep_once(db_session) == 0
    assert publishes == []


@pytest.mark.asyncio
async def test_timeout_sec_reads_settings(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """窗口读 Settings（可配置）：非法值回退模块默认。"""
    from app.core.config import get_settings
    from app.modules.daemon.sweep import PENDING_RUN_START_TIMEOUT_DEFAULT_SEC

    settings = get_settings()
    monkeypatch.setattr(settings, "daemon_pending_run_start_timeout_sec", 42, raising=False)
    assert pending_run_start_timeout_sec() == 42

    monkeypatch.setattr(settings, "daemon_pending_run_start_timeout_sec", 0, raising=False)
    assert pending_run_start_timeout_sec() == PENDING_RUN_START_TIMEOUT_DEFAULT_SEC

    monkeypatch.setattr(
        settings,
        "daemon_pending_run_start_timeout_sec",
        PENDING_RUN_START_TIMEOUT_DEFAULT_SEC,
        raising=False,
    )
    assert pending_run_start_timeout_sec() == PENDING_RUN_START_TIMEOUT_DEFAULT_SEC
