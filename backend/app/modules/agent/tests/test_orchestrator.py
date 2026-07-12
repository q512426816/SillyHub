"""Tests for OrchestratorService（2026-07-12-team-main-agent-orchestration task-03 / D-001@v2）。

覆盖：
- ``team_mission_entry``：建 mission（worker_preset/main_agent_config 落库）+ 主 agent
  run（role=orchestrator, mission_id 非空, agent_type/provider/model 从 main_agent_config）。
- daemon 离线 / workspace 未绑定时捕获 NoOnlineDaemonError，run 标 pending +
  error_code=no_online_daemon，mission 仍建。
- ``schedule_loop`` 三重收敛状态机（task-11 完整逻辑）：
  - 信号 1（worker 全终态）→ converge，done/degraded。
  - 信号 3（budget 触顶）→ 强制 converge，degraded。
  - 三信号均未达 → 返回 None（mission 正常推进）。
  - cancelled mission / 无主 agent run → 跳过。
- 主 agent run 必须写 mission_id（否则 converge_mission_for_completed_run 在
  finalizer.py:206 run.mission_id is None 直接 return，mission 永不收敛）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.agent.orchestrator import (
    OrchestratorService,
    _resolve_main_agent_config,
)


async def _make_workspace(session: AsyncSession) -> uuid.UUID:
    """建一个真实 workspace 行（外键完整，避免依赖 SQLite 不强制 FK）。"""
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


class TestTeamMissionEntry:
    @pytest.mark.asyncio
    async def test_builds_mission_and_orchestrator_run(self, db_session: AsyncSession) -> None:
        """mode=team 入口：建 mission（含 preset/config 落库）+ 主 agent run（role=orchestrator, mission_id 非空）。"""
        ws_id = await _make_workspace(db_session)
        user_id = uuid.uuid4()
        preset = [
            {
                "agent_type": "claude_code",
                "model": "gpt-4o",
                "objective": "扫描架构",
                "role": "arch",
            },
            {"agent_type": "claude_code", "model": "gpt-4o", "objective": "写实现", "role": "impl"},
        ]
        main_cfg = {"agent_type": "claude_code", "provider": "claude", "model": "opus"}

        svc = OrchestratorService(db_session)
        mission, main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=user_id,
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=10.0,
            worker_preset=preset,
            main_agent_config=main_cfg,
        )

        # mission 落库
        assert mission.id is not None
        assert mission.workspace_id == ws_id
        assert mission.objective == "团队目标"
        assert mission.worker_preset == preset
        assert mission.main_agent_config == main_cfg
        assert (mission.constraints or {}).get("mode") == "team"

        # 主 agent run：role=orchestrator + mission_id 非空 + 配置从 main_agent_config
        assert main_run.mission_id == mission.id
        assert main_run.role == "orchestrator"
        assert main_run.agent_type == "claude_code"
        assert main_run.provider == "claude"
        assert main_run.model == "opus"
        assert main_run.status == "pending"

    @pytest.mark.asyncio
    async def test_daemon_offline_marks_run_pending_with_error_code(
        self, db_session: AsyncSession
    ) -> None:
        """workspace 未绑定 daemon → dispatch_to_daemon 抛 NoOnlineDaemonError →
        捕获并标 run.error_code=no_online_daemon，mission 仍建。"""
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=None,
            worker_preset=None,
            main_agent_config=None,
        )

        assert mission.id is not None
        # 无 binding → NoOnlineDaemonError 被捕获
        assert main_run.error_code == "no_online_daemon"
        assert main_run.output_redacted is not None
        assert main_run.mission_id == mission.id
        # 默认配置兜底（main_agent_config=None）
        assert main_run.agent_type == "claude_code"
        assert main_run.provider == "claude"

    @pytest.mark.asyncio
    async def test_main_agent_config_defaults_when_none(self, db_session: AsyncSession) -> None:
        """main_agent_config=None → 默认 agent_type=claude_code / provider=claude / model 空串。"""
        cfg = _resolve_main_agent_config(None)
        assert cfg["agent_type"] == "claude_code"
        assert cfg["provider"] == "claude"
        assert cfg["model"] == ""

    @pytest.mark.asyncio
    async def test_main_agent_config_partial_uses_defaults(self, db_session: AsyncSession) -> None:
        """main_agent_config 只给 model → agent_type/provider 走默认。"""
        cfg = _resolve_main_agent_config({"model": "opus-4"})
        assert cfg["agent_type"] == "claude_code"
        assert cfg["provider"] == "claude"
        assert cfg["model"] == "opus-4"

    @pytest.mark.asyncio
    async def test_orchestrator_run_writes_mission_id_for_converge(
        self, db_session: AsyncSession
    ) -> None:
        """主 agent run 必须写 mission_id（converge_mission_for_completed_run 在
        finalizer.py:206 run.mission_id is None 直接 return，mission 永不收敛）。"""
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=None,
            worker_preset=None,
            main_agent_config=None,
        )
        # 从 DB 重查确认 mission_id 持久化（非仅内存对象）
        persisted = (
            (
                await db_session.execute(
                    select(AgentRun).where(
                        AgentRun.id == main_run.id, AgentRun.mission_id == mission.id
                    )
                )
            )
            .scalars()
            .first()
        )
        assert persisted is not None
        assert persisted.role == "orchestrator"


class TestScheduleLoopConvergence:
    """task-11：schedule_loop 三重收敛状态机（D-006@v2）。

    信号 1（worker 全终态）/ 信号 3（budget 触顶）在 backend 兜底巡检触发；
    信号 2（主 agent 自主收敛）走 MCP endpoint，不经 schedule_loop。
    """

    @pytest.mark.asyncio
    async def test_no_workers_returns_none(self, db_session: AsyncSession) -> None:
        """空 worker 集合（主 agent 还没派 worker）→ 不收敛（避免 mission 刚建空收）。"""
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, _ = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=10.0,
            worker_preset=None,
            main_agent_config=None,
        )
        result = await svc.schedule_loop(mission.id)
        assert result is None

    @pytest.mark.asyncio
    async def test_workers_not_terminal_returns_none(self, db_session: AsyncSession) -> None:
        """worker 仍 running → 不收敛（mission 正常推进）。"""
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, _ = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=10.0,
            worker_preset=None,
            main_agent_config=None,
        )
        # 加一个 running worker（role != orchestrator）
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            role="arch",
            objective="扫描",
            total_cost_usd=0.5,
        )
        db_session.add(worker)
        await db_session.commit()

        result = await svc.schedule_loop(mission.id)
        assert result is None

    @pytest.mark.asyncio
    async def test_signal1_all_workers_terminal_converges_done(
        self, db_session: AsyncSession
    ) -> None:
        """信号 1：所有 worker completed（含 summary 产出）→ converge，status=done。"""
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=10.0,
            worker_preset=None,
            main_agent_config=None,
        )
        # 两个 completed worker（带 output 让 Finalizer concat 合并产出 summary artifact）
        for role in ("arch", "impl"):
            r = AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="completed",
                role=role,
                objective=f"{role} objective",
                output_redacted=f"{role} 摘要",
                total_cost_usd=0.3,
            )
            db_session.add(r)
        await db_session.commit()

        result = await svc.schedule_loop(mission.id)

        # 全 completed worker + 无 patch → bootstrap 路径 → done
        assert result == "done"
        # 主 agent run 被强标 completed（原本 pending，巡检兜底收尾）
        await db_session.refresh(main_run)
        assert main_run.status == "completed"

    @pytest.mark.asyncio
    async def test_signal3_budget_exceeded_force_converges_degraded(
        self, db_session: AsyncSession
    ) -> None:
        """信号 3：cost_so_far >= budget_usd → 强制 converge，status=degraded。

        worker 仍 running 但预算已触顶 → schedule_loop 强收（design §7 信号 3）。
        """
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=1.0,  # 低预算
            worker_preset=None,
            main_agent_config=None,
        )
        # 一个 running worker，cost 已超预算
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            role="arch",
            objective="扫描",
            total_cost_usd=1.5,  # >= 1.0 触顶
            output_redacted="架构摘要",
        )
        db_session.add(worker)
        await db_session.commit()

        result = await svc.schedule_loop(mission.id)

        # budget 触顶强收 → degraded（forced_degraded 覆盖 derive 结果）
        assert result == "degraded"
        # 主 agent run 被强标 failed（budget 强收语义，非正常完成）
        await db_session.refresh(main_run)
        assert main_run.status == "failed"
        # 烧钱的 worker 被 kill（停损）
        await db_session.refresh(worker)
        assert worker.status == "killed"

    @pytest.mark.asyncio
    async def test_cancelled_mission_skipped(self, db_session: AsyncSession) -> None:
        """cancelled mission → schedule_loop 跳过（control.cancel 已终态化，不重复收敛）。"""
        from datetime import UTC, datetime

        from app.modules.agent.model import AgentMission

        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, _main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=None,
            worker_preset=None,
            main_agent_config=None,
        )
        # 标 cancelled
        mission = await db_session.get(AgentMission, mission.id)
        mission.cancelled_at = datetime.now(UTC)
        db_session.add(mission)
        await db_session.commit()

        result = await svc.schedule_loop(mission.id)
        assert result is None

    @pytest.mark.asyncio
    async def test_missing_main_run_returns_none(self, db_session: AsyncSession) -> None:
        """主 agent run 不存在（mission 损坏 / single 误调）→ 无法走收敛锚点，跳过。"""
        from app.modules.agent.model import AgentMission

        ws_id = await _make_workspace(db_session)
        # 直接建 mission（不经 team_mission_entry，无主 agent run）
        mission = AgentMission(
            workspace_id=ws_id,
            objective="裸 mission",
            budget_usd=10.0,
        )
        db_session.add(mission)
        await db_session.commit()
        # 加一个 completed worker（满足信号 1，但缺主 agent run 锚点）
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="completed",
            role="arch",
            objective="扫描",
            output_redacted="摘要",
        )
        db_session.add(worker)
        await db_session.commit()

        svc = OrchestratorService(db_session)
        result = await svc.schedule_loop(mission.id)
        assert result is None
