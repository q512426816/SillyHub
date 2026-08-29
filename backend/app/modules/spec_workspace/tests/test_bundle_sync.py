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

from app.core.config import get_settings
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


async def _make_spec_workspace(
    db_session,
    workspace: Workspace,
    spec_root: Path,
    *,
    strategy: str = "platform-managed",
    spec_version: int = 0,
) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=str(spec_root),
        strategy=strategy,
        sync_status="clean",
        spec_version=spec_version,
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
# Bundle snapshot metadata（task-08 / FR-08 / design §7.3）
# ===========================================================================


class TestBundleMetadata:
    """task-08（2026-08-29-change-delete-closure-and-spec-pull）：快照元数据。

    - 响应头 ``X-Spec-Version`` = ``spec_ws.spec_version``（持包方不解包即可辨新旧）
    - tar 顶层 ``PLATFORM-BUNDLE.json`` 含 {spec_version, strategy, generated_at,
      server} 四键（离线可辨快照来源/时点）
    - ``.runtime/`` 与 local.yaml 任意深度排除零回归 + 元数据不落 spec_root 磁盘
    """

    async def test_bundle_x_spec_version_header_and_metadata(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        import json
        from datetime import datetime

        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        # 排除项素材：顶层 .runtime + 嵌套 .runtime + 顶层/嵌套 local.yaml
        (spec_root / ".runtime").mkdir()
        (spec_root / ".runtime" / "cache.log").write_text("cache", encoding="utf-8")
        (spec_root / "changes").mkdir()
        (spec_root / "changes" / "c1" / ".runtime").mkdir(parents=True)
        (spec_root / "changes" / "c1" / ".runtime" / "x.db").write_text("db", encoding="utf-8")
        (spec_root / "local.yaml").write_text("token: top", encoding="utf-8")
        (spec_root / "changes" / "c1" / "local.yaml").write_text("token: nested", encoding="utf-8")
        await _make_spec_workspace(
            db_session, ws, spec_root, strategy="repo-mirrored", spec_version=12
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/spec-workspace/bundle",
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        assert resp.headers["x-spec-version"] == "12"
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            names = tf.getnames()
            # 顶层字面成员（非嵌套同名）
            assert "PLATFORM-BUNDLE.json" in names
            assert not any(
                n != "PLATFORM-BUNDLE.json" and n.endswith("PLATFORM-BUNDLE.json") for n in names
            )
            raw = tf.extractfile("PLATFORM-BUNDLE.json")
            assert raw is not None
            meta = json.loads(raw.read())
        assert set(meta) == {"spec_version", "strategy", "generated_at", "server"}
        assert meta["spec_version"] == 12
        assert meta["strategy"] == "repo-mirrored"
        datetime.fromisoformat(str(meta["generated_at"]))  # 打包时刻 UTC ISO 可解析
        assert isinstance(meta["server"], str) and meta["server"]

        # 排除零回归：.runtime 任意深度 / local.yaml 任意深度不出服务器
        for n in names:
            assert ".runtime" not in n.split("/"), f"runtime leaked into bundle: {n}"
            assert n.rsplit("/", 1)[-1] != "local.yaml", f"local.yaml leaked: {n}"
        assert "docs/A.md" in names

        # 元数据仅存在于 tar 流内，spec_root 磁盘零残留（镜像树不被污染）
        assert not (spec_root / "PLATFORM-BUNDLE.json").exists()


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
        # D-003：apply_sync 现返回 {reparsed_docs, reparsed_changes}；sync DTO 暴露两段
        # （reparsed=docs 向后兼容 + reparsed_changes；test spec_root 无 changes → 0）。
        assert body == {"ok": True, "reparsed": 1, "reparsed_changes": 0}

        # 2026-08-19-spec-mirror-tombstone-sync FR-01：tar 是整树权威快照——镜像里
        # tar 未包含的 A.md 被对账删除（软删 move 到备份区），幽灵文件不再残留；
        # tar 内的新文件正常落地。
        assert not (spec_root / "docs" / "A.md").exists()
        assert (spec_root / "docs" / "B.md").read_text(encoding="utf-8") == "# B"
        backup_root = Path(get_settings().spec_data_root) / "spec-backups" / str(ws.id)
        backed = list(backup_root.rglob("docs/A.md"))
        assert len(backed) == 1, f"expected converged backup file, found {backed}"
        assert backed[0].read_text(encoding="utf-8") == "old"

    async def test_sync_skips_runtime_dir_from_tar(
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
        # ql-20260813-007：.runtime 整树不入表/不落盘（sillyspec.db 是 SQLite 二进制含 NUL，
        # 写进 scan_documents 文本列曾触发 asyncpg 0x00 整批回滚 500）。spec 数据正常落地。
        assert (spec_root / "docs" / "C.md").read_bytes() == b"# C"
        # tar 内的 sillyspec.db 被跳过（未落 spec_root）。
        assert not (spec_root / ".runtime" / "sillyspec.db").exists()
        # spec_root 预存的 x.log 不在 merge 路径，保留。
        assert (spec_root / ".runtime" / "x.log").exists()

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
