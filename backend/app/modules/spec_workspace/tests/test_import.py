"""Tests for spec-workspace import SSE flow (D-001 流式 + D-003 change reparse).

Covers 2026-07-01-spec-import-async-and-change-reparse：
- POST .../spec-workspace/import 返回 text/event-stream，依次推
  packing/packed/applying/reparsing_docs/reparsing_changes/done。
- daemon 离线 → error 事件（HTTP_504_DAEMON_RUNTIME_OFFLINE）正常关闭。
- reparse 阶段失败 → sync_status dirty，但流继续到 done（D-003 容错）。
- daemon 打包 remote 失败 → error 事件（HTTP_502_DAEMON_RPC_REMOTE）。

author: WhaleFall
created_at: 2026-07-01 13:30:00
"""

from __future__ import annotations

import base64
import io
import json
import tarfile
import uuid
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
    """Create a workspace + per-member binding for the platform admin.

    task-13：task-01 删除 ``workspaces.daemon_runtime_id`` 后，import router 经
    ``MemberBindingResolver`` 按 (workspace_id, user_id) 解析 daemon_id。这里同步
    建 ``DaemonInstance`` + ``WorkspaceMemberRuntime`` 绑定 admin 用户，让 router
    能拿到 daemon_id 走 RPC（daemon 运行时本身由 ``_patch_hub_send_rpc`` mock，
    无需真实心跳）。
    """
    from sqlalchemy import select

    from app.modules.auth.model import User
    from app.modules.daemon.model import DaemonInstance
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None

    ws = Workspace(
        id=uuid.uuid4(),
        name="import sse ws",
        slug=f"imp-sse-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/import-sse-{uuid.uuid4().hex}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    daemon = DaemonInstance(
        id=uuid.uuid4(),
        user_id=admin.id,
        hostname="import-test-host",
        server_url="http://localhost:8000",
        status="online",
    )
    db_session.add(daemon)
    await db_session.flush()
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=admin.id,
            daemon_id=daemon.id,
            root_path=ws.root_path,
            path_source="daemon-client",
        )
    )
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_workspace(db_session, workspace: Workspace, spec_root) -> SpecWorkspace:
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


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    """Parse SSE body into [(event, data_dict), ...]; skips comment lines."""
    events: list[tuple[str, dict]] = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block or block.startswith(":"):
            continue
        event = ""
        data_str = ""
        for line in block.split("\n"):
            if line.startswith("event: "):
                event = line[len("event: ") :]
            elif line.startswith("data: "):
                data_str = line[len("data: ") :]
        if event:
            events.append((event, json.loads(data_str) if data_str else {}))
    return events


def _patch_hub_send_rpc(side_effect: object) -> object:
    hub = AsyncMock()
    hub.send_rpc = AsyncMock(side_effect=side_effect)
    return patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub)


# ===========================================================================
# SSE import flow
# ===========================================================================


