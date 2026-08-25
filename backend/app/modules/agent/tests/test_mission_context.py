"""mission_context helper 测试（2026-08-24-session-team-mission-context task-06 / FR-01）。

覆盖任务卡 acceptance（D-013@v1 一次性语义判定层 / D-002@v1 简报仅首轮一次 /
D-003@v1 懒建回填不补简报）：

- 主干：活跃 mission + 非空 prompt + 无 orchestrator run → resolve 命中返回简报文本。
- 边界一（D-013）：空/纯空白 prompt 判定不命中且不消耗——下一条带文本消息仍命中。
- 边界二（D-013）：failed / killed orchestrator run 不烧断——首轮派发失败后重注。
- 边界三（D-003）：懒建回填的 pending orchestrator run（agent_session_id 落列）天然短路。
- 一次性（D-002）：pending / running / completed 任一 orchestrator run 存在 → 不再命中；
  非 orchestrator role 的活跃 run 不影响判定。
- 简报组装：build/resolve 产出复用 task-01 render_session_orchestrator_briefing 的
  特征段（mission_id / 锚点工作区 / scope 条目含机器名+在线+模式 / dispatch_worker
  用法 / mission_status 提示）；session 缺失防御分支抛 ValueError 不静默返空；
  delegate 不可得降级 git_probe=None（scope 无模式字段，不抛）。
- 无活跃 mission → resolve_first_turn_briefing 返回 None（无 mission 普通会话锚点）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.mission_context import (
    build_orchestrator_briefing,
    resolve_first_turn_briefing,
    should_inject_first_turn_briefing,
)
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.agent.orchestrator import render_session_orchestrator_briefing
from app.modules.daemon.host_fs.delegate import HostFsDelegate, HostFsDelegateUnavailable
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace


async def _make_workspace(session: AsyncSession, name: str | None = None) -> Workspace:
    """建一个真实 Workspace 行，返回 ORM 对象（id 供 scope/锚点断言）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=name or f"ws-{uuid.uuid4().hex[:8]}",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex}",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _seed_agent_session(session: AsyncSession, workspace_id: uuid.UUID) -> AgentSession:
    """建 AgentSession（绑定锚点工作区），返回会话行。"""
    agent_session = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        workspace_id=workspace_id,
    )
    session.add(agent_session)
    await session.commit()
    await session.refresh(agent_session)
    return agent_session


async def _seed_active_mission(
    session: AsyncSession,
    agent_session: AgentSession,
    *,
    scope_workspace_ids: list[str] | None = None,
) -> AgentMission:
    """建会话活跃 mission（session_id 落列，converged/cancelled 均 NULL）。"""
    mission = AgentMission(
        workspace_id=agent_session.workspace_id,
        objective="会话团队任务",
        session_id=agent_session.id,
        scope_workspace_ids=scope_workspace_ids,
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission


async def _seed_orchestrator_run(
    session: AsyncSession,
    mission: AgentMission,
    *,
    status: str,
    agent_session_id: uuid.UUID | None = None,
) -> AgentRun:
    """建 mission 的 orchestrator run（role='orchestrator'，状态入参）。"""
    run = AgentRun(
        mission_id=mission.id,
        agent_type="claude_code",
        provider="claude",
        status=status,
        role="orchestrator",
        agent_session_id=agent_session_id,
    )
    session.add(run)
    await session.commit()
    return run


async def _make_binding_with_online_daemon(
    session: AsyncSession, workspace_id: uuid.UUID, *, alias: str = "主控机"
) -> None:
    """建 workspace binding + 在线 daemon 行（简报 scope 机器名/在线断言用）。

    与 test_mission_status 同款 ORM 播种：binding 属主 user_id 与 daemon 行
    user_id 一致，满足 query_daemon_online_by_id 的属主校验（BE-P1-5 口径）。
    """
    from app.modules.daemon.model import DaemonInstance

    user_id = uuid.uuid4()
    daemon_id = uuid.uuid4()
    session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace_id,
            user_id=user_id,
            daemon_id=daemon_id,
            shared=False,
            root_path=f"/tmp/ws-{workspace_id.hex[:8]}",
            path_source="member",
        )
    )
    session.add(
        DaemonInstance(
            id=daemon_id,
            user_id=user_id,
            hostname=f"host-{daemon_id.hex[:8]}",
            display_alias=alias,
            server_url="http://localhost:8001",
            status="online",
        )
    )
    await session.commit()


