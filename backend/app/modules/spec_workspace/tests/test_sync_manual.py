"""Tests for POST .../spec-workspace/sync-manual + GET .../sync-manual/pending.

Covers 2026-07-02-workspace-config-flow task-13 / D-012：
- server-local：root_path 在容器内可读 → 打包 .sillyspec → apply_sync 落盘 →
  立即返 ``{"status": "done"}``（与 import_from_repo 等价，复用 server-local 分支）。
- daemon-client：建 ``kind="spec-sync"`` 的 DaemonChangeWrite outbox 行（pending），
  返 ``{"status": "pending", "task_id": <uuid>}``；GET pending 查状态。

author: qinyi
created_at: 2026-07-02
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.modules.daemon.model import DaemonChangeWrite
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_workspace(
    db_session,
    *,
    path_source: str = "server-local",
    daemon_runtime_id: uuid.UUID | None = None,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="sync-manual ws",
        slug=f"sm-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/sync-manual-{uuid.uuid4().hex}",
        status="active",
        component_key="comp",
        path_source=path_source,
        daemon_runtime_id=daemon_runtime_id,
    )
    db_session.add(ws)
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


async def _make_member_binding(
    db_session,
    workspace: Workspace,
    *,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID | None,
    root_path: str,
    path_source: str,
) -> WorkspaceMemberRuntime:
    row = WorkspaceMemberRuntime(
        workspace_id=workspace.id,
        user_id=user_id,
        runtime_id=runtime_id,
        root_path=root_path,
        path_source=path_source,
    )
    db_session.add(row)
    await db_session.commit()
    return row


# ===========================================================================
# POST sync-manual
# ===========================================================================


class TestSyncManual:
    async def test_server_local_returns_done_directly(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """server-local：本机 .sillyspec → apply_sync 落盘返 done（不经 outbox）。"""
        ws = await _make_workspace(db_session, path_source="server-local")
        # 把 root_path 指向测试 tmp 目录（容器内可读），放一个 .sillyspec
        local_dir = tmp_path / "src"
        (local_dir / ".sillyspec" / "docs").mkdir(parents=True)
        (local_dir / ".sillyspec" / "docs" / "A.md").write_text("# A", encoding="utf-8")
        ws.root_path = str(local_dir)
        db_session.add(ws)
        await db_session.commit()
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        # mock reparse（避免依赖真实 parser 基建）
        with (
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
        ):
            resp = await client.post(
                f"/api/workspaces/{ws.id}/spec-workspace/sync-manual",
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body == {"status": "done"}

        # 不应建 spec-sync outbox 行
        stmt = select(DaemonChangeWrite).where(DaemonChangeWrite.workspace_id == ws.id)
        rows = (await db_session.execute(stmt)).scalars().all()
        assert len(rows) == 0

    async def test_daemon_client_creates_spec_sync_outbox_row(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """daemon-client：建 kind=spec-sync 的 DaemonChangeWrite 行，返 pending+task_id。"""
        ws = await _make_workspace(
            db_session,
            path_source="daemon-client",
            daemon_runtime_id=uuid.uuid4(),
        )
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        # 解析 actor user id（auth_headers 是 admin token；从 DB 查 admin user）。
        from app.modules.auth.model import User

        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None, "测试库需有 admin 用户"
        runtime_id = uuid.uuid4()
        await _make_member_binding(
            db_session,
            ws,
            user_id=admin.id,
            runtime_id=runtime_id,
            root_path="/home/user/project",
            path_source="daemon-client",
        )

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-manual",
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "pending"
        task_id = body["task_id"]
        assert task_id

        # DB 落 kind=spec-sync 行
        stmt = select(DaemonChangeWrite).where(DaemonChangeWrite.workspace_id == ws.id)
        rows = (await db_session.execute(stmt)).scalars().all()
        assert len(rows) == 1
        cw = rows[0]
        assert cw.kind == "spec-sync"
        assert cw.status == "pending"
        assert cw.runtime_id == runtime_id
        assert cw.change_key == "spec-sync"
        # files 携带 workspace_id 元信息
        assert isinstance(cw.files, list)
        assert any((isinstance(f, dict) and f.get("workspace_id") == str(ws.id)) for f in cw.files)


# ===========================================================================
# GET sync-manual/pending
# ===========================================================================


class TestSyncManualPending:
    async def test_pending_lists_spec_sync_rows_only(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session, path_source="daemon-client")
        await _make_spec_workspace(db_session, ws, tmp_path / "spec-root")

        rt = uuid.uuid4()
        # 一条 spec-sync + 一条 create（不应出现在 pending 列表）
        db_session.add_all(
            [
                DaemonChangeWrite(
                    id=uuid.uuid4(),
                    workspace_id=ws.id,
                    runtime_id=rt,
                    change_key="spec-sync",
                    kind="spec-sync",
                    files=[],
                    status="pending",
                ),
                DaemonChangeWrite(
                    id=uuid.uuid4(),
                    workspace_id=ws.id,
                    runtime_id=rt,
                    change_key="2026-07-02-demo",
                    kind="create",
                    files=[],
                    status="pending",
                ),
            ]
        )
        await db_session.commit()

        resp = await client.get(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-manual/pending",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()
        # 仅 spec-sync 行
        assert len(items) == 1
        assert items[0]["status"] == "pending"
        assert items[0]["runtime_id"] == str(rt)


pytestmark = pytest.mark.asyncio
