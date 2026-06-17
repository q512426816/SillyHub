"""Tests for provider resolution in AgentService dispatch entry points (task-03,
2026-06-14-agent-runtime-selection).

Covers FR-02 / R-02 / R-03: provider resolution precedence is
``explicit provider`` > ``workspace.default_agent`` > ``None``, applied
identically in ``start_run`` / ``start_stage_dispatch`` / ``start_scan_dispatch``.
Auto-scheduled runs (which never pass an explicit provider) inherit the
workspace default (R-03).

AC mapping (task-03):
- AC-01: default_agent="claude", provider=None -> dispatch receives "claude".
- AC-02: default_agent="claude", provider="codex" -> dispatch receives "codex".
- AC-03: default_agent=None, provider=None -> dispatch receives None.
- AC-04: start_stage_dispatch honours the same precedence (second entry point).

Collaborators (build_spec_bundle / ExecutionCoordinatorService /
RunPlacementService and stage-specific helpers) are mocked so the test focuses
purely on the provider argument reaching ``dispatch_to_daemon``.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.agent.placement import ExecutionBackend
from app.modules.agent.service import AgentService
from app.modules.change.model import Change
from app.modules.task.model import Task
from app.modules.workspace.model import Workspace
from app.modules.worktree.model import WorktreeLease

# ---- helpers -----------------------------------------------------------------


def _make_session(task, lease, workspace=None):
    """AsyncSession mock dispatching ``get`` by model class.

    ``Workspace`` lookups (the task-03 bundle fetch) return the supplied
    workspace mock so ``default_agent`` resolution has something to read.
    """
    session = MagicMock()

    async def _get(model, _pk, *args, **kwargs):
        if model is Task:
            return task
        if model is WorktreeLease:
            return lease
        if model is Workspace and workspace is not None:
            return workspace
        return None

    session.get = AsyncMock(side_effect=_get)
    result = MagicMock()
    result.all.return_value = []
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _patch_run_env(*, dispatch_return=None):
    """Patch start_run collaborators; return (managers, placement)."""
    bundle = MagicMock()
    bundle.spec_strategy = "v1"
    bundle.profile_version = "1"

    coord = MagicMock()
    coord.check_idempotency = AsyncMock(return_value=None)
    coord.compute_fingerprint.return_value = "fp"
    coord.generate_resume_token = AsyncMock()

    placement = MagicMock()
    placement.decide_backend = AsyncMock(return_value=ExecutionBackend.DAEMON)
    placement.dispatch_to_daemon = AsyncMock(return_value=dispatch_return)

    managers = [
        patch("app.modules.agent.service.build_spec_bundle", new=AsyncMock(return_value=bundle)),
        patch("app.modules.agent.service.ExecutionCoordinatorService", return_value=coord),
        patch("app.modules.agent.service.RunPlacementService", return_value=placement),
    ]
    return managers, placement


def _run_task_lease(workspace_id):
    task = MagicMock()
    task.id = uuid.uuid4()
    task.workspace_id = workspace_id
    task.change_id = None
    lease = MagicMock()
    lease.id = uuid.uuid4()
    lease.status = "locked"
    return task, lease


# ---- AC-01: default_agent used when no explicit provider ---------------------


@pytest.mark.asyncio
async def test_start_run_uses_workspace_default_agent():
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    task, lease = _run_task_lease(workspace_id)
    ws = MagicMock()
    ws.default_agent = "claude"
    ws.default_model = None
    session = _make_session(task, lease, ws)

    svc = AgentService(session)
    managers, placement = _patch_run_env(dispatch_return=uuid.uuid4())
    for m in managers:
        m.start()
    try:
        await svc.start_run(
            workspace_id=workspace_id,
            user_id=user_id,
            task_id=task.id,
            lease_id=lease.id,
        )
    finally:
        for m in managers:
            m.stop()

    assert placement.dispatch_to_daemon.call_args.kwargs["provider"] == "claude"


# ---- AC-02: explicit provider wins over default_agent -----------------------


@pytest.mark.asyncio
async def test_start_run_explicit_provider_wins():
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    task, lease = _run_task_lease(workspace_id)
    ws = MagicMock()
    ws.default_agent = "claude"
    ws.default_model = None
    session = _make_session(task, lease, ws)

    svc = AgentService(session)
    managers, placement = _patch_run_env(dispatch_return=uuid.uuid4())
    for m in managers:
        m.start()
    try:
        await svc.start_run(
            workspace_id=workspace_id,
            user_id=user_id,
            task_id=task.id,
            lease_id=lease.id,
            provider="codex",
        )
    finally:
        for m in managers:
            m.stop()

    assert placement.dispatch_to_daemon.call_args.kwargs["provider"] == "codex"


@pytest.mark.asyncio
async def test_start_run_uses_workspace_default_model():
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    task, lease = _run_task_lease(workspace_id)
    ws = MagicMock()
    ws.default_agent = "claude"
    ws.default_model = "claude-sonnet-4"
    session = _make_session(task, lease, ws)

    svc = AgentService(session)
    managers, placement = _patch_run_env(dispatch_return=uuid.uuid4())
    for m in managers:
        m.start()
    try:
        await svc.start_run(
            workspace_id=workspace_id,
            user_id=user_id,
            task_id=task.id,
            lease_id=lease.id,
        )
    finally:
        for m in managers:
            m.stop()

    assert placement.dispatch_to_daemon.call_args.kwargs["model"] == "claude-sonnet-4"


@pytest.mark.asyncio
async def test_start_run_explicit_model_wins():
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    task, lease = _run_task_lease(workspace_id)
    ws = MagicMock()
    ws.default_agent = "claude"
    ws.default_model = "claude-haiku"
    session = _make_session(task, lease, ws)

    svc = AgentService(session)
    managers, placement = _patch_run_env(dispatch_return=uuid.uuid4())
    for m in managers:
        m.start()
    try:
        await svc.start_run(
            workspace_id=workspace_id,
            user_id=user_id,
            task_id=task.id,
            lease_id=lease.id,
            model="claude-sonnet-4",
        )
    finally:
        for m in managers:
            m.stop()

    assert placement.dispatch_to_daemon.call_args.kwargs["model"] == "claude-sonnet-4"


# ---- AC-03: None when neither explicit nor default --------------------------


@pytest.mark.asyncio
async def test_start_run_none_when_unset():
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    task, lease = _run_task_lease(workspace_id)
    ws = MagicMock()
    ws.default_agent = None
    ws.default_model = None
    session = _make_session(task, lease, ws)

    svc = AgentService(session)
    managers, placement = _patch_run_env(dispatch_return=uuid.uuid4())
    for m in managers:
        m.start()
    try:
        await svc.start_run(
            workspace_id=workspace_id,
            user_id=user_id,
            task_id=task.id,
            lease_id=lease.id,
        )
    finally:
        for m in managers:
            m.stop()

    assert placement.dispatch_to_daemon.call_args.kwargs["provider"] is None


# ---- AC-04: start_stage_dispatch honours the same precedence ----------------


@pytest.mark.asyncio
async def test_start_stage_dispatch_uses_workspace_default_agent():
    workspace_id = uuid.uuid4()
    change_id = uuid.uuid4()
    user_id = uuid.uuid4()

    change = MagicMock()
    change.id = change_id
    change.title = "t"
    change.change_key = "k"
    change.path = "/c"
    change.current_stage = "draft"
    change.change_type = "feature"
    change.affected_components = []
    ws = MagicMock()
    ws.default_agent = "claude"
    ws.default_model = None

    session = MagicMock()

    async def _get(model, _pk, *args, **kwargs):
        if model is Change:
            return change
        if model is Workspace:
            return ws
        return None

    session.get = AsyncMock(side_effect=_get)
    result = MagicMock()
    result.all.return_value = []
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    placement = MagicMock()
    placement.decide_backend = AsyncMock(return_value=ExecutionBackend.DAEMON)
    placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())

    # Stage-specific collaborators short-circuited so the test targets only the
    # provider argument reaching dispatch_to_daemon.
    with (
        patch("app.modules.agent.service.RunPlacementService", return_value=placement),
        patch("app.modules.agent.service.resolve_work_dir", return_value="/tmp"),
        patch(
            "app.modules.change.dispatch.load_prompt_template",
            return_value="prompt",
        ),
        patch.object(
            AgentService,
            "_get_workspace_root",
            new=AsyncMock(return_value="/ws"),
        ),
    ):
        svc = AgentService(session)
        await svc.start_stage_dispatch(
            workspace_id=workspace_id,
            change_id=change_id,
            user_id=user_id,
            stage="implementation",
            prompt_template="tpl",
            requires_worktree=False,
            read_only=True,
        )

    assert placement.dispatch_to_daemon.call_args.kwargs["provider"] == "claude"
