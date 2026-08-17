"""Tests for the incremental spec sync endpoint (change 2026-08-13-platform-managed-file-sync).

Covers design §7 + 关键落盘决策（P2 R-07 hash 兜底 / R-06 备份 30 天修剪 / Q7 旧 tar
失效 manifest）+ D-001~D-011 行为验收：

- add/update：文件落 spec_root + 清单 version 递增 + content_hash 正确
- rename：文件移动 + 清单 path 更新（含 new_path containment）
- delete：文件移出 spec_root 到 ``spec-backups/{ws}/{ts}/{path}`` + 清单 exists=False + version+1
- base_version 过期 → conflict=True + server_versions（冲突文件未落盘）
- ``.runtime/*`` op → 422
- containment 越界（``../``、绝对路径、symlink 逃逸）→ 422
- 备份目标越界（path 逃出 spec-backups）→ 422
- 旧 tar apply_sync 后 spec_file_manifest 行清空 + 下一次增量 add 重建（Q7）
- 无行 op（R-07）：update 无行视为新建 version=1；delete 无行 no-op 成功
- 备份 30 天机会式修剪（构造早于 30 天的备份目录断言被删）

author: qinyi
created_at: 2026-08-13
"""

from __future__ import annotations

import base64
import hashlib
import io
import tarfile
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import get_settings
from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.workspace.model import Workspace


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _op(op: str, path: str, base_version: int = 0, **extra: object) -> dict[str, object]:
    d: dict[str, object] = {"op": op, "path": path, "base_version": base_version}
    d.update(extra)
    return d


async def _make_workspace(db_session, *, component_key: str | None = "comp") -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="sync-incremental ws",
        slug=f"si-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/sync-incremental-test",
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
# add / update
# ===========================================================================


