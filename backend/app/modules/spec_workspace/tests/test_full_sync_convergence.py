"""全量同步对账收敛测试（change 2026-08-19-spec-mirror-tombstone-sync）。

覆盖 design §7 单测清单（FR-01/FR-02/FR-04）：

- 对账删除：镜像多出的文件全 move 备份区 + 空目录清理 + manifest 墓碑；
- 落盘集与镜像一致 → 零删除零墓碑（manifest 行保留且 version 递增）；
- 空 tar → 护栏①跳过对账（镜像现状不动）；
- 数量比例护栏② → 中止 + 镜像不动；
- 镜像存量 local.yaml 整包覆盖后消失（SERVER_EXCLUDED 语义——staging 不解包
  → 不进落盘集 → 对账删除）；
- `_write_spec_root` 返回对账统计元组（task-03 事件字段来源）。

直接调 `ChangeService` 级 `_write_spec_root`（不过 HTTP / reparse，聚焦对账本身）。

author: qinyi
created_at: 2026-08-19
"""

from __future__ import annotations

import io
import tarfile
import uuid
from pathlib import Path

from sqlalchemy import select

from app.core.config import get_settings
from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.spec_workspace.service import SpecWorkspaceService
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers（对齐 test_sync_incremental.py 范式）
# ---------------------------------------------------------------------------


