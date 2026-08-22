"""Tests for MissionPatrolService（2026-08-21-mission-converge-patrol task-02 骨架）。

Wave 1 骨架用例（service 层直测，design §7）：
- ``mission_patrol_loop``：enabled=False 直接返回不进循环；enabled=True 按轮执行、
  打 ``mission_patrol_round_done`` 五计数 + duration_ms；单轮抛错不崩循环。
- ``_active_mission_ids``：cancelled/converged 排除、created_at 升序、limit 生效。
- 异常隔离：单 mission 抛错只记 warning 不阻断同轮其它 mission（FR-01.2）；
  单职责抛错不阻断同轮其它职责。

task-09（main.py lifespan 接线）补充两组：
- 循环 cancel 语义：轮间 sleep 挂起点被 cancel 后 CancelledError 穿出循环，
  gather(return_exceptions=True) 干净返回（design §4 关停契约）。
- main.py 接线契约：conftest client 走 ASGITransport 不触发 lifespan（gap-2），
  无法 lifespan 冒烟——退而断言 main.py 源码含接线要素（轻量冒烟防误删）。

task-01（Settings 四字段）与本任务同 Wave 并行，本文件用配置桩验证循环行为，
不依赖 Settings 真字段——merge 后 get_settings() 返回真字段，桩替换为等价语义。

task-08（2026-08-22-team-session-unify，design §5 Phase 1 patrol 适配 / §7.5
patrol auto-converge 行 / D-008 / FR-08）追加两组：
- awaiting_input 超时自动收敛：会话 mission（session_id 指向真实 AgentSession）
  主控轮+分身全终态未 converge 且会话无活跃 turn 持续超
  ``mission_patrol_awaiting_input_timeout_minutes`` → 走 task-06 explicit
  置位入口（锚点=最新 orchestrator run）；未超时 / 时钟缺失 / 会话活跃 /
  分身非终态 / 存量 external 不触发。
- 僵尸判定按会话维度：分身 run 非终态 + 承载 daemon 离线超时 + 主控会话无
  活跃 turn → 判死分身（不写 mission zombie 标记，无复活语义）；会话 mission
  主控轮不进存量主 run 判死；存量 external 主 run 判定零回归（分流用例）。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.agent.patrol as patrol
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.agent.orchestrator import OrchestratorService
from app.modules.agent.patrol import MissionPatrolService, mission_patrol_loop
from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease


def _stub_settings(
    enabled: bool = True,
    interval_seconds: int = 0,
    zombie_after_minutes: int = 60,
    revive_window_minutes: int = 30,
    awaiting_input_timeout_minutes: int = 30,
) -> SimpleNamespace:
    """巡检配置桩：循环消费 enabled/interval，僵尸段消费 after/revive 两阈值，
    task-08 超时收敛段消费 awaiting_input_timeout。"""
    return SimpleNamespace(
        mission_patrol_enabled=enabled,
        mission_patrol_interval_seconds=interval_seconds,
        mission_patrol_zombie_after_minutes=zombie_after_minutes,
        mission_patrol_revive_window_minutes=revive_window_minutes,
        mission_patrol_awaiting_input_timeout_minutes=awaiting_input_timeout_minutes,
    )


def _zero_counts() -> dict[str, int]:
    return dict.fromkeys(patrol.PATROL_COUNT_KEYS, 0)


async def _make_workspace(session: AsyncSession) -> uuid.UUID:
    """建一个真实 workspace 行（外键完整，照 test_orchestrator.py 惯例）。"""
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=f"ws-{ws_id.hex[:8]}",
        slug=f"ws-{ws_id.hex[:8]}",
        root_path=f"/tmp/{ws_id.hex}",
    )
    session.add(ws)
    await session.commit()
    return ws_id


async def _make_mission(
    session: AsyncSession,
    ws_id: uuid.UUID,
    *,
    created_at: datetime,
    cancelled_at: datetime | None = None,
    converged_at: datetime | None = None,
    change_id: uuid.UUID | None = None,
    constraints: dict | None = None,
    created_by: uuid.UUID | None = None,
    session_id: uuid.UUID | None = None,
) -> AgentMission:
    """建一条 AgentMission 行，created_at / cancelled_at / converged_at / session_id 可显式控制。

    ``session_id`` 传真实 AgentSession.id 即「会话 mission」；缺省走列
    default_factory 随机 uuid（= 存量 external/team 形态，查无会话行）。
    """
    extra: dict = {}
    if session_id is not None:
        # 显式传 None 会绕过 default_factory 违反 NOT NULL（orchestrator.py 同款注释）。
        extra["session_id"] = session_id
    mission = AgentMission(
        workspace_id=ws_id,
        change_id=change_id,
        objective=f"objective-{uuid.uuid4().hex[:8]}",
        constraints=constraints,
        created_by=created_by,
        created_at=created_at,
        cancelled_at=cancelled_at,
        converged_at=converged_at,
        **extra,
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission


async def _make_agent_session(session: AsyncSession) -> AgentSession:
    """建一条真实 AgentSession 行（会话 mission 判别依据：session_id 指向此行）。"""
    agent_session = AgentSession(
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
    )
    session.add(agent_session)
    await session.commit()
    await session.refresh(agent_session)
    return agent_session


async def _make_worker_run(
    session: AsyncSession,
    mission_id: uuid.UUID,
    *,
    status: str = "completed",
    role: str | None = "arch",
    finished_at: datetime | None = None,
    created_at: datetime | None = None,
) -> AgentRun:
    """建一条分身 run（role 可传 None 覆盖存量 NULL role 形态）。"""
    extra: dict = {}
    if created_at is not None:
        extra["created_at"] = created_at
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status=status,
        role=role,
        objective="分身目标",
        finished_at=finished_at,
        **extra,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _make_user(session: AsyncSession) -> uuid.UUID:
    """建一条 User 行（daemon 链路两表的 user_id NOT NULL 外键需要）。"""
    from app.modules.auth.model import User

    user_id = uuid.uuid4()
    session.add(
        User(
            id=user_id,
            email=f"u-{user_id.hex[:8]}@example.com",
            password_hash="not-a-real-hash",
            display_name=f"u-{user_id.hex[:8]}",
            status="active",
        )
    )
    await session.commit()
    return user_id


async def _make_daemon_chain(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    daemon_status: str,
    last_heartbeat_at: datetime | None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """建完整判死链路（instance + runtime），返回 (daemon_id, runtime_id)。"""
    daemon_id = uuid.uuid4()
    runtime_id = uuid.uuid4()
    session.add(
        DaemonInstance(
            id=daemon_id,
            user_id=user_id,
            hostname=f"host-{daemon_id.hex[:8]}",
            server_url="http://daemon.test",
            status=daemon_status,
            last_heartbeat_at=last_heartbeat_at,
        )
    )
    session.add(
        DaemonRuntime(
            id=runtime_id,
            daemon_instance_id=daemon_id,
            user_id=user_id,
            provider="claude",
        )
    )
    await session.commit()
    return daemon_id, runtime_id


async def _make_orchestrator_run(
    session: AsyncSession,
    mission_id: uuid.UUID,
    *,
    status: str = "running",
    error_code: str | None = None,
    finished_at: datetime | None = None,
    agent_session_id: uuid.UUID | None = None,
    created_at: datetime | None = None,
) -> AgentRun:
    """建主 agent run（role=orchestrator），status/error_code/finished_at/会话锚可控。

    ``agent_session_id`` 传会话 id 即会话 mission 的主控轮 turn run 形态（task-04
    双标记）；``created_at`` 显式控制用于「最新 orchestrator run」锚点判定。
    """
    extra: dict = {}
    if created_at is not None:
        extra["created_at"] = created_at
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status=status,
        role="orchestrator",
        error_code=error_code,
        finished_at=finished_at,
        agent_session_id=agent_session_id,
        **extra,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _make_lease(
    session: AsyncSession,
    run_id: uuid.UUID,
    runtime_id: uuid.UUID | None,
) -> DaemonTaskLease:
    """建一条 interactive lease（主 agent run 派 daemon 的载体）。"""
    lease = DaemonTaskLease(
        agent_run_id=run_id,
        runtime_id=runtime_id,
        kind="interactive",
        status="claimed",
    )
    session.add(lease)
    await session.commit()
    return lease


class TestMissionPatrolLoop:
    @pytest.mark.asyncio
    async def test_disabled_returns_before_first_round(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """enabled=False：loop 直接返回，循环体一次不进（run_once 未被调用）。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings(enabled=False))
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)
        runs: list[int] = []

        async def _fake_run_once(self: MissionPatrolService) -> dict[str, int]:
            runs.append(1)
            return _zero_counts()

        monkeypatch.setattr(MissionPatrolService, "run_once", _fake_run_once)

        await mission_patrol_loop()

        assert runs == [], "enabled=False 时不得执行任何巡检轮"
        log_spy.info.assert_not_called()

    @pytest.mark.asyncio
    async def test_round_done_log_then_exit_when_disabled_midway(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """enabled=True：按轮执行并打 round_done 五计数 + duration_ms 日志（FR-04.2）。"""
        stub = _stub_settings(enabled=True, interval_seconds=0)
        monkeypatch.setattr(patrol, "get_settings", lambda: stub)
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)

        async def _fake_run_once(self: MissionPatrolService) -> dict[str, int]:
            # 一轮后关闸退出常驻循环（测试不能挂死）。
            stub.mission_patrol_enabled = False
            return {
                "checked": 2,
                "converged": 1,
                "redispatched": 0,
                "zombie_marked": 0,
                "zombie_revived": 0,
            }

        monkeypatch.setattr(MissionPatrolService, "run_once", _fake_run_once)

        await mission_patrol_loop()

        log_spy.info.assert_called_once_with(
            "mission_patrol_round_done",
            duration_ms=ANY,
            checked=2,
            converged=1,
            redispatched=0,
            zombie_marked=0,
            zombie_revived=0,
        )

    @pytest.mark.asyncio
    async def test_round_failure_does_not_crash_loop(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """单轮整体抛错：只记 mission_patrol_round_failed，循环继续跑下一轮。"""
        stub = _stub_settings(enabled=True, interval_seconds=0)
        monkeypatch.setattr(patrol, "get_settings", lambda: stub)
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)
        calls: list[int] = []

        async def _flaky_run_once(self: MissionPatrolService) -> dict[str, int]:
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("boom on first round")
            stub.mission_patrol_enabled = False
            return _zero_counts()

        monkeypatch.setattr(MissionPatrolService, "run_once", _flaky_run_once)

        await mission_patrol_loop()

        assert len(calls) == 2, "首轮失败后循环必须继续执行第二轮"
        log_spy.exception.assert_called_once_with("mission_patrol_round_failed")


