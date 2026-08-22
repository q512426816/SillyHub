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

task-08（2026-08-22-team-session-unify / design §5 Phase 1 patrol 适配 / D-008）追加：
- ``schedule_loop`` 会话 mission 分流：主控轮为短生命周期 turn run，三重收敛信号
  按 session 维度判定主控存续——不强改主控轮状态、不触发 converge（收敛入口仅
  MCP converge 与 patrol awaiting_input 超时，task-06 契约）；收敛锚点=最新
  orchestrator run（与 task-06 一致）；存量 external 链路零回归。
- ``redispatch_pending_main_runs`` 候选过滤会话 mission（显式 no-op），存量
  external 重派行为保留。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.agent.orchestrator import (
    OrchestratorService,
    _resolve_main_agent_config,
)
from app.modules.agent.placement import RunPlacementService


async def _fake_converge(session, run_id, glm_config=None):
    """Stub converge——schedule_loop 末尾的 mission 收敛副作用。

    ``converge_mission_for_completed_run`` 内部构造 FinalizerService（经
    ``new_host_fs_delegate`` 调 git_merge RPC 无 daemon 真等超时）+ GLM httpx
    （120s timeout），本文件多个 schedule_loop 测试单跑偶发 8~34s（top30 慢点，
    2026-08-12 ql-004 修 lease 同款根因）。本测试只测 schedule_loop 状态机，
    converge 返回值 ``done`` 走 done 断言分支，副作用属不必要等待，统一 mock。
    """
    return "done"


@pytest.fixture(autouse=True)
def _mock_converge(monkeypatch: pytest.MonkeyPatch) -> None:
    """module 级 autouse：所有用例不真跑 finalizer converge（RPC/httpx 等待）。

    schedule_loop 在函数体内 ``from app.modules.agent.finalizer import
    converge_mission_for_completed_run``——访问的是 finalizer 模块属性，patch
    finalizer 模块符号即命中。
    """
    import app.modules.agent.finalizer as _finalizer_mod

    monkeypatch.setattr(_finalizer_mod, "converge_mission_for_completed_run", _fake_converge)


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


async def _mark_main_run_zombie(
    session: AsyncSession,
    mission: AgentMission,
    main_run: AgentRun,
    *,
    minutes_ago: float | None = None,
) -> None:
    """把 main_run 标成 patrol 判死后状态（failed + error_code=orchestrator_zombie，
    design §2.3 判死语义，task-05 落地）；minutes_ago 非 None 时同步写
    constraints.zombie_marked_at（距今 minutes_ago 分钟的 ISO 时间戳）。"""
    main_run.status = "failed"
    main_run.error_code = "orchestrator_zombie"
    if minutes_ago is not None:
        constraints = dict(mission.constraints or {})
        constraints["zombie_marked_at"] = (
            datetime.now(UTC) - timedelta(minutes=minutes_ago)
        ).isoformat()
        mission.constraints = constraints
        session.add(mission)
    session.add(main_run)
    await session.commit()


async def _converge_and_mark(session, run_id, glm_config=None):
    """Stub converge——在 _fake_converge 基础上把 mission.converged_at 落库，供
    豁免用例区分「真收敛 / 未收敛」（autouse 的 _fake_converge 不写库，
    converged_at 恒 None，无法断言收敛副作用）。"""
    run = await session.get(AgentRun, run_id)
    if run is not None and run.mission_id is not None:
        mission = await session.get(AgentMission, run.mission_id)
        if mission is not None:
            mission.converged_at = datetime.now(UTC)
            session.add(mission)
            await session.commit()
    return "done"


