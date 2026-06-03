"""Tests for WorkspaceService.scan_generate()."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import WorkspacePathNotFound
from app.modules.agent.service import AgentService
from app.modules.workspace.model import Workspace
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