class TestMissionPatrolLoopCancel:
    """task-09 接线关停契约：lifespan finally 的 cancel + await gather 干净落地（design §4）。"""

    @pytest.mark.asyncio
    async def test_cancel_during_interval_sleep_returns_cancelled_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """轮间 sleep 挂起点被 cancel：CancelledError 穿出循环（不被 except Exception
        吞、不被吞成正常返回），gather(return_exceptions=True) 收到唯一结果。"""
        stub = _stub_settings(enabled=True, interval_seconds=3600)
        monkeypatch.setattr(patrol, "get_settings", lambda: stub)
        rounds: list[int] = []

        async def _counting_run_once(self: MissionPatrolService) -> dict[str, int]:
            rounds.append(1)
            return _zero_counts()

        monkeypatch.setattr(MissionPatrolService, "run_once", _counting_run_once)

        task = asyncio.create_task(mission_patrol_loop(), name="mission-patrol")
        try:
            # 等首轮完成（run_once 计数落盘），再给循环推进时间挂进 3600s 的
            # interval sleep——之后 cancel 必命中 sleep 挂起点（唯一常规挂起点）。
            for _ in range(200):
                if rounds:
                    break
                await asyncio.sleep(0.01)
            assert len(rounds) == 1, "取消前必须已完成首轮，否则没测到轮间挂起点"
            await asyncio.sleep(0.05)

            task.cancel()
            results = await asyncio.gather(task, return_exceptions=True)
        finally:
            if not task.done():
                task.cancel()

        assert len(results) == 1
        assert isinstance(results[0], asyncio.CancelledError), (
            "CancelledError 必须穿出循环——main.py finally 靠它感知取消落地"
        )
        assert len(rounds) == 1, "cancel 后不得再进新一轮"


class TestMainLifespanWiring:
    """task-09 main.py 接线契约（gap-2：conftest client 走 ASGITransport 不触发
    lifespan，无法用 lifespan 冒烟验证启动/关停——退而断言 main.py 源码含接线
    要素，轻量冒烟防接线被误删/误改）。"""

    def test_main_lifespan_wires_patrol_loop(self) -> None:
        """main.py 源码须含：mission_patrol_loop 引用 + enabled 开关 + 任务命名 +
        mission_patrol_started 日志 + gather(return_exceptions=True) 关停语义。"""
        import app.main as main_module

        source = Path(main_module.__file__).read_text(encoding="utf-8")

        assert "mission_patrol_loop" in source, "lifespan 必须引用巡检协程入口"
        assert "mission_patrol_enabled" in source, (
            "接线必须受 mission_patrol_enabled 开关控制（enabled=False 零巡检协程）"
        )
        assert 'name="mission-patrol"' in source, "巡检任务必须命名（可观测性）"
        assert "mission_patrol_started" in source, "启动日志事件必须存在"
        assert "return_exceptions=True" in source, (
            "关停必须 cancel + await gather(return_exceptions=True) 等取消落地"
        )


