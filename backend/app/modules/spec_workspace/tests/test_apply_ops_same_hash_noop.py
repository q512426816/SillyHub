"""apply_ops 冲突分支同内容豁免（change 2026-08-15-init-trigger-sillyspec-init / task-09 / FR-05 / D-008@v2）。

场景：init 第二成员对已初始化 workspace 推 add(base_version=0) 骨架文件时，
服务器已有同名清单行（第一成员 init 建过）→ 版本不匹配。豁免规则：
``op.hash`` 非空且 == ``row.content_hash``（sha256 不可伪造，R-07）→ 同内容
no-op：跳过落盘、不置 conflict、``new_versions[path]=row.version``（daemon
manifest 对齐）。op.hash 缺失（旧 daemon 契约）或内容不符 → 维持 conflict。

验收（task-09 acceptance）：
- 版本不匹配 + hash 相同 → conflict=False，new_versions 回服务器版本，清单行不变
- 版本不匹配 + hash 不同 → 仍 conflict=True
- 不传 hash（旧 daemon 契约）→ 行为与现状一致（conflict）
- 无清单行 + add → 仍走新建 version=1（既有行为，R-07 不受影响）

author: qinyi
created_at: 2026-08-15
"""

from __future__ import annotations

import base64
import hashlib
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.workspace.model import Workspace


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _op(op: str, path: str, base_version: int = 0, **extra: object) -> dict[str, object]:
    d: dict[str, object] = {"op": op, "path": path, "base_version": base_version}
    d.update(extra)
    return d


async def _make_workspace(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="same-hash-noop ws",
        slug=f"shn-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/same-hash-noop-test",
        status="active",
        component_key="comp",
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
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()
    await db_session.refresh(spec_ws)
    return spec_ws


async def _add_file(
    client: AsyncClient, auth_headers: dict[str, str], ws: Workspace, path: str, text: str
) -> int:
    """铺底：增量 add 一份文件，返回其服务器版本号。"""
    resp = await client.post(
        f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
        headers=auth_headers,
        json={"ops": [_op("add", path, base_version=0, content=_b64(text))]},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["new_versions"][path]


async def _get_row(db_session, ws: Workspace, path: str) -> SpecFileManifest | None:
    return (
        (
            await db_session.execute(
                select(SpecFileManifest).where(
                    SpecFileManifest.workspace_id == ws.id,
                    SpecFileManifest.path == path,
                )
            )
        )
        .scalars()
        .first()
    )


class TestSameHashNoop:
    async def test_stale_version_same_hash_is_noop(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """版本不匹配 + hash 相同 → no-op：conflict=False，new_versions 回服务器版本。

        D-008@v2 场景：第二成员 init add(base_version=0)，服务器已有 version=1
        同内容行 → 跳过落盘，清单行 version/content_hash 原样不动。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        v1 = await _add_file(client, auth_headers, ws, "docs/skeleton.md", "# init skeleton")
        assert v1 == 1
        row_before = await _get_row(db_session, ws, "docs/skeleton.md")
        assert row_before is not None
        mtime_before = (spec_root / "docs" / "skeleton.md").stat().st_mtime

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        "docs/skeleton.md",
                        base_version=0,  # 过期（服务器 version=1）
                        content=_b64("# init skeleton"),
                        hash=_sha256("# init skeleton"),
                    )
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["conflict"] is False
        assert body["server_versions"] is None
        # new_versions 回服务器版本（daemon manifest 对齐）
        assert body["new_versions"] == {"docs/skeleton.md": 1}

        # 清单行不变（version/content_hash 不动）、文件未重写
        row_after = await _get_row(db_session, ws, "docs/skeleton.md")
        assert row_after is not None
        assert row_after.version == row_before.version
        assert row_after.content_hash == row_before.content_hash
        assert row_after.updated_at == row_before.updated_at
        assert (spec_root / "docs" / "skeleton.md").read_text(encoding="utf-8") == "# init skeleton"
        assert (spec_root / "docs" / "skeleton.md").stat().st_mtime == mtime_before

    async def test_stale_version_different_hash_still_conflicts(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """版本不匹配 + hash 不同 → 维持现状 conflict=True（真正内容分歧）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        await _add_file(client, auth_headers, ws, "docs/diverge.md", "server truth")

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "update",
                        "docs/diverge.md",
                        base_version=0,
                        content=_b64("daemon truth"),
                        hash=_sha256("daemon truth"),
                    )
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["conflict"] is True
        assert body["server_versions"] == {"docs/diverge.md": 1}
        assert body["new_versions"] == {}
        # 冲突文件未落盘
        assert (spec_root / "docs" / "diverge.md").read_text(encoding="utf-8") == "server truth"

    async def test_stale_version_without_hash_conflicts(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """不传 hash（旧 daemon 契约）→ 无法证明同内容，行为与现状一致（conflict）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        await _add_file(client, auth_headers, ws, "docs/legacy.md", "same content")

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        "docs/legacy.md",
                        base_version=0,
                        content=_b64("same content"),
                        # hash 缺失——旧 daemon
                    )
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["conflict"] is True
        assert body["server_versions"] == {"docs/legacy.md": 1}
        assert body["new_versions"] == {}

    async def test_no_row_add_still_creates_version_1(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """无清单行 + add（带 hash）→ 既有 R-07 行为不变：走新建 version=1。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        "docs/first.md",
                        base_version=0,
                        content=_b64("# first"),
                        hash=_sha256("# first"),
                    )
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["conflict"] is False
        assert body["new_versions"] == {"docs/first.md": 1}
        assert (spec_root / "docs" / "first.md").read_text(encoding="utf-8") == "# first"

        row = await _get_row(db_session, ws, "docs/first.md")
        assert row is not None
        assert row.version == 1
        assert row.content_hash == _sha256("# first")


pytestmark = pytest.mark.asyncio
