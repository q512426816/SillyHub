"""Tests for SpecBootstrapService — coordinates spec workspace initialization.

author: qinyi
created_at: 2026-05-28
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import SpecWorkspaceNotFound
from app.modules.agent.base import AgentRunResult
from app.modules.spec_profile.model import SpecConflict
from app.modules.spec_workspace.bootstrap import SpecBootstrapService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace


def _fake_agent_result(**overrides) -> AgentRunResult:
    defaults = dict(exit_code=0, stdout="", stderr="", redacted_output="ok")
    defaults.update(overrides)
    return AgentRunResult(**defaults)


async def _create_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="Test Workspace",
        slug="test-ws",
        root_path="/tmp/test-ws",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_spec_workspace(
    session: AsyncSession,
    workspace: Workspace,
    spec_root: str,
) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=spec_root,
        strategy="platform-managed",
        sync_status="dirty",
    )
    session.add(spec_ws)
    await session.commit()
    await session.refresh(spec_ws)
    return spec_ws


# ── Bootstrap tests ────────────────────────────────────────────────────────────


class TestBootstrapCreatesDirectory:
    """bootstrap() creates spec_root directory on disk."""

    async def test_directory_created(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        with patch(
            "app.modules.spec_workspace.bootstrap.ClaudeCodeAdapter.run_with_bundle",
            new_callable=AsyncMock,
            return_value=_fake_agent_result(),
        ):
            svc = SpecBootstrapService(db_session)
            await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        assert spec_root.exists()
        assert spec_root.is_dir()


class TestBootstrapValidatesAndSetsClean:
    """When validator passes, sync_status becomes 'clean'."""

    async def test_sync_status_clean(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        projects_dir = spec_root / ".sillyspec" / "projects"
        projects_dir.mkdir(parents=True, exist_ok=True)
        (projects_dir / "backend.yaml").write_text(
            "name: Backend\n",
            encoding="utf-8",
        )

        with patch(
            "app.modules.spec_workspace.bootstrap.ClaudeCodeAdapter.run_with_bundle",
            new_callable=AsyncMock,
            return_value=_fake_agent_result(),
        ):
            svc = SpecBootstrapService(db_session)
            result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        assert result["sync_status"] == "clean"
        assert result["validation_passed"] is True

        stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == ws.id)
        db_spec_ws = (await db_session.execute(stmt)).scalars().first()
        assert db_spec_ws is not None
        assert db_spec_ws.sync_status == "clean"


class TestBootstrapValidationFailureSetsDirty:
    """When validator finds errors, sync_status becomes 'dirty'."""

    async def test_sync_status_dirty(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        (spec_root / ".sillyspec").mkdir(parents=True, exist_ok=True)

        with patch(
            "app.modules.spec_workspace.bootstrap.ClaudeCodeAdapter.run_with_bundle",
            new_callable=AsyncMock,
            return_value=_fake_agent_result(),
        ):
            svc = SpecBootstrapService(db_session)
            result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        assert result["sync_status"] == "dirty"
        assert result["validation_passed"] is False

        stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == ws.id)
        db_spec_ws = (await db_session.execute(stmt)).scalars().first()
        assert db_spec_ws is not None
        assert db_spec_ws.sync_status == "dirty"


class TestBootstrapCreatesConflictOnFailure:
    """Validation errors create SpecConflict records in the database."""

    async def test_conflict_records_created(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws = await _create_workspace(db_session)
        spec_root = tmp_path / "specs" / str(ws.id)
        await _create_spec_workspace(db_session, ws, str(spec_root))

        projects_dir = spec_root / ".sillyspec" / "projects"
        projects_dir.mkdir(parents=True, exist_ok=True)
        (projects_dir / "app.yaml").write_text(
            "name: myapp\nrelations:\n  - target: nonexistent-component\n    type: depends_on\n",
            encoding="utf-8",
        )

        with patch(
            "app.modules.spec_workspace.bootstrap.ClaudeCodeAdapter.run_with_bundle",
            new_callable=AsyncMock,
            return_value=_fake_agent_result(),
        ):
            svc = SpecBootstrapService(db_session)
            result = await svc.bootstrap(ws.id, user_id=uuid.uuid4())

        assert result["validation_passed"] is False
        assert len(result["errors"]) > 0

        stmt = select(SpecConflict).where(SpecConflict.workspace_id == ws.id)
        conflicts = (await db_session.execute(stmt)).scalars().all()
        assert len(conflicts) >= 1

        conflict = conflicts[0]
        assert conflict.stage == "bootstrap"
        assert conflict.status == "open"


class TestBootstrapWorkspaceNotFound:
    """bootstrap() raises SpecWorkspaceNotFound when workspace_id is missing."""

    async def test_raises_not_found(self, db_session: AsyncSession) -> None:
        svc = SpecBootstrapService(db_session)

        with pytest.raises(SpecWorkspaceNotFound):
            await svc.bootstrap(uuid.uuid4(), user_id=uuid.uuid4())