class TestImportSse:
    async def test_import_sse_happy_path_phases(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_daemon_client_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        tar_bytes = _build_tar({"docs": None, "docs/A.md": b"# A"})
        hub = AsyncMock()
        hub.send_rpc = AsyncMock(return_value={"tar_base64": base64.b64encode(tar_bytes).decode()})
        with (
            patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub),
            patch(
                "app.modules.scan_docs.service.ScanDocsService.reparse",
                new=AsyncMock(return_value=({"parsed": 1}, None)),
            ),
            patch(
                "app.modules.change.service.ChangeService.reparse",
                new=AsyncMock(return_value=({"parsed": 2}, None)),
            ),
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/import", headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("text/event-stream")
        names = [e for e, _ in _parse_sse(resp.text)]
        assert "packing" in names
        assert "packed" in names
        assert "applying" in names
        assert "done" in names

    async def test_import_sse_daemon_offline_error_event(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_daemon_client_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        with _patch_hub_send_rpc(DaemonRuntimeOffline("daemon offline")):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/import", headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        events = _parse_sse(resp.text)
        err = [d for e, d in events if e == "error"]
        assert len(err) == 1
        assert err[0]["code"] == "HTTP_504_DAEMON_RUNTIME_OFFLINE"
        assert "done" not in [e for e, _ in events]

    async def test_import_sse_daemon_remote_error_502(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_daemon_client_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        with _patch_hub_send_rpc(DaemonRpcRemoteError({"code": "pack_failed", "message": "boom"})):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/import", headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        err = [d for e, d in _parse_sse(resp.text) if e == "error"]
        assert err[0]["code"] == "HTTP_502_DAEMON_RPC_REMOTE"

    async def test_import_sse_reparse_failure_continues_to_done(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """D-003: docs reparse 失败 → dirty，但 changes 阶段仍跑、流到 done。"""
        ws = await _make_daemon_client_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        tar_bytes = _build_tar({"docs/A.md": b"# A"})
        hub = AsyncMock()
        hub.send_rpc = AsyncMock(return_value={"tar_base64": base64.b64encode(tar_bytes).decode()})
        with (
            patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub),
            patch(
                "app.modules.scan_docs.service.ScanDocsService.reparse",
                new=AsyncMock(side_effect=RuntimeError("docs boom")),
            ),
            patch(
                "app.modules.change.service.ChangeService.reparse",
                new=AsyncMock(return_value=({"parsed": 3}, None)),
            ),
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/import", headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        names = [e for e, _ in _parse_sse(resp.text)]
        assert "done" in names
        assert "reparsing_changes" in names

    async def test_import_sse_resolves_daemon_id_from_member_binding(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """daemon-entity-binding 补遗（ql-20260704-002）：daemon-client workspace 的
        daemon_id 存 per-member binding 行（workspace.daemon_runtime_id=NULL）。import
        必须经 MemberBindingResolver 解析 binding 拿 daemon_id，否则落 server path 分支
        返回 SPEC_IMPORT_PATH_UNRESOLVED "cannot resolve server path"。
        """
        from sqlalchemy import select

        from app.modules.auth.model import User
        from app.modules.daemon.model import DaemonInstance
        from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None

        # 新链路 workspace：daemon_id 存 member binding 行
        ws = Workspace(
            id=uuid.uuid4(),
            name="binding ws",
            slug=f"binding-{uuid.uuid4().hex[:8]}",
            root_path=f"/tmp/binding-{uuid.uuid4().hex}",
            status="active",
            component_key="comp",
        )
        db_session.add(ws)
        daemon = DaemonInstance(
            id=uuid.uuid4(),
            user_id=admin.id,
            hostname="binding-host",
            server_url="http://localhost:8000",
            status="online",
        )
        db_session.add(daemon)
        await db_session.flush()
        db_session.add(
            WorkspaceMemberRuntime(
                workspace_id=ws.id,
                user_id=admin.id,
                daemon_id=daemon.id,
                root_path=ws.root_path,
                path_source="daemon-client",
            )
        )
        await db_session.commit()
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        tar_bytes = _build_tar({"docs": None, "docs/A.md": b"# A"})
        hub = AsyncMock()
        hub.send_rpc = AsyncMock(return_value={"tar_base64": base64.b64encode(tar_bytes).decode()})
        with (
            patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub),
            patch(
                "app.modules.scan_docs.service.ScanDocsService.reparse",
                new=AsyncMock(return_value=({"parsed": 1}, None)),
            ),
            patch(
                "app.modules.change.service.ChangeService.reparse",
                new=AsyncMock(return_value=({"parsed": 1}, None)),
            ),
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/import", headers=auth_headers
            )

        assert resp.status_code == 200, resp.text
        events = _parse_sse(resp.text)
        names = [e for e, _ in events]
        # 走 daemon 分支：packed + done；不是 error SPEC_IMPORT_PATH_UNRESOLVED
        assert "packed" in names, f"expected daemon branch, got events: {events}"
        assert "done" in names
        err = [d for e, d in events if e == "error"]
        assert not err, f"unexpected error event: {err}"
        # RPC 用的是 binding 的 daemon_id（不是 NULL）
        hub.send_rpc.assert_awaited_once()
        rpc_daemon_id = hub.send_rpc.await_args.args[0]
        assert rpc_daemon_id == daemon.id


pytestmark = pytest.mark.asyncio
