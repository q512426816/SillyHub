"""dispatch_worker per-worker worktree 接线单测（task-03）。

change ``2026-07-12-worker-worktree-isolation`` task-03 / D-001@v2 / D-005@v2：

- AC-01 正常创建：``MissionExecutionService`` 注入 ``HostFsDelegate`` 后，
  ``dispatch_worker`` 算 workspace 内 ``.worktrees/<run.id 短8>`` sibling 路径
  + 调 ``git_worktree_add`` → 把副本路径作 ``root_path`` 传 ``dispatch_to_daemon``
  （非 ``ws.root_path``）+ 填 ``AgentRun.worktree_branch``。
- AC-02 base_ref 兜底：``ws.default_branch`` 为 None → ``git_worktree_add`` 收到
  ``base_ref="HEAD"``（X-001 空值兜底）。
- AC-03 创建失败：``git_worktree_add`` 返回 ``ok=False`` → worker run 标
  ``failed``，``dispatch_to_daemon`` 不调用，``dispatch_worker`` 返回 None
  （不抛，主 agent 决策补派，design §9 兼容策略）。
- AC-04 向后兼容：未注入 ``HostFsDelegate`` → 保留原行为（``root_path=ws.root_path``，
  不填 ``worktree_branch``），single mode / 既有调用零回归（design §9）。

路径策略 D-001@v2：worktree 放 ``ws.root_path/.worktrees/<run.id 短8>/``（workspace
内，非父目录 sibling）——daemon ``allowed_roots`` 只含 ``ws.root_path``，父目录
sibling 会被 ``assertWithinAllowedRoots`` 拒绝（design §7）。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MissionExecutionService
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
        role="arch",
        objective="scan arch",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _make_delegate_mock(*, ok: bool, worktree_path: str | None = None, error: str | None = None):
    """Build a fake HostFsDelegate with git_worktree_add as a recording AsyncMock."""
    delegate = MagicMock()
    delegate.git_worktree_add = AsyncMock(
        return_value={
            "ok": ok,
            "worktree_path": worktree_path,
            "error": error,
        }
    )
    return delegate


# ---------------------------------------------------------------------------
# AC-01 正常创建：root_path=sibling + worktree_branch 填值
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_creates_worktree_and_passes_sibling_as_root(
    db_session: AsyncSession,
) -> None:
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    delegate = _make_delegate_mock(ok=True, worktree_path="/tmp/repo/.worktrees/abcd1234")
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    # dispatch_to_daemon 被调用，且 root_path 是 sibling 副本（非 ws.root_path）
    assert lease_id is not None
    fake_placement.dispatch_to_daemon.assert_awaited_once()
    kwargs = fake_placement.dispatch_to_daemon.call_args.kwargs
    expected_sibling = "/tmp/repo/.worktrees/" + str(run.id)[:8]
    assert kwargs["root_path"] == expected_sibling
    assert kwargs["root_path"] != "/tmp/repo"

    # git_worktree_add 被调用，sibling/branch/base_ref 正确
    delegate.git_worktree_add.assert_awaited_once()
    wt_kwargs = delegate.git_worktree_add.call_args.kwargs
    assert wt_kwargs["sibling_path"] == expected_sibling
    assert wt_kwargs["branch"] == "workers/" + str(run.id)[:8]
    assert wt_kwargs["base_ref"] == "main"

    # AgentRun.worktree_branch 填值（converge 时读取）
    await db_session.refresh(run)
    assert run.worktree_branch == "workers/" + str(run.id)[:8]
    # dispatch 后 run.status 由 lease 推进，dispatch_worker 不在此改 status
    assert run.status == "pending"


# ---------------------------------------------------------------------------
# AC-02 base_ref 空（ws.default_branch=None）→ 兜底 "HEAD"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_base_ref_defaults_to_head_when_branch_none(
    db_session: AsyncSession,
) -> None:
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch=None)
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    delegate = _make_delegate_mock(ok=True, worktree_path="/tmp/repo/.worktrees/x")
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)

    await svc.dispatch_worker(run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=True)

    wt_kwargs = delegate.git_worktree_add.call_args.kwargs
    # X-001 空值兜底：default_branch None → base_ref="HEAD"
    assert wt_kwargs["base_ref"] == "HEAD"
    # placement branch 参数也应为 None（与既有语义一致，不因 worktree 改变 lease branch）
    placement_kwargs = fake_placement.dispatch_to_daemon.call_args.kwargs
    assert placement_kwargs["branch"] is None


# ---------------------------------------------------------------------------
# AC-03 git_worktree_add 失败 → run failed + return None + 不调 dispatch_to_daemon
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_marks_run_failed_when_worktree_add_fails(
    db_session: AsyncSession,
) -> None:
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    delegate = _make_delegate_mock(ok=False, error="rpc unavailable")
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    # 失败：return None，不抛（主 agent 决策补派，design §9）
    assert lease_id is None
    # dispatch_to_daemon 绝不调用（worker 没拿到副本 cwd 就不该派 lease）
    fake_placement.dispatch_to_daemon.assert_not_awaited()
    # run 标 failed + worktree_branch 未填（无副本）
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.worktree_branch is None


# ---------------------------------------------------------------------------
# AC-04 向后兼容：未注入 HostFsDelegate → 原行为（root_path=ws.root_path，不建 worktree）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_without_delegate_keeps_legacy_root_path(
    db_session: AsyncSession,
) -> None:
    """未注入 delegate（single mode / 既有调用方未接线）→ 保留原行为。

    design §9 兼容策略：未配置 team 的既有 workspace 行为完全不变。
    生产接线（router/mcp_tools 传 delegate）由 task-05 完成。
    """
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    # 不传 host_fs_delegate
    svc = MissionExecutionService(db_session, placement=fake_placement)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=True
    )

    assert lease_id is not None
    placement_kwargs = fake_placement.dispatch_to_daemon.call_args.kwargs
    # root_path 保持 ws.root_path（resolve_root_path_for_daemon 改写后的宿主机路径）
    assert placement_kwargs["root_path"] == "/tmp/repo"
    # worktree_branch 不填
    await db_session.refresh(run)
    assert run.worktree_branch is None
