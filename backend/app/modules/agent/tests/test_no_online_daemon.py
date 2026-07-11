"""Tests for the daemon-only execution backend (task-01).

Covers:
- ``RunPlacementService.decide_backend`` daemon-only semantics (no SERVER
  fallback, ``preferred_backend="server"`` rejected).
- ``NoOnlineDaemonError`` shape (user_id required, default message).
- ``AgentService.start_run`` failure path: ``decide_backend`` raises ->
  ``AgentRun.status="failed"`` + ``error_code="no_online_daemon"`` +
  ``output_redacted`` contains the localized message (AC-05).
- ``start_run`` happy path: online daemon -> run stays ``pending`` (daemon
  claims asynchronously).
- ``app.modules.agent.adapters.claude_code`` module removed (AC-01).
"""

from __future__ import annotations

import importlib
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.agent.placement import (
    ExecutionBackend,
    NoOnlineDaemonError,
    RunPlacementService,
)
from app.modules.agent.service import AgentService
from app.modules.task.model import Task
from app.modules.worktree.model import WorktreeLease

# ---- decide_backend daemon-only semantics ------------------------------------


@pytest.mark.asyncio
async def test_decide_backend_raises_no_online_daemon_when_no_binding():
    """无 per-member binding -> NoOnlineDaemonError（无 SERVER 回退）。

    D-007@2026-07-10：server-local 列删除后所有 workspace 永远 daemon-client，
    `_resolve_decide_runtime` 无 binding 行直接抛，不再回退 user 级 runtime 兜底。
    """
    session = AsyncMock()
    svc = RunPlacementService(session)
    with patch.object(
        RunPlacementService,
        "_resolve_decide_runtime",
        side_effect=NoOnlineDaemonError(workspace_id=uuid.uuid4(), user_id=uuid.uuid4()),
    ):
        with pytest.raises(NoOnlineDaemonError) as ei:
            await svc.decide_backend(
                workspace_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
            )
    assert ei.value.user_id is not None


@pytest.mark.asyncio
async def test_decide_backend_preferred_server_raises():
    """preferred_backend='server' is rejected (SERVER path removed)."""
    session = AsyncMock()
    svc = RunPlacementService(session)
    # _resolve_decide_runtime 不会被调用（preferred=server 在其之前就抛）。
    with patch.object(
        RunPlacementService,
        "_resolve_decide_runtime",
        return_value={"id": uuid.uuid4()},
    ):
        with pytest.raises(NoOnlineDaemonError):
            await svc.decide_backend(
                workspace_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                preferred_backend="server",
            )


@pytest.mark.asyncio
async def test_decide_backend_returns_daemon_when_online():
    """已绑定且 daemon 在线 -> ExecutionBackend.DAEMON。"""
    session = AsyncMock()
    svc = RunPlacementService(session)
    with patch.object(
        RunPlacementService,
        "_resolve_decide_runtime",
        return_value={"id": uuid.uuid4()},
    ):
        backend = await svc.decide_backend(
            workspace_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )
    assert backend is ExecutionBackend.DAEMON


# ---- NoOnlineDaemonError shape -----------------------------------------------


def test_no_online_daemon_error_requires_user_id():
    """user_id is mandatory -> TypeError when omitted."""
    with pytest.raises(TypeError):
        NoOnlineDaemonError()


def test_no_online_daemon_error_default_message():
    exc = NoOnlineDaemonError(user_id=uuid.uuid4())
    assert "未检测到在线 daemon" in exc.message
    assert str(exc) == exc.message
    assert exc.workspace_id is None  # allowed to be None (scan run)


# ---- start_run failure path (AC-05) ------------------------------------------


def _patched_start_run_env(*, decide_side_effect=None, decide_return=None, dispatch_return=None):
    """Build the patch context managers for start_run's collaborators."""
    bundle = MagicMock()
    bundle.spec_strategy = "v1"
    bundle.profile_version = "1"

    bs = AsyncMock(return_value=bundle)
    coord = MagicMock()
    coord.check_idempotency = AsyncMock(return_value=None)
    coord.compute_fingerprint.return_value = "fp"
    coord.generate_resume_token = AsyncMock()

    placement = MagicMock()
    if decide_side_effect is not None:
        placement.decide_backend = AsyncMock(side_effect=decide_side_effect)
    else:
        placement.decide_backend = AsyncMock(return_value=decide_return)
    placement.dispatch_to_daemon = AsyncMock(return_value=dispatch_return)

    patches = [
        patch("app.modules.agent.service.build_spec_bundle", new=bs),
        patch("app.modules.agent.service.ExecutionCoordinatorService", return_value=coord),
        patch("app.modules.agent.service.RunPlacementService", return_value=placement),
    ]
    return patches


