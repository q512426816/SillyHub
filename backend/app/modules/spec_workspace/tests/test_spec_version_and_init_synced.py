"""Tests for 2026-07-02-workspace-config-flow task-09 / D-010.

Covers the schema pieces landed by task-09:
- ``spec_workspaces.spec_version`` starts at 0, bumps by 1 each time
  ``apply_sync`` lands a new spec tree (the single persistence entry point —
  scan_generate itself only dispatches a lease, so the bump lives in
  ``_write_spec_root`` which apply_sync / import_from_repo / SSE import share).
- ``workspace_member_runtimes.init_synced_at`` / ``init_synced_spec_version``
  round-trip (added by task-03 model + this task's migration). They stay NULL by
  default; the init-lease complete path writes them (task-07) — here we only
  verify the columns exist and persist.

author: qinyi
created_at: 2026-07-02
"""

from __future__ import annotations

import io
import tarfile
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.service import SpecWorkspaceService
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_workspace(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="task-09 ws",
        slug=f"t9-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/task-09-test",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_workspace(db_session, workspace: Workspace, spec_root: str) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=spec_root,
        strategy="platform-managed",
        sync_status="pending",
    )
    db_session.add(spec_ws)
    await db_session.commit()
    await db_session.refresh(spec_ws)
    return spec_ws


def _build_tar(members: dict[str, bytes | None]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for name, data in members.items():
            if data is None:
                info = tarfile.TarInfo(name=name)
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
                tar.addfile(info)
            else:
                info = tarfile.TarInfo(name=name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
    buf.seek(0)
    return buf.read()


def _mock_reparse() -> object:
    """Patch both reparse services so apply_sync doesn't need a real parser."""
    return (
        patch(
            "app.modules.scan_docs.service.ScanDocsService.reparse",
            new=AsyncMock(
                return_value=({"parsed": 0, "created": 0, "updated": 0, "deleted": 0}, None)
            ),
        ),
        patch(
            "app.modules.change.service.ChangeService.reparse",
            new=AsyncMock(
                return_value=({"parsed": 0, "created": 0, "updated": 0, "deleted": 0}, None)
            ),
        ),
    )


# ===========================================================================
# SpecWorkspace.spec_version
# ===========================================================================


class TestSpecVersion:
    async def test_defaults_to_zero(self, db_session, tmp_path) -> None:
        """Newly created SpecWorkspace rows default spec_version=0 (D-010)."""
        ws = await _make_workspace(db_session)
        spec_ws = await _make_spec_workspace(db_session, ws, str(tmp_path / "spec-root"))

        assert spec_ws.spec_version == 0

    async def test_bumps_on_apply_sync_landing(self, db_session, tmp_path) -> None:
        """apply_sync landing increments spec_version by exactly 1 per call."""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        spec_root.mkdir()
        _spec_ws = await _make_spec_workspace(db_session, ws, str(spec_root))

        svc = SpecWorkspaceService(db_session)
        tar_bytes = _build_tar({"docs/A.md": b"# A"})

        p_doc, p_change = _mock_reparse()  # type: ignore[misc]
        with p_doc, p_change:  # type: ignore[has-type]
            await svc.apply_sync(ws.id, tar_bytes)
        refreshed = await svc.get(ws.id)
        assert refreshed.spec_version == 1

        # Second landing bumps again.
        tar_bytes_2 = _build_tar({"docs/B.md": b"# B"})
        with p_doc, p_change:  # type: ignore[has-type]
            await svc.apply_sync(ws.id, tar_bytes_2)
        refreshed = await svc.get(ws.id)
        assert refreshed.spec_version == 2

    async def test_existing_rows_backfill_zero(self, db_session, tmp_path) -> None:
        """A row inserted without an explicit spec_version persists as 0."""
        ws = await _make_workspace(db_session)
        spec_ws = await _make_spec_workspace(db_session, ws, str(tmp_path / "r"))

        # Re-read from DB to confirm the column default (not just ORM default).
        stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == ws.id)
        row = (await db_session.execute(stmt)).scalars().first()
        assert row is not None
        assert row.spec_version == 0
        assert spec_ws.spec_version == 0


# ===========================================================================
# WorkspaceMemberRuntime init_synced fields round-trip
# ===========================================================================


class TestInitSyncedFields:
    async def test_init_synced_fields_default_null(self, db_session) -> None:
        """New member-binding rows have NULL init_synced_* (uninitialized)."""
        ws = await _make_workspace(db_session)
        from app.modules.auth.model import User

        user = User(
            id=uuid.uuid4(),
            username=f"t9user-{uuid.uuid4().hex[:6]}",
            password_hash="x",
            display_name="t9",
        )
        db_session.add(user)
        await db_session.commit()

        row = WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=user.id,
            runtime_id=None,
            root_path="/tmp/p",
            path_source="server-local",
        )
        db_session.add(row)
        await db_session.commit()

        stmt = select(WorkspaceMemberRuntime).where(
            WorkspaceMemberRuntime.workspace_id == ws.id,
            WorkspaceMemberRuntime.user_id == user.id,
        )
        fetched = (await db_session.execute(stmt)).scalars().first()
        assert fetched is not None
        assert fetched.init_synced_at is None
        assert fetched.init_synced_spec_version is None

    async def test_init_synced_fields_round_trip(self, db_session) -> None:
        """The init-lease complete path can write both columns (task-07 contract)."""
        ws = await _make_workspace(db_session)
        from app.modules.auth.model import User

        user = User(
            id=uuid.uuid4(),
            username=f"t9user-{uuid.uuid4().hex[:6]}",
            password_hash="x",
            display_name="t9",
        )
        db_session.add(user)
        await db_session.commit()

        row = WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=user.id,
            runtime_id=None,
            root_path="/tmp/p",
            path_source="server-local",
        )
        db_session.add(row)
        await db_session.commit()

        # Simulate the init_completed write (task-07 path).
        seeded_at = datetime(2026, 7, 2, 12, 0, 0, tzinfo=UTC)
        row.init_synced_at = seeded_at
        row.init_synced_spec_version = 7
        await db_session.commit()

        # Fresh fetch to confirm persistence (a new SELECT returns a new
        # instance with the column values loaded; avoid expire_all() which
        # triggers a sync refresh and trips the async greenlet guard).
        stmt = select(WorkspaceMemberRuntime).where(
            WorkspaceMemberRuntime.workspace_id == ws.id,
            WorkspaceMemberRuntime.user_id == user.id,
        )
        fetched = (await db_session.execute(stmt)).scalars().first()
        assert fetched is not None
        assert fetched.init_synced_spec_version == 7
        assert fetched.init_synced_at is not None


pytestmark = pytest.mark.asyncio