def _patch_converge_to_mark(monkeypatch: pytest.MonkeyPatch) -> None:
    """覆盖 autouse 的 _fake_converge，改用会写 converged_at 的 _converge_and_mark。"""
    import app.modules.agent.finalizer as _finalizer_mod

    monkeypatch.setattr(_finalizer_mod, "converge_mission_for_completed_run", _converge_and_mark)


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
    async def test_main_agent_config_extracts_agent_profile_id(
        self, db_session: AsyncSession
    ) -> None:
        """task-12：main_agent_config.agent_profile_id 合法 UUID → 原样返回；缺失/非法 → None。"""
        pid = uuid.uuid4()
        cfg_ok = _resolve_main_agent_config(
            {"agent_type": "claude_code", "agent_profile_id": str(pid)}
        )
        assert cfg_ok["agent_profile_id"] == pid

        # 缺失 → None（不阻断兜底链）
        cfg_missing = _resolve_main_agent_config({"provider": "claude"})
        assert cfg_missing["agent_profile_id"] is None

        # None 输入 → None
        assert _resolve_main_agent_config(None)["agent_profile_id"] is None

        # 非法字符串 → None（不抛错，走原路径零回归）
        cfg_bad = _resolve_main_agent_config({"agent_profile_id": "not-a-uuid"})
        assert cfg_bad["agent_profile_id"] is None

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


class TestScheduleLoopZombieExemption:
    """task-08：schedule_loop 信号 1 zombie 豁免（D-004 两阶段复活 / D-006 纯 DB 时间窗）。

    主 run error_code=orchestrator_zombie（patrol 判死写入，全库新值）+ 复活窗口
    未耗尽 → 信号 1 不收敛（return None 等 patrol 复活）；窗口耗尽 / 标记缺失非法
    / 非 zombie error_code → 原逻辑照常收敛；信号 3（预算触顶）是治理强收，
    优先级高于复活等待，不豁免。
    """

    @pytest.mark.asyncio
    async def test_zombie_within_window_signal1_exempted(self, db_session: AsyncSession) -> None:
        """窗口内 zombie：worker 全 completed（信号 1 达成）但主 run 判死未满复活
        窗口 → return None 不收敛——main_run 不被强标、mission.converged_at 仍空。"""
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
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="completed",
            role="arch",
            objective="扫描",
            output_redacted="架构摘要",
            total_cost_usd=0.3,
        )
        db_session.add(worker)
        # marked_at = now - window/2：对任意合法 revive_window 配置都在窗口内
        window = get_settings().mission_patrol_revive_window_minutes
        await _mark_main_run_zombie(db_session, mission, main_run, minutes_ago=window / 2)

        result = await svc.schedule_loop(mission.id)

        assert result is None
        await db_session.refresh(main_run)
        assert main_run.status == "failed"  # 未被信号 1 强标 completed
        assert main_run.error_code == "orchestrator_zombie"
        mission_fresh = await db_session.get(AgentMission, mission.id)
        assert mission_fresh.converged_at is None

    @pytest.mark.asyncio
    async def test_zombie_window_exhausted_converges(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """窗口耗尽：豁免到期自然解除，信号 1 原逻辑照常收敛（done + converged_at 落库）。"""
        _patch_converge_to_mark(monkeypatch)
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
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="completed",
            role="impl",
            objective="实现",
            output_redacted="实现摘要",
            total_cost_usd=0.3,
        )
        db_session.add(worker)
        # marked_at = now - (window + 5min)：窗口必然已耗尽
        window = get_settings().mission_patrol_revive_window_minutes
        await _mark_main_run_zombie(db_session, mission, main_run, minutes_ago=window + 5)

        result = await svc.schedule_loop(mission.id)

        assert result == "done"
        mission_fresh = await db_session.get(AgentMission, mission.id)
        assert mission_fresh.converged_at is not None

    @pytest.mark.asyncio
    async def test_zombie_window_budget_exceeded_still_forces_degraded(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """信号 3 不豁免：预算触顶强收优先级高于复活等待——主 run zombie 窗口内
        仍 degraded 强收，烧钱 worker 被 kill。"""
        _patch_converge_to_mark(monkeypatch)
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
        window = get_settings().mission_patrol_revive_window_minutes
        await _mark_main_run_zombie(db_session, mission, main_run, minutes_ago=window / 2)

        result = await svc.schedule_loop(mission.id)

        assert result == "degraded"
        await db_session.refresh(worker)
        assert worker.status == "killed"
        mission_fresh = await db_session.get(AgentMission, mission.id)
        assert mission_fresh.converged_at is not None

    @pytest.mark.asyncio
    async def test_non_zombie_error_code_not_exempted(self, db_session: AsyncSession) -> None:
        """error_code=no_online_daemon（既有值，非 zombie）→ 豁免不触发，信号 1
        原逻辑照常收敛（既有调用方零回归）。"""
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
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="completed",
            role="arch",
            objective="扫描",
            output_redacted="架构摘要",
            total_cost_usd=0.3,
        )
        db_session.add(worker)
        main_run.status = "pending"
        main_run.error_code = "no_online_daemon"  # 既有 error_code 值
        db_session.add(main_run)
        await db_session.commit()

        result = await svc.schedule_loop(mission.id)

        assert result == "done"
        await db_session.refresh(main_run)
        assert main_run.status == "completed"  # 信号 1 照常强标（豁免未挡）

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "constraints",
        [
            {"mode": "team"},  # zombie_marked_at 缺失
            {"mode": "team", "zombie_marked_at": "not-an-iso-timestamp"},  # 非法 ISO
            None,  # constraints 为 None
        ],
        ids=["missing", "invalid-iso", "constraints-none"],
    )
    async def test_zombie_marked_at_missing_or_invalid_not_exempted(
        self, db_session: AsyncSession, constraints: dict | None
    ) -> None:
        """zombie_marked_at 缺失 / 非法 ISO / constraints 为 None → 不猜时间，
        豁免不成立，信号 1 原逻辑照常收敛。"""
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints=constraints,
            budget_usd=10.0,
            worker_preset=None,
            main_agent_config=None,
        )
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="completed",
            role="arch",
            objective="扫描",
            output_redacted="架构摘要",
            total_cost_usd=0.3,
        )
        db_session.add(worker)
        # 只标 run 侧判死态（error_code=zombie），constraints 不动（参数即被测态）
        await _mark_main_run_zombie(db_session, mission, main_run)

        result = await svc.schedule_loop(mission.id)

        assert result == "done"


