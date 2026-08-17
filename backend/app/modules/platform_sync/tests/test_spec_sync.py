"""platform_sync spec 增量同步端点测试（change 2026-08-17-spec-file-incremental-sync）。

覆盖新端点：
- GET /api/changes/-/spec-manifest
- POST /api/changes/-/spec-sync

测试点：shpsync_ 鉴权、清单读取、增量 add/update/delete/rename、base_version
冲突、空 ops、路径越界 422。
"""

from __future__ import annotations

import base64
import hashlib
import uuid
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.workspace.model import Workspace


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _op(op: str, path: str, base_version: int = 0, **extra: object) -> dict[str, object]:
    d: dict[str, object] = {"op": op, "path": path, "base_version": base_version}
    d.update(extra)
    return d


def _h(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def _make_workspace(db_session: Any, *, tag: str = "spec-sync") -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{tag}-{uuid.uuid4().hex[:8]}",
        slug=f"ws-{tag}-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/ws-{tag}-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_workspace(
    db_session: Any, workspace: Workspace, spec_root: Path
) -> SpecWorkspace:
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


@pytest.fixture
async def spec_env(
    db_session: Any,
    client: AsyncClient,
    tmp_path: Path,
    shpsync_headers: tuple[Any, dict[str, str]],
):
    """造 workspace + spec_workspace + shpsync headers。"""
    workspace_id, headers = shpsync_headers
    ws = await db_session.get(Workspace, workspace_id)
    spec_root = tmp_path / "spec-root"
    await _make_spec_workspace(db_session, ws, spec_root)
    return {
        "client": client,
        "headers": headers,
        "workspace_id": workspace_id,
        "spec_root": spec_root,
    }