def _patch_git_probe(monkeypatch: pytest.MonkeyPatch, mode: str = "direct") -> None:
    """patch 真实 HostFsDelegate 的探测方法（与 test_mission_status 同款接线 seam）。"""

    async def _fake_probe(self: HostFsDelegate, workspace: Workspace) -> str:
        return mode

    monkeypatch.setattr(HostFsDelegate, "probe_workspace_git_mode", _fake_probe)


class TestShouldInjectFirstTurnBriefing:
    async def test_none_mission_returns_false(self, db_session: AsyncSession) -> None:
        """条件①：mission 为 None（无活跃 mission）→ 不命中。"""
        assert await should_inject_first_turn_briefing(db_session, None, "开始干活") is False

    @pytest.mark.parametrize("blank_prompt", ["", "   ", "\n\t  \n"])
    async def test_blank_prompt_misses_and_does_not_burn(
        self, db_session: AsyncSession, blank_prompt: str
    ) -> None:
        """边界一（D-013/CC-12）：纯空白 prompt 不注入不消耗——后续首条带文本消息仍命中。"""
        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        mission = await _seed_active_mission(db_session, agent_session)

        assert await should_inject_first_turn_briefing(db_session, mission, blank_prompt) is False
        # 空白轮不落任何已消耗 run（判定纯查询无副作用）——同库同 mission 下一条
        # 带文本消息仍命中（一次性名额未烧）。
        assert await should_inject_first_turn_briefing(db_session, mission, "开工") is True

    @pytest.mark.parametrize("consumed_status", ["pending", "running", "completed"])
    async def test_consumed_statuses_miss(
        self, db_session: AsyncSession, consumed_status: str
    ) -> None:
        """一次性（D-002@v1）：已消耗集合 {pending, running, completed} 任一存在 → 不命中。"""
        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        mission = await _seed_active_mission(db_session, agent_session)
        await _seed_orchestrator_run(db_session, mission, status=consumed_status)

        assert await should_inject_first_turn_briefing(db_session, mission, "继续推进") is False

    @pytest.mark.parametrize("retryable_status", ["failed", "killed"])
    async def test_failed_and_killed_do_not_burn(
        self, db_session: AsyncSession, retryable_status: str
    ) -> None:
        """边界二（D-013）：failed/killed 落已消耗集合外——首轮失败后下一条消息重注。"""
        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        mission = await _seed_active_mission(db_session, agent_session)
        await _seed_orchestrator_run(db_session, mission, status=retryable_status)

        assert await should_inject_first_turn_briefing(db_session, mission, "重试") is True

    async def test_lazy_backfilled_pending_run_short_circuits(
        self, db_session: AsyncSession
    ) -> None:
        """边界三（D-003）：懒建回填的 orchestrator run 为 pending（agent_session_id 落列）
        → 判定天然短路，懒建轮不补简报。"""
        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        mission = await _seed_active_mission(db_session, agent_session)
        await _seed_orchestrator_run(
            db_session, mission, status="pending", agent_session_id=agent_session.id
        )

        assert await should_inject_first_turn_briefing(db_session, mission, "继续") is False

    async def test_non_orchestrator_role_run_ignored(self, db_session: AsyncSession) -> None:
        """口径锚点：已消耗集合只看 role='orchestrator'——worker run 活跃不影响判定。"""
        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        mission = await _seed_active_mission(db_session, agent_session)
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="running",
                role="arch",
                objective="扫描架构",
            )
        )
        await db_session.commit()

        assert await should_inject_first_turn_briefing(db_session, mission, "派活") is True


