"""execution.py dispatch_worker 按 target_workspace_id 路由单测（task-04）。

change ``2026-08-19-cross-workspace-team-mission`` task-04 / D-001@v2：

- AC-01 零回归：``target_workspace_id=None`` 时等同于单 workspace（用 anchor）。
- AC-02 worktree 路径：``target_workspace_id`` 非空时 worktree 落目标 workspace root（非 anchor）。
- AC-03 provider/model：按目标 workspace 的 default_agent/model。
- AC-04 representative_fallback 旗标：target 异于 anchor 时传 ``True``（走代表 binding），
  target 等于 anchor 时传 ``False``（维持 borrow）。
- AC-05 target 无可用 binding：worker run 标 failed，mission 不崩。

路由规则（design §4.2）：
- ``effective_target = target_workspace_id or anchor_workspace_id``
- worktree/provider/placement 全按 ``effective_target`` 路由。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MissionExecutionService
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.workspace.model import Workspace


async def _make_workspace(
    db_session: AsyncSession,
    *,
    root_path: str | None = None,
    default_branch: str | None = "main",
    default_agent: str = "claude",
    default_model: str = "claude-3-5-sonnet-20241022",
) -> uuid.UUID:
    """Helper: 创建 workspace。"""
    uid = uuid.uuid4()
    if root_path is None:
        root_path = f"/tmp/repo-{uid.hex[:8]}"
    ws = Workspace(
        id=uid,
        name=f"t-{uid.hex[:8]}",
        slug=f"t-{uid.hex[:8]}",
        root_path=root_path,
        default_branch=default_branch,
        default_agent=default_agent,
        default_model=default_model,
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws.id


async def _make_worker(db_session: AsyncSession, *, mission_id: uuid.UUID) -> AgentRun:
    """Helper: 创建 worker run。"""
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status="pending",
        role="arch",
        objective="scan arch",
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    return run


def _make_delegate_mock(*, ok: bool, worktree_path: str | None = None, error: str | None = None):
    """Helper: 构造 HostFsDelegate mock。"""
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


async def test_dispatch_worker_target_null_uses_anchor(
    db_session: AsyncSession,
) -> None:
    """AC-01：target_workspace_id=None 时用 anchor workspace（零回归）。"""
    # Given: anchor workspace A
    anchor_ws_id = await _make_workspace(db_session, root_path="/tmp/a", default_agent="claude_a")
    mission = AgentMission(id=uuid.uuid4(), workspace_id=anchor_ws_id, objective="test mission")
    db_session.add(mission)
    await db_session.commit()

    run = await _make_worker(db_session, mission_id=mission.id)

    # Mock placement + delegate
    placement_mock = MagicMock()
    placement_mock.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    delegate_mock = _make_delegate_mock(ok=True, worktree_path="/tmp/a/.worktrees/12345678")

    service = MissionExecutionService(
        session=db_session,
        placement=placement_mock,
        host_fs_delegate=delegate_mock,
    )

    # When: dispatch_worker(target_workspace_id=None)
    lease_id = await service.dispatch_worker(
        run,
        workspace_id=anchor_ws_id,
        user_id=uuid.uuid4(),
        read_only=False,
        target_workspace_id=None,  # NULL → anchor
    )

    # Then: placement 被调用，workspace_id=anchor（非 NULL），provider=anchor 配置
    assert lease_id is not None
    placement_mock.dispatch_to_daemon.assert_called_once()
    call_kwargs = placement_mock.dispatch_to_daemon.call_args.kwargs
    assert call_kwargs["workspace_id"] == anchor_ws_id
    assert call_kwargs["provider"] == "claude_a"  # anchor 的 default_agent


async def test_dispatch_worker_target_workspace_routes_worktree(
    db_session: AsyncSession,
) -> None:
    """AC-02：target_workspace_id 非空时 worktree 落目标 workspace root。"""
    # Given: anchor A，target T
    anchor_ws_id = await _make_workspace(db_session, root_path="/tmp/a")
    target_ws_id = await _make_workspace(db_session, root_path="/tmp/t", default_agent="claude_t")
    mission = AgentMission(id=uuid.uuid4(), workspace_id=anchor_ws_id, objective="test mission")
    db_session.add(mission)
    await db_session.commit()

    run = await _make_worker(db_session, mission_id=mission.id)

    # Mock delegate git_worktree_add 返回目标路径
    delegate_mock = _make_delegate_mock(ok=True, worktree_path="/tmp/t/.worktrees/12345678")
    placement_mock = MagicMock()
    placement_mock.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())

    service = MissionExecutionService(
        session=db_session,
        placement=placement_mock,
        host_fs_delegate=delegate_mock,
    )

    # When: dispatch_worker(target_workspace_id=T)
    lease_id = await service.dispatch_worker(
        run,
        workspace_id=anchor_ws_id,
        user_id=uuid.uuid4(),
        read_only=False,
        target_workspace_id=target_ws_id,
    )

    # Then: git_worktree_add 被调用，workspace_id=T（target 非 anchor）
    assert lease_id is not None
    delegate_mock.git_worktree_add.assert_called_once()
    call_args = delegate_mock.git_worktree_add.call_args.args
    assert call_args[0].id == target_ws_id  # worktree 落 target workspace
    # 额外验收：跨 ws 派发传 representative_fallback=True（走代表 binding）
    call_kwargs = placement_mock.dispatch_to_daemon.call_args.kwargs
    assert call_kwargs["representative_fallback"] is True


async def test_dispatch_worker_target_workspace_routes_provider(
    db_session: AsyncSession,
) -> None:
    """AC-03：provider/model 取目标 workspace 的配置。"""
    # Given: anchor A（claude_a），target T（claude_t + custom_model）
    anchor_ws_id = await _make_workspace(
        db_session, default_agent="claude_a", default_model="model_a"
    )
    target_ws_id = await _make_workspace(
        db_session, default_agent="claude_t", default_model="model_t"
    )
    mission = AgentMission(id=uuid.uuid4(), workspace_id=anchor_ws_id, objective="test mission")
    db_session.add(mission)
    await db_session.commit()

    run = await _make_worker(db_session, mission_id=mission.id)

    delegate_mock = _make_delegate_mock(ok=True)
    placement_mock = MagicMock()
    placement_mock.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())

    service = MissionExecutionService(
        session=db_session,
        placement=placement_mock,
        host_fs_delegate=delegate_mock,
    )

    # When: dispatch_worker(target_workspace_id=T)
    await service.dispatch_worker(
        run,
        workspace_id=anchor_ws_id,
        user_id=uuid.uuid4(),
        read_only=False,
        target_workspace_id=target_ws_id,
    )

    # Then: placement 被调用，provider/model 来自 T（非 A）
    placement_mock.dispatch_to_daemon.assert_called_once()
    call_kwargs = placement_mock.dispatch_to_daemon.call_args.kwargs
    assert call_kwargs["provider"] == "claude_t"
    assert call_kwargs["model"] == "model_t"


async def test_dispatch_worker_target_equals_anchor_no_representative_fallback(
    db_session: AsyncSession,
) -> None:
    """AC-04：target=anchor 时 representative_fallback=False（维持 borrow）。"""
    # Given: 单 workspace 模式（target=anchor）
    ws_id = await _make_workspace(db_session)
    mission = AgentMission(id=uuid.uuid4(), workspace_id=ws_id, objective="test mission")
    db_session.add(mission)
    await db_session.commit()

    run = await _make_worker(db_session, mission_id=mission.id)

    delegate_mock = _make_delegate_mock(ok=True)
    placement_mock = MagicMock()
    placement_mock.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())

    service = MissionExecutionService(
        session=db_session,
        placement=placement_mock,
        host_fs_delegate=delegate_mock,
    )

    # When: dispatch_worker(target_workspace_id=anchor，即 None)
    await service.dispatch_worker(
        run,
        workspace_id=ws_id,
        user_id=uuid.uuid4(),
        read_only=False,
        target_workspace_id=None,  # NULL = anchor
    )

    # Then: placement 被调用，representative_fallback=False（维持 borrow）
    placement_mock.dispatch_to_daemon.assert_called_once()
    call_kwargs = placement_mock.dispatch_to_daemon.call_args.kwargs
    assert call_kwargs["representative_fallback"] is False


async def test_dispatch_worker_target_no_binding_marks_failed(
    db_session: AsyncSession,
) -> None:
    """AC-05：target 无可用 binding → worker run 标 failed（mission 不崩）。"""
    # Given: target T 无 binding，placement 抛 NoOnlineDaemonError
    from app.modules.agent.placement import NoOnlineDaemonError

    anchor_ws_id = await _make_workspace(db_session)
    target_ws_id = await _make_workspace(db_session)
    mission = AgentMission(id=uuid.uuid4(), workspace_id=anchor_ws_id, objective="test mission")
    db_session.add(mission)
    await db_session.commit()

    run = await _make_worker(db_session, mission_id=mission.id)

    delegate_mock = _make_delegate_mock(ok=True)
    placement_mock = MagicMock()
    # Mock placement 抛异常（target 无 binding）
    placement_mock.dispatch_to_daemon = AsyncMock(
        side_effect=NoOnlineDaemonError(
            workspace_id=target_ws_id,
            user_id=uuid.uuid4(),
            message="工作区无在线绑定（代表 binding 未命中）",
        )
    )

    service = MissionExecutionService(
        session=db_session,
        placement=placement_mock,
        host_fs_delegate=delegate_mock,
    )

    # When: dispatch_worker(target_workspace_id=T) 且无 binding
    lease_id = await service.dispatch_worker(
        run,
        workspace_id=anchor_ws_id,
        user_id=uuid.uuid4(),
        read_only=False,
        target_workspace_id=target_ws_id,
    )

    # Then: worker run 标 failed，返回 None（不抛，mission 不崩）
    assert lease_id is None
    await db_session.refresh(run)
    assert run.status == "failed"
