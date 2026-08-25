"""task-06 单测：run_sync 闸拒绝失败收口（FR-06 / D-006@v1 Grill M1-R 终版）。

daemon 会话闸（task-04 SessionManager.create 抛 SessionLimitReached）标首 run
failed 回传 close_interactive_run 后，backend 补收口规则：触发面「首 run
failed + 会话从未 ready + parent 非空」三条件齐备 → 子会话置 failed +
ended_at（对齐 P1 ``_fail_worker_subsession`` 语义，非 ended），复用既有
SESSION_END 清理信号 + publish 链。

触发面收窄防误杀（每条件独立钉死不命中面）：
- 曾 ready（追问轮中途失败的存活分身）→ 保持 active（turn 失败≠会话死亡）；
- 已有更早 run（run 行数 > 1）→ 保持 active；
- parent_session_id NULL（普通会话）→ 保持 active；
- 首 run completed（闸形态但非 failed）→ 多轮保持 active、单轮走既有 ended。

readiness 用 ``get_session_readiness()`` 单例 mark_ready / clear 控制——闸拒绝
会话 daemon 从未上报 mark_ready（对齐 session/service.py :3021 clear 先例口径）。
参照 test_close_interactive_run_session_status.py 的 seed + DaemonService facade
+ mocked_redis 范式。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import get_session_readiness

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task06-{uid}@example.com",
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


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


@pytest.fixture()
def readiness_guard():
    """每个测试后清掉本测试用过的 session_id，防 readiness 单例跨测试残留。"""
    touched: set[uuid.UUID] = set()

    def _touch(session_id: uuid.UUID) -> None:
        touched.add(session_id)

    yield _touch
    for sid in touched:
        get_session_readiness().clear(sid)


async def _seed_gate_shape(
    db_session: AsyncSession,
    *,
    parent_session_id: uuid.UUID | None = None,
    spec_strategy: str | None = "interactive",
    change_id: uuid.UUID | None = None,
    earlier_run_completed: bool = False,
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID]:
    """构造闸拒绝形态的 session + lease + run。

    返回待 close 的 (lease_id, run_id, claim_token, session_id)。默认 1 个
    running run（首 run）；``earlier_run_completed=True`` 时额外补一个已完成
    的更早 run（追问轮形态——待 close 的是第 2 个 run），各配独立 lease。
    """
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    placement = RunPlacementService(db_session)
    session_id = uuid.uuid4()
    now = datetime.now(UTC)

    session = AgentSession(
        id=session_id,
        user_id=uid,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=rt.id,
        last_active_at=now,
        created_at=now,
        parent_session_id=parent_session_id,
    )
    db_session.add(session)
    await db_session.flush()

    if earlier_run_completed:
        earlier_run_id = uuid.uuid4()
        earlier_dispatch = await placement.prepare_interactive_dispatch(
            agent_session_id=session_id,
            agent_run_id=earlier_run_id,
            user_id=uid,
            provider="claude",
            prompt="round-1",
            model=None,
        )
        db_session.add(
            AgentRun(
                id=earlier_run_id,
                agent_type="claude_code",
                provider="claude",
                status="completed",
                exit_code=0,
                finished_at=now,
                spec_strategy=spec_strategy,
                agent_session_id=session_id,
                change_id=change_id,
            )
        )
        # 追问轮形态：session.lease_id 指向最新一轮的 lease
        session.lease_id = earlier_dispatch.lease_id

    run_id = uuid.uuid4()
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=uid,
        provider="claude",
        prompt="hi",
        model=None,
    )
    if session.lease_id is None:
        session.lease_id = dispatch.lease_id
    db_session.add(
        AgentRun(
            id=run_id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            spec_strategy=spec_strategy,
            agent_session_id=session_id,
            change_id=change_id,
        )
    )
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token, session_id


# ── 命中：闸拒绝形态 → failed + ended_at + SESSION_END ─────────────────────


@pytest.mark.asyncio
async def test_gate_rejected_first_run_flips_subsession_failed(
    db_session: AsyncSession, mocked_redis, monkeypatch, readiness_guard
) -> None:
    """闸拒绝形态（首 run failed + 从未 ready + parent 非空，多轮 interactive）
    → 子会话置 failed + ended_at（非 ended，对齐 _fail_worker_subsession 语义），
    并补发 SESSION_END 清理 daemon 内存副本。"""
    from app.modules.daemon import ws_hub
    from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END

    sent: list[tuple[object, str, dict]] = []

    async def fake_send(daemon_id, msg_type, payload):
        sent.append((daemon_id, msg_type, payload))
        return True

    hub = ws_hub.get_daemon_ws_hub()
    monkeypatch.setattr(hub, "send_session_control", fake_send)

    lease_id, run_id, token, session_id = await _seed_gate_shape(
        db_session, parent_session_id=uuid.uuid4()
    )
    # 闸拒绝会话 daemon 从未上报 mark_ready——防御性 clear 钉死从未 ready。
    get_session_readiness().clear(session_id)
    readiness_guard(session_id)

    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(lease_id, run_id, token, status="error", is_error=True)
    assert run.status == "failed"

    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.ended_at is not None
    # SESSION_END 清理信号复用既有链（run_terminal_flip）
    assert len(sent) == 1
    _daemon_id, msg_type, payload = sent[0]
    assert msg_type == DAEMON_MSG_SESSION_END
    assert payload["session_id"] == str(session_id)


# ── 防误杀：追问轮失败（曾 mark_ready / 已有更早 run）→ 保持 active ─────────


@pytest.mark.asyncio
async def test_followup_turn_failure_with_ready_keeps_active(
    db_session: AsyncSession, mocked_redis, monkeypatch, readiness_guard
) -> None:
    """追问轮中途失败：会话曾 mark_ready 且已有更早完成 run → 保持 active
    等下一轮（turn 失败≠会话死亡，P1 原则），不发 SESSION_END。"""
    from app.modules.daemon import ws_hub

    sent: list[tuple[object, str, dict]] = []

    async def fake_send(daemon_id, msg_type, payload):
        sent.append((daemon_id, msg_type, payload))
        return True

    hub = ws_hub.get_daemon_ws_hub()
    monkeypatch.setattr(hub, "send_session_control", fake_send)

    lease_id, run_id, token, session_id = await _seed_gate_shape(
        db_session,
        parent_session_id=uuid.uuid4(),
        earlier_run_completed=True,
    )
    get_session_readiness().mark_ready(session_id)
    readiness_guard(session_id)

    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(lease_id, run_id, token, status="error", is_error=True)
    assert run.status == "failed"

    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "active"
    assert refreshed.ended_at is None
    assert sent == []


@pytest.mark.asyncio
async def test_first_run_failure_after_ready_keeps_active(
    db_session: AsyncSession, mocked_redis, readiness_guard
) -> None:
    """首 run 失败但会话曾 ready（daemon create 成功、首 turn 中途失败）→
    不命中（「从未 ready」条件缺席），保持 active。"""
    lease_id, run_id, token, session_id = await _seed_gate_shape(
        db_session, parent_session_id=uuid.uuid4()
    )
    get_session_readiness().mark_ready(session_id)
    readiness_guard(session_id)

    svc = DaemonService(db_session)
    await svc.close_interactive_run(lease_id, run_id, token, status="error", is_error=True)

    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "active"
    assert refreshed.ended_at is None


@pytest.mark.asyncio
async def test_second_run_failure_never_ready_keeps_active(
    db_session: AsyncSession, mocked_redis, readiness_guard
) -> None:
    """非首 run 失败（该会话已有更早 run，行数 > 1）→ 不命中（「首 run」条件
    缺席），保持 active。"""
    lease_id, run_id, token, session_id = await _seed_gate_shape(
        db_session,
        parent_session_id=uuid.uuid4(),
        earlier_run_completed=True,
    )
    get_session_readiness().clear(session_id)
    readiness_guard(session_id)

    svc = DaemonService(db_session)
    await svc.close_interactive_run(lease_id, run_id, token, status="error", is_error=True)

    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "active"
    assert refreshed.ended_at is None


# ── 防误杀：普通会话（parent NULL）不命中 ──────────────────────────────────


@pytest.mark.asyncio
async def test_normal_session_no_parent_not_matched(
    db_session: AsyncSession, mocked_redis, readiness_guard
) -> None:
    """普通用户会话（parent_session_id NULL）即使首 run failed + 从未 ready
    → 不命中，多轮 interactive 保持 active（闸形态仅对分身子会话收口）。"""
    lease_id, run_id, token, session_id = await _seed_gate_shape(db_session, parent_session_id=None)
    get_session_readiness().clear(session_id)
    readiness_guard(session_id)

    svc = DaemonService(db_session)
    await svc.close_interactive_run(lease_id, run_id, token, status="error", is_error=True)

    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "active"
    assert refreshed.ended_at is None


# ── 防误杀：首 run completed 不命中（条件① run failed 缺席）────────────────


@pytest.mark.asyncio
async def test_gate_shape_first_run_completed_keeps_active(
    db_session: AsyncSession, mocked_redis, readiness_guard
) -> None:
    """闸形态（首 run + 从未 ready + parent 非空）但 run completed → 不命中，
    多轮 interactive 保持 active + 刷 last_active_at。"""
    lease_id, run_id, token, session_id = await _seed_gate_shape(
        db_session, parent_session_id=uuid.uuid4()
    )
    get_session_readiness().clear(session_id)
    readiness_guard(session_id)

    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(lease_id, run_id, token, status="success", is_error=False)
    assert run.status == "completed"

    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "active"
    assert refreshed.ended_at is None
    assert refreshed.last_active_at is not None


@pytest.mark.asyncio
async def test_gate_shape_single_turn_completed_marks_ended(
    db_session: AsyncSession, mocked_redis, readiness_guard
) -> None:
    """闸形态 + 单轮任务（change_id 非空）首 run completed → 走既有 ended
    映射零回归（本规则只覆写多轮 keep-active 的 failed 分支）。"""
    lease_id, run_id, token, session_id = await _seed_gate_shape(
        db_session,
        parent_session_id=uuid.uuid4(),
        change_id=uuid.uuid4(),
    )
    get_session_readiness().clear(session_id)
    readiness_guard(session_id)

    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(lease_id, run_id, token, status="success", is_error=False)
    assert run.status == "completed"

    refreshed = await db_session.get(AgentSession, session_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.status == "ended"
    assert refreshed.ended_at is not None
