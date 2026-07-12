"""Tests for ``converge_mission`` 可重入冲突解决（task-06 / design §5.2 / §7.5 / R-07）。

覆盖可重入状态机四态：
- 成功路径（全 merged）→ 调 ``_cleanup_mission`` + 返 ``status=merged``。
- 冲突返 ``status=conflict`` + conflicts（主 agent 自己 SDK 解决）+ attempt +1。
- 重入（mock 第二次 ``_finalize_merge_for_mission`` 返全 merged）→ cleanup + merged。
- R-07 超限（attempt+1 > 上限仍有 conflict）→ ``status=failed_manual`` +
  mission.constraints.needs_manual（X-003 副本保留，简化不实际 abort）。

测试隔离策略：整体 mock ``converge_mission_for_completed_run``（既有链路，返 done）+
``_finalize_merge_for_mission``（task-05 契约 FinalizerMergeResult 透出）+
``_cleanup_mission``（task-07 契约 cleanup_mission）—— 不依赖 git_merge / host_fs delegate
（task-08 集成期接线）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent import mcp_tools
from app.modules.agent.mcp_tools import ConvergeResponse, converge_mission
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.workspace.model import Workspace


async def _seed_mission(session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID, AgentRun]:
    """建 workspace + mission（team 模式）+ 主 agent run（orchestrator，completed）。"""
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=f"ws-{ws_id.hex[:8]}",
        slug=f"ws-{ws_id.hex[:8]}",
        root_path=f"/tmp/{ws_id.hex}",
    )
    session.add(ws)
    await session.commit()

    mission = AgentMission(
        workspace_id=ws_id,
        objective="团队目标",
        constraints={"mode": "team"},
        worker_preset=[{"role": "impl", "agent_type": "claude_code", "objective": "写代码"}],
        main_agent_config={"agent_type": "claude_code", "provider": "claude"},
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)

    main_run = AgentRun(
        mission_id=mission.id,
        agent_type="claude_code",
        provider="claude",
        status="completed",
        role="orchestrator",
        objective="团队目标",
    )
    session.add(main_run)
    await session.commit()
    await session.refresh(main_run)
    return ws_id, mission.id, main_run


def _patch_converge_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    *,
    merge_results: list[tuple[list[str], list[dict]]],
    cleanup_calls: list[uuid.UUID],
) -> None:
    """统一 mock converge_mission 三个外部依赖。

    - ``converge_mission_for_completed_run``（既有链路，函数体内延迟 import 自
      ``finalizer``）→ patch 源 module ``finalizer``，返 ``"done"``。
    - ``_finalize_merge_for_mission``（task-05 契约透出）→ patch ``mcp_tools`` 模块属性。
    - ``_cleanup_mission``（task-07 契约）→ patch ``mcp_tools`` 模块属性。
    - ``GLMConfig.from_env`` → patch 源 module ``delegation`` 返 None（不走 HTTP）。
    """
    from app.modules.agent import delegation, finalizer
    from app.modules.agent import mcp_tools as mod

    async def _fake_converge_for_completed_run(session, run_id, cfg):  # type: ignore[no-untyped-def]
        return "done"

    merge_iter = iter(merge_results)

    async def _fake_finalize_merge(session, mission_id):  # type: ignore[no-untyped-def]
        try:
            return next(merge_iter)
        except StopIteration:
            # 重入次数超 merge_results 时返全 merged（成功终态）
            return (["workers/merged"], [])

    async def _fake_cleanup(session, mission_id):  # type: ignore[no-untyped-def]
        cleanup_calls.append(mission_id)

    # converge_mission_for_completed_run 在 endpoint 函数体内延迟 import（from finalizer
    # import），patch 源 module finalizer 才能生效（每次调用都 re-import 拿最新属性）。
    monkeypatch.setattr(
        finalizer, "converge_mission_for_completed_run", _fake_converge_for_completed_run
    )
    monkeypatch.setattr(mod, "_finalize_merge_for_mission", _fake_finalize_merge)
    monkeypatch.setattr(mod, "_cleanup_mission", _fake_cleanup)

    # GLMConfig 在函数体内延迟 import（from app.modules.agent.delegation），patch 源 module。
    class _FakeGLMConfig:
        @staticmethod
        def from_env():
            return None

    monkeypatch.setattr(delegation, "GLMConfig", _FakeGLMConfig)


class TestConvergeReentrant:
    @pytest.mark.asyncio
    async def test_success_path_calls_cleanup_and_returns_merged(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """用例 1：全 merged → status=merged + 调 cleanup_mission + converged=True。"""
        ws_id, mission_id, _main_run = await _seed_mission(db_session)
        cleanup_calls: list[uuid.UUID] = []
        _patch_converge_dependencies(
            monkeypatch,
            merge_results=[(["workers/aaa", "workers/bbb"], [])],
            cleanup_calls=cleanup_calls,
        )

        resp = await converge_mission(ws_id, mission_id, db_session, user=None)  # type: ignore[arg-type]

        assert isinstance(resp, ConvergeResponse)
        assert resp.status == "merged"
        assert resp.converged is True
        assert resp.merged_branches == ["workers/aaa", "workers/bbb"]
        assert resp.conflicts == []
        assert resp.attempt == 0
        assert cleanup_calls == [mission_id], "全 merged 必须调 cleanup_mission 清副本"

    @pytest.mark.asyncio
    async def test_conflict_returns_conflicts_to_main_agent(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """用例 2：冲突 → status=conflict + conflicts + attempt +1（不调 cleanup）。"""
        ws_id, mission_id, _main_run = await _seed_mission(db_session)
        cleanup_calls: list[uuid.UUID] = []
        conflicts = [
            {"file": "src/main.py", "marker_lines": [10, 20], "branch": "workers/aaa"},
        ]
        _patch_converge_dependencies(
            monkeypatch,
            merge_results=[(["workers/bbb"], conflicts)],
            cleanup_calls=cleanup_calls,
        )

        resp = await converge_mission(ws_id, mission_id, db_session, user=None)  # type: ignore[arg-type]

        assert resp.status == "conflict"
        assert resp.converged is False
        assert resp.merged_branches == ["workers/bbb"]
        assert resp.conflicts == conflicts
        assert resp.attempt == 1, "首次冲突 attempt 应从 0 自增到 1"
        assert cleanup_calls == [], "冲突时不应清副本（待主 agent 解决）"

        # 验证计数已落库（mission.constraints JSON）
        from sqlalchemy import select

        mission = (
            (await db_session.execute(select(AgentMission).where(AgentMission.id == mission_id)))
            .scalars()
            .first()
        )
        assert mission is not None
        assert (mission.constraints or {}).get("conflict_attempts") == 1

    @pytest.mark.asyncio
    async def test_reentry_after_resolution_succeeds(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """用例 3：重入——首次冲突，主 agent 解决后第二次 converge 返全 merged → cleanup。

        模拟主 agent SDK 解决冲突（git add）后再调 converge：第二次
        ``_finalize_merge_for_mission`` 返全 merged（已解决），状态机走 success 路径。
        """
        ws_id, mission_id, _main_run = await _seed_mission(db_session)
        cleanup_calls: list[uuid.UUID] = []
        conflicts = [{"file": "src/a.py", "marker_lines": [5], "branch": "workers/aaa"}]
        _patch_converge_dependencies(
            monkeypatch,
            # 第一次返冲突，第二次返全 merged（重入后已解决）
            merge_results=[(["workers/bbb"], conflicts), (["workers/aaa", "workers/bbb"], [])],
            cleanup_calls=cleanup_calls,
        )

        # 第一次调用：冲突
        resp1 = await converge_mission(ws_id, mission_id, db_session, user=None)  # type: ignore[arg-type]
        assert resp1.status == "conflict"
        assert resp1.attempt == 1
        assert cleanup_calls == []

        # 第二次调用：重入（主 agent 已 SDK 解决）
        resp2 = await converge_mission(ws_id, mission_id, db_session, user=None)  # type: ignore[arg-type]
        assert resp2.status == "merged"
        assert resp2.converged is True
        assert resp2.merged_branches == ["workers/aaa", "workers/bbb"]
        assert resp2.attempt == 1, "重入成功 attempt 不再自增（仍是首次冲突的计数）"
        assert cleanup_calls == [mission_id], "重入全 merged 后必须 cleanup"

    @pytest.mark.asyncio
    async def test_r07_exceed_returns_failed_manual(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """用例 4：R-07 超限——attempt+1 > 上限（默认 3）仍有 conflict → failed_manual。

        预置 mission.constraints.conflict_attempts=2（已尝试 2 轮），第 3 次冲突时
        attempts+1=3 不超 3；再 bump 到 3 后第 4 次调用（attempts+1=4>3）→ failed_manual。
        简化（task-06 决策）：不实际 git merge --abort，标 needs_manual 让用户手动处理。
        """
        ws_id, mission_id, _main_run = await _seed_mission(db_session)
        # 预置已累计 3 轮（attempts=3）→ 下次冲突 attempts+1=4 > 3 → 超限
        from sqlalchemy import select

        mission = (
            (await db_session.execute(select(AgentMission).where(AgentMission.id == mission_id)))
            .scalars()
            .first()
        )
        assert mission is not None
        mission.constraints = {"mode": "team", "conflict_attempts": 3}
        await db_session.commit()
        await db_session.refresh(mission)

        cleanup_calls: list[uuid.UUID] = []
        conflicts = [{"file": "src/b.py", "marker_lines": [1], "branch": "workers/ccc"}]
        _patch_converge_dependencies(
            monkeypatch,
            merge_results=[(["workers/ddd"], conflicts)],
            cleanup_calls=cleanup_calls,
        )

        resp = await converge_mission(ws_id, mission_id, db_session, user=None)  # type: ignore[arg-type]

        assert resp.status == "failed_manual"
        assert resp.converged is False
        assert resp.attempt == 3, "超限时 attempt 反映当前累计值（不再 +1 漂移）"
        assert resp.conflicts == conflicts
        assert cleanup_calls == [], "失败路径不清副本（X-003 保留排查）"

        # 验证 needs_manual 标记已落库
        mission_after = (
            (await db_session.execute(select(AgentMission).where(AgentMission.id == mission_id)))
            .scalars()
            .first()
        )
        assert mission_after is not None
        nm = (mission_after.constraints or {}).get("needs_manual")
        assert nm is not None and "R-07" in nm.get("reason", "")

    @pytest.mark.asyncio
    async def test_r07_max_boundary_third_attempt_still_returns_conflict(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """R-07 边界：上限 3，attempt=2 时第三次冲突（attempt+1=3 未超限）→ 仍返 conflict。

        验证上限是「超过」语义（>3 才 failed_manual），attempt 自增到 3 仍给主 agent 机会。
        """
        ws_id, mission_id, _main_run = await _seed_mission(db_session)
        from sqlalchemy import select

        mission = (
            (await db_session.execute(select(AgentMission).where(AgentMission.id == mission_id)))
            .scalars()
            .first()
        )
        assert mission is not None
        mission.constraints = {"mode": "team", "conflict_attempts": 2}
        await db_session.commit()
        await db_session.refresh(mission)

        cleanup_calls: list[uuid.UUID] = []
        conflicts = [{"file": "src/c.py", "marker_lines": [2], "branch": "workers/eee"}]
        _patch_converge_dependencies(
            monkeypatch,
            merge_results=[([], conflicts)],
            cleanup_calls=cleanup_calls,
        )

        resp = await converge_mission(ws_id, mission_id, db_session, user=None)  # type: ignore[arg-type]

        # attempt=2 → +1=3，不超 3 → 仍 conflict
        assert resp.status == "conflict"
        assert resp.attempt == 3
        assert cleanup_calls == []

    @pytest.mark.asyncio
    async def test_bootstrap_path_preserves_legacy_behavior(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """bootstrap mission（无 worker_branch 合并）→ 走既有 done 语义（零回归）。

        merge 结果空（无 merged 无 conflict）→ 不进 conflict 状态机，返 converge_mission_for_completed_run
        的 status（done），保护 task-04 既有 bootstrap 路径（design §9）。
        """
        ws_id, mission_id, _main_run = await _seed_mission(db_session)
        cleanup_calls: list[uuid.UUID] = []
        _patch_converge_dependencies(
            monkeypatch,
            merge_results=[([], [])],  # bootstrap：无合并需求
            cleanup_calls=cleanup_calls,
        )

        resp = await converge_mission(ws_id, mission_id, db_session, user=None)  # type: ignore[arg-type]

        assert resp.status == "done"
        assert resp.converged is True
        assert resp.merged_branches == []
        assert resp.conflicts == []
        assert cleanup_calls == [], "bootstrap 路径不触发 worktree cleanup（无副本）"


class TestMaxConflictAttemptsConfig:
    """R-07 上限可配（默认 3，env 覆盖）。"""

    def test_default_is_3(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("CONVERGE_MAX_CONFLICT_ATTEMPTS", raising=False)
        assert mcp_tools._max_conflict_attempts() == 3

    def test_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CONVERGE_MAX_CONFLICT_ATTEMPTS", "5")
        assert mcp_tools._max_conflict_attempts() == 5

    def test_invalid_env_falls_back_to_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CONVERGE_MAX_CONFLICT_ATTEMPTS", "not-a-number")
        assert mcp_tools._max_conflict_attempts() == 3

    def test_non_positive_env_falls_back_to_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CONVERGE_MAX_CONFLICT_ATTEMPTS", "0")
        assert mcp_tools._max_conflict_attempts() == 3


class TestReadConflictAttempts:
    """计数存储复用 AgentMission.constraints JSON（无新列，design §8）。"""

    def test_none_constraints_returns_zero(self) -> None:
        m = AgentMission(workspace_id=uuid.uuid4(), objective="x", constraints=None)
        assert mcp_tools._read_conflict_attempts(m) == 0

    def test_missing_key_returns_zero(self) -> None:
        m = AgentMission(workspace_id=uuid.uuid4(), objective="x", constraints={"mode": "team"})
        assert mcp_tools._read_conflict_attempts(m) == 0

    def test_int_value_returned(self) -> None:
        m = AgentMission(
            workspace_id=uuid.uuid4(), objective="x", constraints={"conflict_attempts": 2}
        )
        assert mcp_tools._read_conflict_attempts(m) == 2

    def test_bool_treated_as_zero(self) -> None:
        """bool 是 int 子类，先挡（True 语义 != 1 次尝试）。"""
        m = AgentMission(
            workspace_id=uuid.uuid4(), objective="x", constraints={"conflict_attempts": True}
        )
        assert mcp_tools._read_conflict_attempts(m) == 0
