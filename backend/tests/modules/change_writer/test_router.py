"""Tests for change_writer router migration to SillySpecStageDispatchService."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _setup_workspace_and_change(
    session: AsyncSession,
    *,
    current_stage: str = "ready_for_dev",
) -> tuple[Workspace, Change]:
    """Create a workspace and a linked change with given stage."""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"test-ws-{uuid.uuid4().hex[:6]}",
        slug=f"test-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()

    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=f"test-change-{uuid.uuid4().hex[:6]}",
        title="Test change for router",
        status="draft",
        location="active",
        path="/tmp/test-change",
        current_stage=current_stage,
        stages={},
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return ws, change


async def _setup_user(session: AsyncSession) -> User:
    """Create a test user and return it."""
    from app.core.security import password_hasher

    user = User(
        id=uuid.uuid4(),
        email=f"test-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("Test123!@#"),
        display_name="Test User",
        status="active",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


# ===================================================================
# 1. test_execute_change_calls_dispatch_next_step
# ===================================================================


async def test_execute_change_calls_dispatch_next_step(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_admin_token: str,
) -> None:
    """POST /changes/{change_key}/execute calls SillySpecStageDispatchService.dispatch_next_step."""
    ws, change = await _setup_workspace_and_change(db_session)

    with patch("app.modules.change.dispatch.SillySpecStageDispatchService") as MockService:
        mock_svc = MockService.return_value
        mock_svc.dispatch_next_step = AsyncMock(
            return_value={
                "dispatched": True,
                "agent_run_id": str(uuid.uuid4()),
                "stage": "execute",
            }
        )

        resp = await client.post(
            f"/api/workspaces/{ws.id}/changes/{change.change_key}/execute",
            headers={"Authorization": f"Bearer {auth_admin_token}"},
        )

    assert resp.status_code == 200
    mock_svc.dispatch_next_step.assert_called_once()
    call_kwargs = mock_svc.dispatch_next_step.call_args[1]
    assert call_kwargs["change_id"] == change.id
    assert call_kwargs["workspace_id"] == ws.id
    assert call_kwargs["target_stage"] == "execute"


# ===================================================================
# 2. test_execute_change_returns_run_id_on_success
# ===================================================================


async def test_execute_change_returns_run_id_on_success(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_admin_token: str,
) -> None:
    """Successful dispatch returns ok=True with run_id and stage."""
    ws, change = await _setup_workspace_and_change(db_session)
    run_id = str(uuid.uuid4())

    with patch("app.modules.change.dispatch.SillySpecStageDispatchService") as MockService:
        mock_svc = MockService.return_value
        mock_svc.dispatch_next_step = AsyncMock(
            return_value={
                "dispatched": True,
                "agent_run_id": run_id,
                "stage": "execute",
            }
        )

        resp = await client.post(
            f"/api/workspaces/{ws.id}/changes/{change.change_key}/execute",
            headers={"Authorization": f"Bearer {auth_admin_token}"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["run_id"] == run_id
    assert data["stage"] == "execute"


# ===================================================================
# 3. test_execute_change_returns_reason_on_dispatch_failure
# ===================================================================


async def test_execute_change_returns_reason_on_dispatch_failure(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_admin_token: str,
) -> None:
    """Dispatch failure returns ok=False with reason and stage."""
    ws, change = await _setup_workspace_and_change(db_session)

    with patch("app.modules.change.dispatch.SillySpecStageDispatchService") as MockService:
        mock_svc = MockService.return_value
        mock_svc.dispatch_next_step = AsyncMock(
            return_value={
                "dispatched": False,
                "reason": "active_run_exists",
                "stage": "execute",
            }
        )

        resp = await client.post(
            f"/api/workspaces/{ws.id}/changes/{change.change_key}/execute",
            headers={"Authorization": f"Bearer {auth_admin_token}"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert data["reason"] == "active_run_exists"
    assert data["stage"] == "execute"


# ===================================================================
# 4. test_execute_change_does_not_import_coordinator
# ===================================================================


def test_execute_change_does_not_import_coordinator() -> None:
    """router.py source must not contain ExecutionCoordinatorService import."""
    import inspect

    import app.modules.change_writer.router as router_mod

    source = inspect.getsource(router_mod)
    assert "ExecutionCoordinatorService" not in source
    assert "start_sillyspec_run" not in source