class TestAddUpdate:
    async def test_add_writes_file_and_manifest(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/A.md", base_version=0, content=_b64("# A"), hash="h1")]},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body == {
            "ok": True,
            "new_versions": {"docs/A.md": 1},
            "conflict": False,
            "server_versions": None,
        }
        assert (spec_root / "docs" / "A.md").read_text(encoding="utf-8") == "# A"

        row = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == ws.id,
                        SpecFileManifest.path == "docs/A.md",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert row is not None

        assert row.content_hash == hashlib.sha256(b"# A").hexdigest()
        assert row.version == 1
        assert row.exists is True

    async def test_add_with_mtime_stamps_file(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """ql-20260813-008：add op 带 mtime → 落盘文件 mtime 真实（非写入时刻）。

        后端 changes.updated_at 取变更目录文件 mtime max 填充，镜像文件 mtime 必须真实
        （daemon buildTarHeader 旧固定 0 致该链路失效）。op.mtime（Unix 秒）经
        _apply_file_mtime os.utime 设到 target。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        fixed_mtime = 1773624600  # 2026-03-13 09:30 UTC，区别于写入 now
        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        "docs/A.md",
                        base_version=0,
                        content=_b64("# A"),
                        hash="h1",
                        mtime=fixed_mtime,
                    )
                ]
            },
        )
        assert resp.status_code == 200, resp.text

        st = (spec_root / "docs" / "A.md").stat()
        assert abs(st.st_mtime - fixed_mtime) < 2  # mtime=op.mtime，非 now

    async def test_add_mtime_flow_to_change_updated_at(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """ql-20260813-008 全链路：add op 带 mtime → 镜像文件 mtime 真实 → reparse 后
        changes.updated_at 取该 mtime（反映真实活动，非同步/写入时刻）。"""
        from app.modules.change.model import Change
        from app.modules.change.service import ChangeService

        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        fixed_mtime = 1773797400  # 2026-03-15 09:30 UTC
        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        "changes/2026-03-15-demo/proposal.md",
                        base_version=0,
                        content=_b64("# Demo"),
                        hash="h1",
                        mtime=fixed_mtime,
                    )
                ]
            },
        )
        assert resp.status_code == 200, resp.text

        # reparse 扫镜像目录 mtime → 建/更新 change，updated_at 取 max(mtimes)
        stats, _ = await ChangeService(db_session).reparse(ws.id)
        assert stats["parsed"] >= 1

        change = (
            (
                await db_session.execute(
                    select(Change).where(
                        Change.workspace_id == ws.id,
                        Change.change_key == "2026-03-15-demo",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert change is not None
        # SQLite 返回 naive datetime，视作 UTC 比较（DB 列语义即 UTC）；用 .timestamp()
        # 直接比会被本机时区（UTC+8）解释致 28800 偏差。
        assert abs(change.updated_at.replace(tzinfo=UTC).timestamp() - fixed_mtime) < 2

    async def test_update_increments_version(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        # 先 add → version 1
        resp1 = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/B.md", base_version=0, content=_b64("v1"))]},
        )
        assert resp1.json()["new_versions"] == {"docs/B.md": 1}

        # update with base_version=1 → version 2
        resp2 = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("update", "docs/B.md", base_version=1, content=_b64("v2"))]},
        )
        assert resp2.status_code == 200, resp2.text
        assert resp2.json()["new_versions"] == {"docs/B.md": 2}
        assert (spec_root / "docs" / "B.md").read_text(encoding="utf-8") == "v2"

        row = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == ws.id,
                        SpecFileManifest.path == "docs/B.md",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert row is not None
        assert row.version == 2

        assert row.content_hash == hashlib.sha256(b"v2").hexdigest()


# ===========================================================================
# rename
# ===========================================================================


class TestRename:
    async def test_rename_moves_file_and_manifest(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/old.md", base_version=0, content=_b64("same"))]},
        )

        # rename（同内容，不重传 content → hash 相同保留原 content）
        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("rename", "docs/old.md", base_version=1, new_path="docs/new.md")]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["new_versions"] == {"docs/new.md": 2}
        assert not (spec_root / "docs" / "old.md").exists()
        assert (spec_root / "docs" / "new.md").read_text(encoding="utf-8") == "same"

        old_row = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == ws.id,
                        SpecFileManifest.path == "docs/old.md",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert old_row is None
        new_row = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == ws.id,
                        SpecFileManifest.path == "docs/new.md",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert new_row is not None
        assert new_row.version == 2
        assert new_row.exists is True

    async def test_rename_rejects_new_path_escape(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("rename", "docs/old.md", base_version=0, new_path="../../evil.md")]},
        )
        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"
        assert not (tmp_path / "evil.md").exists()


# ===========================================================================
# delete（软删 move + 备份区）
# ===========================================================================


class TestDelete:
    async def test_delete_moves_to_backup_and_marks_not_exists(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/del.md", base_version=0, content=_b64("bye"))]},
        )

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("delete", "docs/del.md", base_version=1)]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["new_versions"] == {"docs/del.md": 2}

        # 文件移出 spec_root（不在 spec_root 下）
        assert not (spec_root / "docs" / "del.md").exists()

        # 备份落 spec_data_root/spec-backups/{ws}/{ts}/{path}
        backup_root = Path(get_settings().spec_data_root) / "spec-backups" / str(ws.id)
        assert backup_root.exists()
        backed = list(backup_root.rglob("docs/del.md"))
        assert len(backed) == 1, f"expected backup file, found {backed}"
        assert backed[0].read_text(encoding="utf-8") == "bye"

        # 清单 exists=False + version+1
        row = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == ws.id,
                        SpecFileManifest.path == "docs/del.md",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert row is not None
        assert row.exists is False
        assert row.version == 2

    async def test_delete_no_row_is_noop(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """R-07：无清单行的 delete → no-op 成功（幂等），不写 new_versions。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("delete", "docs/ghost.md", base_version=0)]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "ok": True,
            "new_versions": {},
            "conflict": False,
            "server_versions": None,
        }


# ===========================================================================
# base_version 乐观锁（D-001）
# ===========================================================================


