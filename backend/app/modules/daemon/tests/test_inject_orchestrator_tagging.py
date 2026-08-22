"""task-04（2026-08-22-team-session-unify）：inject 主控轮双标记 + objective 占位回填。

design §5 核心机制（D-009@v1）：
- 会话存在活跃 mission（未收敛 converged_at IS NULL 且未取消 cancelled_at IS NULL，
  R-07 单活跃保证至多一条）时，inject 产生的当轮 AgentRun 回填 ``mission_id`` +
  ``role='orchestrator'``（双标记）——该 run 即"主控 run"，task-05 懒建补回填 /
  task-06 _get_main_run·finalizer 锚点 / task-08 patrol 主控存续判定消费。
- objective 占位回填（CC-09）：预建 mission 的 objective 为占位时，以首条带消息
  文本的 inject 的用户 prompt 原文回填（附件标记行不参与）；回填后非占位，后续轮
  不再覆盖。
- 无活跃 mission 时 inject 行为逐字节不变（run 不带 mission_id/role，零回归）。
- 双标记与 objective 回填同 inject 事务：事务内后段失败整体回滚，不落半标记。

create_session 首 turn 不做双标记（mission 预建晚于会话创建，活跃 mission 仅
inject 轮命中）——首个 run 保持无标记。

并行契约 shim：task-02 的 ``mission.get_active_mission_for_session`` 与 task-03 的
``orchestrator.SESSION_OBJECTIVE_PLACEHOLDER`` 由并行子任务落地；本文件在符号暂缺
时按契约语义（design §5/§8：session_id + 未收敛未取消取最新一条；占位文案「（由
会话首条团队指令定义）」）就地补桩，符号落地后自动改用真实现（hasattr 守卫）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DaemonSessionConfigInvalid,
    DaemonSessionTurnConflict,
)

# ── 并行契约 shim（task-02 / task-03 在途；hasattr 守卫，落地后零生效）────────


def _install_parallel_contract_stubs() -> str:
    """按契约语义补齐暂缺符号，返回占位文案常量。

    真实现落地前以等价查询/常量垫底（语义=taskcard task-02/task-03 契约原文）；
    落地后 hasattr 守卫跳过，测试自动走真实现——两侧行为一致，断言不用改。
    """
    import app.modules.agent.mission as _mission_mod
    import app.modules.agent.orchestrator as _orchestrator_mod

    if not hasattr(_mission_mod, "get_active_mission_for_session"):

        async def _get_active_mission_for_session(db: AsyncSession, session_id: uuid.UUID):
            stmt = (
                select(AgentMission)
                .where(
                    AgentMission.session_id == session_id,
                    AgentMission.converged_at.is_(None),
                    AgentMission.cancelled_at.is_(None),
                )
                .order_by(AgentMission.created_at.desc())
                .limit(1)
            )
            return (await db.execute(stmt)).scalar_one_or_none()

        _mission_mod.get_active_mission_for_session = _get_active_mission_for_session

    if not hasattr(_orchestrator_mod, "SESSION_OBJECTIVE_PLACEHOLDER"):
        # design §8 占位文案；与 task-03 常量同值（落库比较用，真实现落地后以其为准）。
        _orchestrator_mod.SESSION_OBJECTIVE_PLACEHOLDER = "（由会话首条团队指令定义）"

    return str(_orchestrator_mod.SESSION_OBJECTIVE_PLACEHOLDER)


SESSION_OBJECTIVE_PLACEHOLDER = _install_parallel_contract_stubs()

# ── Fixtures / helpers（镜像 test_session_user_log.py / test_session_switch_config.py）──


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"t04-{uid}@example.com",
            password_hash="x",
            display_name="T04",
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


async def _make_mission(
    session: AsyncSession,
    *,
    session_id: uuid.UUID,
    objective: str,
    converged_at: datetime | None = None,
    cancelled_at: datetime | None = None,
) -> AgentMission:
    """按 task-01 后的列结构直接落 mission（workspace FK 在 SQLite 测试不强制）。"""
    m = AgentMission(
        workspace_id=uuid.uuid4(),
        session_id=session_id,
        objective=objective,
        converged_at=converged_at,
        cancelled_at=cancelled_at,
    )
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return m


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


async def _setup_injectable_session(db_session: AsyncSession, *, first_prompt: str = "first"):
    """建用户/runtime/会话并完结首 turn，返回 (svc, uid, created)。"""
    uid = await _create_user(db_session)
    await _create_runtime(db_session, uid)
    svc = DaemonService(db_session)
    created = await svc.create_session(uid, provider="claude", prompt=first_prompt)
    await _finish_run(db_session, created.agent_run)
    return svc, uid, created


# ── 1. 活跃 mission → 当轮 run 双标记 ────────────────────────────────────────


class TestDualTagging:
    @pytest.mark.asyncio
    async def test_active_mission_tags_inject_run(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """活跃 mission 存在时 inject 当轮 AgentRun 带 mission_id+role=orchestrator。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        mission = await _make_mission(
            db_session, session_id=created.agent_session.id, objective="已有真实目标"
        )

        result = await svc.inject_session(created.agent_session.id, uid, prompt="继续推进")

        assert result.agent_run.mission_id == mission.id
        assert result.agent_run.role == "orchestrator"

    @pytest.mark.asyncio
    async def test_create_session_first_turn_not_tagged(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """create_session 首 turn 不做双标记（活跃 mission 仅 inject 轮命中）。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        await _make_mission(
            db_session,
            session_id=created.agent_session.id,
            objective="预建晚于会话首 turn",
        )

        result = await svc.inject_session(created.agent_session.id, uid, prompt="第二条")

        runs = await _session_runs(db_session, created.agent_session.id)
        assert len(runs) == 2
        first, second = sorted(runs, key=lambda r: r.created_at)
        # 首 run（create_session 产生）保持无标记。
        assert first.mission_id is None
        assert first.role is None
        # 仅 inject 当轮带双标记。
        assert second.mission_id is not None
        assert second.role == "orchestrator"
        assert result.agent_run.id == second.id

    @pytest.mark.asyncio
    async def test_service_identity_path_also_tags(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """inject_session_as_service 与 inject_session 共用同一段双标记逻辑。"""
        from app.modules.daemon.session.service import SessionService

        _svc, _uid, created = await _setup_injectable_session(db_session)
        mission = await _make_mission(
            db_session, session_id=created.agent_session.id, objective="服务路径目标"
        )

        # as_service 挂在 SessionService（DaemonService facade 不委托，见
        # change/service.py 消费方同口径）。
        result = await SessionService(db_session).inject_session_as_service(
            created.agent_session.id, prompt="平台代写轮"
        )

        assert result.agent_run.mission_id == mission.id
        assert result.agent_run.role == "orchestrator"


# ── 2. 无活跃 mission → 行为不变（零回归） ───────────────────────────────────


class TestNoActiveMission:
    @pytest.mark.asyncio
    async def test_no_mission_run_untagged(self, db_session, mocked_hub, mocked_redis) -> None:
        """无 mission 时 run 不带 mission_id/role，与改动前一致。"""
        svc, uid, created = await _setup_injectable_session(db_session)

        result = await svc.inject_session(created.agent_session.id, uid, prompt="普通追问")

        assert result.agent_run.mission_id is None
        assert result.agent_run.role is None

    @pytest.mark.asyncio
    async def test_converged_mission_not_tagged(self, db_session, mocked_hub, mocked_redis) -> None:
        """已收敛（终态）mission 不算活跃——run 不带标记。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        await _make_mission(
            db_session,
            session_id=created.agent_session.id,
            objective="已收敛目标",
            converged_at=datetime.now(UTC),
        )

        result = await svc.inject_session(created.agent_session.id, uid, prompt="收敛后追问")

        assert result.agent_run.mission_id is None
        assert result.agent_run.role is None

    @pytest.mark.asyncio
    async def test_cancelled_mission_not_tagged(self, db_session, mocked_hub, mocked_redis) -> None:
        """已取消 mission 不算活跃——run 不带标记。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        await _make_mission(
            db_session,
            session_id=created.agent_session.id,
            objective="已取消目标",
            cancelled_at=datetime.now(UTC),
        )

        result = await svc.inject_session(created.agent_session.id, uid, prompt="取消后追问")

        assert result.agent_run.mission_id is None
        assert result.agent_run.role is None


# ── 3. objective 占位回填（CC-09） ───────────────────────────────────────────


class TestObjectivePlaceholderBackfill:
    @pytest.mark.asyncio
    async def test_placeholder_backfilled_by_first_inject(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """占位 objective 以首条 inject 消息文本（用户 prompt 原文）回填。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        mission = await _make_mission(
            db_session,
            session_id=created.agent_session.id,
            objective=SESSION_OBJECTIVE_PLACEHOLDER,
        )

        await svc.inject_session(
            created.agent_session.id, uid, prompt="帮我把登录模块重构成两步校验"
        )

        await db_session.refresh(mission)
        assert mission.objective == "帮我把登录模块重构成两步校验"

    @pytest.mark.asyncio
    async def test_second_inject_does_not_overwrite(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """回填仅首条生效：第二条 inject 不覆盖已回填的 objective。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        mission = await _make_mission(
            db_session,
            session_id=created.agent_session.id,
            objective=SESSION_OBJECTIVE_PLACEHOLDER,
        )

        first = await svc.inject_session(created.agent_session.id, uid, prompt="首条团队指令")
        await db_session.refresh(mission)
        assert mission.objective == "首条团队指令"

        await _finish_run(db_session, first.agent_run)
        await svc.inject_session(created.agent_session.id, uid, prompt="第二条改需求")

        await db_session.refresh(mission)
        assert mission.objective == "首条团队指令"

    @pytest.mark.asyncio
    async def test_non_placeholder_objective_kept(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """非占位 objective（懒建已填 / 预建显式给了目标）不被覆盖。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        mission = await _make_mission(
            db_session, session_id=created.agent_session.id, objective="显式预建目标"
        )

        await svc.inject_session(created.agent_session.id, uid, prompt="首条消息")

        await db_session.refresh(mission)
        assert mission.objective == "显式预建目标"

    @pytest.mark.asyncio
    async def test_no_mission_no_backfill_target(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """无活跃 mission 时无回填对象——inject 正常完成（不报错，行为不变）。"""
        svc, uid, created = await _setup_injectable_session(db_session)

        result = await svc.inject_session(created.agent_session.id, uid, prompt="普通轮无回填")

        assert result.agent_run.mission_id is None


# ── 4. 同事务原子性（失败回滚不落半标记） ───────────────────────────────────


class TestSameTransactionAtomicity:
    @pytest.mark.asyncio
    async def test_turn_conflict_keeps_placeholder(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """turn 冲突守卫（建 run 前）拦下时：无新 run、objective 不动。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        # 重新拉起一个活跃 run：复活首 run 为 pending。
        created.agent_run.status = "pending"
        created.agent_run.finished_at = None
        await db_session.commit()
        # rollback 会 expire ORM 对象，id 先取局部变量（下述原子性用例同）。
        sid = created.agent_session.id
        mission = await _make_mission(
            db_session, session_id=sid, objective=SESSION_OBJECTIVE_PLACEHOLDER
        )

        with pytest.raises(DaemonSessionTurnConflict):
            await svc.inject_session(sid, uid, prompt="被冲突拦下")

        runs = await _session_runs(db_session, sid)
        assert len(runs) == 1  # 只有首 run，无新 run
        await db_session.refresh(mission)
        assert mission.objective == SESSION_OBJECTIVE_PLACEHOLDER

    @pytest.mark.asyncio
    async def test_late_failure_rolls_back_tag_and_backfill(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """事务后段失败（切换轮供应商配置解析破裂）→ 回滚：无新 run、objective
        仍是占位、turn_count 不变——双标记与回填同 inject 事务，不落半标记。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        mission = await _make_mission(
            db_session, session_id=sid, objective=SESSION_OBJECTIVE_PLACEHOLDER
        )
        # 合法新供应商（归属+agent_kind 均过校验），仅解析器被打破。
        provider_row = await _seed_provider(db_session, uid)
        turn_count_before = created.agent_session.turn_count

        with patch(
            "app.modules.daemon.lease.context.resolve_bound_provider_config",
            new=AsyncMock(return_value=None),
        ):
            with pytest.raises(DaemonSessionConfigInvalid):
                await svc.inject_session(
                    sid,
                    uid,
                    prompt="切换轮消息",
                    llm_provider_id=str(provider_row.id),
                )

        runs = await _session_runs(db_session, sid)
        assert len(runs) == 1  # 回滚：双标记 run 未落库
        assert runs[0].mission_id is None
        await db_session.refresh(mission)
        assert mission.objective == SESSION_OBJECTIVE_PLACEHOLDER  # 回填未落库
        refreshed_session = await db_session.get(type(created.agent_session), sid)
        assert refreshed_session is not None
        assert refreshed_session.turn_count == turn_count_before


async def _seed_provider(session: AsyncSession, user_id: uuid.UUID):
    from app.core.crypto import get_cipher
    from app.modules.llm_provider.model import LlmProvider

    cipher = get_cipher()
    ct, key_id = cipher.encrypt("sk-test-key")
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name="GLM",
        agent_kind="claude",
        encrypted_api_key=ct,
        key_id=key_id,
        model="glm-4.7",
        is_default=False,
        api_format="anthropic",
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row