class TestAuth:
    async def test_get_manifest_no_token_401(self, client: AsyncClient) -> None:
        resp = await client.get("/api/changes/-/spec-manifest")
        assert resp.status_code == 401

    async def test_post_sync_no_token_401(self, client: AsyncClient) -> None:
        resp = await client.post("/api/changes/-/spec-sync", json={"ops": []})
        assert resp.status_code == 401

    async def test_get_manifest_jwt_403(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        resp = await client.get("/api/changes/-/spec-manifest", headers=auth_headers)
        assert resp.status_code == 403

    async def test_post_sync_api_key_403(
        self, client: AsyncClient, apikey_headers: dict[str, str]
    ) -> None:
        resp = await client.post(
            "/api/changes/-/spec-sync",
            headers=apikey_headers,
            json={"ops": []},
        )
        assert resp.status_code == 403


class TestManifestAndSync:
    async def test_get_manifest_matches_database(self, spec_env: dict[str, Any]) -> None:
        """推 ops 后 GET manifest 与 SpecFileManifest 表一致。"""
        client: AsyncClient = spec_env["client"]
        headers = spec_env["headers"]
        spec_root: Path = spec_env["spec_root"]

        resp = await client.post(
            "/api/changes/-/spec-sync",
            headers=headers,
            json={
                "ops": [
                    _op("add", "docs/A.md", base_version=0, content=_b64("# A"), hash=_h("# A")),
                    _op("add", "docs/B.md", base_version=0, content=_b64("# B"), hash=_h("# B")),
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["conflict"] is False
        assert body["new_versions"] == {"docs/A.md": 1, "docs/B.md": 1}
        assert (spec_root / "docs" / "A.md").read_text(encoding="utf-8") == "# A"

        resp = await client.get("/api/changes/-/spec-manifest", headers=headers)
        assert resp.status_code == 200, resp.text
        manifest = resp.json()["files"]
        assert set(manifest) == {"docs/A.md", "docs/B.md"}
        assert manifest["docs/A.md"]["version"] == 1
        assert manifest["docs/A.md"]["exists"] is True
        assert manifest["docs/A.md"]["hash"] == _h("# A")

    async def test_delete_keeps_manifest_entry_with_exists_false(
        self, spec_env: dict[str, Any]
    ) -> None:
        """delete 后端清单仍存在，exists=False。"""
        client: AsyncClient = spec_env["client"]
        headers = spec_env["headers"]

        await client.post(
            "/api/changes/-/spec-sync",
            headers=headers,
            json={
                "ops": [_op("add", "docs/C.md", base_version=0, content=_b64("c"), hash=_h("c"))]
            },
        )
        resp = await client.post(
            "/api/changes/-/spec-sync",
            headers=headers,
            json={"ops": [_op("delete", "docs/C.md", base_version=1)]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["new_versions"] == {"docs/C.md": 2}

        resp = await client.get("/api/changes/-/spec-manifest", headers=headers)
        manifest = resp.json()["files"]
        assert "docs/C.md" in manifest
        assert manifest["docs/C.md"]["exists"] is False
        assert manifest["docs/C.md"]["version"] == 2


class TestOps:
    async def test_update_increments_version(self, spec_env: dict[str, Any]) -> None:
        client: AsyncClient = spec_env["client"]
        headers = spec_env["headers"]

        await client.post(
            "/api/changes/-/spec-sync",
            headers=headers,
            json={
                "ops": [_op("add", "docs/V.md", base_version=0, content=_b64("v1"), hash=_h("v1"))]
            },
        )
        resp = await client.post(
            "/api/changes/-/spec-sync",
            headers=headers,
            json={
                "ops": [
                    _op("update", "docs/V.md", base_version=1, content=_b64("v2"), hash=_h("v2"))
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["new_versions"] == {"docs/V.md": 2}

    async def test_rename_moves_manifest(self, spec_env: dict[str, Any]) -> None:
        client: AsyncClient = spec_env["client"]
        headers = spec_env["headers"]
        spec_root: Path = spec_env["spec_root"]

        await client.post(
            "/api/changes/-/spec-sync",
            headers=headers,
            json={
                "ops": [_op("add", "docs/Old.md", base_version=0, content=_b64("x"), hash=_h("x"))]
            },
        )
        resp = await client.post(
            "/api/changes/-/spec-sync",
            headers=headers,
            json={"ops": [_op("rename", "docs/Old.md", new_path="docs/New.md", base_version=1)]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["new_versions"] == {"docs/New.md": 2}
        assert (spec_root / "docs" / "New.md").read_text(encoding="utf-8") == "x"
        assert not (spec_root / "docs" / "Old.md").exists()


class TestConflict:
    async def test_stale_base_version_returns_conflict(
        self, db_session: Any, spec_env: dict[str, Any]
    ) -> None:
        client: AsyncClient = spec_env["client"]
        headers = spec_env["headers"]

        await client.post(
            "/api/changes/-/spec-sync",
            headers=headers,
            json={
                "ops": [_op("add", "docs/K.md", base_version=0, content=_b64("k"), hash=_h("k"))]
            },
        )

        # 手动 bump 服务器 version，模拟并发写入
        row = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == spec_env["workspace_id"],
                        SpecFileManifest.path == "docs/K.md",
                    )
                )
            )
            .scalars()
            .first()
        )
        row.version = 5
        await db_session.commit()

        resp = await client.post(
            "/api/changes/-/spec-sync",
            headers=headers,
            json={
                "ops": [
                    _op("update", "docs/K.md", base_version=1, content=_b64("k2"), hash=_h("k2"))
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["conflict"] is True
        assert body["server_versions"] == {"docs/K.md": 5}


class TestEdgeCases:
    async def test_empty_ops_ok(self, spec_env: dict[str, Any]) -> None:
        client: AsyncClient = spec_env["client"]
        headers = spec_env["headers"]

        resp = await client.post("/api/changes/-/spec-sync", headers=headers, json={"ops": []})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["conflict"] is False
        assert body["new_versions"] == {}

    async def test_path_escape_422(self, spec_env: dict[str, Any]) -> None:
        client: AsyncClient = spec_env["client"]
        headers = spec_env["headers"]

        resp = await client.post(
            "/api/changes/-/spec-sync",
            headers=headers,
            json={
                "ops": [
                    _op("add", "../etc/passwd", base_version=0, content=_b64("x"), hash=_h("x"))
                ]
            },
        )
        assert resp.status_code == 422, resp.text