async def _make_workspace(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="full-sync-convergence ws",
        slug=f"fc-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/full-sync-convergence-test",
        status="active",
        component_key="comp",
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


async def _manifest_rows(db_session, ws_id) -> dict[str, SpecFileManifest]:
    return {
        r.path: r
        for r in (
            (
                await db_session.execute(
                    select(SpecFileManifest).where(SpecFileManifest.workspace_id == ws_id)
                )
            )
            .scalars()
            .all()
        )
    }


def _backup_root(ws_id) -> Path:
    return Path(get_settings().spec_data_root) / "spec-backups" / str(ws_id)


# ===========================================================================
# FR-01 对账删除 + FR-02 manifest 墓碑
# ===========================================================================


class TestConvergeStaleFiles:
    async def test_ghost_files_moved_to_backup_and_dirs_pruned_and_tombstoned(
        self, db_session, tmp_path
    ) -> None:
        """镜像多 3 文件（含幽灵变更目录）→ 全 move 备份区 + 空目录清理 + 墓碑。

        2026-08-19 生产实例复现：改名归档后旧目录在镜像永久残留（41 vs 24）。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        # 镜像现状：tar 内 1 文件 + 幽灵变更目录 2 文件 + 孤儿目录 1 文件
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "keep.md").write_text("# keep", encoding="utf-8")
        ghost_change = spec_root / "changes" / "2026-08-18-renamed-away"
        ghost_change.mkdir(parents=True)
        (ghost_change / "proposal.md").write_text("ghost", encoding="utf-8")
        (ghost_change / "design.md").write_text("ghost", encoding="utf-8")
        orphan = spec_root / "orphan-dir"
        orphan.mkdir()
        (orphan / "x.md").write_text("orphan", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)
        # 预置幽灵路径的 manifest 行（模拟增量协议曾建行）
        db_session.add(
            SpecFileManifest(
                workspace_id=ws.id,
                path="changes/2026-08-18-renamed-away/proposal.md",
                content_hash="0" * 64,
                version=3,
                exists=True,
            )
        )
        await db_session.commit()

        tar_bytes = _build_tar({"docs": None, "docs/keep.md": b"# keep"})
        spec_ws, converged_files, converged_dirs = await SpecWorkspaceService(
            db_session
        )._write_spec_root(ws.id, tar_bytes)

        # FR-01：镜像收敛——幽灵目录整目录消失，孤儿目录消失，keep 保留
        assert converged_files == 3
        assert converged_dirs == 3  # changes/2026-08-18-renamed-away + orphan-dir + changes
        assert (spec_root / "docs" / "keep.md").exists()
        assert not (spec_root / "changes").exists()
        assert not (spec_root / "orphan-dir").exists()
        # 备份区有全部 3 个文件的副本（同一收敛批时间戳目录下）
        backup_root = _backup_root(ws.id)
        backed = {
            str(p.relative_to(backup_root).as_posix()).split("/", 1)[1]
            for p in backup_root.rglob("*")
            if p.is_file()
        }
        assert backed == {
            "changes/2026-08-18-renamed-away/proposal.md",
            "changes/2026-08-18-renamed-away/design.md",
            "orphan-dir/x.md",
        }
        # FR-02：manifest 墓碑——被删行 exists=False + version+1；无全表 DELETE
        # （行还在）；落盘文件行对齐 version=1（新插）
        rows = await _manifest_rows(db_session, ws.id)
        assert set(rows) == {
            "changes/2026-08-18-renamed-away/proposal.md",
            "docs/keep.md",
        }
        tomb = rows["changes/2026-08-18-renamed-away/proposal.md"]
        assert tomb.exists is False
        assert tomb.version == 4
        landed = rows["docs/keep.md"]
        assert landed.exists is True
        assert landed.version == 1
        assert spec_ws.sync_status == "clean"

    async def test_identical_tree_converges_nothing(self, db_session, tmp_path) -> None:
        """落盘集与镜像一致 → 零删除零墓碑；manifest 行保留且 version 递增。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        (spec_root / "docs" / "B.md").write_text("# B", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)
        db_session.add(
            SpecFileManifest(
                workspace_id=ws.id,
                path="docs/A.md",
                content_hash="0" * 64,
                version=5,
                exists=True,
            )
        )
        await db_session.commit()

        tar_bytes = _build_tar({"docs": None, "docs/A.md": b"# A", "docs/B.md": b"# B"})
        _, converged_files, converged_dirs = await SpecWorkspaceService(
            db_session
        )._write_spec_root(ws.id, tar_bytes)

        assert converged_files == 0
        assert converged_dirs == 0
        assert (spec_root / "docs" / "A.md").exists()
        assert (spec_root / "docs" / "B.md").exists()
        assert not _backup_root(ws.id).exists()
        rows = await _manifest_rows(db_session, ws.id)
        assert set(rows) == {"docs/A.md", "docs/B.md"}
        assert rows["docs/A.md"].version == 6  # 命中文件 version 递增，行保留
        assert rows["docs/A.md"].exists is True
        assert rows["docs/B.md"].version == 1

    async def test_mirror_local_yaml_removed_on_full_sync(self, db_session, tmp_path) -> None:
        """镜像存量 local.yaml 整包覆盖后消失（SERVER_EXCLUDED 语义）。

        staging 解包层不 extract local.yaml 成员 → 不进落盘集 → 对账删除；
        tar 同时带 local.yaml 成员也一样（服务端排除优先）。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / ".sillyspec").mkdir(parents=True)
        (spec_root / ".sillyspec" / "local.yaml").write_text("cached: true", encoding="utf-8")
        (spec_root / "docs").mkdir()
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar(
            {
                "docs": None,
                "docs/A.md": b"# A",
                ".sillyspec": None,
                ".sillyspec/local.yaml": b"client: local",
            }
        )
        _, converged_files, _ = await SpecWorkspaceService(db_session)._write_spec_root(
            ws.id, tar_bytes
        )

        assert converged_files == 1
        assert not (spec_root / ".sillyspec" / "local.yaml").exists()
        assert (spec_root / "docs" / "A.md").exists()
        backed = [p for p in _backup_root(ws.id).rglob("local.yaml") if p.is_file()]
        assert len(backed) == 1
        assert backed[0].read_text(encoding="utf-8") == "cached: true"


# ===========================================================================
# FR-04 坏包护栏
# ===========================================================================


class TestConvergeGuards:
    async def test_empty_tar_skips_convergence(self, db_session, tmp_path) -> None:
        """护栏①：空 tar（落盘集为空）→ 跳过对账，镜像现状不动。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        _, converged_files, converged_dirs = await SpecWorkspaceService(
            db_session
        )._write_spec_root(ws.id, _build_tar({}))

        assert converged_files == 0
        assert converged_dirs == 0
        assert (spec_root / "docs" / "A.md").exists()
        assert not _backup_root(ws.id).exists()

    async def test_ratio_guard_aborts_convergence(self, db_session, tmp_path) -> None:
        """护栏②：磁盘文件数 > 2×max(落盘集,200) → 中止对账，镜像不动。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        (spec_root / "docs").mkdir(parents=True)
        (spec_root / "docs" / "A.md").write_text("# A", encoding="utf-8")
        # 401 个幽灵文件 > 2 × max(1, 200) = 400
        ghost_root = spec_root / "ghost"
        for i in range(401):
            gdir = ghost_root / f"d{i}"
            gdir.mkdir(parents=True, exist_ok=True)
            (gdir / "g.md").write_text("g", encoding="utf-8")
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar({"docs": None, "docs/A.md": b"# A"})
        _, converged_files, converged_dirs = await SpecWorkspaceService(
            db_session
        )._write_spec_root(ws.id, tar_bytes)

        assert converged_files == 0
        assert converged_dirs == 0
        # 坏包保护：镜像一个文件都不动
        assert (spec_root / "docs" / "A.md").exists()
        assert (ghost_root / "d0" / "g.md").exists()
        assert not _backup_root(ws.id).exists()