class TestBaseVersionConflict:
    async def test_stale_base_version_conflicts(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/c.md", base_version=0, content=_b64("v1"))]},
        )
        # 服务器当前 version=1；再并发推 base_version=0 视为过期
        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("update", "docs/c.md", base_version=0, content=_b64("v2"))]},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["conflict"] is True
        assert body["server_versions"] == {"docs/c.md": 1}
        # 冲突文件未落盘、未更新
        assert (spec_root / "docs" / "c.md").read_text(encoding="utf-8") == "v1"

    async def test_mixed_ops_apply_others_on_conflict(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """冲突 op 跳过，其余照常 apply，整体 conflict=True。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/conflict.md", base_version=0, content=_b64("keep"))]},
        )

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op("update", "docs/conflict.md", base_version=0, content=_b64("evil")),  # 过期
                    _op("add", "docs/ok.md", base_version=0, content=_b64("new")),  # 正常
                ]
            },
        )
        body = resp.json()
        assert body["conflict"] is True
        assert body["server_versions"] == {"docs/conflict.md": 1}
        # 冲突文件未动，其余文件正常落盘
        assert (spec_root / "docs" / "conflict.md").read_text(encoding="utf-8") == "keep"
        assert (spec_root / "docs" / "ok.md").read_text(encoding="utf-8") == "new"
        assert body["new_versions"] == {"docs/ok.md": 1}


# ===========================================================================
# 路径校验（containment + .runtime）
# ===========================================================================


class TestPathValidation:
    async def test_runtime_path_rejected(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """D-006：.runtime/* op → 422。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", ".runtime/cache.log", base_version=0, content=_b64("x"))]},
        )
        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"
        assert not (spec_root / ".runtime" / "cache.log").exists()

    async def test_absolute_path_rejected(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "/etc/passwd", base_version=0, content=_b64("x"))]},
        )
        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"

    async def test_path_traversal_rejected(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "../../escape.md", base_version=0, content=_b64("x"))]},
        )
        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"
        assert not (tmp_path / "escape.md").exists()

    async def test_symlink_escape_rejected(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """symlink 逃逸（spec_root 内符号链接指向外部）→ 422（对齐 tar resolve 校验）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "target.txt").write_text("secret", encoding="utf-8")

        try:
            (spec_root / "link").symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError) as exc:
            pytest.skip(f"symlink not permitted on this platform: {exc}")

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "link/target.txt", base_version=0, content=_b64("x"))]},
        )
        assert resp.status_code == 422
        assert resp.json()["code"] == "HTTP_422_SPEC_BUNDLE_INVALID"
        # 外部文件未被写入
        assert (outside / "target.txt").read_text(encoding="utf-8") == "secret"


# ===========================================================================
# 旧 tar 失效 manifest（Q7 / R-01）
# ===========================================================================


class TestOldTarInvalidates:
    async def test_old_tar_clears_manifest_and_next_incremental_rebuilds(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        # 先增量 add → 建清单行
        await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/A.md", base_version=0, content=_b64("# A"))]},
        )
        assert (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(SpecFileManifest.workspace_id == ws.id)
                )
            )
            .scalars()
            .all()
        )

        # 旧 tar 全量 push（apply_sync）
        tar_bytes = _build_tar({"docs": None, "docs/T.md": b"# T"})
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
                f"/api/workspaces/{ws.id}/spec-workspace/sync",
                headers={**auth_headers, "Content-Type": "application/x-tar"},
                content=tar_bytes,
            )
        assert resp.status_code == 200, resp.text

        # Q7：旧 tar 落盘后该 ws 清单全清空
        rows = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(SpecFileManifest.workspace_id == ws.id)
                )
            )
            .scalars()
            .all()
        )
        assert rows == []

        # 下一次增量 add → R-07 兜底重建 version=1
        resp2 = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/R.md", base_version=0, content=_b64("# R"))]},
        )
        assert resp2.json()["new_versions"] == {"docs/R.md": 1}
        assert (spec_root / "docs" / "R.md").read_text(encoding="utf-8") == "# R"


# ===========================================================================
# R-07 无行兜底
# ===========================================================================


class TestHashFallback:
    async def test_update_without_row_is_new_version_1(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """R-07：无清单行 update → 视为新建 version=1。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("update", "docs/fresh.md", base_version=0, content=_b64("x"))]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["new_versions"] == {"docs/fresh.md": 1}
        assert (spec_root / "docs" / "fresh.md").read_text(encoding="utf-8") == "x"


# ===========================================================================
# 备份 30 天机会式修剪（R-06）
# ===========================================================================


class TestBackupPrune:
    async def test_old_backup_dir_pruned(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        backup_root = Path(get_settings().spec_data_root) / "spec-backups" / str(ws.id)

        # 构造一个 40 天前的备份目录（同 BACKUP_TS_FORMAT 命名），放入文件
        old_ts = (datetime.now(UTC) - timedelta(days=40)).strftime("%Y%m%d%H%M%S%f")
        old_dir = backup_root / old_ts / "docs"
        old_dir.mkdir(parents=True)
        (old_dir / "old.md").write_text("old", encoding="utf-8")
        assert old_dir.exists()

        # 触发一次软删 → 机会式修剪
        await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/to-del.md", base_version=0, content=_b64("x"))]},
        )
        await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("delete", "docs/to-del.md", base_version=1)]},
        )

        # 40 天前目录被修剪
        assert not (backup_root / old_ts).exists()
        # 新备份目录保留
        new_backups = [p for p in backup_root.iterdir() if p.is_dir()]
        assert len(new_backups) == 1


# ===========================================================================
# 兼容收尾（task-09）：旧 tar 端点保留 + 单成员快速路径（R-01）
# ===========================================================================


class TestCompat:
    async def test_single_member_sequence_never_conflicts(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """单成员快速路径：同一写者 base_version 恒匹配（add→update→delete 无冲突）。

        design §9：单成员 workspace 下乐观锁不冲突（base_version 恒匹配），行为透明。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        # add → v1
        r1 = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/solo.md", base_version=0, content=_b64("one"))]},
        )
        assert r1.json()["new_versions"] == {"docs/solo.md": 1}
        assert r1.json()["conflict"] is False

        # update（base_version=1）→ v2
        r2 = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("update", "docs/solo.md", base_version=1, content=_b64("two"))]},
        )
        assert r2.json()["new_versions"] == {"docs/solo.md": 2}
        assert r2.json()["conflict"] is False

        # delete（base_version=2）→ 软删
        r3 = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("delete", "docs/solo.md", base_version=2)]},
        )
        assert r3.json()["new_versions"] == {"docs/solo.md": 3}
        assert r3.json()["conflict"] is False

    async def test_old_tar_endpoint_retained(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """R-01 兼容：旧 tar POST /spec-workspace/sync（apply_sync 整树覆盖）未改仍可用。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar({"docs": None, "docs/legacy.md": b"# legacy"})
        with (
            patch(
                "app.modules.scan_docs.service.ScanDocsService.reparse",
                new=AsyncMock(
                    return_value=({"parsed": 1, "created": 1, "updated": 0, "deleted": 0}, None)
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
                f"/api/workspaces/{ws.id}/spec-workspace/sync",
                headers={**auth_headers, "Content-Type": "application/x-tar"},
                content=tar_bytes,
            )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True, "reparsed": 1, "reparsed_changes": 0}
        # 旧 tar 整树覆盖仍落盘
        assert (spec_root / "docs" / "legacy.md").read_text(encoding="utf-8") == "# legacy"


# ===========================================================================
# 循环前 IN 预取等价性（perf-remediation task-03）
# ===========================================================================


class TestPrefetchEquivalence:
    """task-03：apply_ops 循环前按 path ∪ new_path 一次 IN 预取 SpecFileManifest
    成 dict（含循环内镜像维护：add 插入 / delete 删除 / rename 换 key）。

    等价锚点：原 per-op SELECT 语义下，同一请求内后一个 op 能看到前一个 op
    写入的清单行（asyncSession autoflush）。预取 + 镜像必须保持该语义——
    否则同请求连续 op（单成员 add→update→delete）会误判无行 / 冲突。
    """

    async def test_same_request_sequential_ops_same_path(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """单请求 add→update→delete 同一路径：后续 op 看到前序 op 的清单行。

        add v1 → update(base=1) v2 → delete(base=2) v3，全部无冲突。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op("add", "docs/seq.md", base_version=0, content=_b64("v1")),
                    _op("update", "docs/seq.md", base_version=1, content=_b64("v2")),
                    _op("delete", "docs/seq.md", base_version=2),
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["conflict"] is False
        assert body["new_versions"] == {"docs/seq.md": 3}
        assert not (spec_root / "docs" / "seq.md").exists()

        row = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == ws.id,
                        SpecFileManifest.path == "docs/seq.md",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert row is not None
        assert row.version == 3
        assert row.exists is False
        assert row.content_hash == hashlib.sha256(b"v2").hexdigest()

    async def test_same_request_rename_then_touch_new_path(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """rename 换 key 镜像：rename A→B 后同请求 delete B（base=new version）。

        rename 后预取 dict 须删旧 key（A）加新 key（B），否则 delete B 误判
        无行走 R-07 no-op（语义漂移：原 per-op SELECT 能看到新行）。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        # 先铺底 add A（独立请求，落库）
        r0 = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/old.md", base_version=0, content=_b64("x"))]},
        )
        assert r0.json()["new_versions"] == {"docs/old.md": 1}

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op("rename", "docs/old.md", base_version=1, new_path="docs/new.md"),
                    _op("delete", "docs/new.md", base_version=2),
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["conflict"] is False
        assert body["new_versions"] == {"docs/new.md": 3}
        assert not (spec_root / "docs" / "old.md").exists()
        assert not (spec_root / "docs" / "new.md").exists()

        row = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == ws.id,
                        SpecFileManifest.path == "docs/new.md",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert row is not None
        assert row.exists is False
        assert row.version == 3


# Suppress unused-import warning for pytest (used for fixture discovery in some setups).
pytestmark = pytest.mark.asyncio


# ===========================================================================
# ql-20260818-002：local.yaml 服务器侧三处过滤（token 不落 landing 树 / 不跨机分发）
# ===========================================================================


class TestLocalYamlExcluded:
    async def test_add_local_yaml_filtered_silently(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """过滤点①：add local.yaml 静默丢弃——200 但不落盘、无清单行、不置 conflict。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "local.yaml", base_version=0, content=_b64("token: x"))]},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["new_versions"] == {}
        assert body["conflict"] is False
        assert not (spec_root / "local.yaml").exists()
        rows = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(SpecFileManifest.workspace_id == ws.id)
                )
            )
            .scalars()
            .all()
        )
        assert rows == []

    async def test_rename_to_local_yaml_filtered(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """过滤点①：rename new_path=local.yaml 丢弃（写入目标是排除名）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        # 先正常落一个源文件
        await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/A.md", base_version=0, content=_b64("# A"))]},
        )

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("rename", "docs/A.md", base_version=1, new_path="local.yaml")]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["new_versions"] == {}
        # 源文件不动（rename 整个被丢弃）
        assert (spec_root / "docs" / "A.md").read_text(encoding="utf-8") == "# A"
        assert not (spec_root / "local.yaml").exists()

    async def test_delete_local_yaml_cleans_stale_row(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """delete 放行：清存量 landing 树历史 local.yaml 行（软删入备份区）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        # 造存量：真实文件 + 清单行（模拟旧版本生产者已上传过）
        (spec_root).mkdir(parents=True, exist_ok=True)
        (spec_root / "local.yaml").write_text("token: stale", encoding="utf-8")
        db_session.add(
            SpecFileManifest(
                id=uuid.uuid4(),
                workspace_id=ws.id,
                path="local.yaml",
                content_hash=hashlib.sha256(b"token: stale").hexdigest(),
                version=1,
                exists=True,
            )
        )
        await db_session.commit()

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("delete", "local.yaml", base_version=1)]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["new_versions"] == {"local.yaml": 2}
        assert not (spec_root / "local.yaml").exists()
        row = (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(
                        SpecFileManifest.workspace_id == ws.id,
                        SpecFileManifest.path == "local.yaml",
                    )
                )
            )
            .scalars()
            .one()
        )
        assert row.exists is False
        assert row.version == 2

    async def test_tar_ingest_skips_local_yaml_member(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """过滤点②：整包 tar 含 local.yaml 成员不落盘（整包覆盖语义下即从服务器树移除）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar({"docs": None, "docs/T.md": b"# T", "local.yaml": b"token: x"})
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
                f"/api/workspaces/{ws.id}/spec-workspace/sync",
                headers={**auth_headers, "Content-Type": "application/x-tar"},
                content=tar_bytes,
            )
        assert resp.status_code == 200, resp.text
        assert (spec_root / "docs" / "T.md").read_text(encoding="utf-8") == "# T"
        assert not (spec_root / "local.yaml").exists()

    async def test_build_bundle_excludes_local_yaml(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """过滤点③：bundle 导出跳过 local.yaml（landing 树存量文件也不出服务器）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        spec_root.mkdir(parents=True, exist_ok=True)
        (spec_root / "docs").mkdir()
        (spec_root / "docs" / "T.md").write_text("# T", encoding="utf-8")
        # 存量残留（历史版本生产者上传过的 local.yaml 还在树上）
        (spec_root / "local.yaml").write_text("token: stale", encoding="utf-8")

        resp = await client.get(
            f"/api/workspaces/{ws.id}/spec-workspace/bundle", headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            names = {m.name for m in tf.getmembers()}
        assert "docs/T.md" in names
        assert "local.yaml" not in names