def _make_session(task, lease):
    """AsyncSession mock with sync ``add`` and explicit async methods.

    ``AsyncMock()`` makes ``session.add`` (a sync SQLAlchemy call) return a
    coroutine, raising RuntimeWarning; a plain MagicMock with AsyncMock-wrapped
    async methods is the correct shape.  Note also that ``AsyncMock().return_value``
    defaults to another AsyncMock, so the execute result must be set explicitly
    to a plain MagicMock for ``.all()`` to stay synchronous.

    ``session.get`` dispatches by model class so new lookups (e.g. the
    task-03 ``Workspace`` bundle fetch) don't exhaust a fixed side-effect
    list.
    """
    session = MagicMock()

    async def _get(model, _pk, *args, **kwargs):
        if model is Task:
            return task
        if model is WorktreeLease:
            return lease
        # Workspace and any other model → None (task-03 bundle fetch path).
        return None

    session.get = AsyncMock(side_effect=_get)
    result = MagicMock()
    result.all.return_value = []
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_start_run_sets_failed_with_error_code():
    """decide_backend raises NoOnlineDaemonError -> failed + error_code."""
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()

    task = MagicMock()
    task.id = uuid.uuid4()
    task.workspace_id = workspace_id
    task.change_id = None
    lease = MagicMock()
    lease.id = uuid.uuid4()
    lease.status = "locked"
    session = _make_session(task, lease)

    svc = AgentService(session)
    exc = NoOnlineDaemonError(workspace_id=workspace_id, user_id=user_id)
    patches = _patched_start_run_env(decide_side_effect=exc)
    for p in patches:
        p.start()
    try:
        run = await svc.start_run(
            workspace_id=workspace_id,
            user_id=user_id,
            task_id=task.id,
            lease_id=lease.id,
        )
    finally:
        for p in patches:
            p.stop()

    assert run.status == "failed"
    assert run.error_code == "no_online_daemon"
    assert "未检测到在线 daemon" in (run.output_redacted or "")


@pytest.mark.asyncio
async def test_start_run_marks_failed_when_dispatch_returns_none():
    """decide_backend OK but dispatch_to_daemon returns None (race) -> failed."""
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()

    task = MagicMock()
    task.id = uuid.uuid4()
    task.workspace_id = workspace_id
    task.change_id = None
    lease = MagicMock()
    lease.id = uuid.uuid4()
    lease.status = "locked"
    session = _make_session(task, lease)

    svc = AgentService(session)
    patches = _patched_start_run_env(
        decide_return=ExecutionBackend.DAEMON,
        dispatch_return=None,
    )
    for p in patches:
        p.start()
    try:
        run = await svc.start_run(
            workspace_id=workspace_id,
            user_id=user_id,
            task_id=task.id,
            lease_id=lease.id,
        )
    finally:
        for p in patches:
            p.stop()

    assert run.status == "failed"
    assert run.error_code == "no_online_daemon"


@pytest.mark.asyncio
async def test_start_run_dispatches_when_online():
    """Online daemon -> run stays pending (daemon claims asynchronously)."""
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()

    task = MagicMock()
    task.id = uuid.uuid4()
    task.workspace_id = workspace_id
    task.change_id = None
    lease = MagicMock()
    lease.id = uuid.uuid4()
    lease.status = "locked"
    session = _make_session(task, lease)

    svc = AgentService(session)
    patches = _patched_start_run_env(
        decide_return=ExecutionBackend.DAEMON,
        dispatch_return=uuid.uuid4(),
    )
    for p in patches:
        p.start()
    try:
        run = await svc.start_run(
            workspace_id=workspace_id,
            user_id=user_id,
            task_id=task.id,
            lease_id=lease.id,
        )
    finally:
        for p in patches:
            p.stop()

    assert run.status == "pending"


# ---- claude_code module removed (AC-01) --------------------------------------


def test_claude_code_module_removed():
    """The claude_code adapter module must be removed (task-01)."""
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("app.modules.agent.adapters.claude_code")
