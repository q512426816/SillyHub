"""task-09: 测试 stage 回写（complete_lease 后 last_dispatch.status 推进）。

验证 FR-004：``LeaseService.complete_lease`` 收尾时调用
``_sync_stage_status_from_run``，把 ``changes.stages.last_dispatch.status``
从 ``running`` 推进到 ``completed`` / ``failed``。

关键约束（D-003 守护）：
- 新方法独立路径，**不读 sillyspec.db**、**不调** ``dispatch_svc.sync_stage_status``。
- scan run（``agent_run.change_id is None``）早返回，不触碰 ``change.stages``。
- 回写失败（如 Change 不存在）只 ``log.warning``，不阻塞 lease 完成。
- ``last_dispatch`` 其他字段（stage / user_id / at / config / run_id）保留。

参考：``backend/tests/modules/change/test_dispatch_chain.py`` 的 real-DB fixture
模式（``_create_workspace`` / 直接构造 ``AgentRun`` + ``AgentRunWorkspace``）。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.change.model import Change
from app.modules.daemon.lease.service import LeaseService
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.workspace.model import AgentRunWorkspace, Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"stage-{uuid.uuid4().hex[:6]}@example.com",
        password_hash="x",
        display_name="stage-test",
        status="active",
    )
    session.add(user)
    await session.commit()
    return user.id


async def _create_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"stage-ws-{uuid.uuid4().hex[:6]}",
        slug=f"stage-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/stage-test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="stage-test-runtime",
        provider="claude",
        status="online",
    )
    session.add(runtime)
    await session.commit()
    await session.refresh(runtime)
    return runtime


def _build_last_dispatch(run_id: uuid.UUID, *, stage: str = "verify") -> dict:
    """预置 last_dispatch，模拟 dispatch 写入的初始 running 态。"""
    return {
        "stage": stage,
        "user_id": str(uuid.uuid4()),
        "at": "2026-07-08T10:00:00Z",
        "config": {"auto_dispatch_next": True},
        "run_id": str(run_id),
        "status": "running",
    }


async def _make_stage_lease(
    session: AsyncSession,
    *,
    run: AgentRun,
    runtime: DaemonRuntime,
    stage: str | None = "verify",
    claim_token: str = "test-claim-token",
) -> DaemonTaskLease:
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        agent_run_id=run.id,
        kind="interactive",
        status="claimed",
        metadata_={"claim_token": claim_token, **({"stage": stage} if stage else {})},
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


def _no_op_facade() -> MagicMock:
    """facade mock：所有跨子域回调（patch/run_sync/end_session/mission converge）
    一律 no-op，隔离 ``_sync_stage_status_from_run`` 的断言。

    按 TaskCard 约束（risk 段）：mock ``_facade._trigger_stage_completion_callback``
    为 no-op，避免它走 ``sync_stage_status`` 读 sillyspec.db 干扰新方法断言。
    """
    facade = MagicMock()
    facade._trigger_stage_completion_callback = AsyncMock(return_value=None)
    facade._apply_patch_to_worktree = AsyncMock(return_value=None)
    facade._run_post_scan_validation = AsyncMock(return_value=None)
    facade.end_session = AsyncMock(return_value=None)
    return facade


# ---------------------------------------------------------------------------
# 用例
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_complete_lease_promotes_last_dispatch_to_completed(
    db_session: AsyncSession,
) -> None:
    """run completed → last_dispatch.status == completed。"""
    user_id = await _create_user(db_session)
    ws = await _create_workspace(db_session)
    runtime = await _create_runtime(db_session, user_id)

    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=f"stage-c-{uuid.uuid4().hex[:6]}",
        title="stage completed",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/stage-c",
        current_stage="verify",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        model="claude-sonnet-4",
        status="running",
        change_id=change.id,
    )
    db_session.add(run)
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await db_session.commit()
    await db_session.refresh(run)

    # 预置 last_dispatch（running 态）
    change.stages = {"last_dispatch": _build_last_dispatch(run.id)}
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    lease = await _make_stage_lease(
        db_session, run=run, runtime=runtime, stage=change.current_stage
    )

    service = LeaseService(db_session)
    service._facade = _no_op_facade()

    await service.complete_lease(
        lease.id,
        "test-claim-token",
        result={"status": "completed", "output": "done"},
    )

    # 重新读 change，避开 identity map 缓存（JSON in-place mutation 坑）
    await db_session.refresh(change)
    assert change.stages["last_dispatch"]["status"] == "completed"

    refreshed_run = await db_session.get(AgentRun, run.id)
    assert refreshed_run.status == "completed"
    assert refreshed_run.finished_at is not None


@pytest.mark.asyncio
async def test_complete_lease_promotes_last_dispatch_to_failed_on_run_failure(
    db_session: AsyncSession,
) -> None:
    """run failed → last_dispatch.status == failed。"""
    user_id = await _create_user(db_session)
    ws = await _create_workspace(db_session)
    runtime = await _create_runtime(db_session, user_id)

    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=f"stage-f-{uuid.uuid4().hex[:6]}",
        title="stage failed",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/stage-f",
        current_stage="verify",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        model="claude-sonnet-4",
        status="running",
        change_id=change.id,
    )
    db_session.add(run)
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await db_session.commit()
    await db_session.refresh(run)

    change.stages = {"last_dispatch": _build_last_dispatch(run.id)}
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    lease = await _make_stage_lease(
        db_session, run=run, runtime=runtime, stage=change.current_stage
    )

    service = LeaseService(db_session)
    service._facade = _no_op_facade()

    await service.complete_lease(
        lease.id,
        "test-claim-token",
        result={"status": "failed", "error": "boom"},
    )

    await db_session.refresh(change)
    assert change.stages["last_dispatch"]["status"] == "failed"

    refreshed_run = await db_session.get(AgentRun, run.id)
    assert refreshed_run.status == "failed"


@pytest.mark.asyncio
async def test_complete_lease_skips_stage_writeback_for_scan_run(
    db_session: AsyncSession,
) -> None:
    """scan run（change_id=None）→ 不触发回写，方法早返回。

    验证 ``_sync_stage_status_from_run`` 的 ``agent_run.change_id is None`` 分支：
    不触碰任何 change.stages（scan 无 change，stages 保持空 dict）。
    """
    user_id = await _create_user(db_session)
    ws = await _create_workspace(db_session)
    runtime = await _create_runtime(db_session, user_id)

    # scan run：change_id=None
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        model="claude-sonnet-4",
        status="running",
        change_id=None,
        spec_strategy="platform-managed",
    )
    db_session.add(run)
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await db_session.commit()
    await db_session.refresh(run)

    lease = await _make_stage_lease(db_session, run=run, runtime=runtime, stage=None)

    service = LeaseService(db_session)
    service._facade = _no_op_facade()

    # 直接调 _sync_stage_status_from_run 验证早返回（scan 路径）
    await service._sync_stage_status_from_run(run)
    # scan run 无 change，方法不应触碰任何 stages（这里只是确认不抛、早返回）

    # 走完整 complete_lease 也确认不抛、lease 正常完成
    await service.complete_lease(
        lease.id,
        "test-claim-token",
        result={"status": "completed", "output": "scan done"},
    )

    refreshed_lease = await db_session.get(DaemonTaskLease, lease.id)
    assert refreshed_lease.status == "completed"
    # scan run 不应创建任何 change / 写入 stages（无 change_id 关联）
    refreshed_run = await db_session.get(AgentRun, run.id)
    assert refreshed_run.change_id is None


@pytest.mark.asyncio
async def test_complete_lease_stage_writeback_failure_does_not_block_lease(
    db_session: AsyncSession,
) -> None:
    """回写失败（如 Change 不存在）→ 不阻塞 lease 完成（log.warning 兜底）。

    构造一个 change_id 指向不存在的 Change（直接删 change 行模拟），让
    ``_sync_stage_status_from_run`` 走 ``change is None`` warn 分支。
    lease 仍应 status=completed。
    """
    user_id = await _create_user(db_session)
    ws = await _create_workspace(db_session)
    runtime = await _create_runtime(db_session, user_id)

    # 先建 change + run，再删 change，模拟 change 不存在
    ghost_change_id = uuid.uuid4()
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        model="claude-sonnet-4",
        status="running",
        change_id=ghost_change_id,
    )
    db_session.add(run)
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await db_session.commit()
    await db_session.refresh(run)

    lease = await _make_stage_lease(db_session, run=run, runtime=runtime, stage=None)

    service = LeaseService(db_session)
    service._facade = _no_op_facade()

    # Change 不存在：_sync_stage_status_from_run 走 warn 分支不抛
    # complete_lease 整体不被阻塞，lease 仍 completed
    await service.complete_lease(
        lease.id,
        "test-claim-token",
        result={"status": "completed", "output": "ok"},
    )

    refreshed_lease = await db_session.get(DaemonTaskLease, lease.id)
    assert refreshed_lease.status == "completed"


@pytest.mark.asyncio
async def test_complete_lease_does_not_read_sillyspec_db(
    db_session: AsyncSession,
    tmp_path,
) -> None:
    """D-003 守护：complete_lease 不读 sillyspec.db、不调 dispatch_svc.sync_stage_status。

    断言：
    1. ``SillySpecStageDispatchService.sync_stage_status`` 未被调用。
    2. ``_sync_stage_status_from_run`` 代码路径无 sqlite3 / sillyspec.db 文件读取
       （测试不创建 sillyspec.db 文件即能完成回写，证明独立路径）。
    """
    user_id = await _create_user(db_session)
    ws = await _create_workspace(db_session)
    runtime = await _create_runtime(db_session, user_id)

    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=f"stage-db-{uuid.uuid4().hex[:6]}",
        title="stage no db",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/stage-db",
        current_stage="verify",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        model="claude-sonnet-4",
        status="running",
        change_id=change.id,
    )
    db_session.add(run)
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await db_session.commit()
    await db_session.refresh(run)

    change.stages = {"last_dispatch": _build_last_dispatch(run.id)}
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    lease = await _make_stage_lease(
        db_session, run=run, runtime=runtime, stage=change.current_stage
    )

    service = LeaseService(db_session)
    service._facade = _no_op_facade()

    # mock sync_stage_status，断言从未被调用（新方法独立路径）
    with patch(
        "app.modules.change.dispatch.SillySpecStageDispatchService.sync_stage_status",
        new_callable=AsyncMock,
    ) as mock_sync:
        await service.complete_lease(
            lease.id,
            "test-claim-token",
            result={"status": "completed", "output": "done"},
        )
        mock_sync.assert_not_called()

    # 回写成功（无 sillyspec.db 文件存在，证明不依赖 spec sync）
    await db_session.refresh(change)
    assert change.stages["last_dispatch"]["status"] == "completed"

    # grep 守护：_sync_stage_status_from_run 可执行体不含 sillyspec.db / sqlite3 /
    # sync_stage_status 调用（docstring 里 "不读 sillyspec.db" 是描述，需排除）。
    # 用 ast 提取函数体内的所有 Call 节点名称，断言无 sqlite3 / sync_stage_status /
    # SpecPathResolver / sillyspec 路径访问。
    import ast
    import inspect
    import textwrap

    src = textwrap.dedent(inspect.getsource(LeaseService._sync_stage_status_from_run))
    tree = ast.parse(src)

    called_names: set[str] = set()

    def _collect_call_names(node: ast.AST) -> None:
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name):
                called_names.add(func.id)
            elif isinstance(func, ast.Attribute):
                # 收集属性链末端名（如 self._session.get → get；foo.sync_stage_status → sync_stage_status）
                called_names.add(func.attr)
        for child in ast.iter_child_nodes(node):
            _collect_call_names(child)

    for node in ast.walk(tree):
        _collect_call_names(node)

    assert "sqlite3" not in called_names
    assert "sync_stage_status" not in called_names
    assert "SpecPathResolver" not in called_names


@pytest.mark.asyncio
async def test_complete_lease_preserves_last_dispatch_other_fields(
    db_session: AsyncSession,
) -> None:
    """回写后 last_dispatch 的 stage/user_id/at/config/run_id 保留，仅 status 变更。"""
    user_id = await _create_user(db_session)
    ws = await _create_workspace(db_session)
    runtime = await _create_runtime(db_session, user_id)

    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=f"stage-p-{uuid.uuid4().hex[:6]}",
        title="stage preserve",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/stage-p",
        current_stage="verify",
        stages={},
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        model="claude-sonnet-4",
        status="running",
        change_id=change.id,
    )
    db_session.add(run)
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await db_session.commit()
    await db_session.refresh(run)

    original_last_dispatch = _build_last_dispatch(run.id, stage="verify")
    change.stages = {"last_dispatch": original_last_dispatch}
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)

    lease = await _make_stage_lease(
        db_session, run=run, runtime=runtime, stage=change.current_stage
    )

    service = LeaseService(db_session)
    service._facade = _no_op_facade()

    await service.complete_lease(
        lease.id,
        "test-claim-token",
        result={"status": "completed", "output": "done"},
    )

    await db_session.refresh(change)
    new_last_dispatch = change.stages["last_dispatch"]

    # status 推进
    assert new_last_dispatch["status"] == "completed"
    # 其他字段保留原值
    assert new_last_dispatch["stage"] == original_last_dispatch["stage"]
    assert new_last_dispatch["user_id"] == original_last_dispatch["user_id"]
    assert new_last_dispatch["at"] == original_last_dispatch["at"]
    assert new_last_dispatch["config"] == original_last_dispatch["config"]
    assert new_last_dispatch["run_id"] == original_last_dispatch["run_id"]