class TestBuildOrchestratorBriefing:
    async def test_briefing_contains_render_feature_sections(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """简报组装复用 task-01 渲染：mission_id/锚点工作区/scope 条目（机器名+在线+模式）
        /dispatch_worker 用法/mission_status 提示段（本卡不重复实现文案，只断言特征段）。"""
        anchor_ws = await _make_workspace(db_session, name="锚点仓")
        second_ws = await _make_workspace(db_session, name="前端仓")
        agent_session = await _seed_agent_session(db_session, anchor_ws.id)
        mission = await _seed_active_mission(
            db_session,
            agent_session,
            scope_workspace_ids=[str(anchor_ws.id), str(second_ws.id)],
        )
        await _make_binding_with_online_daemon(db_session, second_ws.id, alias="开发机A")
        _patch_git_probe(monkeypatch, mode="direct")

        briefing = await build_orchestrator_briefing(db_session, mission)

        assert "团队任务简报" in briefing
        assert str(mission.id) in briefing
        assert "锚点工作区: 锚点仓" in briefing
        assert "前端仓" in briefing
        assert "机器=开发机A" in briefing
        assert "daemon=在线" in briefing
        assert "模式=直通" in briefing
        assert "dispatch_worker" in briefing
        assert "mission_status 工具" in briefing
        assert "禁止越权" in briefing

    async def test_missing_session_row_raises_value_error(self, db_session: AsyncSession) -> None:
        """防御分支：mission.session_id 指向不存在的会话 → 抛 ValueError，不静默返空串。"""
        ws = await _make_workspace(db_session)
        mission = AgentMission(
            workspace_id=ws.id,
            objective="孤儿 mission",
            session_id=uuid.uuid4(),  # 无对应 AgentSession 行
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)

        with pytest.raises(ValueError, match="AgentSession"):
            await build_orchestrator_briefing(db_session, mission)

    async def test_delegate_unavailable_degrades_to_no_mode_field(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """降级路径：delegate 构造不可得（HostFsDelegateUnavailable）→ git_probe=None，
        简报 scope 条目省略模式字段，不抛（探测接线失败不断简报主链路）。"""
        import app.modules.agent.mission_context as mc

        def _raise_unavailable(session: AsyncSession) -> HostFsDelegate:
            raise HostFsDelegateUnavailable("ws_rpc 未接线（测试模拟）")

        monkeypatch.setattr(mc, "new_host_fs_delegate", _raise_unavailable)
        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        mission = await _seed_active_mission(
            db_session, agent_session, scope_workspace_ids=[str(ws.id)]
        )

        briefing = await build_orchestrator_briefing(db_session, mission)

        assert str(mission.id) in briefing
        assert "模式=" not in briefing


class TestResolveFirstTurnBriefing:
    async def test_hit_returns_briefing_text(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """主干：活跃 mission + 非空 prompt + 无 orchestrator run → 返回简报文本。"""
        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        mission = await _seed_active_mission(
            db_session, agent_session, scope_workspace_ids=[str(ws.id)]
        )
        _patch_git_probe(monkeypatch, mode="git")

        briefing = await resolve_first_turn_briefing(db_session, agent_session.id, "组建团队")

        assert briefing is not None
        assert str(mission.id) in briefing
        assert "模式=git隔离" in briefing

    async def test_no_active_mission_returns_none(self, db_session: AsyncSession) -> None:
        """无 mission 普通会话锚点：无活跃 mission → None（行为不变的判定层锚点）。"""
        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)

        assert await resolve_first_turn_briefing(db_session, agent_session.id, "普通对话") is None

    async def test_consumed_mission_returns_none(self, db_session: AsyncSession) -> None:
        """一次性端到端：存在 completed orchestrator run → resolve 返回 None。"""
        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        mission = await _seed_active_mission(db_session, agent_session)
        await _seed_orchestrator_run(db_session, mission, status="completed")

        assert await resolve_first_turn_briefing(db_session, agent_session.id, "下一轮") is None

    async def test_blank_prompt_returns_none_then_next_text_hits(
        self, db_session: AsyncSession
    ) -> None:
        """边界一端到端（D-013）：纯切换轮 resolve 返回 None；下一条带文本消息返回简报。"""
        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        await _seed_active_mission(db_session, agent_session)

        assert await resolve_first_turn_briefing(db_session, agent_session.id, "  \n") is None
        briefing = await resolve_first_turn_briefing(db_session, agent_session.id, "现在开始")
        assert briefing is not None


class TestBriefingTokenBudget:
    async def test_scope5_briefing_within_1500_token_budget(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """简报 token 量化（R-01 / task-14）：scope=5 工作区（每区有机器名+在线+模式字段，
        即渲染最verbose形态）的 mission 简报 ≤ 1500 token。

        token 估算口径（粗估，写死在断言旁）：
        - 上界口径：中文 char ≈ 1 token，ASCII char 实际 < 1 token 但按 1 计——
          即 estimated_tokens_upper = len(text)，这是对真实分词的保守上界；
        - 参考口径：len(text) // 3（纯 ASCII 惯用 3 char/token，对中文低估，仅作参考）。
        上界口径下仍 ≤ 1500 即认定达标（真实 tokenizer 只会更少）。
        """
        scope_workspaces = [
            await _make_workspace(db_session, name="平台主仓"),
            await _make_workspace(db_session, name="前端协作仓"),
            await _make_workspace(db_session, name="daemon 适配仓"),
            await _make_workspace(db_session, name="文档站仓"),
            await _make_workspace(db_session, name="部署脚本仓"),
        ]
        for ws in scope_workspaces:
            await _make_binding_with_online_daemon(db_session, ws.id, alias=f"开发机{ws.name[:2]}")
        _patch_git_probe(monkeypatch, mode="git")  # 模式字段渲染（最长形态）

        agent_session = await _seed_agent_session(db_session, scope_workspaces[0].id)
        mission = await _seed_active_mission(
            db_session,
            agent_session,
            scope_workspace_ids=[str(ws.id) for ws in scope_workspaces],
        )

        async def _probe(ws: Workspace) -> str:
            return "git"

        briefing = await render_session_orchestrator_briefing(mission, db_session, git_probe=_probe)

        assert "派发范围" in briefing, "前置自检：5 工作区 scope 段确实渲染（防空 scope 假绿）"
        assert briefing.count("机器=") == 5
        estimated_tokens_upper = len(briefing)
        assert estimated_tokens_upper <= 1500, (
            f"scope=5 简报 token 上界 {estimated_tokens_upper} 超 R-01 预算 1500"
            f"（参考 len//3 口径 ≈ {len(briefing) // 3}）"
        )


# ---------------------------------------------------------------------------
# ql-20260825-003：分身全部完成 → 系统通知唤醒主控（判定 + 幂等投递）
# ---------------------------------------------------------------------------


class TestWorkersDoneNotify:
    async def test_workers_all_terminal_with_stats(self, db_session):
        """全终态判定 + 成败统计（planning 空集 / 有非终态 → False）。"""
        from app.modules.agent.mission_context import workers_all_terminal_with_stats

        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)
        mission = await _seed_active_mission(db_session, agent_session)
        await _seed_orchestrator_run(db_session, mission, status="completed")
        from app.modules.agent.model import AgentRun as _Run

        async def _worker(status):
            r = _Run(
                mission_id=mission.id,
                agent_type="claude_code",
                status=status,
                role="impl",
                objective="x",
            )
            db_session.add(r)
            await db_session.commit()
            return r

        await _worker("completed")
        await _worker("failed")
        done, ok, bad = await workers_all_terminal_with_stats(db_session, mission)
        assert (done, ok, bad) == (True, 1, 1)

        m2_sess = await _seed_agent_session(db_session, ws.id)
        mission2 = await _seed_active_mission(db_session, m2_sess)
        r_running = _Run(
            mission_id=mission2.id,
            agent_type="claude_code",
            status="running",
            role="impl",
            objective="x",
        )
        db_session.add(r_running)
        await db_session.commit()
        done2, _, _ = await workers_all_terminal_with_stats(db_session, mission2)
        assert done2 is False

        m3_sess = await _seed_agent_session(db_session, ws.id)
        mission3 = await _seed_active_mission(db_session, m3_sess)
        done3, _, _ = await workers_all_terminal_with_stats(db_session, mission3)
        assert done3 is False

    async def test_notify_idempotent_and_prompt_shape(self, db_session, monkeypatch):
        """SETNX 抢到才投递一次；二次调用（锁已占）直接 False；prompt 含系统通知标记。"""
        from app.modules.agent import mission_context as mc

        ws = await _make_workspace(db_session)
        agent_session = await _seed_agent_session(db_session, ws.id)

        class _FakeRedis:
            def __init__(self):
                self.keys = {}

            async def set(self, key, val, nx=None, ex=None):
                if nx and key in self.keys:
                    return None
                self.keys[key] = val
                return True

        fake_redis = _FakeRedis()
        import app.core.redis as _redis_mod

        monkeypatch.setattr(_redis_mod, "get_redis", lambda: fake_redis)

        injected = []

        class _FakeSessionService:
            def __init__(self, db):
                pass

            async def inject_session_as_service(self, session_id, *, prompt):
                injected.append((session_id, prompt))

        import app.modules.daemon.session.service as _svc_mod

        monkeypatch.setattr(_svc_mod, "SessionService", _FakeSessionService)

        ok1 = await mc.notify_orchestrator_workers_done(
            agent_session.id, agent_session.id, completed=2, failed=1
        )
        assert ok1 is True and len(injected) == 1
        assert "系统通知·团队任务" in injected[0][1]
        assert "成功 2" in injected[0][1] and "失败 1" in injected[0][1]

        ok2 = await mc.notify_orchestrator_workers_done(
            agent_session.id, agent_session.id, completed=2, failed=1
        )
        assert ok2 is False and len(injected) == 1
