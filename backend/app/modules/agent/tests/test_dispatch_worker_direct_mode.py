"""dispatch_worker 三态 git 模式分流单测（task-05）。

change ``2026-08-24-session-team-mission-context`` task-05 / FR-04 / D-006@v2 /
D-007@v1 / design §5.D：

- **git**：探测返 ``"git"`` → 照旧 per-worker worktree（``git_worktree_add`` 调用
  + ``worktree_branch`` 落列，全链路与现状一致）。
- **direct**：探测返 ``"direct"``（daemon 真答 ``.git`` ``exists=False``，确证非
  git checkout）→ 跳过 worktree 创建：``root_path=resolve_root_path_for_daemon(
  ws.root_path)``（工作区根即 worker cwd）、``run.worktree_branch`` 保持 None
  （路径A 语义，finalizer 合并/清理只选 NOT NULL 天然跳过，D-007@v1）、
  ``dispatch_to_daemon branch=None``（lease metadata 不写 branch——:232-233 的
  ``ws.default_branch`` 回退在 direct 旁路）、prompt 用直通变体（无 git
  add/commit 指令、结果落盘段无「随 commit 提交」措辞、含直通约束文案）。
- **unknown**：探测返 ``"unknown"``（transport 异常 / 未绑 daemon / 超时，task-02
  helper 内归 unknown）→ 维持现状仍尝试 worktree，失败按
  ``worktree_create_failed`` 既有语义（D-006@v2：宁可 failed 也不误直通）；
  delegate 未注入（None）→ 同视 unknown 走现状（无 delegate 无 worktree 的既有
  兼容路径，对照 test_dispatch_worker_worktree.py AC-04）。

render_worker_prompt mode 参数：缺省（"git"）与既有文案逐字节一致；"direct"
切换直通变体（两段调整：worktree 协作约束块替换 + 结果落盘段去 commit 措辞）；
"unknown" 渲染既有变体（现状语义）。

mock 模式复刻 ``test_dispatch_worker_worktree.py``（db_session / fake placement
/ fake HostFsDelegate），probe 固定可注入返回值。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MissionExecutionService, render_worker_prompt
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.workspace.model import Workspace


async def _make_workspace(
    session: AsyncSession, *, root_path: str = "/tmp/repo", default_branch: str | None = "main"
) -> uuid.UUID:
    ws = Workspace(
        id=uuid.uuid4(),
        name="t",
        slug="t",
        root_path=root_path,
        default_branch=default_branch,
        default_agent="claude_code",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws.id


async def _make_worker(session: AsyncSession, *, mission_id: uuid.UUID) -> AgentRun:
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status="pending",
        role="impl",
        objective="改前端页面",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _make_delegate_mock(*, probe: str = "git", ok: bool = True) -> MagicMock:
    """fake HostFsDelegate：probe_workspace_git_mode 可注入三态，git_worktree_add 可注入成败。"""
    delegate = MagicMock()
    delegate.probe_workspace_git_mode = AsyncMock(return_value=probe)
    delegate.git_worktree_add = AsyncMock(
        return_value={"ok": ok, "worktree_path": None, "error": None if ok else "rpc down"}
    )
    return delegate


def _make_placement() -> MagicMock:
    placement = MagicMock()
    placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    return placement


async def _seed(db_session: AsyncSession) -> tuple[uuid.UUID, AgentRun]:
    """建 workspace + mission + pending worker run（三件套）。"""
    ws_id = await _make_workspace(db_session)
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)
    return ws_id, run


# ---------------------------------------------------------------------------
# render_worker_prompt mode 参数（直通变体 / 缺省零改动）
# ---------------------------------------------------------------------------


class TestRenderWorkerPromptModes:
    def test_default_mode_matches_git_mode_byte_for_byte(self) -> None:
        """缺省调用（既有调用方形态）与 mode="git" 逐字节一致，含 commit 协作约束。"""
        run = AgentRun(role="impl", objective="整理架构清单")
        assert render_worker_prompt(run) == render_worker_prompt(run, mode="git")
        legacy = render_worker_prompt(run)
        assert "worktree 协作约束" in legacy
        assert "git add -A && git commit" in legacy
        assert "随 commit 提交" in legacy

    def test_direct_mode_swaps_constraint_and_drops_commit_wording(self) -> None:
        """mode="direct"：直通约束替换 worktree 约束块，全文无任何 commit 指令。"""
        run = AgentRun(role="impl", objective="整理架构清单")
        prompt = render_worker_prompt(run, mode="direct")
        # 直通约束（design §5.D 口径）
        assert "直接在工作区目录内工作" in prompt
        assert "无隔离副本" in prompt
        assert "避免并行写同一文件" in prompt
        # worktree 协作约束块被替换；无 commit/git add 指令（含结果落盘段措辞）
        assert "worktree 协作约束" not in prompt
        assert "commit" not in prompt
        assert "git add" not in prompt
        # 结果落盘要求保留（get_worker_result 按 run_id 收 AgentArtifact，不依赖分支）
        assert "get_worker_result" in prompt
        assert "results.md" in prompt

    def test_unknown_mode_renders_legacy_variant(self) -> None:
        """mode="unknown" 渲染既有变体（unknown=维持现状，含 commit 约束）。"""
        run = AgentRun(role="impl", objective="整理架构清单")
        assert render_worker_prompt(run, mode="unknown") == render_worker_prompt(run)


# ---------------------------------------------------------------------------
# 分支一 git：探测返 git → 照旧 worktree 隔离
# ---------------------------------------------------------------------------


async def test_probe_git_keeps_worktree_isolation(db_session: AsyncSession) -> None:
    ws_id, run = await _seed(db_session)
    delegate = _make_delegate_mock(probe="git")
    placement = _make_placement()
    svc = MissionExecutionService(db_session, placement=placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    # 探测被调（worktree 块前）+ worktree 照旧创建
    delegate.probe_workspace_git_mode.assert_awaited_once()
    delegate.git_worktree_add.assert_awaited_once()
    kwargs = placement.dispatch_to_daemon.call_args.kwargs
    assert kwargs["root_path"] == "/tmp/repo/.worktrees/" + str(run.id)[:8]
    # worktree_branch 落列（converge 时 finalizer 读取合并）
    await db_session.refresh(run)
    assert run.worktree_branch == "workers/" + str(run.id)[:8]
    # git 模式 prompt 保持既有变体（含 commit 指令）
    assert "worktree 协作约束" in kwargs["prompt"]
    assert "git add" in kwargs["prompt"]


# ---------------------------------------------------------------------------
# 分支二 direct：确证非 git → 跳过 worktree 直通工作区目录
# ---------------------------------------------------------------------------


async def test_probe_direct_skips_worktree_and_dispatches_into_workspace_root(
    db_session: AsyncSession,
) -> None:
    ws_id, run = await _seed(db_session)
    delegate = _make_delegate_mock(probe="direct")
    placement = _make_placement()
    svc = MissionExecutionService(db_session, placement=placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    delegate.probe_workspace_git_mode.assert_awaited_once()
    # 无 worktree 创建
    delegate.git_worktree_add.assert_not_awaited()
    kwargs = placement.dispatch_to_daemon.call_args.kwargs
    # root_path=工作区根（resolve_root_path_for_daemon 改写后），非 .worktrees 副本
    assert kwargs["root_path"] == "/tmp/repo"
    assert ".worktrees" not in kwargs["root_path"]
    # lease metadata 不写 branch（ws.default_branch 回退在 direct 旁路）
    assert kwargs["branch"] is None
    # worktree_branch 保持 None（路径A 语义，finalizer 只选 NOT NULL 天然跳过）
    await db_session.refresh(run)
    assert run.worktree_branch is None
    assert run.status == "pending"
    # prompt 直通变体：直通约束 + 无 commit 指令
    assert "直接在工作区目录内工作" in kwargs["prompt"]
    assert "无隔离副本" in kwargs["prompt"]
    assert "commit" not in kwargs["prompt"]


async def test_probe_direct_does_not_override_explicit_worker_prompt(
    db_session: AsyncSession,
) -> None:
    """caller 显式覆写 worker_prompt 时探测分流不影响 prompt（覆写形态零回归）。"""
    ws_id, run = await _seed(db_session)
    delegate = _make_delegate_mock(probe="direct")
    placement = _make_placement()
    svc = MissionExecutionService(db_session, placement=placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run,
        workspace_id=ws_id,
        user_id=uuid.uuid4(),
        read_only=False,
        worker_prompt="自定义 worker prompt（SillySpec execute 覆写）",
    )

    assert lease_id is not None
    kwargs = placement.dispatch_to_daemon.call_args.kwargs
    assert kwargs["prompt"] == "自定义 worker prompt（SillySpec execute 覆写）"


# ---------------------------------------------------------------------------
# 分支三 unknown：探测不可判定 → 维持现状（仍尝试 worktree，不降级直通）
# ---------------------------------------------------------------------------


async def test_probe_unknown_attempts_worktree_as_today(db_session: AsyncSession) -> None:
    ws_id, run = await _seed(db_session)
    delegate = _make_delegate_mock(probe="unknown")
    placement = _make_placement()
    svc = MissionExecutionService(db_session, placement=placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    delegate.probe_workspace_git_mode.assert_awaited_once()
    # unknown → 仍尝试 worktree（D-006@v2：不降级直通）
    delegate.git_worktree_add.assert_awaited_once()
    await db_session.refresh(run)
    assert run.worktree_branch == "workers/" + str(run.id)[:8]
    kwargs = placement.dispatch_to_daemon.call_args.kwargs
    assert kwargs["root_path"] == "/tmp/repo/.worktrees/" + str(run.id)[:8]
    # prompt 走既有变体（unknown=现状）
    assert "worktree 协作约束" in kwargs["prompt"]


async def test_probe_unknown_worktree_failure_keeps_failed_semantics(
    db_session: AsyncSession,
) -> None:
    """unknown + worktree 创建失败 → worktree_create_failed 既有语义不变（不直通）。"""
    ws_id, run = await _seed(db_session)
    delegate = _make_delegate_mock(probe="unknown", ok=False)
    placement = _make_placement()
    svc = MissionExecutionService(db_session, placement=placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is None
    placement.dispatch_to_daemon.assert_not_awaited()
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code == "worktree_create_failed"
    assert run.worktree_branch is None


async def test_probe_crash_maps_to_unknown_and_attempts_worktree(
    db_session: AsyncSession,
) -> None:
    """probe 调用抛非契约异常（防御性兜底面）→ 归 unknown 走现状 worktree。"""
    ws_id, run = await _seed(db_session)
    delegate = _make_delegate_mock()
    delegate.probe_workspace_git_mode = AsyncMock(side_effect=RuntimeError("boom"))
    placement = _make_placement()
    svc = MissionExecutionService(db_session, placement=placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    delegate.git_worktree_add.assert_awaited_once()
    await db_session.refresh(run)
    assert run.worktree_branch == "workers/" + str(run.id)[:8]


async def test_no_delegate_stays_legacy_path_with_default_branch(
    db_session: AsyncSession,
) -> None:
    """delegate 未注入（None）→ 视 unknown 走现状：无 worktree、branch=default_branch 回退。

    对照 direct 分支的 branch=None：legacy 无 delegate 路径的 :232-233 回退不变。
    """
    ws_id, run = await _seed(db_session)
    placement = _make_placement()
    svc = MissionExecutionService(db_session, placement=placement)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    kwargs = placement.dispatch_to_daemon.call_args.kwargs
    assert kwargs["root_path"] == "/tmp/repo"
    # 既有 default_branch 回退保留（与 direct 的 None 对照）
    assert kwargs["branch"] == "main"
    await db_session.refresh(run)
    assert run.worktree_branch is None
    # prompt 既有变体
    assert "worktree 协作约束" in kwargs["prompt"]


# ---------------------------------------------------------------------------
# ql-20260825-003：dispatch 写 run↔workspace 关联行（per-run 日志/产物端点授权依据）
# ---------------------------------------------------------------------------


async def test_dispatch_writes_run_workspace_links(db_session: AsyncSession) -> None:
    """派发后 run↔workspace 关联行落库（anchor + 显式 target 都关联）。

    缺关联行会让 /api/workspaces/{ws}/agent/runs/{id}/logs 等 per-run 端点
    （_require_run_workspace 按 AgentRunWorkspace 授权）对分身一律 403。
    """
    from sqlalchemy import select as _select
    from sqlmodel import col as _col

    from app.modules.workspace.model import AgentRunWorkspace

    ws_id, run = await _seed(db_session)
    delegate = _make_delegate_mock(probe="git")
    placement = _make_placement()
    svc = MissionExecutionService(db_session, placement=placement, host_fs_delegate=delegate)

    other_ws = uuid.UUID(int=42)
    lease_id = await svc.dispatch_worker(
        run,
        workspace_id=ws_id,
        user_id=uuid.uuid4(),
        read_only=False,
        target_workspace_id=other_ws,
    )
    assert lease_id is not None
    rows = (
        (
            await db_session.execute(
                _select(AgentRunWorkspace.workspace_id).where(
                    _col(AgentRunWorkspace.agent_run_id) == run.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert set(rows) == {ws_id, other_ws}
