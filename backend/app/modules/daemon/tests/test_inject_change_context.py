"""inject 建轮打锚会话「当前变更上下文」（2026-10-12-run-level-change-attribution
task-03 / FR-01）。

背景：一个交互会话先后执行多个变更时，inject 产生的轮（AgentRun）原先 change_id
恒 None，变更执行用量聚合只能整会话摊派（每个绑定变更显示同一组总和）。本变更：
run_sync 命令解析通道把 sillyspec 绑定命令指向的变更回写
``AgentSession.current_change_id``（task-02），inject 建轮时据此打锚
``change_id=session.current_change_id``——轮级归属可拆分（≤1 轮切换误差，与本地
CLI 水位差分粒度同级）。

本文件验证 inject 侧打锚契约：
- 上下文有值 → 当轮 run.change_id 记为该上下文；
- 上下文为空（存量/未绑定）→ run.change_id 保持 NULL，行为与改动前一致；
- 上下文切换 → 下一轮跟随新值。

fixtures 镜像 test_inject_orchestrator_tagging.py（SQLite create_all，FK 不强制，
current_change_id 直接落 uuid 无需真实 Change 行——打锚契约只关心 id 透传）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.service import DaemonService

# ── fixtures / helpers（镜像 test_inject_orchestrator_tagging.py）────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"ctx-{uid}@example.com",
            password_hash="x",
            display_name="CtxT",
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


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _finish_run(db_session: AsyncSession, run: AgentRun) -> None:
    run.status = "completed"
    run.finished_at = datetime.now(UTC)
    await db_session.commit()


async def _session_runs(db_session: AsyncSession, session_id: uuid.UUID) -> list[AgentRun]:
    return list(
        (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == session_id)))
        .scalars()
        .all()
    )


async def _set_context(db_session: AsyncSession, session_row, change_id: uuid.UUID | None) -> None:
    """直接写上下文列（模拟 task-02 run_sync 通道的回写产物，单列直写等价）。"""
    session_row.current_change_id = change_id
    db_session.add(session_row)
    await db_session.commit()


async def _setup_injectable_session(db_session: AsyncSession, *, first_prompt: str = "first"):
    """建用户/runtime/会话并完结首 turn，返回 (svc, uid, created)。"""
    uid = await _create_user(db_session)
    await _create_runtime(db_session, uid)
    svc = DaemonService(db_session)
    created = await svc.create_session(uid, provider="claude", prompt=first_prompt)
    await _finish_run(db_session, created.agent_run)
    return svc, uid, created


# ── 用例 ─────────────────────────────────────────────────────────────────────


class TestInjectChangeContextStamp:
    @pytest.mark.asyncio
    async def test_inject_run_stamped_with_session_context(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """上下文有值 → 当轮 run.change_id 记为该上下文。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        change_x = uuid.uuid4()
        await _set_context(db_session, created.agent_session, change_x)

        result = await svc.inject_session(sid, uid, prompt="继续变更 X 的活")

        assert result.agent_run.change_id == change_x

    @pytest.mark.asyncio
    async def test_inject_run_unstamped_when_context_none(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """上下文为空（未出现任何绑定命令）→ run.change_id 保持 NULL（零回归）。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        assert created.agent_session.current_change_id is None

        result = await svc.inject_session(created.agent_session.id, uid, prompt="普通追问")

        assert result.agent_run.change_id is None

    @pytest.mark.asyncio
    async def test_context_switch_retargets_next_run(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """上下文 X → 切到 Y 后，下一轮打锚 Y（前一轮保持 X）——同会话两变更
        用量可按轮拆分。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        change_x, change_y = uuid.uuid4(), uuid.uuid4()

        await _set_context(db_session, created.agent_session, change_x)
        first = await svc.inject_session(sid, uid, prompt="做 X")
        assert first.agent_run.change_id == change_x

        await _finish_run(db_session, first.agent_run)
        # run_sync 通道解析到 flow start --change Y → 上下文覆盖为 Y。
        await _set_context(db_session, created.agent_session, change_y)
        second = await svc.inject_session(sid, uid, prompt="切到 Y")

        assert second.agent_run.change_id == change_y
        runs = sorted(await _session_runs(db_session, sid), key=lambda r: (r.created_at, r.id))
        assert [r.change_id for r in runs if r.id != created.agent_run.id] == [
            change_x,
            change_y,
        ]
