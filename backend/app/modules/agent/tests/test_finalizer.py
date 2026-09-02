"""Tests for Mission Finalizer + convergence (Wave 1, 2026-06-28-team-mainline-integration).

Covers the three P0 Design-Grill fixes that make the team pipeline actually
converge:
- D-007@v1 — ``converge_mission_for_completed_run`` is the Finalizer trigger
  anchor (called at ``complete_lease`` end); ``derive_status`` is a pure fn with
  no watcher, so the anchor must be the lease-completion path.
- D-008@v1 — ``can_dispatch_worker`` rejects (budget/max/cancelled) and the
  dispatch loop marks rejected Runs ``killed`` (not dangling pending).
- D-004@v2 — tool governance v1 is non-enforcing (tested indirectly: Workers
  carry no canUseTool expectation; Finalizer is backend-embedded, no daemon).

Also covers C2: ``collect_completed_artifacts`` fires per-run in
``complete_lease`` (decoupled from session end) — exercised via converge.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.control import MissionControlService
from app.modules.agent.finalizer import (
    FinalizerService,
    converge_mission_for_completed_run,
)
from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun


async def _make_mission(session: AsyncSession, *, budget_usd: float | None = None) -> AgentMission:
    m = AgentMission(
        workspace_id=uuid.uuid4(),
        objective="分析项目架构与规范",
        budget_usd=budget_usd,
    )
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return m


async def _make_worker(
    session: AsyncSession,
    mission_id: uuid.UUID,
    *,
    status: str = "completed",
    output: str | None = "Worker 结构化摘要",
    role: str = "arch",
    cost: float = 0.0,
    diff_summary: str | None = None,
) -> AgentRun:
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        provider="claude",
        status=status,
        role=role,
        objective=f"{role} objective",
        spec_strategy="oneshot",
        output_redacted=output,
        total_cost_usd=cost,
        diff_summary=diff_summary,
    )
    session.add(r)
    await session.commit()
    await session.refresh(r)
    return r


# ── D-007@v1: converge_mission_for_completed_run ────────────────────────────


class TestConvergeSkipsNonMissionRun:
    @pytest.mark.asyncio
    async def test_run_without_mission_returns_none(self, db_session: AsyncSession) -> None:
        """非 mission run（绝大多数 lease）→ converge 零影响（SC-5 兼容）。"""
        run = AgentRun(
            agent_type="claude_code",
            provider="claude",
            status="completed",
            spec_strategy="oneshot",
        )
        db_session.add(run)
        await db_session.commit()
        await db_session.refresh(run)

        result = await converge_mission_for_completed_run(db_session, run.id, None)
        assert result is None


class TestConvergeCollectsAndFinalizes:
    @pytest.mark.asyncio
    async def test_all_done_triggers_finalizer_concat_merge(self, db_session: AsyncSession) -> None:
        """全 worker completed → collect 回灌 + Finalizer 合并（config=None 走 concat）。"""
        mission = await _make_mission(db_session)
        r1 = await _make_worker(db_session, mission.id, output="架构摘要A", role="arch")
        await _make_worker(db_session, mission.id, output="规范摘要B", role="code_style")

        status = await converge_mission_for_completed_run(db_session, r1.id, None)

        assert status == "done"
        # collect 回灌：每个 completed worker 一个 summary Artifact
        arts = (
            (await db_session.execute(select(AgentArtifact).where(AgentArtifact.run_id == r1.id)))
            .scalars()
            .all()
        )
        assert any(("架构摘要A" in (a.content_ref or "")) for a in arts)
        # Finalizer 合并产物（concat，config=None）：内容含两摘要 + 合并标记
        merged = [
            a
            for a in (
                (
                    await db_session.execute(
                        select(AgentArtifact)
                        .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                        .where(AgentRun.mission_id == mission.id)
                    )
                )
                .scalars()
                .all()
            )
            if "架构摘要A" in (a.content_ref or "") and "规范摘要B" in (a.content_ref or "")
        ]
        assert merged, "Finalizer 应产出含所有 worker 摘要的合并 Artifact"

    @pytest.mark.asyncio
    async def test_partial_failure_converges_degraded(self, db_session: AsyncSession) -> None:
        """1 completed + 1 killed → derive_status=degraded → Finalizer 仍触发（D6 降级不阻断）。"""
        mission = await _make_mission(db_session)
        ok = await _make_worker(db_session, mission.id, output="完成的摘要", role="arch")
        await _make_worker(db_session, mission.id, status="killed", output=None, role="test")

        status = await converge_mission_for_completed_run(db_session, ok.id, None)

        assert status == "degraded"
        merged = [
            a
            for a in (
                (
                    await db_session.execute(
                        select(AgentArtifact)
                        .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                        .where(AgentRun.mission_id == mission.id)
                    )
                )
                .scalars()
                .all()
            )
            if "完成的摘要" in (a.content_ref or "")
        ]
        assert merged, "degraded 仍应 Finalizer 合并（降级不阻断收敛）"

    @pytest.mark.asyncio
    async def test_pending_worker_keeps_running_no_finalizer(
        self, db_session: AsyncSession
    ) -> None:
        """有 pending → status=running，Finalizer 不触发（等待全终态）。"""
        mission = await _make_mission(db_session)
        done = await _make_worker(db_session, mission.id, output="done摘要", role="arch")
        await _make_worker(db_session, mission.id, status="pending", output=None, role="test")

        before = len(
            (
                await db_session.execute(
                    select(AgentArtifact)
                    .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                    .where(AgentRun.mission_id == mission.id)
                )
            )
            .scalars()
            .all()
        )
        status = await converge_mission_for_completed_run(db_session, done.id, None)

        assert status == "running"
        after = len(
            (
                await db_session.execute(
                    select(AgentArtifact)
                    .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                    .where(AgentRun.mission_id == mission.id)
                )
            )
            .scalars()
            .all()
        )
        # collect 回灌了 done worker 的 1 个 Artifact，但 Finalizer 未触发（无合并产物）
        assert after == before + 1


class TestFinalizerNoArtifacts:
    @pytest.mark.asyncio
    async def test_no_artifacts_returns_none(self, db_session: AsyncSession) -> None:
        """mission 无 Artifact（worker 无 output）→ Finalizer 返回 None，不写空合并。"""
        mission = await _make_mission(db_session)
        await _make_worker(db_session, mission.id, output=None, role="arch")
        fin = FinalizerService(db_session, None)
        result = await fin.finalize_bootstrap_mission(mission.id)
        assert result is None


# ── D-008@v1: can_dispatch_worker (running-based concurrency) ───────────────


class TestCanDispatchWorker:
    @pytest.mark.asyncio
    async def test_running_count_excludes_pending(self, db_session: AsyncSession) -> None:
        """running_worker_count 只算 running，不算 pending（D-008 修复 N pending 误触发）。"""
        mission = await _make_mission(db_session)
        await _make_worker(db_session, mission.id, status="pending", role="arch")
        await _make_worker(db_session, mission.id, status="pending", role="test")
        ctrl = MissionControlService(db_session)
        assert await ctrl.running_worker_count(mission.id) == 0
        assert await ctrl.active_worker_count(mission.id) == 2  # pending+running

    @pytest.mark.asyncio
    async def test_allows_dispatch_for_flat_pending_mission(self, db_session: AsyncSession) -> None:
        """5 个 pending（plan 允许上限）→ can_dispatch_worker 应 allow（running=0）。

        修复前用 active（pending+running）会误判 max_workers_reached。
        """
        mission = await _make_mission(db_session)
        for role in ("arch", "code_style", "test", "integration", "risk"):
            await _make_worker(db_session, mission.id, status="pending", role=role)
        ctrl = MissionControlService(db_session)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert allowed, f"5 pending mission 应 allow dispatch，got reason={reason}"
        assert reason == "ok"

    @pytest.mark.asyncio
    async def test_rejects_cancelled(self, db_session: AsyncSession) -> None:
        """mission cancelled → 拒绝（reason=mission_cancelled）。"""
        mission = await _make_mission(db_session)
        mission.cancelled_at = datetime.now(UTC)
        db_session.add(mission)
        await db_session.commit()
        ctrl = MissionControlService(db_session)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert not allowed
        assert reason == "mission_cancelled"

    @pytest.mark.asyncio
    async def test_rejects_budget_exceeded(self, db_session: AsyncSession) -> None:
        """累计成本 >= budget → 拒绝（reason=budget_exceeded，超预算=收敛信号非错误）。"""
        mission = await _make_mission(db_session, budget_usd=1.0)
        await _make_worker(
            db_session,
            mission.id,
            status="completed",
            role="arch",
            cost=1.5,  # 超预算
        )
        ctrl = MissionControlService(db_session)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert not allowed
        assert reason == "budget_exceeded"

    @pytest.mark.asyncio
    async def test_rejects_max_workers_when_running_full(self, db_session: AsyncSession) -> None:
        """已有 MAX_WORKERS(5) 个 running → 拒绝（reason=max_workers_reached）。"""
        from app.modules.agent.delegation import MAX_WORKERS

        mission = await _make_mission(db_session)
        for _ in range(MAX_WORKERS):
            await _make_worker(db_session, mission.id, status="running", role="arch")
        ctrl = MissionControlService(db_session)
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        assert not allowed
        assert reason == "max_workers_reached"


# ── task-11 按 target_workspace_id 分组 merge ────────────────────────────────


class TestFinalizeExecuteMissionGroupByWorkspace:
    """task-11（2026-08-19-cross-workspace-team-mission design §4.3）：
    finalize_execute_mission 按 target_workspace_id 分组 merge，冲突按组独立。
    """

    @pytest.mark.asyncio
    async def test_single_workspace_zero_regression(self, db_session: AsyncSession) -> None:
        """单 workspace mission（全 target 为 NULL 回退 anchor）行为零回归。"""
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.workspace.model import Workspace

        # 创建 anchor workspace（mission.workspace_id）
        anchor_ws = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/anchor",
            name="Anchor",
            slug="anchor",
            status="active",
            default_branch="main",
        )
        db_session.add(anchor_ws)
        await db_session.commit()

        mission = await _make_mission(db_session)
        mission.workspace_id = anchor_ws.id
        db_session.add(mission)
        await db_session.commit()

        # 两个 worker 全无 target_workspace_id（NULL）→ 回退 anchor
        r1 = await _make_worker(
            db_session,
            mission.id,
            output="impl1",
            role="impl",
            diff_summary="diff --git a/foo.py b/foo.py\n+pass",
        )
        r1.worktree_branch = f"workers/{str(r1.id)[:8]}"
        db_session.add(r1)

        r2 = await _make_worker(
            db_session,
            mission.id,
            output="impl2",
            role="test",
            diff_summary="diff --git a/bar.py b/bar.py\n+pass",
        )
        r2.worktree_branch = f"workers/{str(r2.id)[:8]}"
        db_session.add(r2)
        await db_session.commit()

        # mock delegate：验证所有 branch 合并到同一 workspace（anchor）
        mock_delegate = MagicMock()
        mock_delegate.git_merge = AsyncMock(
            return_value={"ok": True, "merged_files": ["foo.py", "bar.py"]}
        )
        fin = FinalizerService(db_session, None, host_fs_delegate=mock_delegate)

        result = await fin.finalize_execute_mission(mission.id)

        assert len(result.merged_branches) == 2
        assert set(result.merged_branches) == {r1.worktree_branch, r2.worktree_branch}
        assert len(result.pending_conflicts) == 0
        # git_merge 被调 2 次，全传入同一个 workspace（anchor）
        assert mock_delegate.git_merge.call_count == 2
        for call in mock_delegate.git_merge.call_args_list:
            ws_arg = call[0][0]  # 第一个位置参数是 Workspace
            assert ws_arg.id == anchor_ws.id

    @pytest.mark.asyncio
    async def test_multi_workspace_grouped_merge(self, db_session: AsyncSession) -> None:
        """多 workspace mission：按各自 target_workspace_id 分组 merge（mock 断言调用分组）。"""
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.workspace.model import Workspace

        mission = await _make_mission(db_session)
        anchor_ws = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/anchor",
            name="Anchor",
            slug="anchor",
            status="active",
            default_branch="main",
        )
        db_session.add(anchor_ws)
        mission.workspace_id = anchor_ws.id
        await db_session.commit()

        ws_a = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/a",
            name="A",
            slug="a",
            status="active",
            default_branch="main",
        )
        ws_b = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/b",
            name="B",
            slug="b",
            status="active",
            default_branch="main",
        )
        db_session.add(ws_a)
        db_session.add(ws_b)
        await db_session.commit()

        # worker 1 派到 ws_a，worker 2 派到 ws_b
        r1 = await _make_worker(
            db_session,
            mission.id,
            output="impl_a",
            role="impl",
            diff_summary="diff a",
        )
        r1.target_workspace_id = ws_a.id
        r1.worktree_branch = f"workers/{str(r1.id)[:8]}"
        db_session.add(r1)

        r2 = await _make_worker(
            db_session,
            mission.id,
            output="impl_b",
            role="test",
            diff_summary="diff b",
        )
        r2.target_workspace_id = ws_b.id
        r2.worktree_branch = f"workers/{str(r2.id)[:8]}"
        db_session.add(r2)
        await db_session.commit()

        # mock delegate：记录每次 git_merge 的 (workspace, branch) 对
        mock_delegate = MagicMock()
        mock_delegate.git_merge = AsyncMock(return_value={"ok": True, "merged_files": []})
        fin = FinalizerService(db_session, None, host_fs_delegate=mock_delegate)

        result = await fin.finalize_execute_mission(mission.id)

        assert len(result.merged_branches) == 2
        assert len(result.pending_conflicts) == 0

        # 验证分组调用：ws_a 只合 r1.branch，ws_b 只合 r2.branch
        calls_by_ws: dict[uuid.UUID, list[str]] = {}
        for call in mock_delegate.git_merge.call_args_list:
            ws = call[0][0]
            branch = call[1]["worker_branch"]
            calls_by_ws.setdefault(ws.id, []).append(branch)

        assert set(calls_by_ws.keys()) == {ws_a.id, ws_b.id}
        assert calls_by_ws[ws_a.id] == [r1.worktree_branch]
        assert calls_by_ws[ws_b.id] == [r2.worktree_branch]

    @pytest.mark.asyncio
    async def test_conflicts_isolated_by_group(self, db_session: AsyncSession) -> None:
        """A 工作区冲突不挡 B 工作区合并（分支独立处理，冲突按组收集）。"""
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.workspace.model import Workspace

        mission = await _make_mission(db_session)
        anchor_ws = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/anchor",
            name="Anchor",
            slug="anchor",
            status="active",
            default_branch="main",
        )
        db_session.add(anchor_ws)
        mission.workspace_id = anchor_ws.id
        await db_session.commit()

        ws_a = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/a",
            name="A",
            slug="a",
            status="active",
            default_branch="main",
        )
        ws_b = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/b",
            name="B",
            slug="b",
            status="active",
            default_branch="main",
        )
        db_session.add(ws_a)
        db_session.add(ws_b)
        await db_session.commit()

        r1 = await _make_worker(db_session, mission.id, output="impl_a", diff_summary="diff a")
        r1.target_workspace_id = ws_a.id
        r1.worktree_branch = f"workers/{str(r1.id)[:8]}"
        db_session.add(r1)

        r2 = await _make_worker(db_session, mission.id, output="impl_b", diff_summary="diff b")
        r2.target_workspace_id = ws_b.id
        r2.worktree_branch = f"workers/{str(r2.id)[:8]}"
        db_session.add(r2)
        await db_session.commit()

        # mock：ws_a 合并冲突，ws_b 成功
        mock_delegate = MagicMock()
        ws_a_conflict = {
            "ok": False,
            "conflicts": [
                {"file": "foo.py", "marker_lines": ["<<<<<<<"], "branch": r1.worktree_branch}
            ],
            "error": "merge conflict",
        }
        ws_b_ok = {"ok": True, "merged_files": ["bar.py"]}

        async def _side_effect(ws, worker_branch):
            if ws.id == ws_a.id:
                return ws_a_conflict
            return ws_b_ok

        mock_delegate.git_merge = AsyncMock(side_effect=_side_effect)
        fin = FinalizerService(db_session, None, host_fs_delegate=mock_delegate)

        result = await fin.finalize_execute_mission(mission.id)

        # B 组成功合并，A 组冲突不挡它
        assert result.merged_branches == [r2.worktree_branch]
        assert len(result.pending_conflicts) == 1
        # 冲突携带 target_workspace_id
        assert result.pending_conflicts[0]["target_workspace_id"] == str(ws_a.id)

    @pytest.mark.asyncio
    async def test_pending_conflicts_carries_target(self, db_session: AsyncSession) -> None:
        """pending_conflicts 携带 target_workspace_id 字段供前端展示。"""
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.workspace.model import Workspace

        mission = await _make_mission(db_session)
        anchor_ws = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/anchor",
            name="Anchor",
            slug="anchor",
            status="active",
            default_branch="main",
        )
        db_session.add(anchor_ws)
        mission.workspace_id = anchor_ws.id
        await db_session.commit()

        ws_target = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/t",
            name="T",
            slug="t",
            status="active",
            default_branch="main",
        )
        db_session.add(ws_target)
        await db_session.commit()

        r1 = await _make_worker(db_session, mission.id, output="impl", diff_summary="diff")
        r1.target_workspace_id = ws_target.id
        r1.worktree_branch = f"workers/{str(r1.id)[:8]}"
        db_session.add(r1)
        await db_session.commit()

        mock_delegate = MagicMock()
        mock_delegate.git_merge = AsyncMock(
            return_value={
                "ok": False,
                "conflicts": [
                    {
                        "file": "conflict.py",
                        "marker_lines": ["<<<<<<<"],
                        "branch": r1.worktree_branch,
                    }
                ],
                "error": "conflict",
            }
        )
        fin = FinalizerService(db_session, None, host_fs_delegate=mock_delegate)

        result = await fin.finalize_execute_mission(mission.id)

        assert len(result.pending_conflicts) == 1
        cf = result.pending_conflicts[0]
        assert cf["target_workspace_id"] == str(ws_target.id)
        assert cf["file"] == "conflict.py"

    @pytest.mark.asyncio
    async def test_workspace_resolve_failure_skips_group(self, db_session: AsyncSession) -> None:
        """Workspace resolve 失败时 log 跳过该组不崩其它组（best-effort）。"""
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.workspace.model import Workspace

        mission = await _make_mission(db_session)
        anchor_ws = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/anchor",
            name="Anchor",
            slug="anchor",
            status="active",
            default_branch="main",
        )
        db_session.add(anchor_ws)
        mission.workspace_id = anchor_ws.id
        await db_session.commit()

        ws_ok = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/ok",
            name="OK",
            slug="ok",
            status="active",
            default_branch="main",
        )
        # ws_missing 不建表，模拟 resolve 失败
        ws_missing_id = uuid.uuid4()
        db_session.add(ws_ok)
        await db_session.commit()

        # worker 1 落有效 ws_ok，worker 2 落不存在的 ws_missing
        r1 = await _make_worker(db_session, mission.id, output="impl_ok", diff_summary="diff ok")
        r1.target_workspace_id = ws_ok.id
        r1.worktree_branch = f"workers/{str(r1.id)[:8]}"
        db_session.add(r1)

        r2 = await _make_worker(
            db_session, mission.id, output="impl_missing", diff_summary="diff miss"
        )
        r2.target_workspace_id = ws_missing_id
        r2.worktree_branch = f"workers/{str(r2.id)[:8]}"
        db_session.add(r2)
        await db_session.commit()

        mock_delegate = MagicMock()
        mock_delegate.git_merge = AsyncMock(return_value={"ok": True, "merged_files": []})
        fin = FinalizerService(db_session, None, host_fs_delegate=mock_delegate)

        result = await fin.finalize_execute_mission(mission.id)

        # 有效 ws_ok 组成功合并
        assert result.merged_branches == [r1.worktree_branch]
        # 缺失组记为 conflict（error 字段说明原因）
        assert len(result.pending_conflicts) == 1
        assert result.pending_conflicts[0]["error"] == f"workspace {ws_missing_id} unresolved"
        assert result.pending_conflicts[0]["branch"] == r2.worktree_branch
        # git_merge 只被调一次（ws_ok 组）
        assert mock_delegate.git_merge.call_count == 1


# ── task-04 D-005@v2: patch 采集 + converge 路由 ─────────────────────────────


class TestConvergePatchArtifacts:
    """task-04：write worker diff_summary → patch artifact + execute mission converge 路由。

    per-worker worktree 隔离 + git merge 留 task-04b；本任务只验证 patch 采集 +
    converge 对 execute mission（有 patch）调 finalize_execute_mission、对 bootstrap
    mission（无 patch）回退 finalize_bootstrap_mission。
    """

    @pytest.mark.asyncio
    async def test_worker_diff_summary_collected_as_patch(self, db_session: AsyncSession) -> None:
        """write worker 有 diff_summary → collect_completed_artifacts 额外采 kind=patch artifact。"""
        mission = await _make_mission(db_session)
        r1 = await _make_worker(
            db_session,
            mission.id,
            output="impl 摘要",
            role="impl",
            diff_summary="diff --git a/foo.py b/foo.py\n+pass",
        )

        status = await converge_mission_for_completed_run(db_session, r1.id, None)

        assert status == "done"
        arts = (
            (await db_session.execute(select(AgentArtifact).where(AgentArtifact.run_id == r1.id)))
            .scalars()
            .all()
        )
        kinds = {a.kind for a in arts}
        assert "summary" in kinds
        assert "patch" in kinds, "write worker 有 diff_summary 应采 patch artifact"
        patch_art = next(a for a in arts if a.kind == "patch")
        assert "diff --git" in (patch_art.content_ref or "")

    @pytest.mark.asyncio
    async def test_patch_mission_skips_bootstrap_finalize(self, db_session: AsyncSession) -> None:
        """有 patch 的 mission → converge 调 finalize_execute_mission，不调 finalize_bootstrap_mission。

        bootstrap finalize 会产含「合并摘要」的 summary artifact（_concat_merge 标记）。
        execute mission（有 patch）不应产该合并产物——patch 列表供人审，不自动合并。
        """
        mission = await _make_mission(db_session)
        r1 = await _make_worker(
            db_session,
            mission.id,
            output="impl 摘要",
            role="impl",
            diff_summary="diff --git a/foo.py b/foo.py\n+pass",
        )

        status = await converge_mission_for_completed_run(db_session, r1.id, None)

        assert status == "done"
        all_arts = (
            (
                await db_session.execute(
                    select(AgentArtifact)
                    .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                    .where(AgentRun.mission_id == mission.id)
                )
            )
            .scalars()
            .all()
        )
        patches = [a for a in all_arts if a.kind == "patch"]
        assert len(patches) == 1
        merged = [a for a in all_arts if "合并摘要" in (a.content_ref or "")]
        assert not merged, (
            "execute mission（有 patch）不应调 finalize_bootstrap_mission 产合并 summary"
        )

    @pytest.mark.asyncio
    async def test_no_patch_mission_falls_back_to_bootstrap(self, db_session: AsyncSession) -> None:
        """无 patch 的 mission（read-only worker）→ finalize_execute_mission 返回空 → 调 finalize_bootstrap_mission 合并 summary。"""
        mission = await _make_mission(db_session)
        r1 = await _make_worker(db_session, mission.id, output="架构摘要A", role="arch")
        await _make_worker(db_session, mission.id, output="规范摘要B", role="code_style")

        status = await converge_mission_for_completed_run(db_session, r1.id, None)

        assert status == "done"
        all_arts = (
            (
                await db_session.execute(
                    select(AgentArtifact)
                    .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                    .where(AgentRun.mission_id == mission.id)
                )
            )
            .scalars()
            .all()
        )
        merged = [a for a in all_arts if "合并摘要" in (a.content_ref or "")]
        assert merged, "无 patch 的 read-only mission 应调 finalize_bootstrap_mission 合并 summary"


# ── task-12 D-011: cleanup_mission 按 target_workspace_id 分组 ─────────────────────────────


class TestCleanupMissionGroupByWorkspace:
    """task-12（2026-08-19-cross-workspace-team-mission design §4.3 / D-011）：
    cleanup_mission 按 target_workspace_id 分组删除 worktree 副本。
    """

    @pytest.mark.asyncio
    async def test_single_workspace_zero_regression(self, db_session: AsyncSession) -> None:
        """单 workspace mission（全 target 为 NULL 回退 anchor）行为零回归。"""
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.workspace.model import Workspace

        mission = await _make_mission(db_session)

        anchor_ws = Workspace(
            id=mission.workspace_id,
            root_path="/tmp/anchor",
            name="Anchor",
            slug="anchor",
            status="active",
            default_branch="main",
        )
        db_session.add(anchor_ws)
        await db_session.commit()

        # 两个 worker，全 target=NULL（回退 anchor）
        r1 = await _make_worker(db_session, mission.id, status="completed")
        r1.worktree_branch = f"workers/{str(r1.id)[:8]}"
        db_session.add(r1)
        await db_session.commit()

        r2 = await _make_worker(db_session, mission.id, status="completed")
        r2.worktree_branch = f"workers/{str(r2.id)[:8]}"
        db_session.add(r2)
        await db_session.commit()

        # patch artifact（复用采集，task-07 授权）
        patch = AgentArtifact(run_id=r1.id, kind="patch", content_ref="diff")
        db_session.add(patch)
        await db_session.commit()

        mock_delegate = MagicMock()
        mock_delegate.git_worktree_remove = AsyncMock(return_value={"ok": True})

        fin = FinalizerService(db_session, host_fs_delegate=mock_delegate)
        result = await fin.cleanup_mission(mission.id)

        assert len(result["cleaned"]) == 2
        assert result["patch_artifact_id"] == patch.id
        # git_worktree_remove 被调 2 次，全传入同一个 workspace（anchor）
        assert mock_delegate.git_worktree_remove.call_count == 2
        for call in mock_delegate.git_worktree_remove.call_args_list:
            ws_arg = call[0][0]  # 第一个位置参数是 Workspace
            assert ws_arg.id == anchor_ws.id

        # ql-20260902-001：清理连带删 workers/<id> 分支（worktree remove 不删
        # 分支，此前 converge 清理后分支仍永久堆积）——branch kwarg 逐 run 传对。
        branch_args = [c[1]["branch"] for c in mock_delegate.git_worktree_remove.call_args_list]
        assert set(branch_args) == {f"workers/{str(r1.id)[:8]}", f"workers/{str(r2.id)[:8]}"}

    @pytest.mark.asyncio
    async def test_multi_workspace_grouped_cleanup(self, db_session: AsyncSession) -> None:
        """多 workspace mission：按各自 target_workspace_id 分组 cleanup（mock 断言调用分组）。"""
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.workspace.model import Workspace

        mission = await _make_mission(db_session)

        # 创建两个不同的 target workspace
        ws_a = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/ws_a",
            name="WS A",
            slug="ws_a",
            status="active",
            default_branch="main",
        )
        ws_b = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/ws_b",
            name="WS B",
            slug="ws_b",
            status="active",
            default_branch="main",
        )
        db_session.add_all([ws_a, ws_b])
        await db_session.commit()

        # r1 target ws_a，r2 target ws_b
        r1 = await _make_worker(db_session, mission.id, status="completed")
        r1.target_workspace_id = ws_a.id
        r1.worktree_branch = f"workers/{str(r1.id)[:8]}"
        db_session.add(r1)
        await db_session.commit()

        r2 = await _make_worker(db_session, mission.id, status="completed")
        r2.target_workspace_id = ws_b.id
        r2.worktree_branch = f"workers/{str(r2.id)[:8]}"
        db_session.add(r2)
        await db_session.commit()

        patch = AgentArtifact(run_id=r1.id, kind="patch", content_ref="diff")
        db_session.add(patch)
        await db_session.commit()

        mock_delegate = MagicMock()
        mock_delegate.git_worktree_remove = AsyncMock(return_value={"ok": True})

        fin = FinalizerService(db_session, host_fs_delegate=mock_delegate)
        result = await fin.cleanup_mission(mission.id)

        assert len(result["cleaned"]) == 2
        assert result["patch_artifact_id"] == patch.id

        # 验证分组调用：ws_a 只清 r1，ws_b 只清 r2
        calls_by_ws: dict[uuid.UUID, list[str]] = {}
        for call in mock_delegate.git_worktree_remove.call_args_list:
            ws = call[0][0]
            sibling_path = call[1]["sibling_path"]
            calls_by_ws.setdefault(ws.id, []).append(sibling_path)

        assert set(calls_by_ws.keys()) == {ws_a.id, ws_b.id}
        # r1 短 8 位在 ws_a 的 sibling_path
        assert any(f"/.worktrees/{str(r1.id)[:8]}" in p for p in calls_by_ws[ws_a.id])
        # r2 短 8 位在 ws_b 的 sibling_path
        assert any(f"/.worktrees/{str(r2.id)[:8]}" in p for p in calls_by_ws[ws_b.id])

    @pytest.mark.asyncio
    async def test_workspace_resolve_failure_skips_group(self, db_session: AsyncSession) -> None:
        """Workspace resolve 失败时 log 跳过该组不崩其它组（best-effort，对齐 task-11）。"""
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.workspace.model import Workspace

        mission = await _make_mission(db_session)

        ws_ok = Workspace(
            id=uuid.uuid4(),
            root_path="/tmp/ws_ok",
            name="WS OK",
            slug="ws_ok",
            status="active",
            default_branch="main",
        )
        db_session.add(ws_ok)
        await db_session.commit()

        ws_missing_id = uuid.uuid4()  # 不存在于 DB

        # r1 target ws_ok（有效），r2 target ws_missing（缺失）
        r1 = await _make_worker(db_session, mission.id, status="completed")
        r1.target_workspace_id = ws_ok.id
        r1.worktree_branch = f"workers/{str(r1.id)[:8]}"
        db_session.add(r1)
        await db_session.commit()

        r2 = await _make_worker(db_session, mission.id, status="completed")
        r2.target_workspace_id = ws_missing_id
        r2.worktree_branch = f"workers/{str(r2.id)[:8]}"
        db_session.add(r2)
        await db_session.commit()

        patch = AgentArtifact(run_id=r1.id, kind="patch", content_ref="diff")
        db_session.add(patch)
        await db_session.commit()

        mock_delegate = MagicMock()
        mock_delegate.git_worktree_remove = AsyncMock(return_value={"ok": True})

        fin = FinalizerService(db_session, host_fs_delegate=mock_delegate)
        result = await fin.cleanup_mission(mission.id)

        # 有效 ws_ok 组成功清理
        assert len(result["cleaned"]) == 1
        assert result["patch_artifact_id"] == patch.id
        # git_worktree_remove 只被调一次（ws_ok 组）
        assert mock_delegate.git_worktree_remove.call_count == 1
        ws_arg = mock_delegate.git_worktree_remove.call_args_list[0][0][0]
        assert ws_arg.id == ws_ok.id
