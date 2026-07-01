"""Tests for spec-workspace import (daemon-client RPC error mapping).

Covers ql-20260701-001：``import_from_repo`` 经 daemon WS RPC ``get_spec_bundle``
的错误码语义——daemon 离线/超时/冲突透传既有 AppError（504/504/409），daemon
业务失败 re-map 成 403（forbidden）/ 502（其他），其余兜底 502
``SPEC_IMPORT_RPC_FAILED``。修复前全部被吞成 502，前端无法区分 "daemon 没开"
与 "真 RPC 失败"。

author: WhaleFall
created_at: 2026-07-01 08:58:05
"""

from __future__ import annotations

import base64
import io
import tarfile
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRuntimeOffline,
)
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_daemon_client_workspace(db_session) -> Workspace:
    """A daemon-client workspace bound to an arbitrary (offline) runtime id.

    SQLite test engine has FK enforcement off, so the random runtime id need
    not reference a real daemon_runtimes row.
    """
    ws = Workspace(
        id=uuid.uuid4(),
        name="import ws",
        slug=f"imp-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/import-test-{uuid.uuid4().hex}",
        status="active",
        component_key="comp",
        path_source="daemon-client",
        daemon_runtime_id=uuid.uuid4(),
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


def _patch_hub_send_rpc(side_effect: BaseException) -> object:
    """Patch ``get_daemon_ws_hub`` to return a hub whose send_rpc raises."""
    hub = AsyncMock()
    hub.send_rpc = AsyncMock(side_effect=side_effect)
    return patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub)


# ===========================================================================
# daemon-client import error mapping
# ===========================================================================


class TestImportDaemonClientErrors:
    async def test_import_daemon_offline_returns_504(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_daemon_client_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        with _patch_hub_send_rpc(DaemonRuntimeOffline("daemon runtime offline")):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/import",
                headers=auth_headers,
            )

        assert resp.status_code == 504, resp.text
        assert resp.json()["code"] == "HTTP_504_DAEMON_RUNTIME_OFFLINE"

    async def test_import_daemon_remote_error_returns_502(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_daemon_client_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        with _patch_hub_send_rpc(
            DaemonRpcRemoteError({"code": "pack_failed", "message": "no .sillyspec dir"})
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/import",
                headers=auth_headers,
            )

        assert resp.status_code == 502, resp.text
        assert resp.json()["code"] == "HTTP_502_DAEMON_RPC_REMOTE"

    async def test_import_daemon_forbidden_returns_403(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_daemon_client_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        with _patch_hub_send_rpc(
            DaemonRpcRemoteError({"code": "forbidden", "message": "root not allowed"})
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/import",
                headers=auth_headers,
            )

        assert resp.status_code == 403, resp.text
        assert resp.json()["code"] == "HTTP_403_DAEMON_RPC_FORBIDDEN"

    async def test_import_success_when_daemon_returns_bundle(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """Regression guard: the new except-chain must not break the happy path."""
        ws = await _make_daemon_client_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar({"docs": None, "docs/A.md": b"# A"})
        hub = AsyncMock()
        hub.send_rpc = AsyncMock(return_value={"tar_base64": base64.b64encode(tar_bytes).decode()})
        with (
            patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub),
            patch(
                "app.modules.scan_docs.service.ScanDocsService.reparse",
                new=AsyncMock(
                    return_value=({"parsed": 1, "created": 1, "updated": 0, "deleted": 0}, None)
                ),
            ),
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/import",
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["sync_status"] == "clean"
        # Tar applied to spec_root
        assert (spec_root / "docs" / "A.md").read_text(encoding="utf-8") == "# A"


# Suppress unused-import warning for pytest (used for fixture discovery in some setups).
pytestmark = pytest.mark.asyncio
