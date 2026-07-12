"""per-worker worktree 全链路集成测试（task-08）。

change ``2026-07-12-worker-worktree-isolation`` task-08 / D-001@v2 / D-005@v2：

端到端单测链路验证 per-worker worktree 完整生命周期（design §5 / §7.5 / §9）：

    主 agent 派 worker
        │  execution.dispatch_worker → HostFsDelegate.git_worktree_add
        │  → root_path=副本 cwd + 填 worktree_branch + placement.dispatch_to_daemon
        ▼
    worker 在副本写 + commit → complete_lease 回灌 diff_summary → kind=patch artifact
        │
        ▼
    主 agent converge
        │  finalizer.finalize_execute_mission → HostFsDelegate.git_merge 逐个合
        │  ok=True 收 merged / ok=False 收 pending_conflicts（只收集不解决）
        ▼
    冲突主 agent SDK 解决（mock）→ 重入 converge_mission → 全 merged
        │
        ▼
    finalizer.cleanup_mission → HostFsDelegate.git_worktree_remove 清各副本
    + 复用 kind=patch artifact

四场景覆盖（design §9 兼容路径全收口）：
- 场景1（成功路径）：2 worker → 各独立 worktree → converge 全 merged → cleanup。
- 场景2（冲突解决）：2 worker 改同一文件 → converge 首次冲突 → 主 agent 解（mock）
  → 重入全 merged → cleanup。
- 场景3（worker 创建失败）：dispatch_worker git_worktree_add ok=False → run failed
  → 主 agent 补派另一 worker。
- 场景4（超轮次回退）：converge 反复冲突超 R-07（CONVERGE_MAX_CONFLICT_ATTEMPTS）
  → failed_manual + needs_manual + **不调 cleanup_mission**（副本保留 X-003）。

测试边界（铁律）：
- **全 mock WS RPC**：HostFsDelegate 每方法返结构化 dict（不依赖真 daemon / 真 git）；
  placement.dispatch_to_daemon mock 为 AsyncMock（不派真 lease）。
- 真部署 e2e（daemon complete_lease diff 回灌真链路 / 真宿主机 git）留 verify/部署阶段。
- 复用 task-03/05/06/07 的 mock helper（_make_delegate / _delegate_with_merge 等）。

集成接线说明（与生产 task-08 接线对齐）：
- dispatch 走 ``MissionExecutionService(session, placement=..., host_fs_delegate=...)``
  （task-03 注入路径，AC-01 同款）。
- merge / cleanup 走 ``FinalizerService(session, None, host_fs_delegate=...)``
  （task-05/07 注入路径）。
- converge_mission endpoint 内部 ``_finalize_merge_for_mission`` / ``_cleanup_mission``
  当前构建无 delegate 的 FinalizerService（生产接线由 task-08 集成调用方注入——本测试
  monkeypatch 两 helper 把 delegate 透传进去，复现生产接线后的完整链路，与 task-06
  整体 mock 两 helper 的隔离单测互补）。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MissionExecutionService
from app.modules.agent.finalizer import FinalizerService
from app.modules.agent.mcp_tools import ConvergeResponse, converge_mission
from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun
from app.modules.workspace.model import Workspace

# sibling_path / branch 公式（D-001@v2，与 task-03 execution.dispatch_worker /
# task-07 finalizer.cleanup_mission 同款；测试用裸 root_path，无 prefix 配置时
# resolve_root_path_for_daemon 原样返回）。
_WORKTREE_DIR = ".worktrees"


def _sibling_path(root_path: str, run_id: uuid.UUID) -> str:
    return f"{root_path}/{_WORKTREE_DIR}/{str(run_id)[:8]}"


def _worktree_branch(run_id: uuid.UUID) -> str:
    return f"workers/{str(run_id)[:8]}"


# ---------------------------------------------------------------------------
# Seed helpers（复用 task-03/05/06/07 构造模式）
# ---------------------------------------------------------------------------


async def _make_workspace(
    session: AsyncSession, *, root_path: str = "/tmp/repo", default_branch: str | None = "main"
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="t",
        slug="t-ws",
        root_path=root_path,
        default_branch=default_branch,
        default_agent="claude_code",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_team_mission(session: AsyncSession, workspace_id: uuid.UUID) -> AgentMission:
    """team 模式 mission（mode=team + 主 agent config + worker_preset）。"""
    m = AgentMission(
        workspace_id=workspace_id,
        objective="实现模块 A + B",
        constraints={"mode": "team"},
        worker_preset=[
            {"role": "impl", "agent_type": "claude_code", "objective": "写模块 A"},
            {"role": "impl", "agent_type": "claude_code", "objective": "写模块 B"},
        ],
        main_agent_config={"agent_type": "claude_code", "provider": "claude"},
    )
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return m


async def _make_orchestrator_run(session: AsyncSession, mission_id: uuid.UUID) -> AgentRun:
    """主 agent run（role=orchestrator，converge_mission 必需，design §7.5）。"""
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        provider="claude",
        status="completed",
        role="orchestrator",
        objective="团队目标",
    )
    session.add(r)
    await session.commit()
    await session.refresh(r)
    return r


async def _make_pending_worker(
    session: AsyncSession, mission_id: uuid.UUID, *, role: str = "impl", objective: str = "写代码"
) -> AgentRun:
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status="pending",
        role=role,
        objective=objective,
    )
    session.add(r)
    await session.commit()
    await session.refresh(r)
    return r


async def _make_completed_worker(
    session: AsyncSession,
    mission_id: uuid.UUID,
    *,
    worktree_branch: str | None,
    diff_summary: str | None = "diff --git a/x b/x\n+pass",
    role: str = "impl",
) -> AgentRun:
    """completed worker（带 worktree_branch + diff_summary，模拟 worker commit 后回灌）。"""
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        provider="claude",
        status="completed",
        role=role,
        objective="写模块",
        spec_strategy="oneshot",
        output_redacted="impl 摘要",
        diff_summary=diff_summary,
        worktree_branch=worktree_branch,
    )
    session.add(r)
    await session.commit()
    await session.refresh(r)
    return r


async def _collect_patch_artifact(session: AsyncSession, run: AgentRun) -> AgentArtifact:
    """模拟 task-04 collect_completed_artifacts 把 diff_summary 采成 kind=patch。"""
    a = AgentArtifact(run_id=run.id, kind="patch", content_ref=run.diff_summary or "")
    session.add(a)
    await session.commit()
    await session.refresh(a)
    return a


def _make_placement_mock() -> MagicMock:
    """mock RunPlacementService（不派真 lease，dispatch_to_daemon 返 lease_id）。"""
    placement = MagicMock()
    placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    return placement


def _make_delegate_mock() -> MagicMock:
    """全方法 mock 的 HostFsDelegate（git_worktree_add / git_merge / git_worktree_remove）。

    每方法默认返成功；测试用 ``delegate.git_merge.side_effect`` / ``return_value``
    或 ``delegate.git_worktree_add.return_value`` 按场景定制（参考 task-05/07）。
    """
    delegate = MagicMock()
    delegate.git_worktree_add = AsyncMock(
        return_value={"ok": True, "worktree_path": None, "error": None}
    )
    delegate.git_merge = AsyncMock(
        return_value={"ok": True, "conflicts": [], "merged_files": [], "error": None}
    )
    delegate.git_worktree_remove = AsyncMock(return_value={"ok": True, "error": None})
    return delegate


def _patch_converge_helpers_with_delegate(
    monkeypatch: pytest.MonkeyPatch,
    delegate: MagicMock,
) -> dict[str, list[uuid.UUID]]:
    """把 converge_mission endpoint 的两 helper 接到注入 delegate 的 FinalizerService。

    生产接线（task-08 调用方）会在 ``_finalize_merge_for_mission`` / ``_cleanup_mission``
    内用注入 delegate 的 FinalizerService（task-06 整体 mock 两 helper 的隔离单测互补）。
    本集成测试复现生产接线后的完整链路：

    - ``_finalize_merge_for_mission`` → ``FinalizerService(session, None, host_fs_delegate=delegate)
      .finalize_execute_mission(mission_id)``（task-05 真实逐个 git_merge）。
    - ``_cleanup_mission`` → 同款 ``FinalizerService.cleanup_mission``（task-07 真实逐个
      git_worktree_remove）。
    - ``converge_mission_for_completed_run``（既有链路）→ mock 返 ``"done"``，不依赖 GLM。
    - ``GLMConfig.from_env`` → mock 返 None（不走 HTTP）。

    返回 ``{"cleanup_calls": [...]}`` 供断言 cleanup 是否被调用（X-003 验证）。
    """
    from app.modules.agent import delegation, finalizer
    from app.modules.agent import mcp_tools as mod

    cleanup_calls: list[uuid.UUID] = []

    async def _fake_converge_for_completed_run(session, run_id, cfg):
        return "done"

    async def _wired_finalize_merge(session, mission_id):
        # 注入 delegate：复现生产 task-08 接线（FinalizerService 由调用方注入 delegate）。
        fin = FinalizerService(session, None, host_fs_delegate=delegate)
        result = await fin.finalize_execute_mission(mission_id)
        return result.merged_branches, result.pending_conflicts

    async def _wired_cleanup(session, mission_id):
        cleanup_calls.append(mission_id)
        fin = FinalizerService(session, None, host_fs_delegate=delegate)
        await fin.cleanup_mission(mission_id)

    # converge_mission_for_completed_run 在 endpoint 函数体内延迟 import（from finalizer
    # import），patch 源 module finalizer 才能生效（每次调用都 re-import）。
    monkeypatch.setattr(
        finalizer, "converge_mission_for_completed_run", _fake_converge_for_completed_run
    )
    monkeypatch.setattr(mod, "_finalize_merge_for_mission", _wired_finalize_merge)
    monkeypatch.setattr(mod, "_cleanup_mission", _wired_cleanup)

    class _FakeGLMConfig:
        @staticmethod
        def from_env():
            return None

    monkeypatch.setattr(delegation, "GLMConfig", _FakeGLMConfig)
    return {"cleanup_calls": cleanup_calls}


# ---------------------------------------------------------------------------
# 场景1（成功路径）：2 worker 各独立 worktree → converge 全 merged → cleanup
# ---------------------------------------------------------------------------


class TestScenario1SuccessPath:
    @pytest.mark.asyncio
    async def test_two_workers_each_own_worktree_merge_and_cleanup(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """mission 派 2 worker → 各独立 worktree（branch 不同 / root_path=副本）→
        worker commit（diff_summary 回灌）→ converge 逐个 git_merge ok →
        cleanup 各副本 + patch artifact。

        断言：
        - 2 worker 各 worktree_branch 不同、dispatch 时 root_path 指副本。
        - finalize_execute_mission merged_branches=2、git_merge 调 2 次。
        - converge_mission 返 status=merged。
        - cleanup_mission 调 git_worktree_remove 各副本（=2 次）。
        """
        # resolve_root_path_for_daemon 无 prefix 配置时原样返回（task-07 同款）
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_team_mission(db_session, ws.id)
        w1 = await _make_pending_worker(db_session, mission.id, objective="写模块 A")
        w2 = await _make_pending_worker(db_session, mission.id, objective="写模块 B")

        delegate = _make_delegate_mock()
        placement = _make_placement_mock()
        exec_svc = MissionExecutionService(
            db_session, placement=placement, host_fs_delegate=delegate
        )

        # --- dispatch 2 worker ---
        lease1 = await exec_svc.dispatch_worker(
            w1, workspace_id=ws.id, user_id=uuid.uuid4(), read_only=False
        )
        lease2 = await exec_svc.dispatch_worker(
            w2, workspace_id=ws.id, user_id=uuid.uuid4(), read_only=False
        )

        # dispatch 接线验证：2 worker 各独立 worktree（branch 不同 / root_path=副本）
        assert lease1 is not None and lease2 is not None
        await db_session.refresh(w1)
        await db_session.refresh(w2)
        assert w1.worktree_branch is not None and w2.worktree_branch is not None
        assert w1.worktree_branch != w2.worktree_branch, "2 worker 必须各独立 worktree 分支"
        assert w1.worktree_branch == _worktree_branch(w1.id)
        assert w2.worktree_branch == _worktree_branch(w2.id)

        # dispatch_to_daemon 收到的 root_path 是各自副本（非 ws.root_path）
        call1_kwargs = placement.dispatch_to_daemon.call_args_list[0].kwargs
        call2_kwargs = placement.dispatch_to_daemon.call_args_list[1].kwargs
        assert call1_kwargs["root_path"] == _sibling_path(ws.root_path, w1.id)
        assert call2_kwargs["root_path"] == _sibling_path(ws.root_path, w2.id)
        assert call1_kwargs["root_path"] != call2_kwargs["root_path"]
        assert delegate.git_worktree_add.await_count == 2

        # --- 模拟 worker commit 后回灌（complete_lease → diff_summary → patch artifact）---
        # 真链路在 daemon 侧；单测直接置 completed + 采 patch artifact。
        w1.status = "completed"
        w1.diff_summary = "diff --git a/moduleA.py b/moduleA.py\n+def a(): pass"
        w2.status = "completed"
        w2.diff_summary = "diff --git a/moduleB.py b/moduleB.py\n+def b(): pass"
        db_session.add(w1)
        db_session.add(w2)
        await db_session.commit()
        await _collect_patch_artifact(db_session, w1)
        await _collect_patch_artifact(db_session, w2)

        # --- converge：逐个 git_merge（生产 finalize_execute_mission 真链路）---
        fin = FinalizerService(db_session, None, host_fs_delegate=delegate)
        merge_result = await fin.finalize_execute_mission(mission.id)

        assert sorted(merge_result.merged_branches) == sorted(
            [w1.worktree_branch, w2.worktree_branch]
        )
        assert merge_result.pending_conflicts == []
        assert delegate.git_merge.await_count == 2

        # --- cleanup：逐个 git_worktree_remove ---
        cleanup_result = await fin.cleanup_mission(mission.id)
        assert sorted(cleanup_result["cleaned"]) == sorted(
            [_sibling_path(ws.root_path, w1.id), _sibling_path(ws.root_path, w2.id)]
        )
        assert cleanup_result["patch_artifact_id"] is not None
        assert delegate.git_worktree_remove.await_count == 2

    @pytest.mark.asyncio
    async def test_converge_endpoint_merged_status_on_all_success(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """同场景经 converge_mission endpoint：全 merged → status=merged + converged=True
        + cleanup 被调一次（_cleanup_mission 接 delegate 后调 git_worktree_remove）。"""
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_team_mission(db_session, ws.id)
        await _make_orchestrator_run(db_session, mission.id)
        w1 = await _make_completed_worker(
            db_session, mission.id, worktree_branch="workers/aaaaaaaa"
        )
        w2 = await _make_completed_worker(
            db_session, mission.id, worktree_branch="workers/bbbbbbbb"
        )
        await _collect_patch_artifact(db_session, w1)
        await _collect_patch_artifact(db_session, w2)

        delegate = _make_delegate_mock()
        # git_merge 默认返成功（_make_delegate_mock 已置）
        harness = _patch_converge_helpers_with_delegate(monkeypatch, delegate)

        resp = await converge_mission(ws.id, mission.id, db_session, user=None)

        assert isinstance(resp, ConvergeResponse)
        assert resp.status == "merged"
        assert resp.converged is True
        assert sorted(resp.merged_branches) == sorted(["workers/aaaaaaaa", "workers/bbbbbbbb"])
        assert resp.conflicts == []
        assert harness["cleanup_calls"] == [mission.id], "全 merged 必须调 cleanup_mission"
        # delegate.git_merge 经 _wired_finalize_merge 被调 2 次
        assert delegate.git_merge.await_count == 2
        # cleanup 经 _wired_cleanup 调 git_worktree_remove 2 次
        assert delegate.git_worktree_remove.await_count == 2


# ---------------------------------------------------------------------------
# 场景2（冲突解决）：2 worker 改同一文件 → converge 首次冲突 → 重入 merged → cleanup
# ---------------------------------------------------------------------------


class TestScenario2ConflictResolution:
    @pytest.mark.asyncio
    async def test_conflict_then_reentry_resolves_and_cleans(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """2 worker 改同一文件 → converge 第一次：第1个 git_merge ok、第2个 conflict
        （pending_conflicts 非空）→ converge_mission 返 {status:conflict}（主 agent SDK
        解决，mock）→ 重入 converge：第2次 git_merge ok（mock already-up-to-date）→
        status=merged → cleanup。

        断言：
        - 状态机 conflict → merged。
        - 首次返 conflict + attempt +1（R-07 计数）。
        - 重入后 cleanup_calls=[mission.id]。
        """
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_team_mission(db_session, ws.id)
        await _make_orchestrator_run(db_session, mission.id)
        b1, b2 = "workers/aaaaaaaa", "workers/bbbbbbbb"
        await _make_completed_worker(db_session, mission.id, worktree_branch=b1)
        await _make_completed_worker(db_session, mission.id, worktree_branch=b2)

        delegate = _make_delegate_mock()
        conflict_payload = [{"file": "shared.py", "marker_lines": [10, 20], "branch": b2}]

        # git_merge 第一次返 b1 ok / b2 conflict；第二次（重入后已解决）两都 ok。
        call_state = {"n": 0}

        async def _git_merge(workspace, *, worker_branch):
            call_state["n"] += 1
            if call_state["n"] <= 2:
                # 第一次 converge：b1 ok / b2 conflict（改同一文件 shared.py）
                if worker_branch == b1:
                    return {
                        "ok": True,
                        "conflicts": [],
                        "merged_files": ["shared.py"],
                        "error": None,
                    }
                return {
                    "ok": False,
                    "conflicts": conflict_payload,
                    "merged_files": [],
                    "error": None,
                }
            # 重入 converge（主 agent 已 SDK 解决 + git add）：两都 ok（already-up-to-date 幂等）
            return {"ok": True, "conflicts": [], "merged_files": [], "error": None}

        delegate.git_merge = _git_merge
        harness = _patch_converge_helpers_with_delegate(monkeypatch, delegate)

        # --- 第一次 converge：冲突 ---
        resp1 = await converge_mission(ws.id, mission.id, db_session, user=None)
        assert resp1.status == "conflict"
        assert resp1.converged is False
        assert resp1.attempt == 1, "首次冲突 attempt 从 0 自增到 1"
        assert resp1.conflicts == conflict_payload
        assert resp1.merged_branches == [b1], "第1个 worker 已合，第2个待解决"
        assert harness["cleanup_calls"] == [], "冲突时不应清副本（待主 agent 解决）"

        # 验证 R-07 计数已落库
        m1 = (
            (await db_session.execute(select(AgentMission).where(AgentMission.id == mission.id)))
            .scalars()
            .first()
        )
        assert m1 is not None
        assert (m1.constraints or {}).get("conflict_attempts") == 1

        # --- 模拟主 agent SDK 解决冲突（git add）后重入 converge ---
        # 重置 _wired_finalize_merge 内部 FinalizerService 每次新建，merge 重跑走 call_state>=3
        resp2 = await converge_mission(ws.id, mission.id, db_session, user=None)
        assert resp2.status == "merged"
        assert resp2.converged is True
        assert sorted(resp2.merged_branches) == sorted([b1, b2])
        assert resp2.attempt == 1, "重入成功 attempt 不再自增（仍是首次冲突的计数）"
        assert harness["cleanup_calls"] == [mission.id], "重入全 merged 后必须 cleanup"


# ---------------------------------------------------------------------------
# 场景3（worker 创建失败）：dispatch git_worktree_add ok=False → run failed → 补派
# ---------------------------------------------------------------------------


class TestScenario3WorkerCreationFailure:
    @pytest.mark.asyncio
    async def test_worktree_add_fails_run_failed_and_main_agent_redispatches(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """worker dispatch 时 git_worktree_add ok=False（daemon 离线 / RPC 失败 / git 错）→
        run.status=failed + dispatch_worker 返 None + 不调 dispatch_to_daemon → 主 agent
        补派另一 worker（重 dispatch ok）。

        断言：
        - 失败 worker run.status=failed、dispatch_to_daemon 未为它调用。
        - dispatch_worker 返 None（不抛，主 agent 决策补派，design §9）。
        - 补派 worker 正常建副本 + dispatch_to_daemon 调用。
        """
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_team_mission(db_session, ws.id)
        w_fail = await _make_pending_worker(db_session, mission.id, objective="失败 worker")
        w_retry = await _make_pending_worker(db_session, mission.id, objective="补派 worker")

        # delegate 第一次 git_worktree_add 返 ok=False，第二次（补派）返 ok=True
        delegate = _make_delegate_mock()
        add_state = {"n": 0}

        async def _git_worktree_add(workspace, *, sibling_path, branch, base_ref):
            add_state["n"] += 1
            if add_state["n"] == 1:
                return {"ok": False, "worktree_path": None, "error": "rpc unavailable"}
            return {"ok": True, "worktree_path": sibling_path, "error": None}

        delegate.git_worktree_add = _git_worktree_add
        placement = _make_placement_mock()
        exec_svc = MissionExecutionService(
            db_session, placement=placement, host_fs_delegate=delegate
        )

        # --- 第一次 dispatch：worker 创建失败 ---
        lease_fail = await exec_svc.dispatch_worker(
            w_fail, workspace_id=ws.id, user_id=uuid.uuid4(), read_only=False
        )

        assert lease_fail is None, "worktree 创建失败 dispatch_worker 返 None（不抛）"
        await db_session.refresh(w_fail)
        assert w_fail.status == "failed", "失败 worker run 标 failed"
        assert w_fail.worktree_branch is None, "无副本不填 worktree_branch"
        # dispatch_to_daemon 不应为失败 worker 调用（没拿到副本 cwd 就不该派 lease）
        assert placement.dispatch_to_daemon.await_count == 0

        # --- 主 agent 补派另一 worker（生产由主 agent SDK 决策，单测直接重 dispatch）---
        lease_retry = await exec_svc.dispatch_worker(
            w_retry, workspace_id=ws.id, user_id=uuid.uuid4(), read_only=False
        )

        assert lease_retry is not None, "补派 worker 正常建副本 + 派 lease"
        await db_session.refresh(w_retry)
        assert w_retry.status == "pending"
        assert w_retry.worktree_branch == _worktree_branch(w_retry.id)
        # dispatch_to_daemon 只为补派 worker 调一次（失败 worker 未派）
        assert placement.dispatch_to_daemon.await_count == 1
        retry_kwargs = placement.dispatch_to_daemon.call_args.kwargs
        assert retry_kwargs["root_path"] == _sibling_path(ws.root_path, w_retry.id)


# ---------------------------------------------------------------------------
# 场景4（超轮次回退）：converge 反复冲突超 R-07 → failed_manual + needs_manual + 保留副本
# ---------------------------------------------------------------------------


class TestScenario4ExceedMaxAttemptsFallback:
    @pytest.mark.asyncio
    async def test_exceed_r07_returns_failed_manual_keeps_worktrees(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """converge 反复冲突超 R-07 上限（CONVERGE_MAX_CONFLICT_ATTEMPTS=3）→
        converge_mission 返 {status:failed_manual} + mission.constraints.needs_manual 设置
        + **不调 cleanup_mission**（副本保留，X-003）。

        断言：
        - attempt 计数到上限。
        - needs_manual 标记已落库（constraints.needs_manual.reason 含 R-07）。
        - cleanup 未调用（副本保留供人工排查，X-003）。
        """
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")
        # R-07 上限设 3（与默认一致，显式置便于可读性）
        monkeypatch.setenv("CONVERGE_MAX_CONFLICT_ATTEMPTS", "3")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_team_mission(db_session, ws.id)
        await _make_orchestrator_run(db_session, mission.id)
        b1, b2 = "workers/aaaaaaaa", "workers/bbbbbbbb"
        await _make_completed_worker(db_session, mission.id, worktree_branch=b1)
        await _make_completed_worker(db_session, mission.id, worktree_branch=b2)

        delegate = _make_delegate_mock()
        # git_merge 恒冲突（主 agent 始终解不出，模拟死循环）
        persistent_conflict = [{"file": "shared.py", "marker_lines": [10], "branch": b2}]

        async def _git_merge_always_conflict(workspace, *, worker_branch):
            if worker_branch == b1:
                return {"ok": True, "conflicts": [], "merged_files": ["x.py"], "error": None}
            return {
                "ok": False,
                "conflicts": persistent_conflict,
                "merged_files": [],
                "error": None,
            }

        delegate.git_merge = _git_merge_always_conflict
        harness = _patch_converge_helpers_with_delegate(monkeypatch, delegate)

        # 预置已累计 2 轮（attempt=2）→ 第 3 次冲突 attempt+1=3 未超 3 → 仍 conflict
        mission.constraints = {"mode": "team", "conflict_attempts": 2}
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)

        resp3 = await converge_mission(ws.id, mission.id, db_session, user=None)
        assert resp3.status == "conflict", "attempt+1=3 未超 3 → 仍给主 agent 机会"
        assert resp3.attempt == 3
        assert harness["cleanup_calls"] == []

        # 第 4 次（attempt=3 → +1=4 > 3）→ failed_manual
        resp4 = await converge_mission(ws.id, mission.id, db_session, user=None)
        assert resp4.status == "failed_manual"
        assert resp4.converged is False
        assert resp4.attempt == 3, "超限时 attempt 反映当前累计值（不再 +1 漂移）"
        assert resp4.conflicts == persistent_conflict
        # X-003：失败路径不清副本（保留供人工排查）
        assert harness["cleanup_calls"] == [], "超限 failed_manual 不应清副本（X-003 保留）"

        # needs_manual 标记已落库
        m_after = (
            (await db_session.execute(select(AgentMission).where(AgentMission.id == mission.id)))
            .scalars()
            .first()
        )
        assert m_after is not None
        nm = (m_after.constraints or {}).get("needs_manual")
        assert nm is not None, "超限必须标 needs_manual"
        assert "R-07" in nm.get("reason", ""), "needs_manual.reason 应含 R-07 标识"

    @pytest.mark.asyncio
    async def test_max_attempts_env_override_changes_threshold(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """CONVERGE_MAX_CONFLICT_ATTEMPTS env 覆盖（=1）→ 首次冲突即超限（attempt+1=1
        未超 1，第二次 +1=2 > 1 → failed_manual）。验证 R-07 阈值可配 + 失败保留副本。"""
        monkeypatch.setenv("HOST_PATH_PREFIX", "")
        monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")
        monkeypatch.setenv("CONVERGE_MAX_CONFLICT_ATTEMPTS", "1")

        ws = await _make_workspace(db_session, root_path="/tmp/repo")
        mission = await _make_team_mission(db_session, ws.id)
        await _make_orchestrator_run(db_session, mission.id)
        b1, b2 = "workers/aaaaaaaa", "workers/bbbbbbbb"
        await _make_completed_worker(db_session, mission.id, worktree_branch=b1)
        await _make_completed_worker(db_session, mission.id, worktree_branch=b2)

        delegate = _make_delegate_mock()

        async def _git_merge_conflict(workspace, *, worker_branch):
            if worker_branch == b1:
                return {"ok": True, "conflicts": [], "merged_files": [], "error": None}
            return {
                "ok": False,
                "conflicts": [{"file": "shared.py", "marker_lines": [1], "branch": b2}],
                "merged_files": [],
                "error": None,
            }

        delegate.git_merge = _git_merge_conflict
        harness = _patch_converge_helpers_with_delegate(monkeypatch, delegate)

        # 首次 converge：attempt=0 → +1=1 未超 1 → 仍 conflict
        resp1 = await converge_mission(ws.id, mission.id, db_session, user=None)
        assert resp1.status == "conflict"
        assert resp1.attempt == 1

        # 第二次 converge：attempt=1 → +1=2 > 1 → failed_manual
        resp2 = await converge_mission(ws.id, mission.id, db_session, user=None)
        assert resp2.status == "failed_manual"
        assert harness["cleanup_calls"] == [], "失败保留副本（X-003）"
