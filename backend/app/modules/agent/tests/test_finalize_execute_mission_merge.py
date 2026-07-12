"""finalize_execute_mission git merge 单测（task-05）。

change ``2026-07-12-worker-worktree-isolation`` task-05 / D-003@v1 / D-005@v2：

``finalize_execute_mission`` 从 task-04 的"采 patch 列表"占位升级为实际逐个
``HostFsDelegate.git_merge`` 合并各 worker ``worktree_branch`` 到 workspace root，
冲突只收集不解决（解决在 task-06 主 agent SDK）。返回 ``FinalizerMergeResult``
``{merged_branches, pending_conflicts}`` 供 task-06 ``converge_mission`` 决策。

覆盖用例：
- AC-01 全部 worker 合并成功（worktree_branch 填值）→ merged_branches=N，
  pending_conflicts=[]。
- AC-02 部分成功部分冲突 → 不中断，继续合能合的；merged_branches 与
  pending_conflicts 各收各自。
- AC-03 全部冲突 → merged_branches=[]，pending_conflicts 收全部冲突。
- AC-04 无 worktree_branch（老路径 / single mode）→ 不调 git_merge，
  merged_branches=[] / pending_conflicts=[]（既有 patch 采集不变）。

delegate 走 mock（生产接线留 task-08 集成）。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.finalizer import (
    FinalizerMergeResult,
    FinalizerService,
)
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.workspace.model import Workspace


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="t",
        slug="t-ws",
        root_path="/tmp/repo",
        default_branch="main",
        default_agent="claude_code",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_mission(session: AsyncSession, workspace_id: uuid.UUID) -> AgentMission:
    m = AgentMission(workspace_id=workspace_id, objective="实现模块 A+B")
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return m


async def _make_worker(
    session: AsyncSession,
    mission_id: uuid.UUID,
    *,
    worktree_branch: str | None,
    diff_summary: str | None = None,
    output: str | None = "impl 摘要",
) -> AgentRun:
    """Completed worker run with optional worktree_branch + diff_summary."""
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        provider="claude",
        status="completed",
        role="impl",
        objective="impl objective",
        spec_strategy="oneshot",
        output_redacted=output,
        diff_summary=diff_summary,
        worktree_branch=worktree_branch,
    )
    session.add(r)
    await session.commit()
    await session.refresh(r)
    return r


def _delegate_with_merge(
    merge_results: dict[str, dict],
) -> MagicMock:
    """Build a fake HostFsDelegate whose git_merge dispatches on worker_branch.

    ``merge_results`` maps worker_branch → delegate return dict. Unmatched
    branches raise (test setup error). git_worktree_* unused in finalize_execute.
    """
    delegate = MagicMock()
    delegate.git_worktree_add = AsyncMock()
    delegate.git_worktree_remove = AsyncMock()

    async def _git_merge(workspace, *, worker_branch):
        if worker_branch not in merge_results:
            raise AssertionError(
                f"unexpected git_merge worker_branch={worker_branch!r} "
                f"(known={list(merge_results)})"
            )
        return merge_results[worker_branch]

    delegate.git_merge = _git_merge
    return delegate


# ── AC-01: 全部合并成功 ─────────────────────────────────────────────────────


class TestFinalizeExecuteAllMerged:
    @pytest.mark.asyncio
    async def test_all_workers_merge_ok(self, db_session: AsyncSession) -> None:
        """2 worker 都 worktree_branch 填值 + git_merge 都 ok → merged_branches=2, conflicts=[]。"""
        ws = await _make_workspace(db_session)
        mission = await _make_mission(db_session, ws.id)
        b1, b2 = "workers/aaaaaaaa", "workers/bbbbbbbb"
        await _make_worker(db_session, mission.id, worktree_branch=b1)
        await _make_worker(db_session, mission.id, worktree_branch=b2)

        delegate = _delegate_with_merge(
            {
                b1: {"ok": True, "conflicts": [], "merged_files": ["a.py"], "error": None},
                b2: {"ok": True, "conflicts": [], "merged_files": ["b.py"], "error": None},
            }
        )
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.finalize_execute_mission(mission.id)

        assert isinstance(result, FinalizerMergeResult)
        assert sorted(result.merged_branches) == sorted([b1, b2])
        assert result.pending_conflicts == []


# ── AC-02: 部分成功部分冲突（不中断继续合）────────────────────────────────


class TestFinalizeExecutePartialConflict:
    @pytest.mark.asyncio
    async def test_one_ok_one_conflict_keeps_going(self, db_session: AsyncSession) -> None:
        """1 ok + 1 conflict → merged_branches=1, pending_conflicts 含冲突 worker 的 conflicts。"""
        ws = await _make_workspace(db_session)
        mission = await _make_mission(db_session, ws.id)
        b_ok, b_conf = "workers/aaaaaaaa", "workers/bbbbbbbb"
        await _make_worker(db_session, mission.id, worktree_branch=b_ok)
        await _make_worker(db_session, mission.id, worktree_branch=b_conf)

        conflict_payload = [{"file": "shared.py", "marker_lines": [10, 20]}]
        delegate = _delegate_with_merge(
            {
                b_ok: {"ok": True, "conflicts": [], "merged_files": ["a.py"], "error": None},
                b_conf: {
                    "ok": False,
                    "conflicts": conflict_payload,
                    "merged_files": [],
                    "error": None,
                },
            }
        )
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.finalize_execute_mission(mission.id)

        assert result.merged_branches == [b_ok]
        assert result.pending_conflicts == conflict_payload

    @pytest.mark.asyncio
    async def test_merge_does_not_short_circuit_on_conflict(self, db_session: AsyncSession) -> None:
        """conflict 不中断：第 1 个冲突后第 2 个仍被尝试合并（design §5.1 步骤6 继续合能合的）。"""
        ws = await _make_workspace(db_session)
        mission = await _make_mission(db_session, ws.id)
        b_conf, b_ok = "workers/aaaaaaaa", "workers/bbbbbbbb"
        await _make_worker(db_session, mission.id, worktree_branch=b_conf)
        await _make_worker(db_session, mission.id, worktree_branch=b_ok)

        calls: list[str] = []

        async def _git_merge(workspace, *, worker_branch):
            calls.append(worker_branch)
            if worker_branch == b_conf:
                return {
                    "ok": False,
                    "conflicts": [{"file": "x.py", "marker_lines": [1]}],
                    "merged_files": [],
                    "error": None,
                }
            return {"ok": True, "conflicts": [], "merged_files": ["y.py"], "error": None}

        delegate = MagicMock()
        delegate.git_merge = _git_merge
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.finalize_execute_mission(mission.id)

        assert sorted(calls) == sorted([b_conf, b_ok]), "两个分支都应被尝试合并"
        assert result.merged_branches == [b_ok]
        assert len(result.pending_conflicts) == 1


# ── AC-03: 全部冲突 ─────────────────────────────────────────────────────────


class TestFinalizeExecuteAllConflict:
    @pytest.mark.asyncio
    async def test_all_conflicts_collected(self, db_session: AsyncSession) -> None:
        """全 conflict → merged_branches=[], pending_conflicts 收全部冲突。"""
        ws = await _make_workspace(db_session)
        mission = await _make_mission(db_session, ws.id)
        b1, b2 = "workers/aaaaaaaa", "workers/bbbbbbbb"
        await _make_worker(db_session, mission.id, worktree_branch=b1)
        await _make_worker(db_session, mission.id, worktree_branch=b2)

        c1 = [{"file": "a.py", "marker_lines": [1]}]
        c2 = [{"file": "b.py", "marker_lines": [2, 3]}]
        delegate = _delegate_with_merge(
            {
                b1: {"ok": False, "conflicts": c1, "merged_files": [], "error": None},
                b2: {"ok": False, "conflicts": c2, "merged_files": [], "error": None},
            }
        )
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.finalize_execute_mission(mission.id)

        assert result.merged_branches == []
        assert result.pending_conflicts == c1 + c2


# ── AC-04: 无 worktree_branch（老路径 / single mode）零回归 ──────────────


class TestFinalizeExecuteNoWorktreeBranch:
    @pytest.mark.asyncio
    async def test_workers_without_branch_skip_merge(self, db_session: AsyncSession) -> None:
        """worker 无 worktree_branch（None，老路径 / single mode）→ 不调 git_merge，
        merged_branches=[] / pending_conflicts=[]（design §9 兼容）。"""
        ws = await _make_workspace(db_session)
        mission = await _make_mission(db_session, ws.id)
        await _make_worker(
            db_session,
            mission.id,
            worktree_branch=None,
            diff_summary="diff --git a/foo.py b/foo.py\n+pass",
        )

        delegate = MagicMock()
        delegate.git_merge = AsyncMock()  # 不应被调用
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.finalize_execute_mission(mission.id)

        assert result.merged_branches == []
        assert result.pending_conflicts == []
        delegate.git_merge.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_delegate_keeps_old_patch_collection(self, db_session: AsyncSession) -> None:
        """未注入 delegate（既有调用方）→ finalize_execute_mission 不崩，
        返回空 merge 结果（patch 采集 task-04 既有逻辑保留，由
        collect_completed_artifacts 产出，非本方法职责）。"""
        ws = await _make_workspace(db_session)
        mission = await _make_mission(db_session, ws.id)
        await _make_worker(
            db_session,
            mission.id,
            worktree_branch=None,
            diff_summary="diff --git a/foo.py b/foo.py\n+pass",
        )
        fin = FinalizerService(db_session, None)  # 无 delegate

        result = await fin.finalize_execute_mission(mission.id)

        assert isinstance(result, FinalizerMergeResult)
        assert result.merged_branches == []
        assert result.pending_conflicts == []


# ── AC-05: ok=False 但无 conflicts（error 路径）→ 收为冲突回退上报 ────────


class TestFinalizeExecuteErrorTreatedAsConflict:
    @pytest.mark.asyncio
    async def test_rpc_error_does_not_crash(self, db_session: AsyncSession) -> None:
        """ok=False + 无 conflicts + error（RPC degraded / git 异常）→ 不崩，
        该分支不计 merged，pending_conflicts 仍结构完整（caller 视作失败上报）。"""
        ws = await _make_workspace(db_session)
        mission = await _make_mission(db_session, ws.id)
        b1 = "workers/aaaaaaaa"
        await _make_worker(db_session, mission.id, worktree_branch=b1)

        delegate = _delegate_with_merge(
            {
                b1: {
                    "ok": False,
                    "conflicts": [],
                    "merged_files": [],
                    "error": "rpc unavailable",
                },
            }
        )
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.finalize_execute_mission(mission.id)

        assert result.merged_branches == []
        assert result.pending_conflicts == []  # 无 conflict markers，但也不计 merged
