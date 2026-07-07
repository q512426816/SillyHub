"""task-06：patch/service.py apply_patch_to_worktree path_source 分流单测。

覆盖：
- daemon-client 分支调 HostFsDelegate.git_apply（ok / skipped / conflict 三态）
- server-local 分支保留容器内 git apply（零回归，NFR-02）
- facade 未注入 daemon-client 分支抛 PatchConflictError（防御）
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.daemon.patch.service import PatchConflictError, PatchService
from app.modules.workspace.model import AgentRunWorkspace, Workspace


async def _make_run_and_workspace(
    session: AsyncSession,
    *,
    path_source: str | None,
) -> tuple[AgentRun, Workspace]:
    run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="running")
    session.add(run)
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:8]}",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/irrelevant-daemon-client",
        status="active",
        path_source=path_source if path_source is not None else "server-local",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(run)
    await session.refresh(ws)
    session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    await session.commit()
    return run, ws


class _FakeFacade:
    """最小 facade stub：只暴露 host_fs_delegate property（task-06 注入点）。"""

    def __init__(self, delegate: AsyncMock) -> None:
        self._delegate = delegate

    @property
    def host_fs_delegate(self):
        return self._delegate


@pytest.mark.asyncio
async def test_daemon_client_branch_calls_host_fs_delegate_ok(db_session: AsyncSession) -> None:
    """daemon-client + delegate 返回 ok=True → 正常 return，不抛。"""
    run, _ws = await _make_run_and_workspace(db_session, path_source="daemon-client")
    svc = PatchService(db_session)
    delegate = AsyncMock()
    delegate.git_apply.return_value = {
        "ok": True,
        "conflict_detail": None,
        "skipped": False,
        "patch_id": "abc123",
    }
    svc._facade = _FakeFacade(delegate)

    await svc.apply_patch_to_worktree(
        agent_run_id=run.id,
        patch_data="diff --git a/f b/f\n",
        use_3way=True,
        path_source="daemon-client",
    )

    delegate.git_apply.assert_awaited_once()
    _kwargs = delegate.git_apply.await_args.kwargs
    assert _kwargs["use_3way"] is True
    assert _kwargs["agent_run_id"] == str(run.id)
    assert _kwargs["patch_data"].startswith("diff --git")


@pytest.mark.asyncio
async def test_daemon_client_branch_skipped_idempotent(db_session: AsyncSession) -> None:
    """daemon-client + delegate 返回 skipped=True → 幂等 return，不抛（D-008）。"""
    run, _ws = await _make_run_and_workspace(db_session, path_source="daemon-client")
    svc = PatchService(db_session)
    delegate = AsyncMock()
    delegate.git_apply.return_value = {
        "ok": True,
        "conflict_detail": None,
        "skipped": True,
        "patch_id": "abc123",
    }
    svc._facade = _FakeFacade(delegate)

    await svc.apply_patch_to_worktree(
        agent_run_id=run.id,
        patch_data="diff",
        path_source="daemon-client",
    )
    delegate.git_apply.assert_awaited_once()


@pytest.mark.asyncio
async def test_daemon_client_branch_conflict_raises_patch_conflict(
    db_session: AsyncSession,
) -> None:
    """daemon-client + delegate 返回 ok=False → PatchConflictError（含 RPC 失败兜底）。"""
    run, _ws = await _make_run_and_workspace(db_session, path_source="daemon-client")
    svc = PatchService(db_session)
    delegate = AsyncMock()
    delegate.git_apply.return_value = {
        "ok": False,
        "conflict_detail": "rpc unavailable",
        "skipped": False,
    }
    svc._facade = _FakeFacade(delegate)

    with pytest.raises(PatchConflictError):
        await svc.apply_patch_to_worktree(
            agent_run_id=run.id,
            patch_data="diff",
            path_source="daemon-client",
        )


@pytest.mark.asyncio
async def test_daemon_client_branch_no_facade_raises_conflict(
    db_session: AsyncSession,
) -> None:
    """facade 未注入（独立 PatchService）→ PatchConflictError（防御，生产不触发）。"""
    run, _ws = await _make_run_and_workspace(db_session, path_source="daemon-client")
    svc = PatchService(db_session)
    # svc._facade 默认 None
    with pytest.raises(PatchConflictError):
        await svc.apply_patch_to_worktree(
            agent_run_id=run.id,
            patch_data="diff",
            path_source="daemon-client",
        )


@pytest.mark.asyncio
async def test_server_local_branch_does_not_call_delegate(
    db_session: AsyncSession,
) -> None:
    """server-local → 不走 delegate，走容器内 git apply（_run_git_apply）。

    用 mock 拦截 _run_git_apply（避免 Windows git subprocess 路径不稳定），
    断言 delegate 未被调用 + _run_git_apply 被调用（server-local 分支确证）。
    """
    run, _ws = await _make_run_and_workspace(db_session, path_source="server-local")
    svc = PatchService(db_session)
    delegate = AsyncMock()  # server-local 不应触达
    svc._facade = _FakeFacade(delegate)

    git_apply_calls: list = []
    original_run_git_apply = PatchService._run_git_apply

    async def spy_run_git_apply(*, workdir, args, patch_data):
        git_apply_calls.append((workdir, args))
        # 模拟 check 通过 + apply 通过
        if "apply" in args and "--check" not in args:
            return True, ""
        return True, ""

    PatchService._run_git_apply = staticmethod(spy_run_git_apply)
    try:
        await svc.apply_patch_to_worktree(
            agent_run_id=run.id,
            patch_data="diff --git a/f b/f\n",
            path_source="server-local",
        )
    finally:
        PatchService._run_git_apply = original_run_git_apply
    delegate.git_apply.assert_not_called()
    # server-local 分支至少调了一次 git apply（check）
    assert len(git_apply_calls) >= 1
    assert git_apply_calls[0][1] == ["git", "apply", "--check"]


@pytest.mark.asyncio
async def test_server_local_default_none_behaves_as_server_local(
    db_session: AsyncSession,
) -> None:
    """path_source=None（默认）→ 不走 delegate，走 server-local（向后兼容）。

    用 mock 拦截 _run_git_apply，断言 delegate 未被调用（分流正确，default=None
    即 server-local）。"""
    run, _ws = await _make_run_and_workspace(db_session, path_source=None)
    svc = PatchService(db_session)
    delegate = AsyncMock()
    svc._facade = _FakeFacade(delegate)

    original_run_git_apply = PatchService._run_git_apply

    async def spy_run_git_apply(*, workdir, args, patch_data):
        # check 失败 + 3way 失败 → 走 PatchConflictError 路径
        return False, "fake stderr"

    PatchService._run_git_apply = staticmethod(spy_run_git_apply)
    try:
        from app.modules.daemon.patch.service import PatchConflictError

        with pytest.raises(PatchConflictError):
            await svc.apply_patch_to_worktree(
                agent_run_id=run.id,
                patch_data="not a real patch",
                use_3way=True,
                # path_source 不传，验证 default=None 走 server-local
            )
    finally:
        PatchService._run_git_apply = original_run_git_apply
    delegate.git_apply.assert_not_called()
