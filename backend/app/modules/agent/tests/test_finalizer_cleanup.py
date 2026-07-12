"""finalizer 合并后清理单测（task-07）。

change ``2026-07-12-worker-worktree-isolation`` task-07 / D-005@v1 / X-003：

``FinalizerService.cleanup_mission`` 在 task-06 ``converge_mission`` 判定「全合并
成功」（无 pending_conflicts / 无 needs_manual）后被调用：逐个
``HostFsDelegate.git_worktree_remove`` 清各 worker 副本 + 复用 task-04 既有
``kind=patch`` artifact 作 patch 采集（避免新读 diff 方法，task-07 授权复用）。

失败路径（merge 整体失败 / needs_manual）**不调本方法**（task-06 控制，副本保留
供人工排查，design §9 / X-003）。本方法本身只在「全成功」时被调，但单测仍覆盖
git_worktree_remove 部分失败时 best-effort 继续清其他副本。

sibling_path 公式（D-001@v2，与 task-03 ``execution.dispatch_worker`` 一致）：
``resolve_root_path_for_daemon(ws.root_path) + "/.worktrees/" + str(run.id)[:8]``。

覆盖用例：
- AC-01 全成功 → 各 worker 副本 git_worktree_remove 调用（sibling_path 正确），
  cleaned=N，patch_artifact_id 指向既有 kind=patch artifact。
- AC-02 部分 git_worktree_remove 失败（ok=False）→ 记失败但继续清其他（best-effort），
  cleaned 只含成功项，patch_artifact_id 仍写入。
- AC-03 未注入 delegate（None）→ cleanup_mission 返回空 cleaned，
  patch_artifact_id=None（零回归）。
- AC-04 无 patch artifact（worker 未写代码）→ 仍清理副本，patch_artifact_id=None。
- AC-05 无 worktree_branch（老路径 / single mode）→ 无副本可清，cleaned=[]。
- AC-06 workspace 无法解析 → 不崩，cleaned=[] / patch_artifact_id=None。

delegate 走 mock（生产接线留 task-08 集成）。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.finalizer import FinalizerService
from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun
from app.modules.workspace.model import Workspace


async def _make_workspace(session: AsyncSession, *, root_path: str = "/tmp/repo") -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="t",
        slug="t-ws",
        root_path=root_path,
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


async def _make_patch_artifact(
    session: AsyncSession, run_id: uuid.UUID, content: str = "diff --git a/x b/x"
) -> AgentArtifact:
    """task-04 既有 kind=patch artifact（collect_completed_artifacts 产出）。"""
    a = AgentArtifact(run_id=run_id, kind="patch", content_ref=content)
    session.add(a)
    await session.commit()
    await session.refresh(a)
    return a


def _expected_sibling(root_path: str, run_id: uuid.UUID) -> str:
    """与 task-03 execution.dispatch_worker 同公式（D-001@v2）。

    生产代码会走 ``resolve_root_path_for_daemon``（容器→宿主改写），测试用裸
    root_path（无 prefix 配置时原样返回），故直接拼接。
    """
    return f"{root_path}/.worktrees/{str(run_id)[:8]}"


# ── AC-01: 全成功清理 ─────────────────────────────────────────────────────────


class TestCleanupAllRemoved:
    @pytest.mark.asyncio
    async def test_all_worktrees_removed_and_patch_returned(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """2 worker 都有 worktree_branch + 既有 patch artifact + git_worktree_remove
        都 ok → cleaned=2（sibling_path 正确），patch_artifact_id 指向 patch artifact。"""
        # 裸 root_path：resolve_root_path_for_daemon 无 prefix 配置时原样返回
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_mission(db_session, ws.id)
        w1 = await _make_worker(db_session, mission.id, worktree_branch="workers/aaaaaaaa")
        w2 = await _make_worker(db_session, mission.id, worktree_branch="workers/bbbbbbbb")
        patch = await _make_patch_artifact(db_session, w1.id)

        delegate = MagicMock()
        delegate.git_worktree_remove = AsyncMock(return_value={"ok": True, "error": None})
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.cleanup_mission(mission.id)

        assert isinstance(result, dict)
        assert sorted(result["cleaned"]) == sorted(
            [
                _expected_sibling(ws.root_path, w1.id),
                _expected_sibling(ws.root_path, w2.id),
            ]
        )
        assert result["patch_artifact_id"] == patch.id
        # 两个副本都被要求清理
        assert delegate.git_worktree_remove.await_count == 2

    @pytest.mark.asyncio
    async def test_git_worktree_remove_called_with_correct_sibling(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """git_worktree_remove 收到的 sibling_path 严格等于 task-03 公式产物
        （D-001@v2：ws.root_path + /.worktrees/ + run.id[:8]）。"""
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_mission(db_session, ws.id)
        w = await _make_worker(db_session, mission.id, worktree_branch="workers/cccccccc")
        await _make_patch_artifact(db_session, w.id)

        delegate = MagicMock()
        delegate.git_worktree_remove = AsyncMock(return_value={"ok": True, "error": None})
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        await fin.cleanup_mission(mission.id)

        delegate.git_worktree_remove.assert_awaited_once()
        call_args = delegate.git_worktree_remove.await_args
        # 签名 git_worktree_remove(workspace, *, sibling_path)
        assert call_args.args[0] is ws
        assert call_args.kwargs["sibling_path"] == _expected_sibling(ws.root_path, w.id)


# ── AC-02: 部分 git_worktree_remove 失败（best-effort 继续清其他）────────────


class TestCleanupPartialFailureBestEffort:
    @pytest.mark.asyncio
    async def test_one_remove_fails_other_still_removed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """第 1 个副本 git_worktree_remove ok=False（RPC degraded / git 错）→ 记失败
        但继续清第 2 个（best-effort，design §5.1 步骤8 全清意图）。cleaned 只含
        成功项；patch_artifact_id 仍写入（采集与清理解耦）。"""
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_mission(db_session, ws.id)
        w1 = await _make_worker(db_session, mission.id, worktree_branch="workers/aaaaaaaa")
        w2 = await _make_worker(db_session, mission.id, worktree_branch="workers/bbbbbbbb")
        patch = await _make_patch_artifact(db_session, w1.id)

        sibling1 = _expected_sibling(ws.root_path, w1.id)
        sibling2 = _expected_sibling(ws.root_path, w2.id)

        call_count = {"n": 0}

        async def _remove(workspace, *, sibling_path):
            call_count["n"] += 1
            if sibling_path == sibling1:
                return {"ok": False, "error": "rpc unavailable"}
            return {"ok": True, "error": None}

        delegate = MagicMock()
        delegate.git_worktree_remove = _remove
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.cleanup_mission(mission.id)

        assert result["cleaned"] == [sibling2]
        assert result["patch_artifact_id"] == patch.id
        # 两个副本都被尝试
        assert call_count["n"] == 2

    @pytest.mark.asyncio
    async def test_remove_exception_does_not_crash(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """delegate 异常（非 degraded dict）兜底：不崩，该副本不计 cleaned，
        其他副本继续清（design §9 兼容 — cleanup 不阻塞 mission 收尾）。"""
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_mission(db_session, ws.id)
        w1 = await _make_worker(db_session, mission.id, worktree_branch="workers/aaaaaaaa")
        w2 = await _make_worker(db_session, mission.id, worktree_branch="workers/bbbbbbbb")
        await _make_patch_artifact(db_session, w1.id)

        sibling1 = _expected_sibling(ws.root_path, w1.id)
        sibling2 = _expected_sibling(ws.root_path, w2.id)

        async def _remove(workspace, *, sibling_path):
            if sibling_path == sibling1:
                raise RuntimeError("delegate boom")
            return {"ok": True, "error": None}

        delegate = MagicMock()
        delegate.git_worktree_remove = _remove
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.cleanup_mission(mission.id)

        assert result["cleaned"] == [sibling2]


# ── AC-03: 未注入 delegate（None）零回归 ──────────────────────────────────────


class TestCleanupNoDelegate:
    @pytest.mark.asyncio
    async def test_no_delegate_returns_empty(self, db_session: AsyncSession) -> None:
        """未注入 delegate（既有调用方 / converge_mission_for_completed_run）→
        cleanup_mission 不崩，cleaned=[] / patch_artifact_id=None（design §9 零回归）。
        不调任何 RPC。"""
        ws = await _make_workspace(db_session)
        mission = await _make_mission(db_session, ws.id)
        w = await _make_worker(db_session, mission.id, worktree_branch="workers/aaaaaaaa")
        await _make_patch_artifact(db_session, w.id)

        fin = FinalizerService(db_session, None)  # 无 delegate

        result = await fin.cleanup_mission(mission.id)

        assert result == {"cleaned": [], "patch_artifact_id": None}


# ── AC-04: 无 patch artifact（worker 未写代码）────────────────────────────────


class TestCleanupNoPatchArtifact:
    @pytest.mark.asyncio
    async def test_no_patch_artifact_still_cleans(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """worker 有 worktree_branch（走了 worktree 隔离）但无 kind=patch artifact
        （未写代码 / diff 采集未发生）→ 仍清副本，patch_artifact_id=None
        （清理与采集解耦，best-effort）。"""
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_mission(db_session, ws.id)
        w = await _make_worker(
            db_session, mission.id, worktree_branch="workers/aaaaaaaa", diff_summary=None
        )
        # 无 patch artifact

        delegate = MagicMock()
        delegate.git_worktree_remove = AsyncMock(return_value={"ok": True, "error": None})
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.cleanup_mission(mission.id)

        assert result["cleaned"] == [_expected_sibling(ws.root_path, w.id)]
        assert result["patch_artifact_id"] is None


# ── AC-05: 无 worktree_branch（老路径 / single mode）──────────────────────────


class TestCleanupNoWorktreeBranch:
    @pytest.mark.asyncio
    async def test_workers_without_branch_skip_cleanup(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """worker 无 worktree_branch（None，老路径 / single mode）→ 无副本可清，
        git_worktree_remove 不调，cleaned=[]（design §9 兼容）。"""
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        ws = await _make_workspace(db_session)
        mission = await _make_mission(db_session, ws.id)
        w = await _make_worker(
            db_session, mission.id, worktree_branch=None, diff_summary="diff ..."
        )
        await _make_patch_artifact(db_session, w.id)

        delegate = MagicMock()
        delegate.git_worktree_remove = AsyncMock(return_value={"ok": True, "error": None})
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.cleanup_mission(mission.id)

        assert result["cleaned"] == []
        assert result["patch_artifact_id"] is not None  # patch artifact 仍能查到
        delegate.git_worktree_remove.assert_not_called()


# ── AC-06: workspace 无法解析 ─────────────────────────────────────────────────


class TestCleanupWorkspaceUnresolved:
    @pytest.mark.asyncio
    async def test_workspace_missing_does_not_crash(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """mission 关联的 workspace 无法解析（数据异常 / 已删）→ 不崩，
        cleaned=[] / patch_artifact_id=None（design §9 兼容兜底）。"""
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        # 直接造一个 mission 指向不存在的 workspace
        mission = AgentMission(workspace_id=uuid.uuid4(), objective="orphan mission")
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)

        delegate = MagicMock()
        delegate.git_worktree_remove = AsyncMock(return_value={"ok": True, "error": None})
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)

        result = await fin.cleanup_mission(mission.id)

        assert result == {"cleaned": [], "patch_artifact_id": None}
        delegate.git_worktree_remove.assert_not_called()