class TestActiveMissionIds:
    @pytest.mark.asyncio
    async def test_filters_cancelled_and_converged_orders_by_created_at(
        self, db_session: AsyncSession
    ) -> None:
        """只返回 converged_at/cancelled_at 均 NULL 的 mission，created_at 升序。"""
        ws_id = await _make_workspace(db_session)
        base = datetime(2026, 8, 21, 8, 0, 0, tzinfo=UTC)
        m_old = await _make_mission(db_session, ws_id, created_at=base)
        await _make_mission(
            db_session,
            ws_id,
            created_at=base + timedelta(minutes=1),
            cancelled_at=base + timedelta(hours=1),
        )
        await _make_mission(
            db_session,
            ws_id,
            created_at=base + timedelta(minutes=2),
            converged_at=base + timedelta(hours=1),
        )
        m_new = await _make_mission(db_session, ws_id, created_at=base + timedelta(minutes=3))

        svc = MissionPatrolService(db_session)
        ids = await svc._active_mission_ids()

        assert ids == [m_old.id, m_new.id], "cancelled/converged 必须排除，且老 mission 在前"

    @pytest.mark.asyncio
    async def test_limit_caps_returned_ids(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """limit 生效：3 条活跃 mission 在 limit=2 下只返回最早的 2 条（FR-01.3）。"""
        ws_id = await _make_workspace(db_session)
        base = datetime(2026, 8, 21, 8, 0, 0, tzinfo=UTC)
        m1 = await _make_mission(db_session, ws_id, created_at=base)
        m2 = await _make_mission(db_session, ws_id, created_at=base + timedelta(minutes=1))
        await _make_mission(db_session, ws_id, created_at=base + timedelta(minutes=2))

        monkeypatch.setattr(patrol, "ACTIVE_MISSION_LIMIT", 2)
        svc = MissionPatrolService(db_session)

        assert await svc._active_mission_ids() == [m1.id, m2.id]


class TestConvergenceDuty:
    """职责①收敛兜底（task-03，design §7 收敛兜底组）。"""

    @pytest.mark.asyncio
    async def test_schedule_loop_called_per_active_mission_and_counted(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """活跃 mission 每个恰被 schedule_loop 一次（created_at 序）；cancelled/converged
        不被调；返回 done 计 1 / None 计 0（计数透传）。"""
        ws_id = await _make_workspace(db_session)
        base = datetime(2026, 8, 21, 8, 0, 0, tzinfo=UTC)
        m_done = await _make_mission(db_session, ws_id, created_at=base)
        m_running = await _make_mission(db_session, ws_id, created_at=base + timedelta(minutes=1))
        await _make_mission(
            db_session,
            ws_id,
            created_at=base + timedelta(minutes=2),
            cancelled_at=base + timedelta(hours=1),
        )
        await _make_mission(
            db_session,
            ws_id,
            created_at=base + timedelta(minutes=3),
            converged_at=base + timedelta(hours=1),
        )

        calls: list[uuid.UUID] = []

        async def _fake_schedule_loop(
            self: OrchestratorService, mission_id: uuid.UUID
        ) -> str | None:
            calls.append(mission_id)
            return "done" if mission_id == m_done.id else None

        monkeypatch.setattr(OrchestratorService, "schedule_loop", _fake_schedule_loop)

        svc = MissionPatrolService(db_session)
        counts = await svc.run_once()

        assert calls == [m_done.id, m_running.id], (
            "cancelled/converged mission 不得被巡检，活跃 mission 按创建序各调一次"
        )
        assert counts["converged"] == 1, "返回 done 计 1、返回 None 不计"

    @pytest.mark.asyncio
    async def test_schedule_loop_exception_does_not_block_other_missions(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """schedule_loop 抛异常：真实 _patrol_convergence 隔离下其余 mission 照常收敛。"""
        ws_id = await _make_workspace(db_session)
        base = datetime(2026, 8, 21, 8, 0, 0, tzinfo=UTC)
        m_boom = await _make_mission(db_session, ws_id, created_at=base)
        await _make_mission(db_session, ws_id, created_at=base + timedelta(minutes=1))
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)

        async def _flaky_schedule_loop(
            self: OrchestratorService, mission_id: uuid.UUID
        ) -> str | None:
            if mission_id == m_boom.id:
                raise RuntimeError("boom in schedule_loop")
            return "done"

        monkeypatch.setattr(OrchestratorService, "schedule_loop", _flaky_schedule_loop)

        svc = MissionPatrolService(db_session)
        counts = await svc.run_once()

        assert counts["checked"] == 2
        assert counts["converged"] == 1, "单 mission 异常不得阻断同轮其它 mission"
        warnings = [
            c
            for c in log_spy.warning.call_args_list
            if c.args[0] == "mission_patrol_mission_failed"
        ]
        assert len(warnings) == 1
        assert warnings[0].kwargs.get("mission_id") == str(m_boom.id)


class TestRedispatchDuty:
    """职责②离线重派（task-04，design §7 离线重派组 + Grill P2-6 计数透传）。"""

    @pytest.mark.asyncio
    async def test_redispatch_called_once_and_count_passed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """每轮恰调一次 redispatch_pending_main_runs，返回计数透传 redispatched。"""
        calls: list[None] = []

        async def _fake_redispatch(self: OrchestratorService) -> int:
            calls.append(None)
            return 2

        monkeypatch.setattr(OrchestratorService, "redispatch_pending_main_runs", _fake_redispatch)

        svc = MissionPatrolService(db_session)
        counts = await svc.run_once()

        assert len(calls) == 1, "每轮巡检恰调用一次 redispatch"
        assert counts["redispatched"] == 2, "返回值必须透传进 redispatched 计数"

    @pytest.mark.asyncio
    async def test_redispatch_exception_isolated_from_convergence(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """redispatch 抛异常：真实挂载点抛错只记 duty_failed，职责①计数照常。"""
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)

        async def _boom_redispatch(self: OrchestratorService) -> int:
            raise RuntimeError("boom in redispatch_pending_main_runs")

        async def _fake_convergence(
            self: MissionPatrolService, mission_ids: list[uuid.UUID]
        ) -> int:
            return 1

        monkeypatch.setattr(OrchestratorService, "redispatch_pending_main_runs", _boom_redispatch)
        monkeypatch.setattr(MissionPatrolService, "_patrol_convergence", _fake_convergence)

        svc = MissionPatrolService(db_session)
        counts = await svc.run_once()

        assert counts["converged"] == 1, "职责②异常不得阻断职责①计数"
        assert counts["redispatched"] == 0
        log_spy.exception.assert_called_once_with("mission_patrol_duty_failed", duty="redispatch")


class TestRunOnce:
    @pytest.mark.asyncio
    async def test_skeleton_returns_five_zero_counts(self, db_session: AsyncSession) -> None:
        """空库骨架轮：返回恰好五计数键、值全 0（checked 为真实活跃数 0）。"""
        svc = MissionPatrolService(db_session)

        counts = await svc.run_once()

        assert counts == {
            "checked": 0,
            "converged": 0,
            "redispatched": 0,
            "zombie_marked": 0,
            "zombie_revived": 0,
        }

    @pytest.mark.asyncio
    async def test_checked_counts_active_missions(self, db_session: AsyncSession) -> None:
        """checked 计数为真实活跃 mission 数（含 cancelled 行不计入）。"""
        ws_id = await _make_workspace(db_session)
        base = datetime(2026, 8, 21, 8, 0, 0, tzinfo=UTC)
        await _make_mission(db_session, ws_id, created_at=base)
        await _make_mission(db_session, ws_id, created_at=base + timedelta(minutes=1))
        await _make_mission(
            db_session,
            ws_id,
            created_at=base + timedelta(minutes=2),
            cancelled_at=base + timedelta(hours=1),
        )

        svc = MissionPatrolService(db_session)
        counts = await svc.run_once()

        assert counts["checked"] == 2

    @pytest.mark.asyncio
    async def test_single_mission_failure_isolated(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """单 mission 抛错：只记 mission_patrol_mission_failed warning，不阻断其它（FR-01.2）。"""
        boom_id, ok_id = uuid.uuid4(), uuid.uuid4()
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)

        async def _fake_active(self: MissionPatrolService) -> list[uuid.UUID]:
            return [boom_id, ok_id]

        async def _fake_converge(self: MissionPatrolService, mission_id: uuid.UUID) -> int:
            if mission_id == boom_id:
                raise RuntimeError("boom on one mission")
            return 1

        monkeypatch.setattr(MissionPatrolService, "_active_mission_ids", _fake_active)
        monkeypatch.setattr(MissionPatrolService, "_converge_mission", _fake_converge)

        svc = MissionPatrolService(db_session)
        counts = await svc.run_once()

        assert counts["checked"] == 2
        assert counts["converged"] == 1, "异常 mission 不得阻断同轮其它 mission 的计数"
        log_spy.warning.assert_called_once()
        event_name = log_spy.warning.call_args.args[0]
        assert event_name == "mission_patrol_mission_failed"
        assert log_spy.warning.call_args.kwargs.get("mission_id") == str(boom_id)

    @pytest.mark.asyncio
    async def test_duty_failure_does_not_block_other_duties(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """职责②抛错：只记 mission_patrol_duty_failed，职责①计数照常透传。"""
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)

        async def _fake_convergence(
            self: MissionPatrolService, mission_ids: list[uuid.UUID]
        ) -> int:
            return 3

        async def _boom_redispatch(self: MissionPatrolService) -> int:
            raise RuntimeError("boom on redispatch duty")

        monkeypatch.setattr(MissionPatrolService, "_patrol_convergence", _fake_convergence)
        monkeypatch.setattr(MissionPatrolService, "_patrol_redispatch", _boom_redispatch)

        svc = MissionPatrolService(db_session)
        counts = await svc.run_once()

        assert counts["converged"] == 3, "职责②崩溃不得阻断职责①计数"
        assert counts["redispatched"] == 0
        log_spy.exception.assert_called_once_with("mission_patrol_duty_failed", duty="redispatch")


class TestZombieMark:
    """职责③判死段（task-05，design §7 判死组）：三分支 + 幂等 + 限定 + 断链。"""

    @pytest.mark.asyncio
    async def test_offline_beyond_threshold_marks_failed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """离线 + now-last_heartbeat_at>=阈值 → failed(orchestrator_zombie)+
        finished_at+zombie_marked_at（ISO 字符串），不收敛。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        user_id = await _make_user(db_session)
        mission = await _make_mission(
            db_session, ws_id, created_at=datetime.now(UTC) - timedelta(hours=3)
        )
        run = await _make_orchestrator_run(db_session, mission.id)
        _, runtime_id = await _make_daemon_chain(
            db_session,
            user_id,
            daemon_status="offline",
            last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=90),
        )
        await _make_lease(db_session, run.id, runtime_id)

        marked, revived = await MissionPatrolService(db_session)._patrol_zombie()

        assert (marked, revived) == (1, 0)
        assert run.status == "failed"
        assert run.error_code == "orchestrator_zombie"
        assert run.finished_at is not None
        # 判死不收敛（两阶段第一阶段，只标记不收尾）
        assert mission.converged_at is None
        marked_at = (mission.constraints or {}).get("zombie_marked_at")
        assert isinstance(marked_at, str)
        datetime.fromisoformat(marked_at)  # ISO 字符合法

    @pytest.mark.asyncio
    async def test_online_daemon_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """daemon 在线（心跳再老）→ 全不动。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        user_id = await _make_user(db_session)
        mission = await _make_mission(
            db_session, ws_id, created_at=datetime.now(UTC) - timedelta(hours=3)
        )
        run = await _make_orchestrator_run(db_session, mission.id)
        _, runtime_id = await _make_daemon_chain(
            db_session,
            user_id,
            daemon_status="online",
            last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=90),
        )
        await _make_lease(db_session, run.id, runtime_id)

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert run.status == "running"
        assert run.error_code is None
        assert "zombie_marked_at" not in (mission.constraints or {})

    @pytest.mark.asyncio
    async def test_offline_below_threshold_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """离线但心跳未超阈值（默认 60min，心跳 10min 前）→ 不动。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        user_id = await _make_user(db_session)
        mission = await _make_mission(
            db_session, ws_id, created_at=datetime.now(UTC) - timedelta(hours=3)
        )
        run = await _make_orchestrator_run(db_session, mission.id)
        _, runtime_id = await _make_daemon_chain(
            db_session,
            user_id,
            daemon_status="offline",
            last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=10),
        )
        await _make_lease(db_session, run.id, runtime_id)

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert run.status == "running"

    @pytest.mark.asyncio
    async def test_offline_without_heartbeat_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """离线 + last_heartbeat_at 为 None（无法判持续时长）→ 跳过不动。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        user_id = await _make_user(db_session)
        mission = await _make_mission(
            db_session, ws_id, created_at=datetime.now(UTC) - timedelta(hours=3)
        )
        run = await _make_orchestrator_run(db_session, mission.id)
        _, runtime_id = await _make_daemon_chain(
            db_session, user_id, daemon_status="offline", last_heartbeat_at=None
        )
        await _make_lease(db_session, run.id, runtime_id)

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert run.status == "running"

    @pytest.mark.asyncio
    async def test_already_zombie_run_not_remarked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """幂等（Grill P2-6）：已 failed+orchestrator_zombie 的 run 再巡检不重复标，
        zombie_marked_at 不被覆盖。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        user_id = await _make_user(db_session)
        mission = await _make_mission(
            db_session,
            ws_id,
            created_at=datetime.now(UTC) - timedelta(hours=3),
            constraints={
                "zombie_marked_at": (datetime.now(UTC) - timedelta(minutes=90)).isoformat()
            },
        )
        run = await _make_orchestrator_run(
            db_session,
            mission.id,
            status="failed",
            error_code="orchestrator_zombie",
            finished_at=datetime.now(UTC) - timedelta(minutes=90),
        )
        _, runtime_id = await _make_daemon_chain(
            db_session,
            user_id,
            daemon_status="offline",
            last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=120),
        )
        await _make_lease(db_session, run.id, runtime_id)
        marked_before = (mission.constraints or {})["zombie_marked_at"]

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0, "已 zombie 的 run 不得重复判死"
        assert (mission.constraints or {})["zombie_marked_at"] == marked_before

    @pytest.mark.asyncio
    async def test_change_mission_excluded(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """项目维度限定（Grill P1）：mission.change_id 非空的主 run 不进判死候选。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        user_id = await _make_user(db_session)
        mission = await _make_mission(
            db_session,
            ws_id,
            created_at=datetime.now(UTC) - timedelta(hours=3),
            change_id=uuid.uuid4(),  # change 维度：有 _handle_team_run_completion 兜底
        )
        run = await _make_orchestrator_run(db_session, mission.id)
        _, runtime_id = await _make_daemon_chain(
            db_session,
            user_id,
            daemon_status="offline",
            last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=90),
        )
        await _make_lease(db_session, run.id, runtime_id)

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert run.status == "running"

    @pytest.mark.asyncio
    async def test_pending_run_without_lease_excluded(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """pending 无 lease 的 run 不进候选（pending+no_online_daemon 归职责②重派）。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        await _make_user(db_session)
        mission = await _make_mission(
            db_session, ws_id, created_at=datetime.now(UTC) - timedelta(hours=3)
        )
        run = await _make_orchestrator_run(
            db_session, mission.id, status="pending", error_code="no_online_daemon"
        )

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert run.status == "pending"

    @pytest.mark.asyncio
    async def test_broken_chain_lease_without_runtime_skipped(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """断链（Grill P2-2）：lease.runtime_id 为 NULL → 跳过不判死且不抛异常。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        await _make_user(db_session)
        mission = await _make_mission(
            db_session, ws_id, created_at=datetime.now(UTC) - timedelta(hours=3)
        )
        run = await _make_orchestrator_run(db_session, mission.id)
        await _make_lease(db_session, run.id, None)

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert run.status == "running"

    @pytest.mark.asyncio
    async def test_broken_chain_runtime_without_instance_skipped(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """断链（Grill P2-2）：runtime.daemon_instance_id NULL（迁移期遗留）→ 跳过。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        user_id = await _make_user(db_session)
        mission = await _make_mission(
            db_session, ws_id, created_at=datetime.now(UTC) - timedelta(hours=3)
        )
        run = await _make_orchestrator_run(db_session, mission.id)
        orphan_runtime_id = uuid.uuid4()
        db_session.add(
            DaemonRuntime(id=orphan_runtime_id, daemon_instance_id=None, user_id=user_id)
        )
        await db_session.commit()
        await _make_lease(db_session, run.id, orphan_runtime_id)

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert run.status == "running"


async def _make_zombie_setup(
    db_session: AsyncSession,
    *,
    daemon_status: str,
    marked_minutes_ago: float,
) -> tuple[AgentMission, AgentRun]:
    """建复活/豁免用例的公共前置：zombie 主 run（failed+标记）+ 完整 daemon 链。

    zombie_marked_at / finished_at 均取 now-marked_minutes_ago（ISO 字符串 /
    datetime），daemon 心跳保持新鲜——在线状态分支由 daemon_status 控制。
    """
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)
    marked_at = datetime.now(UTC) - timedelta(minutes=marked_minutes_ago)
    mission = await _make_mission(
        db_session,
        ws_id,
        created_at=datetime.now(UTC) - timedelta(hours=3),
        constraints={"zombie_marked_at": marked_at.isoformat()},
        created_by=user_id,
    )
    run = await _make_orchestrator_run(
        db_session,
        mission.id,
        status="failed",
        error_code="orchestrator_zombie",
        finished_at=marked_at,
    )
    _, runtime_id = await _make_daemon_chain(
        db_session,
        user_id,
        daemon_status=daemon_status,
        last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    await _make_lease(db_session, run.id, runtime_id)
    return mission, run


class TestZombieRevive:
    """职责③复活段（task-06，design §7 复活组）。"""

    @pytest.mark.asyncio
    async def test_revive_in_window_with_online_daemon(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """窗口内 + daemon 恢复 online → running + 清标记 + 以重渲染 prompt 重派。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        mission, run = await _make_zombie_setup(
            db_session, daemon_status="online", marked_minutes_ago=10
        )

        async def _fake_render(
            mission: AgentMission,
            orchestrator_run: AgentRun,
            session: AsyncSession,
        ) -> str:
            return "RE-RENDERED-ORCHESTRATOR-PROMPT"

        dispatch_calls: list[tuple[uuid.UUID, uuid.UUID | None, dict]] = []

        async def _fake_dispatch(
            self: RunPlacementService,
            agent_run_id: uuid.UUID,
            user_id: uuid.UUID | None,
            **kwargs: object,
        ) -> uuid.UUID:
            dispatch_calls.append((agent_run_id, user_id, dict(kwargs)))
            return uuid.uuid4()

        monkeypatch.setattr(patrol, "render_orchestrator_prompt", _fake_render)
        monkeypatch.setattr(RunPlacementService, "dispatch_to_daemon", _fake_dispatch)

        marked, revived = await MissionPatrolService(db_session)._patrol_zombie()

        assert (marked, revived) == (0, 1)
        assert run.status == "running"
        assert run.error_code is None
        assert run.finished_at is None
        assert "zombie_marked_at" not in (mission.constraints or {})

        assert len(dispatch_calls) == 1
        agent_run_id, user_id, kwargs = dispatch_calls[0]
        assert agent_run_id == run.id
        assert user_id == mission.created_by
        assert kwargs["workspace_id"] == mission.workspace_id
        assert kwargs["prompt"] == "RE-RENDERED-ORCHESTRATOR-PROMPT"
        assert kwargs["stage"] == "orchestrator"
        assert kwargs["read_only"] is False
        assert kwargs["agent_profile_id"] is None

    @pytest.mark.asyncio
    async def test_no_revive_after_window(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """窗口耗尽（daemon 已恢复 online）→ 不复活、不重派（豁免归 task-07 语义）。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        mission, run = await _make_zombie_setup(
            db_session, daemon_status="online", marked_minutes_ago=60
        )
        dispatch_calls: list[uuid.UUID] = []

        async def _fake_dispatch(
            self: RunPlacementService,
            agent_run_id: uuid.UUID,
            user_id: uuid.UUID | None,
            **kwargs: object,
        ) -> uuid.UUID:
            dispatch_calls.append(agent_run_id)
            return uuid.uuid4()

        monkeypatch.setattr(RunPlacementService, "dispatch_to_daemon", _fake_dispatch)

        _, revived = await MissionPatrolService(db_session)._patrol_zombie()

        assert revived == 0
        assert run.status == "failed"
        assert run.error_code == "orchestrator_zombie"
        assert dispatch_calls == []
        assert "zombie_converged" not in (mission.constraints or {})

    @pytest.mark.asyncio
    async def test_no_revive_when_daemon_still_offline(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """窗口内但 daemon 仍离线 → 不复活，zombie 态四字段完整保留。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        mission, run = await _make_zombie_setup(
            db_session, daemon_status="offline", marked_minutes_ago=10
        )
        marked_before = (mission.constraints or {})["zombie_marked_at"]

        async def _fail_dispatch(
            self: RunPlacementService,
            agent_run_id: uuid.UUID,
            user_id: uuid.UUID | None,
            **kwargs: object,
        ) -> uuid.UUID:
            raise AssertionError("daemon 离线时不得触发重派")

        monkeypatch.setattr(RunPlacementService, "dispatch_to_daemon", _fail_dispatch)

        _, revived = await MissionPatrolService(db_session)._patrol_zombie()

        assert revived == 0
        assert run.status == "failed"
        assert run.error_code == "orchestrator_zombie"
        assert run.finished_at is not None
        assert (mission.constraints or {})["zombie_marked_at"] == marked_before

    @pytest.mark.asyncio
    async def test_revive_dispatch_failure_rolls_back_zombie_state(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """重派抛 NoOnlineDaemonError → zombie 态四字段完整回滚（标记不丢、不崩）。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        mission, run = await _make_zombie_setup(
            db_session, daemon_status="online", marked_minutes_ago=10
        )
        marked_before = (mission.constraints or {})["zombie_marked_at"]
        finished_before = run.finished_at

        async def _fake_render(
            mission: AgentMission,
            orchestrator_run: AgentRun,
            session: AsyncSession,
        ) -> str:
            return "RE-RENDERED-ORCHESTRATOR-PROMPT"

        async def _boom_dispatch(
            self: RunPlacementService,
            agent_run_id: uuid.UUID,
            user_id: uuid.UUID | None,
            **kwargs: object,
        ) -> uuid.UUID:
            raise NoOnlineDaemonError(user_id=user_id or uuid.uuid4())

        monkeypatch.setattr(patrol, "render_orchestrator_prompt", _fake_render)
        monkeypatch.setattr(RunPlacementService, "dispatch_to_daemon", _boom_dispatch)

        _, revived = await MissionPatrolService(db_session)._patrol_zombie()

        assert revived == 0, "重派失败不计复活"
        assert run.status == "failed"
        assert run.error_code == "orchestrator_zombie"
        assert run.finished_at is not None and run.finished_at != finished_before
        assert (mission.constraints or {})["zombie_marked_at"] == marked_before


class TestZombieExemptionRelease:
    """职责③豁免解除段（task-07，design §7 豁免组）。"""

    @pytest.mark.asyncio
    async def test_window_expired_offline_marks_zombie_converged(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """窗口耗尽 + daemon 仍离线 → zombie_converged=true（zombie_marked_at 留审计），
        run 状态不变、不收敛。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        mission, run = await _make_zombie_setup(
            db_session, daemon_status="offline", marked_minutes_ago=60
        )
        marked_before = (mission.constraints or {})["zombie_marked_at"]

        marked, revived = await MissionPatrolService(db_session)._patrol_zombie()

        assert (marked, revived) == (0, 0)
        assert (mission.constraints or {}).get("zombie_converged") is True
        assert (mission.constraints or {})["zombie_marked_at"] == marked_before, "审计时间戳保留"
        assert run.status == "failed"
        assert run.error_code == "orchestrator_zombie"
        assert mission.converged_at is None, "patrol 不直接触发收敛（信号 1 既有路径负责）"

    @pytest.mark.asyncio
    async def test_window_expired_online_does_not_mark(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """窗口耗尽但 daemon 在线 → 不写 zombie_converged（归复活路径，两分支互斥）。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        mission, _run = await _make_zombie_setup(
            db_session, daemon_status="online", marked_minutes_ago=60
        )

        async def _fail_dispatch(
            self: RunPlacementService,
            agent_run_id: uuid.UUID,
            user_id: uuid.UUID | None,
            **kwargs: object,
        ) -> uuid.UUID:
            raise AssertionError("窗口耗尽不得触发重派（复活仅在窗口内）")

        monkeypatch.setattr(RunPlacementService, "dispatch_to_daemon", _fail_dispatch)

        _, revived = await MissionPatrolService(db_session)._patrol_zombie()

        assert revived == 0
        assert "zombie_converged" not in (mission.constraints or {})

    @pytest.mark.asyncio
    async def test_in_window_offline_does_not_mark(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """窗口内 + 离线：复活等待期，不写 zombie_converged。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        mission, _ = await _make_zombie_setup(
            db_session, daemon_status="offline", marked_minutes_ago=10
        )

        await MissionPatrolService(db_session)._patrol_zombie()

        assert "zombie_converged" not in (mission.constraints or {})

    @pytest.mark.asyncio
    async def test_exempt_write_idempotent(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """幂等：已写 zombie_converged 的 mission 再巡检不重复写、constraints 不变。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        mission, run = await _make_zombie_setup(
            db_session, daemon_status="offline", marked_minutes_ago=60
        )
        mission.constraints = {**(mission.constraints or {}), "zombie_converged": True}
        db_session.add(mission)
        await db_session.commit()
        constraints_before = dict(mission.constraints)

        marked, revived = await MissionPatrolService(db_session)._patrol_zombie()

        assert (marked, revived) == (0, 0)
        assert mission.constraints == constraints_before
        assert run.status == "failed"


def _patch_explicit_converge_recorder(
    monkeypatch: pytest.MonkeyPatch,
) -> list[tuple[uuid.UUID, bool]]:
    """mock finalizer.converge_mission_for_completed_run（task-08 超时收敛消费侧）。

    记录 ``(run_id, converge_explicit)`` 调用并置位 ``mission.converged_at``（对齐
    真实 explicit 入口的原子置位副作用，供 converged 计数与终态断言）；真实入口
    内部 FinalizerService 走 git_merge RPC / GLM httpx（单跑偶发 8~34s），照
    test_orchestrator._mock_converge 惯例统一 mock。
    """
    import app.modules.agent.finalizer as finalizer_mod

    calls: list[tuple[uuid.UUID, bool]] = []

    async def _fake_converge(session, run_id, glm_config=None, *, converge_explicit=False):
        calls.append((run_id, converge_explicit))
        run = await session.get(AgentRun, run_id)
        if run is not None and run.mission_id is not None:
            mission = await session.get(AgentMission, run.mission_id)
            if mission is not None:
                mission.converged_at = datetime.now(UTC)
                session.add(mission)
                await session.commit()
        return "done"

    monkeypatch.setattr(finalizer_mod, "converge_mission_for_completed_run", _fake_converge)
    return calls


class TestAwaitingInputAutoConverge:
    """task-08 职责①扩展：会话 mission awaiting_input 超时自动收敛（FR-08 / §7.5）。

    判据全格：会话 mission（session_id 指向真实 AgentSession）+ 主控轮与分身全
    终态 + 未 converge + 会话无活跃 turn（task-02 派生态）持续超
    ``mission_patrol_awaiting_input_timeout_minutes`` → 走 task-06 explicit
    置位入口（锚点=最新 orchestrator run）；任一条件不满足（未超时 / 时钟缺失 /
    会话活跃 / 分身非终态 / 存量 external）→ 不收敛。
    """

    @pytest.mark.asyncio
    async def test_timeout_expired_converges_via_explicit_entry(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """全条件满足 + 超时 → explicit 入口收敛（converge_explicit=True + 锚点=
        最新 orchestrator run），converged 计 1，converged_at 落库。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        calls = _patch_explicit_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        agent_session = await _make_agent_session(db_session)
        mission = await _make_mission(
            db_session,
            ws_id,
            created_at=datetime.now(UTC) - timedelta(hours=2),
            session_id=agent_session.id,
        )
        turn_run = await _make_orchestrator_run(
            db_session,
            mission.id,
            status="completed",
            finished_at=datetime.now(UTC) - timedelta(minutes=40),
            agent_session_id=agent_session.id,
        )
        await _make_worker_run(db_session, mission.id, status="completed")

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["converged"] == 1
        assert calls == [(turn_run.id, True)], "必须走 explicit 入口且锚点=最新主控轮"
        assert mission.converged_at is not None

    @pytest.mark.asyncio
    async def test_within_timeout_not_converged(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """未超时（finished_at=10min 前 < 默认 30min）→ 不收敛（awaiting_input 窗口内）。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        calls = _patch_explicit_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        agent_session = await _make_agent_session(db_session)
        mission = await _make_mission(
            db_session,
            ws_id,
            created_at=datetime.now(UTC) - timedelta(hours=2),
            session_id=agent_session.id,
        )
        await _make_orchestrator_run(
            db_session,
            mission.id,
            status="completed",
            finished_at=datetime.now(UTC) - timedelta(minutes=10),
            agent_session_id=agent_session.id,
        )
        await _make_worker_run(db_session, mission.id, status="completed")

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["converged"] == 0
        assert calls == []
        assert mission.converged_at is None

    @pytest.mark.asyncio
    async def test_clock_missing_skipped(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """时钟缺失（最新 orchestrator run finished_at=None）→ 跳过不猜（对齐断链语义）。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        calls = _patch_explicit_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        agent_session = await _make_agent_session(db_session)
        mission = await _make_mission(
            db_session,
            ws_id,
            created_at=datetime.now(UTC) - timedelta(hours=2),
            session_id=agent_session.id,
        )
        await _make_orchestrator_run(
            db_session,
            mission.id,
            status="completed",
            finished_at=None,
            agent_session_id=agent_session.id,
        )
        await _make_worker_run(db_session, mission.id, status="completed")

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["converged"] == 0
        assert calls == []

    @pytest.mark.asyncio
    async def test_session_active_turn_not_converged(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """会话有活跃 turn（pending/running/interrupting，task-04/05 同源口径）→
        主控新一轮进行中，不属 awaiting_input，不超时收敛。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        calls = _patch_explicit_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        agent_session = await _make_agent_session(db_session)
        mission = await _make_mission(
            db_session,
            ws_id,
            created_at=datetime.now(UTC) - timedelta(hours=2),
            session_id=agent_session.id,
        )
        await _make_orchestrator_run(
            db_session,
            mission.id,
            status="completed",
            finished_at=datetime.now(UTC) - timedelta(minutes=40),
            agent_session_id=agent_session.id,
        )
        await _make_worker_run(db_session, mission.id, status="completed")
        # 会话当前活跃 turn：挂在该会话上的 running run（mission 全 run 仍终态，
        # 隔离「会话活跃 turn」这一独立判据）
        db_session.add(
            AgentRun(
                agent_session_id=agent_session.id,
                agent_type="claude_code",
                status="running",
            )
        )
        await db_session.commit()

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["converged"] == 0
        assert calls == []

    @pytest.mark.asyncio
    async def test_worker_not_terminal_not_converged(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """分身非终态（running）→ 派生态=running 非 awaiting_input，不超时收敛。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        calls = _patch_explicit_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        agent_session = await _make_agent_session(db_session)
        mission = await _make_mission(
            db_session,
            ws_id,
            created_at=datetime.now(UTC) - timedelta(hours=2),
            session_id=agent_session.id,
        )
        await _make_orchestrator_run(
            db_session,
            mission.id,
            status="completed",
            finished_at=datetime.now(UTC) - timedelta(minutes=40),
            agent_session_id=agent_session.id,
        )
        await _make_worker_run(db_session, mission.id, status="running")

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["converged"] == 0
        assert calls == []

    @pytest.mark.asyncio
    async def test_external_mission_not_timeout_converged(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """存量 external/team mission（session_id 随机 uuid 查无会话行）不进超时
        收敛——其收敛仍走 schedule_loop 存量链路（此处 stub 返回 None 隔离），explicit 入口不被调。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        calls = _patch_explicit_converge_recorder(monkeypatch)

        async def _fake_schedule_loop(
            self: OrchestratorService, mission_id: uuid.UUID
        ) -> str | None:
            return None

        monkeypatch.setattr(OrchestratorService, "schedule_loop", _fake_schedule_loop)
        ws_id = await _make_workspace(db_session)
        mission = await _make_mission(
            db_session, ws_id, created_at=datetime.now(UTC) - timedelta(hours=2)
        )
        await _make_orchestrator_run(
            db_session,
            mission.id,
            status="completed",
            finished_at=datetime.now(UTC) - timedelta(minutes=40),
        )
        await _make_worker_run(db_session, mission.id, status="completed")

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["converged"] == 0
        assert calls == [], "存量 external 不得走 awaiting_input 超时收敛（Grill NEW-4）"

    @pytest.mark.asyncio
    async def test_clock_starts_from_latest_orchestrator_run(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """时钟起点=最新 orchestrator run 的 finished_at：旧轮 45min 前已终、最新轮
        5min 前才终 → 未超时不收敛（不得拿旧轮时钟提前收）。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        calls = _patch_explicit_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        agent_session = await _make_agent_session(db_session)
        mission = await _make_mission(
            db_session,
            ws_id,
            created_at=datetime.now(UTC) - timedelta(hours=2),
            session_id=agent_session.id,
        )
        base = datetime.now(UTC) - timedelta(hours=1)
        await _make_orchestrator_run(
            db_session,
            mission.id,
            status="completed",
            finished_at=datetime.now(UTC) - timedelta(minutes=45),
            agent_session_id=agent_session.id,
            created_at=base,
        )
        latest = await _make_orchestrator_run(
            db_session,
            mission.id,
            status="completed",
            finished_at=datetime.now(UTC) - timedelta(minutes=5),
            agent_session_id=agent_session.id,
            created_at=base + timedelta(minutes=10),
        )
        await _make_worker_run(db_session, mission.id, status="completed")

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["converged"] == 0
        assert calls == []

        # 对照：最新轮也超时后 → 收敛且锚点=最新轮（不取旧轮）。
        latest_run = await db_session.get(AgentRun, latest.id)
        latest_run.finished_at = datetime.now(UTC) - timedelta(minutes=40)
        db_session.add(latest_run)
        await db_session.commit()

        converged = await MissionPatrolService(db_session)._auto_converge_awaiting_input(mission.id)

        assert converged == 1
        assert calls == [(latest.id, True)]


class TestAwaitingInputTimeoutConfig:
    """task-08：``mission_patrol_awaiting_input_timeout_minutes`` 配置契约（默认 30 / ge=5）。"""

    def test_default_30(self) -> None:
        """不设 env 时默认 30 分钟（存量部署零配置可启动）。"""
        from app.core.config import Settings

        s = Settings(
            database_url="postgresql+asyncpg://u:p@localhost/db",
            secret_key="x" * 16,
        )
        assert s.mission_patrol_awaiting_input_timeout_minutes == 30

    def test_below_5_rejected_and_bound_allowed(self) -> None:
        """低于 5 拒绝（ValidationError）；恰好 5 合法（ge 下界含端点）。"""
        from pydantic import ValidationError

        from app.core.config import Settings

        base = {
            "database_url": "postgresql+asyncpg://u:p@localhost/db",
            "secret_key": "x" * 16,
        }
        with pytest.raises(ValidationError):
            Settings(**base, mission_patrol_awaiting_input_timeout_minutes=4)
        ok = Settings(**base, mission_patrol_awaiting_input_timeout_minutes=5)
        assert ok.mission_patrol_awaiting_input_timeout_minutes == 5


async def _make_session_zombie_setup(
    db_session: AsyncSession,
    *,
    daemon_status: str,
    worker_status: str = "running",
    worker_role: str | None = "arch",
    active_turn: bool = False,
) -> tuple[AgentMission, AgentRun]:
    """建会话维度僵尸用例前置：真实 AgentSession + 会话 mission + 非终态分身 run
    （带 lease 的完整 daemon 链）。active_turn=True 时补一条挂在该会话的 running
    turn run（无 mission_id，纯会话活跃信号）。"""
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)
    agent_session = await _make_agent_session(db_session)
    mission = await _make_mission(
        db_session,
        ws_id,
        created_at=datetime.now(UTC) - timedelta(hours=3),
        session_id=agent_session.id,
    )
    worker = await _make_worker_run(db_session, mission.id, status=worker_status, role=worker_role)
    _, runtime_id = await _make_daemon_chain(
        db_session,
        user_id,
        daemon_status=daemon_status,
        last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=90),
    )
    await _make_lease(db_session, worker.id, runtime_id)
    if active_turn:
        db_session.add(
            AgentRun(
                agent_session_id=agent_session.id,
                agent_type="claude_code",
                status="running",
            )
        )
        await db_session.commit()
    return mission, worker


class TestZombieSessionDimension:
    """task-08 职责③判死段会话维度分流（design §5 Phase 1 patrol 适配 / D-008）。

    判死条件=分身 run（role!='orchestrator' 含 NULL）非终态 + 承载 daemon 持续
    离线超 zombie_after + 主控会话无活跃 turn；会话 mission 主控轮（短生命周期
    turn run）不进存量主 run 判死；存量 external 主 run 判定链路零回归。
    """

    @pytest.mark.asyncio
    async def test_session_worker_offline_beyond_threshold_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """全条件满足 → 分身标 failed(orchestrator_zombie)+finished_at；不写 mission
        zombie_marked_at（分身无复活语义，mission 走 awaiting_input 超时收敛）。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        mission, worker = await _make_session_zombie_setup(db_session, daemon_status="offline")

        marked, revived = await MissionPatrolService(db_session)._patrol_zombie()

        assert (marked, revived) == (1, 0)
        assert worker.status == "failed"
        assert worker.error_code == "orchestrator_zombie"
        assert worker.finished_at is not None
        assert mission.converged_at is None
        assert "zombie_marked_at" not in (mission.constraints or {})

    @pytest.mark.asyncio
    async def test_session_worker_active_turn_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """主控会话有活跃 turn（主控本轮还活着，可能仍在等分身）→ 不判死。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        _mission, worker = await _make_session_zombie_setup(
            db_session, daemon_status="offline", active_turn=True
        )

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert worker.status == "running"

    @pytest.mark.asyncio
    async def test_session_worker_daemon_online_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """承载 daemon 在线（心跳再老）→ 不判死。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        _mission, worker = await _make_session_zombie_setup(db_session, daemon_status="online")

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert worker.status == "running"

    @pytest.mark.asyncio
    async def test_session_worker_offline_below_threshold_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """daemon 离线但未超 zombie_after（默认 60min，心跳 10min 前）→ 不判死。

        _make_session_zombie_setup 心跳固定 90min 前，这里手动改回 10min 前。
        """
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        _mission, worker = await _make_session_zombie_setup(db_session, daemon_status="offline")
        from sqlalchemy import update

        from app.modules.daemon.model import DaemonInstance

        await db_session.execute(
            update(DaemonInstance)
            .where(DaemonInstance.status == "offline")
            .values(last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=10))
        )
        await db_session.commit()

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert worker.status == "running"

    @pytest.mark.asyncio
    async def test_session_worker_without_lease_not_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """无 lease 的分身 run（链路断链/未派成）不进候选——判死需承载 daemon 链路。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        agent_session = await _make_agent_session(db_session)
        mission = await _make_mission(
            db_session,
            ws_id,
            created_at=datetime.now(UTC) - timedelta(hours=3),
            session_id=agent_session.id,
        )
        worker = await _make_worker_run(db_session, mission.id, status="running")

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert worker.status == "running"

    @pytest.mark.asyncio
    async def test_null_role_session_worker_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """role=NULL 的存量形态分身也在候选内（SQL 三值逻辑 NULL 守卫）。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        _mission, worker = await _make_session_zombie_setup(
            db_session, daemon_status="offline", worker_role=None
        )

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 1
        assert worker.status == "failed"
        assert worker.error_code == "orchestrator_zombie"

    @pytest.mark.asyncio
    async def test_session_mission_orchestrator_turn_run_not_legacy_marked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """会话 mission 的主控轮（turn run，即使 running + 有 lease + daemon 离线）
        不进存量主 run 判死——主控存续按会话活跃 turn 判定，不按主 run 常驻。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        ws_id = await _make_workspace(db_session)
        user_id = await _make_user(db_session)
        agent_session = await _make_agent_session(db_session)
        mission = await _make_mission(
            db_session,
            ws_id,
            created_at=datetime.now(UTC) - timedelta(hours=3),
            session_id=agent_session.id,
        )
        turn_run = await _make_orchestrator_run(
            db_session, mission.id, status="running", agent_session_id=agent_session.id
        )
        _, runtime_id = await _make_daemon_chain(
            db_session,
            user_id,
            daemon_status="offline",
            last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=90),
        )
        await _make_lease(db_session, turn_run.id, runtime_id)

        marked, _ = await MissionPatrolService(db_session)._patrol_zombie()

        assert marked == 0
        assert turn_run.status == "running"

    @pytest.mark.asyncio
    async def test_session_worker_and_external_main_run_disjoint_paths(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """分流回归：同轮会话 mission 判死分身、存量 external 判死主 run，互不串道。"""
        monkeypatch.setattr(patrol, "get_settings", lambda: _stub_settings())
        # 会话侧：分身 running + daemon 离线
        session_mission, worker = await _make_session_zombie_setup(
            db_session, daemon_status="offline"
        )
        # 存量 external 侧：主 run running + lease + daemon 离线（原判死链路）
        ws_id = await _make_workspace(db_session)
        user_id = await _make_user(db_session)
        external_mission = await _make_mission(
            db_session, ws_id, created_at=datetime.now(UTC) - timedelta(hours=3)
        )
        main_run = await _make_orchestrator_run(db_session, external_mission.id)
        _, runtime_id = await _make_daemon_chain(
            db_session,
            user_id,
            daemon_status="offline",
            last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=90),
        )
        await _make_lease(db_session, main_run.id, runtime_id)

        marked, revived = await MissionPatrolService(db_session)._patrol_zombie()

        assert (marked, revived) == (2, 0)
        assert worker.status == "failed"
        assert worker.error_code == "orchestrator_zombie"
        assert main_run.status == "failed"
        assert main_run.error_code == "orchestrator_zombie"
        # 存量 external 判死保留 mission zombie 标记（复活窗口语义），会话分身不写。
        assert "zombie_marked_at" in (external_mission.constraints or {})
        assert "zombie_marked_at" not in (session_mission.constraints or {})
