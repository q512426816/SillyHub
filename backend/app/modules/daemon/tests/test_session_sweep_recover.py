"""suspended 自动恢复单拍单测（ql-20260831-006-6d67）.

直调 :func:`session_auto_recover_sweep_once`（无状态单次函数、注入
AsyncSession），覆盖 2026-08-31 会话卡排队事故暴露的恢复缺口：backend 重启
窗口内 daemon WS 断开被降级 offline、offline sweep 把 active 主会话翻
suspended 后，daemon 重新上线**无人恢复**（既有恢复链只在 daemon 自身重启时
触发）。断言：

- 恢复：suspended 主会话（parent IS NULL + agent_session_id 非空）且 runtime
  恢复「online + 心跳 600s 宽限内」且挂起已满 AUTO_RECOVER_MIN_AGE_SEC →
  翻 ``reconnecting`` + ``last_active_at`` 刷新 + 落一条 ``session_resume``
  pending 控制指令（WS 不在线 → 三段式落库待补拉，payload 含 resume 必需键）；
- 不误伤：runtime 仍离线 / 挂起未满龄 / worker 子会话 / 无 resume key
  （agent_session_id 空）/ 非 suspended 会话一律不动；
- 幂等：同数据二跑 0 行（已翻 reconnecting，条件更新不重入）。

quick 风险审查补（2026-09-01）：软删（``deleted_at`` 置位）与归档工作区会话
不复活——否则 confirm 会把已删行翻回 active 并补派发其遗留排队消息（列表按
``deleted_at IS NULL`` 过滤，复活后不可见无法停止）；confirm 对软删行按不
存在处理返回 ``rejected`` 收口 daemon 重启恢复链的迟到确认。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonControlCommand, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.sweep import AUTO_RECOVER_MIN_AGE_SEC, session_auto_recover_sweep_once


async def _make_user(db: AsyncSession) -> User:
    from app.core.config import get_settings
    from app.core.security import password_hasher

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=f"recover-{uuid.uuid4()}@example.com",
        password_hash=password_hasher.hash("Admin123!@#"),
        display_name="recover",
        status="active",
        is_platform_admin=True,
    )
    db.add(user)
    await db.commit()
    return user


async def _make_runtime(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    status: str = "online",
    heartbeat_at: datetime | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status=status,
        last_heartbeat_at=heartbeat_at if heartbeat_at is not None else datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()
    return rt


async def _make_lease(db: AsyncSession, runtime_id: uuid.UUID) -> DaemonTaskLease:
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status="cancelled",  # offline sweep 挂起时 lease 已收敛 cancelled（现实态）
        claimed_at=None,
        lease_expires_at=None,
        attempt_number=1,
        metadata_={
            "session_id": "sdk-sess",
            "provider": "claude",
            "claim_token": f"tok-{uuid.uuid4().hex[:12]}",
        },
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
    lease_id: uuid.UUID | None,
    *,
    status: str,
    last_active_at: datetime | None,
    parent_session_id: uuid.UUID | None = None,
    agent_session_id: str | None = "sdk-resume-key",
    workspace_id: uuid.UUID | None = None,
    deleted_at: datetime | None = None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=lease_id,
        provider="claude",
        status=status,
        agent_session_id=agent_session_id,
        config={"model": "sonnet"},
        turn_count=1,
        cwd="/workspace/proj",
        created_at=now,
        last_active_at=last_active_at,
        ended_at=now if status in ("ended", "failed") else None,
        parent_session_id=parent_session_id,
        workspace_id=workspace_id,
        deleted_at=deleted_at,
    )
    db.add(sess)
    await db.commit()
    return sess


async def _make_workspace(
    db: AsyncSession,
    owner_id: uuid.UUID,
    *,
    status: str = "active",
) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    db.add(
        Workspace(
            id=ws_id,
            name=f"Sweep WS {ws_id.hex[:8]}",
            slug=f"sweep-{ws_id.hex[:8]}",
            root_path=f"/tmp/sweep-{ws_id.hex[:8]}",
            status=status,
            created_by=owner_id,
        )
    )
    await db.commit()
    return ws_id


async def _session_status(db: AsyncSession, session_id: uuid.UUID) -> str:
    row = (
        await db.execute(select(AgentSession.status).where(AgentSession.id == session_id))
    ).scalar_one()
    return str(row)


async def _resume_commands(db: AsyncSession) -> list[DaemonControlCommand]:
    """本测试库内全部 session_resume 控制指令（db_session 按测试函数隔离，全局过滤即可）。"""
    return list(
        (
            await db.execute(
                select(DaemonControlCommand).where(DaemonControlCommand.kind == "session_resume")
            )
        )
        .scalars()
        .all()
    )


async def test_recovers_suspended_main_session_when_runtime_back_online(
    db_session: AsyncSession,
) -> None:
    """runtime 重新在线 + 挂起满龄 → 翻 reconnecting + 落 session_resume 指令。"""
    user = await _make_user(db_session)
    rt = await _make_runtime(db_session, user.id, status="online")
    lease = await _make_lease(db_session, rt.id)
    # 挂起时刻 = last_active_at，拨回足够久（> AUTO_RECOVER_MIN_AGE_SEC）。
    suspended_at = datetime.now(UTC) - timedelta(seconds=AUTO_RECOVER_MIN_AGE_SEC + 60)
    sess = await _make_session(
        db_session, user.id, rt.id, lease.id, status="suspended", last_active_at=suspended_at
    )

    before = datetime.now(UTC)
    recovered = await session_auto_recover_sweep_once(db_session)

    assert recovered == 1
    assert await _session_status(db_session, sess.id) == "reconnecting"
    refreshed = await db_session.get(AgentSession, sess.id)
    assert refreshed is not None and refreshed.last_active_at is not None
    assert refreshed.last_active_at >= before  # 180s 重连窗口自恢复拍重置

    commands = await _resume_commands(db_session)
    assert len(commands) == 1
    payload = commands[0].payload
    assert payload is not None
    assert payload["session_id"] == str(sess.id)
    assert payload["agent_session_id"] == "sdk-resume-key"
    assert payload["runtime_id"] == str(rt.id)
    assert payload["lease_id"] == str(lease.id)
    assert payload["provider"] == "claude"


async def test_skips_when_runtime_offline_or_stale_heartbeat(db_session: AsyncSession) -> None:
    """runtime 仍 offline / online 但心跳超 600s 宽限 → suspended 原样。"""
    user = await _make_user(db_session)
    stale = datetime.now(UTC) - timedelta(seconds=700)
    rt_offline = await _make_runtime(db_session, user.id, status="offline")
    rt_stale = await _make_runtime(db_session, user.id, status="online", heartbeat_at=stale)
    old = datetime.now(UTC) - timedelta(seconds=AUTO_RECOVER_MIN_AGE_SEC + 60)

    s1 = await _make_session(
        db_session, user.id, rt_offline.id, None, status="suspended", last_active_at=old
    )
    s2 = await _make_session(
        db_session, user.id, rt_stale.id, None, status="suspended", last_active_at=old
    )

    recovered = await session_auto_recover_sweep_once(db_session)

    assert recovered == 0
    assert await _session_status(db_session, s1.id) == "suspended"
    assert await _session_status(db_session, s2.id) == "suspended"
    assert await _resume_commands(db_session) == []


async def test_skips_young_suspension_worker_and_missing_resume_key(
    db_session: AsyncSession,
) -> None:
    """挂起未满龄 / worker 子会话 / 无 agent_session_id → 不动（防误抢与不可恢复）。"""
    user = await _make_user(db_session)
    rt = await _make_runtime(db_session, user.id, status="online")
    young = datetime.now(UTC) - timedelta(seconds=max(AUTO_RECOVER_MIN_AGE_SEC - 30, 1))
    old = datetime.now(UTC) - timedelta(seconds=AUTO_RECOVER_MIN_AGE_SEC + 60)

    # 未满龄：刚被 suspend-batch 挂起（优雅停机 10s 降级窗口内不误抢）。
    s_young = await _make_session(
        db_session, user.id, rt.id, None, status="suspended", last_active_at=young
    )
    # worker 子会话：offline sweep 语义为 failed/不可 resume，即使 suspended 也不碰
    # （parent 造为终态，避免其本身作为可恢复主会话干扰本用例计数）。
    parent = await _make_session(
        db_session, user.id, rt.id, None, status="ended", last_active_at=old
    )
    s_worker = await _make_session(
        db_session,
        user.id,
        rt.id,
        None,
        status="suspended",
        last_active_at=old,
        parent_session_id=parent.id,
    )
    # 无 SDK resume key：daemon 无法 restoreAndReconnect，无恢复意义。
    s_nokey = await _make_session(
        db_session,
        user.id,
        rt.id,
        None,
        status="suspended",
        last_active_at=old,
        agent_session_id=None,
    )
    # 非 suspended 状态一律不碰。
    s_active = await _make_session(
        db_session, user.id, rt.id, None, status="active", last_active_at=old
    )

    recovered = await session_auto_recover_sweep_once(db_session)

    assert recovered == 0
    for s in (s_young, s_worker, s_nokey):
        assert await _session_status(db_session, s.id) == "suspended"
    assert await _session_status(db_session, s_active.id) == "active"


async def test_idempotent_second_run_recovers_nothing(db_session: AsyncSession) -> None:
    """已翻 reconnecting 的会话二跑 0 行（条件更新幂等，多 worker 重复无害）。"""
    user = await _make_user(db_session)
    rt = await _make_runtime(db_session, user.id, status="online")
    old = datetime.now(UTC) - timedelta(seconds=AUTO_RECOVER_MIN_AGE_SEC + 60)
    sess = await _make_session(
        db_session, user.id, rt.id, None, status="suspended", last_active_at=old
    )

    first = await session_auto_recover_sweep_once(db_session)
    second = await session_auto_recover_sweep_once(db_session)

    assert first == 1
    assert second == 0
    assert await _session_status(db_session, sess.id) == "reconnecting"
    # 控制指令也只落一条（重试由 daemon 补拉既有 pending 行承担，不重复堆叠）。
    commands = await _resume_commands(db_session)
    assert len(commands) == 1


async def test_skips_soft_deleted_session(db_session: AsyncSession) -> None:
    """软删会话不复活：删除时 suspended 不在 ACTIVE_SESSION_STATUSES 不走收列，
    行以 suspended+deleted_at 残留——sweep 不得翻 reconnecting（否则 confirm
    会翻回 active 并补派发遗留排队消息，而列表按 deleted_at IS NULL 过滤，
    复活后对用户不可见无法停止）。"""
    user = await _make_user(db_session)
    rt = await _make_runtime(db_session, user.id, status="online")
    lease = await _make_lease(db_session, rt.id)
    old = datetime.now(UTC) - timedelta(seconds=AUTO_RECOVER_MIN_AGE_SEC + 60)
    sess = await _make_session(
        db_session,
        user.id,
        rt.id,
        lease.id,
        status="suspended",
        last_active_at=old,
        deleted_at=datetime.now(UTC),
    )

    recovered = await session_auto_recover_sweep_once(db_session)

    assert recovered == 0
    assert await _session_status(db_session, sess.id) == "suspended"
    assert await _resume_commands(db_session) == []


async def test_skips_archived_workspace_session(db_session: AsyncSession) -> None:
    """归档工作区会话不自动恢复（对齐 reopen ``_ensure_session_workspace_writable``
    守卫口径——归档区不复活会话句柄）；活跃工作区会话照常恢复不受影响。"""
    user = await _make_user(db_session)
    rt = await _make_runtime(db_session, user.id, status="online")
    ws_archived = await _make_workspace(db_session, user.id, status="archived")
    ws_active = await _make_workspace(db_session, user.id, status="active")
    old = datetime.now(UTC) - timedelta(seconds=AUTO_RECOVER_MIN_AGE_SEC + 60)
    s_archived = await _make_session(
        db_session,
        user.id,
        rt.id,
        None,
        status="suspended",
        last_active_at=old,
        workspace_id=ws_archived,
    )
    s_active_ws = await _make_session(
        db_session,
        user.id,
        rt.id,
        None,
        status="suspended",
        last_active_at=old,
        workspace_id=ws_active,
    )

    recovered = await session_auto_recover_sweep_once(db_session)

    assert recovered == 1
    assert await _session_status(db_session, s_archived.id) == "suspended"
    assert await _session_status(db_session, s_active_ws.id) == "reconnecting"
    commands = await _resume_commands(db_session)
    assert len(commands) == 1
    assert commands[0].payload is not None
    assert commands[0].payload["session_id"] == str(s_active_ws.id)


async def test_confirm_rejects_soft_deleted_session(db_session: AsyncSession) -> None:
    """confirm 收口：软删的 reconnecting 会话按不存在处理返回 rejected、不翻
    active——daemon 重启恢复链读本地 sessions.json（仍含已删会话）发出的迟到
    confirm 不得复活已删行。"""
    from app.modules.daemon.service import DaemonService

    user = await _make_user(db_session)
    rt = await _make_runtime(db_session, user.id, status="online")
    old = datetime.now(UTC) - timedelta(seconds=AUTO_RECOVER_MIN_AGE_SEC + 60)
    sess = await _make_session(
        db_session,
        user.id,
        rt.id,
        None,
        status="reconnecting",
        last_active_at=old,
        deleted_at=datetime.now(UTC),
    )

    svc = DaemonService(db_session)
    # confirm 的 rejected 早退会 rollback（P2 行锁释放），连带把本测试会话中的
    # ORM 对象过期——先取标量再调用，避免过期属性触发懒加载。
    session_id = sess.id
    result = await svc.confirm_session_reconnected(session_id, runtime_id=rt.id)

    assert result == "rejected"
    assert await _session_status(db_session, session_id) == "reconnecting"
