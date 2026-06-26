"""Tests for spec bundle / sync endpoints (task-06).

Covers FR-05:
- GET .../spec-workspace/bundle → tar stream, excludes .runtime/
- POST .../spec-workspace/sync → overwrite spec_root + reparse

author: qinyi
created_at: 2026-06-18
"""

from __future__ import annotations

import io
import tarfile
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_workspace(db_session, *, component_key: str | None = "comp") -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="bundle-sync ws",
        slug=f"bs-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/bundle-sync-test",
        status="active",
        component_key=component_key,
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_workspace(db_session, workspace: Workspace, spec_root: Path) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()
    await db_session.refresh(spec_ws)
    return spec_ws


def _build_tar(members: dict[str, bytes | None]) -> bytes:
    """Build an in-memory tar. value=None → directory entry."""
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


# ===========================================================================
# GET bundle
# ===========================================================================


class TestBundle:
    async def test_bundle_returns_tar_stream_excluding_runtime(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        (spec_root / ".runtime").mkdir()
        (spec_root / ".runtime" / "cache.log").write_text("cache", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/spec-workspace/bundle",
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/x-tar"
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            names = tf.getnames()
            assert "docs/A.md" in names or "docs" in names
            # No member path should contain .runtime
            for n in names:
                assert ".runtime" not in n.split("/"), f"runtime leaked into bundle: {n}"

    async def test_bundle_empty_spec_root(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "empty-root"  # does not exist yet
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/spec-workspace/bundle",
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/x-tar"
        # Valid (empty) tar — must be parseable
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            tf.getmembers()

    async def test_bundle_workspace_not_found(self, client: AsyncClient, auth_headers) -> None:
        resp = await client.get(
            f"/api/workspaces/{uuid.uuid4()}/spec-workspace/bundle",
            headers=auth_headers,
        )
        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_SPEC_WORKSPACE_NOT_FOUND"


# ===========================================================================
# POST sync
# ===========================================================================


class TestSync:
    async def test_sync_overwrites_and_reparses(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("old", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        # New tar with only docs/B.md
        tar_bytes = _build_tar(
            {
                "docs": None,
                "docs/B.md": b"# B",
            }
        )

        # Mock reparse to avoid needing a real parser setup; return parsed=1
        with patch(
            "app.modules.scan_docs.service.ScanDocsService.reparse",
            new=AsyncMock(
                return_value=({"parsed": 1, "created": 1, "updated": 0, "deleted": 0}, None)
            ),
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/sync",
                headers={**auth_headers, "Content-Type": "application/x-tar"},
                content=tar_bytes,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body == {"ok": True, "reparsed": 1}

        # Old file gone, new file present
        assert not (spec_root / "docs" / "A.md").exists()
        assert (spec_root / "docs" / "B.md").read_text(encoding="utf-8") == "# B"

    async def test_sync_receives_runtime_dir_from_tar(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / ".runtime").mkdir(parents=True)
        (spec_root / ".runtime" / "x.log").write_text("runtime-cache", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar(
            {
                "docs/C.md": b"# C",
                ".runtime/sillyspec.db": b"daemon-runtime-db",
            }
        )

        with patch(
            "app.modules.scan_docs.service.ScanDocsService.reparse",
            new=AsyncMock(
                return_value=({"parsed": 0, "created": 0, "updated": 0, "deleted": 0}, None)
            ),
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/sync",
                headers={**auth_headers, "Content-Type": "application/x-tar"},
                content=tar_bytes,
            )

        assert resp.status_code == 200, resp.text
        # .runtime now comes from the daemon tar (D-003@v1 push path), not the old backend copy.
        assert not (spec_root / ".runtime" / "x.log").exists()
        assert (spec_root / ".runtime" / "sillyspec.db").read_bytes() == b"daemon-runtime-db"

    async def test_sync_invalid_tar_422(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        spec_root.mkdir(parents=True)
        (spec_root / "existing.md").write_text("keep", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync",
            headers={**auth_headers, "Content-Type": "application/x-tar"},
            content=b"not a tar payload at all",
        )

        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"
        # spec_root untouched
        assert (spec_root / "existing.md").read_text(encoding="utf-8") == "keep"

    async def test_sync_rejects_absolute_path(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        spec_root.mkdir(parents=True)
        (spec_root / "existing.md").write_text("keep", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar({"/etc/passwd": b"evil"})

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync",
            headers={**auth_headers, "Content-Type": "application/x-tar"},
            content=tar_bytes,
        )

        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"
        # spec_root untouched
        assert (spec_root / "existing.md").exists()

    async def test_sync_rejects_path_traversal(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        spec_root.mkdir(parents=True)
        (spec_root / "existing.md").write_text("keep", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar({"../../escape": b"evil"})

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync",
            headers={**auth_headers, "Content-Type": "application/x-tar"},
            content=tar_bytes,
        )

        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"
        # Nothing escaped
        assert not (tmp_path / "escape").exists()
        assert (spec_root / "existing.md").exists()

    async def test_sync_workspace_not_found(self, client: AsyncClient, auth_headers) -> None:
        tar_bytes = _build_tar({"docs/X.md": b"# X"})
        resp = await client.post(
            f"/api/workspaces/{uuid.uuid4()}/spec-workspace/sync",
            headers={**auth_headers, "Content-Type": "application/x-tar"},
            content=tar_bytes,
        )
        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_SPEC_WORKSPACE_NOT_FOUND"


# Suppress unused-import warning for pytest (used for fixture discovery in some setups).
pytestmark = pytest.mark.asyncio
