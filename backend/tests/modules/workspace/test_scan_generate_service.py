"""Tests for WorkspaceService.scan_generate()."""

import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import WorkspacePathNotFound
from app.modules.agent.model import AgentRun
from app.modules.agent.service import AgentService
from app.modules.workspace.model import AgentRunWorkspace, Workspace
from app.modules.workspace.schema import slugify
from app.modules.workspace.service import WorkspaceService


@pytest.fixture
def mock_agent_service():
    svc = MagicMock(spec=AgentService)
    svc.start_scan_dispatch = AsyncMock()
    return svc


# ---------------------------------------------------------------------------
# Normal flow: creates workspace + spec_workspace + triggers agent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_generate_creates_workspace_and_spec(
    db_session: AsyncSession, mock_agent_service, tmp_path
):
    """Normal flow: create workspace + spec_workspace + trigger agent."""
    project_dir = tmp_path / "my-project"
    project_dir.mkdir()

    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.return_value = fake_run

    svc = WorkspaceService(db_session)
    ws_id, run_id = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )

    assert ws_id is not None
    assert run_id == fake_run.id
    mock_agent_service.start_scan_dispatch.assert_awaited_once()


# ---------------------------------------------------------------------------
# root_path does not exist
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_generate_path_not_found(db_session: AsyncSession, mock_agent_service):
    """Raise WorkspacePathNotFound when root_path does not exist."""
    svc = WorkspaceService(db_session)
    with pytest.raises(WorkspacePathNotFound):
        await svc.scan_generate(
            root_path="/nonexistent/path",
            user_id=uuid.uuid4(),
            agent_service=mock_agent_service,
        )


# ---------------------------------------------------------------------------
# Idempotent: reuse existing active workspace, trigger new agent run
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_generate_idempotent_reuse(
    db_session: AsyncSession, mock_agent_service, tmp_path
):
    """Same root_path reuses existing workspace, triggers new agent run."""
    project_dir = tmp_path / "existing-project"
    project_dir.mkdir()

    fake_run_1 = MagicMock()
    fake_run_1.id = uuid.uuid4()
    fake_run_2 = MagicMock()
    fake_run_2.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.side_effect = [fake_run_1, fake_run_2]

    svc = WorkspaceService(db_session)
    ws_id_1, run_id_1 = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )
    ws_id_2, run_id_2 = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )

    assert ws_id_1 == ws_id_2  # reuse same workspace
    assert run_id_1 != run_id_2  # but trigger new agent run


# ---------------------------------------------------------------------------
# Slug conflict: different root_path, same trailing segment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_generate_slug_conflict(db_session: AsyncSession, mock_agent_service, tmp_path):
    """When two paths share the same trailing segment, slug gets a suffix."""
    dir_a = tmp_path / "alpha" / "my-project"
    dir_b = tmp_path / "beta" / "my-project"
    dir_a.mkdir(parents=True)
    dir_b.mkdir(parents=True)

    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.return_value = fake_run

    svc = WorkspaceService(db_session)
    ws_id_a, _ = await svc.scan_generate(
        root_path=str(dir_a),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )
    ws_id_b, _ = await svc.scan_generate(
        root_path=str(dir_b),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )

    assert ws_id_a != ws_id_b  # two distinct workspaces

    # Verify the second slug is different from the first
    ws_a = await db_session.get(Workspace, ws_id_a)
    ws_b = await db_session.get(Workspace, ws_id_b)
    assert ws_a.slug != ws_b.slug


# ---------------------------------------------------------------------------
# workspace name is path trailing segment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_generate_name_from_path(db_session: AsyncSession, mock_agent_service, tmp_path):
    """workspace name is the trailing segment of root_path."""
    project_dir = tmp_path / "CoolProject"
    project_dir.mkdir()

    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.return_value = fake_run

    svc = WorkspaceService(db_session)
    ws_id, _ = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )

    ws = await db_session.get(Workspace, ws_id)
    assert ws.name == "CoolProject"
    assert ws.slug == slugify("CoolProject")


# ---------------------------------------------------------------------------
# start_scan_dispatch receives correct arguments
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_generate_passes_correct_args_to_agent(
    db_session: AsyncSession, mock_agent_service, tmp_path
):
    """start_scan_dispatch is called with workspace_id, user_id, root_path, spec_root."""
    project_dir = tmp_path / "arg-test"
    project_dir.mkdir()

    user_id = uuid.uuid4()
    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.return_value = fake_run

    svc = WorkspaceService(db_session)
    ws_id, _ = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=user_id,
        agent_service=mock_agent_service,
    )

    call_args = mock_agent_service.start_scan_dispatch.call_args
    assert call_args.kwargs["workspace_id"] == ws_id
    assert call_args.kwargs["user_id"] == user_id
    assert call_args.kwargs["root_path"] == str(project_dir)
    assert "spec_root" in call_args.kwargs


# ---------------------------------------------------------------------------
# Idempotent in-progress scan run reuse (task-05)
# ---------------------------------------------------------------------------


async def _make_scan_run(
    db_session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    status: str = "running",
    change_id: uuid.UUID | None = None,
    started_at: datetime | None = None,
) -> AgentRun:
    """Create a scan/bootstrap run (change_id=None) linked to a workspace."""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",  # NOT NULL, must be set explicitly
        status=status,
        change_id=change_id,  # None => scan run; non-None => change-bound
        started_at=started_at or datetime.utcnow(),
    )
    db_session.add(run)
    await db_session.flush()
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=workspace_id))
    await db_session.flush()
    return run