async def _make_session_mission(
    session: AsyncSession,
    ws_id: uuid.UUID,
    *,
    budget_usd: float | None = None,
) -> tuple[AgentMission, AgentSession]:
    """建真实 AgentSession + 绑定它的会话 mission（task-08 会话维度判定对象）。

    会话 mission 判别口径与 finalizer / patrol 一致：mission.session_id 指向
    真实存在的 AgentSession 行（存量 external 的随机 uuid 查无此行 → 走原链路）。
    """
    agent_session = AgentSession(
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
    )
    session.add(agent_session)
    mission = AgentMission(
        workspace_id=ws_id,
        session_id=agent_session.id,
        objective="会话团队目标",
        constraints={"mode": "team"},
        budget_usd=budget_usd,
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission, agent_session


async def _make_run(
    session: AsyncSession,
    mission_id: uuid.UUID | None,
    *,
    status: str,
    role: str | None,
    agent_session_id: uuid.UUID | None = None,
    created_at: datetime | None = None,
    cost: float = 0.0,
) -> AgentRun:
    """建一条 AgentRun（主控轮 / 分身通用，role 可 None 覆盖存量形态）。"""
    extra: dict = {}
    if created_at is not None:
        extra["created_at"] = created_at
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status=status,
        role=role,
        objective="run objective",
        total_cost_usd=cost,
        agent_session_id=agent_session_id,
        **extra,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _patch_converge_recorder(
    monkeypatch: pytest.MonkeyPatch,
) -> list[tuple[uuid.UUID, bool]]:
    """覆盖 autouse _mock_converge：记录 (run_id, converge_explicit) 的 converge 桩。

    不写任何库副作用（会话 mission 用例断言「零收敛副作用」；external 锚点用例
    只关心 run_id 参数）。
    """
    import app.modules.agent.finalizer as _finalizer_mod

    calls: list[tuple[uuid.UUID, bool]] = []

    async def _recording_converge(session, run_id, glm_config=None, *, converge_explicit=False):
        calls.append((run_id, converge_explicit))
        return "done"

    monkeypatch.setattr(_finalizer_mod, "converge_mission_for_completed_run", _recording_converge)
    return calls


class TestScheduleLoopSessionDimension:
    """task-08：schedule_loop 会话 mission 分流（design §5 Phase 1 / D-008）。

    会话 mission 主控轮=短生命周期 turn run，主控存续按「会话活跃 turn」判定：
    schedule_loop 对会话 mission 整体 no-op（不强改主控轮状态 / 不 kill worker /
    不触发 converge），收敛入口仅 MCP converge 与 patrol awaiting_input 超时
    （task-06 契约——finalizer 非显式路径对会话 mission 已不自动收敛）。
    """

    @pytest.mark.asyncio
    async def test_session_mission_all_terminal_no_converge_no_mutation(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """会话 mission 分身全终态（存量信号 1 场景）→ return None；主控轮终态
        不被强改、converge 不被调、converged_at 不落库（awaiting_input 窗口保留）。"""
        calls = _patch_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        mission, agent_session = await _make_session_mission(db_session, ws_id)
        turn_run = await _make_run(
            db_session,
            mission.id,
            status="completed",
            role="orchestrator",
            agent_session_id=agent_session.id,
        )
        await _make_run(db_session, mission.id, status="completed", role="arch")

        result = await OrchestratorService(db_session).schedule_loop(mission.id)

        assert result is None
        assert calls == [], "会话 mission 不得经 schedule_loop 收敛（task-06 契约）"
        await db_session.refresh(turn_run)
        assert turn_run.status == "completed", "主控轮终态不得被强改"
        mission_fresh = await db_session.get(AgentMission, mission.id)
        assert mission_fresh.converged_at is None

    @pytest.mark.asyncio
    async def test_session_mission_running_turn_run_untouched(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """主控轮当轮 running（会话活跃 turn）+ 分身全终态 → return None；running
        主控轮不被标终态（存量信号 1 会强标 completed——会话链路禁用）。"""
        calls = _patch_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        mission, agent_session = await _make_session_mission(db_session, ws_id)
        turn_run = await _make_run(
            db_session,
            mission.id,
            status="running",
            role="orchestrator",
            agent_session_id=agent_session.id,
        )
        await _make_run(db_session, mission.id, status="completed", role="arch")

        result = await OrchestratorService(db_session).schedule_loop(mission.id)

        assert result is None
        assert calls == []
        await db_session.refresh(turn_run)
        assert turn_run.status == "running", "running 主控轮不得被巡检强改状态"

    @pytest.mark.asyncio
    async def test_session_mission_budget_exceeded_no_force_kill(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """会话 mission 预算触顶（存量信号 3 场景）→ 不强收：worker 不被 kill、
        主控轮不动、不 converge（预算拒新派已由 can_dispatch_worker 治理，收尾
        走 MCP converge / patrol 超时）。"""
        calls = _patch_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        mission, agent_session = await _make_session_mission(db_session, ws_id, budget_usd=1.0)
        turn_run = await _make_run(
            db_session,
            mission.id,
            status="completed",
            role="orchestrator",
            agent_session_id=agent_session.id,
        )
        worker = await _make_run(db_session, mission.id, status="running", role="arch", cost=1.5)

        result = await OrchestratorService(db_session).schedule_loop(mission.id)

        assert result is None
        assert calls == []
        await db_session.refresh(worker)
        assert worker.status == "running", "会话 mission 分身不经 schedule_loop 强杀"
        await db_session.refresh(turn_run)
        assert turn_run.status == "completed"
        mission_fresh = await db_session.get(AgentMission, mission.id)
        assert mission_fresh.converged_at is None

    @pytest.mark.asyncio
    async def test_session_mission_without_orchestrator_run_returns_none(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """会话 mission 尚无主控轮回填（planning：预建后未 inject）→ return None，
        不抛错（存量无主 run 锚点跳过语义对会话链路同样成立）。"""
        calls = _patch_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        mission, _agent_session = await _make_session_mission(db_session, ws_id)

        result = await OrchestratorService(db_session).schedule_loop(mission.id)

        assert result is None
        assert calls == []

    @pytest.mark.asyncio
    async def test_external_anchor_is_latest_orchestrator_run(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """锚点=最新 orchestrator run（task-06 一致）：存量 external 多主控 run 时
        收敛锚定 created_at 最新一条。"""
        calls = _patch_converge_recorder(monkeypatch)
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        mission, old_main = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=10.0,
            worker_preset=None,
            main_agent_config=None,
        )
        await _make_run(db_session, mission.id, status="completed", role="arch")
        base = datetime.now(UTC)
        await _make_run(
            db_session,
            mission.id,
            status="completed",
            role="orchestrator",
            created_at=base + timedelta(minutes=10),
        )

        result = await svc.schedule_loop(mission.id)

        assert result == "done"
        assert len(calls) == 1
        assert calls[0][0] != old_main.id, "锚点不得取首条/旧主控 run"


class TestRedispatchSessionFilter:
    """task-08：redispatch_pending_main_runs 候选过滤会话 mission（显式 no-op）。

    会话链路主控轮由会话 lease 逐 turn 驱动，无「pending 主控 run +
    no_online_daemon」重派语义；存量 external/team 重派行为保留（零回归）。
    """

    @pytest.mark.asyncio
    async def test_session_mission_pending_main_run_skipped(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """会话 mission 的 pending+no_online_daemon 主控轮 run 不进重派候选。"""
        ws_id = await _make_workspace(db_session)
        mission, _agent_session = await _make_session_mission(db_session, ws_id)
        main_run = await _make_run(
            db_session,
            mission.id,
            status="pending",
            role="orchestrator",
        )
        main_run.error_code = "no_online_daemon"
        db_session.add(main_run)
        await db_session.commit()

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

        redispatched = await OrchestratorService(db_session).redispatch_pending_main_runs()

        assert redispatched == 0
        assert dispatch_calls == []
        await db_session.refresh(main_run)
        assert main_run.error_code == "no_online_daemon", "会话 mission 主控轮不被重派改写"

    @pytest.mark.asyncio
    async def test_external_pending_main_run_still_redispatched(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """存量 external/team（随机 session_id 查无会话行）重派行为保留：pending+
        no_online_daemon 主 run 在 daemon 可派时重派成功并清 error_code。"""
        ws_id = await _make_workspace(db_session)
        svc = OrchestratorService(db_session)
        # workspace 未绑 daemon → team_mission_entry 走 NoOnlineDaemonError 分支，
        # 主 run 落 pending + no_online_daemon（即重派候选形态）。
        _mission, main_run = await svc.team_mission_entry(
            workspace_id=ws_id,
            objective="团队目标",
            created_by=uuid.uuid4(),
            change_id=None,
            constraints={"mode": "team"},
            budget_usd=None,
            worker_preset=None,
            main_agent_config=None,
        )
        assert main_run.error_code == "no_online_daemon"

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

        redispatched = await svc.redispatch_pending_main_runs()

        assert redispatched == 1
        assert dispatch_calls == [main_run.id]
        await db_session.refresh(main_run)
        assert main_run.error_code is None


class TestOrchestratorPromptConstraint:
    """诊断 36b9b475：主 agent 派不出 worker 时自己下场写代码（越权），绕过
    worktree 隔离与 converge 合并。render_orchestrator_prompt 必须含越权硬约束——
    禁自写实现源码 / 写代码派 worker / worker 失败即收敛 / 仅 converge 冲突可 Edit。
    prompt 是软约束（LLM 自主决策），测试只断言约束关键词声明存在。
    """

    @pytest.mark.asyncio
    async def test_prompt_forbids_orchestrator_writing_implementation(
        self, db_session: AsyncSession
    ) -> None:
        from app.modules.agent.model import AgentMission, AgentRun
        from app.modules.agent.orchestrator import render_orchestrator_prompt

        ws_id = await _make_workspace(db_session)
        mission = AgentMission(workspace_id=ws_id, objective="团队目标")
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        run = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="pending",
            role="orchestrator",
        )
        db_session.add(run)
        await db_session.commit()
        await db_session.refresh(run)

        prompt = await render_orchestrator_prompt(mission, run, db_session)
        # 越权禁令关键词（软约束声明，存在即合规）
        assert "禁止" in prompt, "prompt 必须含越权禁令段"
        assert "dispatch_worker" in prompt
        assert "converge_mission" in prompt
