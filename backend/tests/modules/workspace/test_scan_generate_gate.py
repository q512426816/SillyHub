"""Tests for WorkspaceService.scan_generate gate (D-003@V2 / D-004).

Covers:
- Non-owner → PermissionDenied (403)
- Owner + existing scan docs + no force → AppError (409)
- Owner + force=True → scan proceeds successfully
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, PermissionDenied
from app.modules.auth.model import Role, UserWorkspaceRole
from app.modules.scan_docs.model import ScanDocument
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import WorkspaceService

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
async def _seed_workspace_owner_role(db_session: AsyncSession) -> dict[str, uuid.UUID]:
    """Seed a single ``workspace_owner`` Role row.

    The test engine is created from scratch (in-memory SQLite, no alembic), so
    ``roles`` is empty by default -- every test that touches role-based checks
    needs at least this role seeded first.
    """
    role = Role(
        id=uuid.uuid4(),
        key="workspace_owner",
        name="Workspace Owner",
        description="Workspace Owner",
        is_system=True,
    )
    db_session.add(role)
    await db_session.commit()
    return {"workspace_owner": role.id}


@pytest.fixture()
def mock_agent_service() -> MagicMock:
    svc = MagicMock()
    svc.start_scan_dispatch = AsyncMock()
    return svc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _bootstrap_workspace_with_owner(
    db_session: AsyncSession,
    *,
    root_path: str,
    owner_id: uuid.UUID,
    owner_role_id: uuid.UUID,
) -> Workspace:
    """Create a Workspace row, grant the given user ``workspace_owner``, and
    create a minimal SpecWorkspace so the dispatch path works.
    """
    ws = Workspace(
        id=uuid.uuid4(),
        name="test-ws",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
        created_by=owner_id,
    )
    db_session.add(ws)
    await db_session.flush()

    # Grant workspace_owner role
    db_session.add(
        UserWorkspaceRole(
            user_id=owner_id,
            workspace_id=ws.id,
            role_id=owner_role_id,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.flush()

    # Create minimal SpecWorkspace so spec_root lookup succeeds
    sws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        spec_root=str(root_path),
        strategy="platform-managed",
    )
    db_session.add(sws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


# ---------------------------------------------------------------------------
# Non-owner → 403
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_generate_non_owner_raises_403(
    db_session: AsyncSession,
    _seed_workspace_owner_role: dict[str, uuid.UUID],
    mock_agent_service: MagicMock,
    tmp_path,
):
    """Non-owner calling scan_generate on an existing workspace raises
    PermissionDenied (403) with "仅 owner 可扫描".
    """
    owner_id = uuid.uuid4()
    stranger_id = uuid.uuid4()
    project_dir = tmp_path / "p1"
    project_dir.mkdir()

    ws = await _bootstrap_workspace_with_owner(
        db_session,
        root_path=str(project_dir),
        owner_id=owner_id,
        owner_role_id=_seed_workspace_owner_role["workspace_owner"],
    )
    _ = ws  # workspace exists, used implicitly by _find_active_by_root_path

    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.return_value = fake_run

    svc = WorkspaceService(db_session)
    with pytest.raises(PermissionDenied) as exc_info:
        await svc.scan_generate(
            root_path=str(project_dir),
            user_id=stranger_id,
            agent_service=mock_agent_service,
        )
    assert "仅 owner 可扫描" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Owner + existing scan docs + no force → 409
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_generate_already_scanned_raises_409(
    db_session: AsyncSession,
    _seed_workspace_owner_role: dict[str, uuid.UUID],
    mock_agent_service: MagicMock,
    tmp_path,
):
    """Owner calling scan_generate on a workspace with existing scan documents
    and no force=True raises AppError with http_status 409.
    """
    owner_id = uuid.uuid4()
    project_dir = tmp_path / "p2"
    project_dir.mkdir()

    ws = await _bootstrap_workspace_with_owner(
        db_session,
        root_path=str(project_dir),
        owner_id=owner_id,
        owner_role_id=_seed_workspace_owner_role["workspace_owner"],
    )

    # Insert a scan document row
    db_session.add(
        ScanDocument(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            doc_type="architecture",
            path="/docs/arch.md",
            exists=True,
        )
    )
    await db_session.commit()

    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.return_value = fake_run

    svc = WorkspaceService(db_session)
    with pytest.raises(AppError) as exc_info:
        await svc.scan_generate(
            root_path=str(project_dir),
            user_id=owner_id,
            agent_service=mock_agent_service,
            force=False,
        )
    assert exc_info.value.http_status == 409
    assert "已有扫描结果" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Owner + existing scan docs + force=True → success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_generate_force_bypasses_gate(
    db_session: AsyncSession,
    _seed_workspace_owner_role: dict[str, uuid.UUID],
    mock_agent_service: MagicMock,
    tmp_path,
):
    """Owner with existing scan documents calling scan_generate with force=True
    bypasses the document-count gate and proceeds to dispatch.
    """
    owner_id = uuid.uuid4()
    project_dir = tmp_path / "p3"
    project_dir.mkdir()

    ws = await _bootstrap_workspace_with_owner(
        db_session,
        root_path=str(project_dir),
        owner_id=owner_id,
        owner_role_id=_seed_workspace_owner_role["workspace_owner"],
    )

    # Insert scan documents (should be bypassed by force=True)
    db_session.add(
        ScanDocument(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            doc_type="architecture",
            path="/docs/arch.md",
            exists=True,
        )
    )
    db_session.add(
        ScanDocument(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            doc_type="api",
            path="/docs/api.md",
            exists=True,
        )
    )
    await db_session.commit()

    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    mock_agent_service.start_scan_dispatch.return_value = fake_run

    svc = WorkspaceService(db_session)
    ws_id, run_id = await svc.scan_generate(
        root_path=str(project_dir),
        user_id=owner_id,
        agent_service=mock_agent_service,
        force=True,
    )
    assert ws_id == ws.id
    assert run_id == fake_run.id
    mock_agent_service.start_scan_dispatch.assert_awaited_once()
