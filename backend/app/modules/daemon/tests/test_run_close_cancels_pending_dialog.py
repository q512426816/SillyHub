"""2026-11-07-orphan-pending-dialog-cure FR-01：run 终态收口联动取消挂起提问。

生产根因（会话 e07c1209，2026-11-07）：AskUserQuestion 挂起等待用户回答期间
daemon 30min 轮活动看门狗判死上报 failed，close_interactive_run 收口不清理
挂起提问行 → 孤儿 pending 行永停「等待回答」→ 列表问号常亮而详情页（读侧
run 活性兜底）无待答卡，两侧口径分裂。全库止血时实证 11 条孤儿（failed 8、
completed 1、killed 4——kill 路径缺口由同 FR 其余挂点覆盖，本文件覆盖主路径
与 cancel_lease 代理用例）。

覆盖：
- daemon 上报失败（turn_activity_timeout 主复现路径）→ 收口事务后提问行 cancelled
- daemon 上报成功（completed 孤儿实证）→ 同款联动取消
- cancel_lease 主动 kill（_mark_agent_run_killed_if_pending）→ 同款联动取消
- 幂等不覆盖：提问行已 answered → 收口后保持 answered

范式参照 test_close_interactive_run_session_status.py（RunPlacementService 建
真实 lease + DaemonService facade + mocked_redis）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime, SessionDialogRequest
from app.modules.daemon.service import DaemonService

# ── Fixtures（范式照抄 test_close_interactive_run_session_status.py）────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"orphan-cure-{uid}@example.com",
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


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


async def _seed_session_run_and_dialog(
    db_session: AsyncSession,
    *,
    dialog_status: str = "pending",
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID]:
    """构造 session + lease + running run + 一条挂起提问行。

    返回 (lease_id, run_id, claim_token, dialog_row_id)。dialog_status 控制
    提问行初始态（幂等用例给 answered）。
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
        status="running",
        spec_strategy="interactive",
        agent_session_id=session_id,
    )
    db_session.add_all([session, run])
    await db_session.flush()
    dialog = SessionDialogRequest(
        id=uuid.uuid4(),
        session_id=session_id,
        run_id=run_id,
        request_id=f"req-{uuid.uuid4().hex[:12]}",
        tool_name="AskUserQuestion",
        dialog_kind="AskUserQuestion",
        status=dialog_status,
        created_at=datetime.now(UTC),
    )
    db_session.add(dialog)
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token, dialog.id


async def _dialog_status(db_session: AsyncSession, dialog_id: uuid.UUID) -> str:
    """重读提问行状态（populate_existing 规避 identity map 缓存）。"""
    row = await db_session.get(SessionDialogRequest, dialog_id, populate_existing=True)
    assert row is not None
    return row.status


# ── 主路径：daemon 上报失败（生产主复现）────────────────────────────────────


@pytest.mark.asyncio
async def test_failed_close_cancels_pending_dialog(db_session: AsyncSession, mocked_redis) -> None:
    """daemon 上报失败（turn_activity_timeout 主复现路径）→ 提问行翻 cancelled。"""
    lease_id, run_id, token, dialog_id = await _seed_session_run_and_dialog(db_session)
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="turn_activity_timeout",
        is_error=True,
    )
    assert run.status == "failed"
    assert await _dialog_status(db_session, dialog_id) == "cancelled"


# ── 主路径：daemon 上报成功（completed 孤儿实证）───────────────────────────


@pytest.mark.asyncio
async def test_completed_close_cancels_pending_dialog(
    db_session: AsyncSession, mocked_redis
) -> None:
    """daemon 上报成功（生产实证 fba80225：completed run 挂 pending 孤儿）→ 同款取消。"""
    lease_id, run_id, token, dialog_id = await _seed_session_run_and_dialog(db_session)
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
    assert await _dialog_status(db_session, dialog_id) == "cancelled"


# ── 主动 kill：cancel_lease → _mark_agent_run_killed_if_pending ─────────────


@pytest.mark.asyncio
async def test_cancel_lease_kill_cancels_pending_dialog(
    db_session: AsyncSession, mocked_redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    """cancel_lease 主动 kill run（生产 killed 孤儿来源之一）→ 同事务联动取消。

    走 DaemonLeaseService.cancel_lease 端到端路径（lease 取消 → run killed →
    提问行 cancelled）；WS 下送为 best-effort，patch 空 hub 只关心 DB 收口
    （对齐 test_cancel_lease_session.py _patch_ws_hub 范式）。
    """
    from app.modules.daemon import ws_hub as ws_hub_mod
    from app.modules.daemon.lease_service import DaemonLeaseService

    class _FakeHub:
        async def send_session_control(self, daemon_id, msg_type, payload):
            return True

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _FakeHub())

    _lease_id, run_id, _token, dialog_id = await _seed_session_run_and_dialog(db_session)
    lease_svc = DaemonLeaseService(db_session)
    await lease_svc.cancel_lease(run_id)

    killed = await db_session.get(AgentRun, run_id, populate_existing=True)
    assert killed is not None and killed.status == "killed"
    assert await _dialog_status(db_session, dialog_id) == "cancelled"


# ── 幂等不覆盖：answered 行保持 ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_answered_dialog_not_overwritten_by_close(
    db_session: AsyncSession, mocked_redis
) -> None:
    """提问行已 answered → 收口清理不覆盖（UPDATE 限定 status='pending'）。"""
    lease_id, run_id, token, dialog_id = await _seed_session_run_and_dialog(
        db_session, dialog_status="answered"
    )
    svc = DaemonService(db_session)
    await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="turn_activity_timeout",
        is_error=True,
    )
    assert await _dialog_status(db_session, dialog_id) == "answered"


# ── 无挂起提问零副作用（brownfield 不崩）──────────────────────────────────


@pytest.mark.asyncio
async def test_close_without_dialog_rows_is_noop(db_session: AsyncSession, mocked_redis) -> None:
    """run 名下无任何提问行 → 收口正常完成、无异常（既有会话零回归）。"""
    lease_id, run_id, token, dialog_id = await _seed_session_run_and_dialog(db_session)
    # 删掉提问行模拟无 dialog 的既有会话
    row = await db_session.get(SessionDialogRequest, dialog_id)
    assert row is not None
    await db_session.delete(row)
    await db_session.commit()

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
    remaining = (
        (
            await db_session.execute(
                select(SessionDialogRequest).where(SessionDialogRequest.run_id == run_id)
            )
        )
        .scalars()
        .all()
    )
    assert remaining == []