async def _bootstrap_workspace(svc: WorkspaceService, mock_agent_service, project_dir) -> uuid.UUID:
    """Trigger a first scan_generate to create a workspace, return its id."""
    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.return_value = fake_run
    ws_id, _ = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )
    return ws_id


@pytest.mark.asyncio
async def test_scan_generate_no_active_run_creates_and_dispatches(
    db_session: AsyncSession, mock_agent_service, tmp_path
):
    """Case 1: no in-progress run -> create new run and dispatch once."""
    project_dir = tmp_path / "p1"
    project_dir.mkdir()

    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.return_value = fake_run

    svc = WorkspaceService(db_session)
    _ws_id, run_id = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )

    assert run_id == fake_run.id
    mock_agent_service.start_scan_dispatch.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["running", "pending"])
async def test_scan_generate_idempotent_active_run(
    db_session: AsyncSession, mock_agent_service, tmp_path, status
):
    """Case 2: existing pending/running scan run -> idempotent, no dispatch."""
    project_dir = tmp_path / f"p-{status}"
    project_dir.mkdir()

    svc = WorkspaceService(db_session)
    ws_id = await _bootstrap_workspace(svc, mock_agent_service, project_dir)

    existing = await _make_scan_run(db_session, ws_id, status=status)
    mock_agent_service.start_scan_dispatch.reset_mock()

    ws_id_2, run_id_2 = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )

    assert ws_id_2 == ws_id
    assert run_id_2 == existing.id
    mock_agent_service.start_scan_dispatch.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "failed"])
async def test_scan_generate_ignores_terminal_run(
    db_session: AsyncSession, mock_agent_service, tmp_path, status
):
    """Case 3: only completed/failed run -> still create new run + dispatch."""
    project_dir = tmp_path / f"p-term-{status}"
    project_dir.mkdir()

    svc = WorkspaceService(db_session)
    ws_id = await _bootstrap_workspace(svc, mock_agent_service, project_dir)

    await _make_scan_run(db_session, ws_id, status=status)

    fake_run_new = MagicMock()
    fake_run_new.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.reset_mock()
    mock_agent_service.start_scan_dispatch.return_value = fake_run_new

    _ws_id, run_id = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )

    assert run_id == fake_run_new.id
    mock_agent_service.start_scan_dispatch.assert_awaited_once()


@pytest.mark.asyncio
async def test_scan_generate_returns_most_recent_active_run(
    db_session: AsyncSession, mock_agent_service, tmp_path
):
    """Case 4: multiple in-progress runs -> return most recent by started_at."""
    project_dir = tmp_path / "p-multi"
    project_dir.mkdir()

    svc = WorkspaceService(db_session)
    ws_id = await _bootstrap_workspace(svc, mock_agent_service, project_dir)

    now = datetime.utcnow()
    await _make_scan_run(db_session, ws_id, status="running", started_at=now - timedelta(minutes=5))
    newer = await _make_scan_run(db_session, ws_id, status="running", started_at=now)
    mock_agent_service.start_scan_dispatch.reset_mock()

    _ws_id, run_id = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )

    assert run_id == newer.id
    mock_agent_service.start_scan_dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_scan_generate_ignores_run_on_other_workspace(
    db_session: AsyncSession, mock_agent_service, tmp_path
):
    """Case 7 (hardening): active run linked to a different workspace must not
    trigger idempotency for the current one -> still creates + dispatches."""
    project_dir = tmp_path / "p-isolated"
    project_dir.mkdir()

    svc = WorkspaceService(db_session)
    ws_id = await _bootstrap_workspace(svc, mock_agent_service, project_dir)

    # Active scan run associated with an unrelated workspace id.
    other_ws_id = uuid.uuid4()
    await _make_scan_run(db_session, other_ws_id, status="running")

    fake_run_new = MagicMock()
    fake_run_new.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.reset_mock()
    mock_agent_service.start_scan_dispatch.return_value = fake_run_new

    _ws_id, run_id = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )

    assert _ws_id == ws_id
    assert run_id == fake_run_new.id
    mock_agent_service.start_scan_dispatch.assert_awaited_once()


@pytest.mark.asyncio
async def test_scan_generate_ignores_change_bound_run(
    db_session: AsyncSession, mock_agent_service, tmp_path
):
    """Case 8 (hardening): a running but change-bound run (change_id non-None)
    is not a scan run -> idempotency must not hit, create + dispatch."""
    project_dir = tmp_path / "p-change-bound"
    project_dir.mkdir()

    svc = WorkspaceService(db_session)
    ws_id = await _bootstrap_workspace(svc, mock_agent_service, project_dir)

    await _make_scan_run(db_session, ws_id, status="running", change_id=uuid.uuid4())

    fake_run_new = MagicMock()
    fake_run_new.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.reset_mock()
    mock_agent_service.start_scan_dispatch.return_value = fake_run_new

    _ws_id, run_id = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=uuid.uuid4(),
        agent_service=mock_agent_service,
    )

    assert run_id == fake_run_new.id
    mock_agent_service.start_scan_dispatch.assert_awaited_once()
