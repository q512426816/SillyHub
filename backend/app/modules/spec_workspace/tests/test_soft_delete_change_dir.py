"""soft_delete_change_dir 镜像目录软删测试。

Change 2026-08-29-change-delete-closure-and-spec-pull task-06（design §6.1 步骤① /
FR-05b / D-002@v1）：

- 活跃区前缀 ``changes/{name}/``：现存文件逐个移入 ``spec-backups/{ws}/{ts}/<rel>``
  （move 软删），manifest 行三标记（``exists=False`` / ``version+1`` /
  ``platform_deleted=True``），变更目录链自底向上 rmdir；
- 归档区前缀 ``changes/archive/{name}/`` 同理可删（location='archive'）；
- 前缀精确性：变更名含 ``_``（my_change）不误伤相似名（myXchange，未转义 LIKE 的
  ``_`` 通配恰会匹配 X）与前缀延长名（my_change_extra）；
- 既有 ``exists=False`` 行只补 ``platform_deleted=True``（前缀级墓碑完整性），
  不 move 不 version+1；
- 零文件幂等（file_count=0 不抛）；
- CLI 墓碑写路径接线（platform_sync ``_apply_cli_tombstone`` 后置调用）触发本方法
  收敛镜像（design §5.5 / §6）。

直接调 service 级方法（对齐 test_platform_deleted_guard.py / test_full_sync_
convergence.py 范式），断言真实磁盘副作用（备份区文件 / 目录消失）+ manifest 行状态。

author: qinyi
created_at: 2026-08-29
"""

from __future__ import annotations

import base64
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.spec_workspace.schema import FileOp
from app.modules.spec_workspace.service import SpecWorkspaceService
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers（对齐 test_platform_deleted_guard.py 范式）
# ---------------------------------------------------------------------------


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _op(op: str, path: str, base_version: int = 0, **extra: object) -> FileOp:
    return FileOp(op=op, path=path, base_version=base_version, **extra)  # type: ignore[arg-type]


async def _make_workspace(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"soft-del-{uuid.uuid4().hex[:8]}",
        slug=f"sd-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/soft-del-{uuid.uuid4().hex[:8]}",
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


async def _manifest_rows(db_session, ws_id: uuid.UUID) -> dict[str, SpecFileManifest]:
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


def _progress(name: str, *, status: str = "in_progress") -> dict:
    """serializeForSync 六表 body（changes[0] 同名条目，供墓碑检测取值）。"""
    return {
        "project": {"name": "demo"},
        "changes": [{"name": name, "current_stage": "execute", "status": status, "title": name}],
        "stages": [],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


# ===========================================================================
# ① 活跃区：文件移入备份区 + manifest 三标记 + 空目录清理
# ===========================================================================


class TestSoftDeleteActiveChange:
    async def test_moves_files_marks_manifest_cleans_dir(self, db_session, tmp_path) -> None:
        """现存文件移备份区、行置三标记、变更目录消失；无关目录零触碰。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        for path, text in (
            ("changes/my_change/proposal.md", "p"),
            ("changes/my_change/tasks/task-01.md", "t"),
            ("changes/other_change/keep.md", "keep"),
            ("docs/readme.md", "docs"),
        ):
            result = await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])
            assert result["conflict"] is False, result

        result = await svc.soft_delete_change_dir(ws.id, "my_change")

        assert result["file_count"] == 2
        backup_dir = Path(str(result["backup_dir"]))
        assert (backup_dir / "changes" / "my_change" / "proposal.md").read_text(
            encoding="utf-8"
        ) == "p"
        assert (backup_dir / "changes" / "my_change" / "tasks" / "task-01.md").read_text(
            encoding="utf-8"
        ) == "t"

        rows = await _manifest_rows(db_session, ws.id)
        for p in ("changes/my_change/proposal.md", "changes/my_change/tasks/task-01.md"):
            assert rows[p].exists is False
            assert rows[p].platform_deleted is True
            assert rows[p].version == 2  # add=1 → 软删 +1
        # 无关目录零触碰
        assert rows["changes/other_change/keep.md"].exists is True
        assert rows["changes/other_change/keep.md"].platform_deleted is False
        assert rows["docs/readme.md"].platform_deleted is False

        # 变更目录（含子目录）从镜像消失；同根其它变更目录保留
        assert not (spec_root / "changes" / "my_change").exists()
        assert (spec_root / "changes" / "other_change" / "keep.md").exists()
        assert (spec_root / "docs" / "readme.md").exists()

    async def test_pre_existing_soft_deleted_row_only_strengthened(
        self, db_session, tmp_path
    ) -> None:
        """前缀内既有 exists=False 行（增量协议软删过）只补 platform_deleted=True，
        不 move 不 version+1（前缀级墓碑完整性，防行缺失时兜底锚点漏判）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        await svc.apply_ops(ws.id, [_op("add", "changes/mixed/a.md", content=_b64("a"))])
        await svc.apply_ops(ws.id, [_op("add", "changes/mixed/stale.md", content=_b64("s"))])
        # 增量 delete：stale.md → exists=False（platform_deleted=False）
        await svc.apply_ops(ws.id, [_op("delete", "changes/mixed/stale.md", base_version=1)])

        result = await svc.soft_delete_change_dir(ws.id, "mixed")

        assert result["file_count"] == 1  # 只搬现存 a.md
        rows = await _manifest_rows(db_session, ws.id)
        assert rows["changes/mixed/a.md"].exists is False
        assert rows["changes/mixed/a.md"].platform_deleted is True
        assert rows["changes/mixed/a.md"].version == 2
        # stale.md：既有软删行——补墓碑标记、version 不动（无 op 应用）
        assert rows["changes/mixed/stale.md"].exists is False
        assert rows["changes/mixed/stale.md"].platform_deleted is True
        assert rows["changes/mixed/stale.md"].version == 2
        assert not (spec_root / "changes" / "mixed").exists()


# ===========================================================================
# ② 前缀精确性（含下划线变更名不漏不误伤）
# ===========================================================================


class TestPrefixPrecision:
    async def test_underscore_name_no_false_match(self, db_session, tmp_path) -> None:
        """删 my_change：myXchange（未转义 LIKE ``_`` 通配会误配）与前缀延长名
        my_change_extra 均零触碰。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        for path, text in (
            ("changes/my_change/a.md", "a"),
            ("changes/myXchange/b.md", "b"),
            ("changes/my_change_extra/c.md", "c"),
        ):
            await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])

        result = await svc.soft_delete_change_dir(ws.id, "my_change")

        assert result["file_count"] == 1
        rows = await _manifest_rows(db_session, ws.id)
        assert rows["changes/my_change/a.md"].platform_deleted is True
        for untouched in ("changes/myXchange/b.md", "changes/my_change_extra/c.md"):
            assert rows[untouched].platform_deleted is False
            assert rows[untouched].exists is True
        assert (spec_root / "changes" / "myXchange" / "b.md").exists()
        assert (spec_root / "changes" / "my_change_extra" / "c.md").exists()


# ===========================================================================
# ③ 归档区：location='archive' → changes/archive/{name}/ 前缀
# ===========================================================================


class TestSoftDeleteArchivedChange:
    async def test_archive_prefix_deleted(self, db_session, tmp_path) -> None:
        """归档区行删除走三段前缀，同样落三标记 + 清目录；活跃区同名变更不受牵连。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        for path, text in (
            ("changes/archive/gone_change/x.md", "x"),
            ("changes/archive/live_change/y.md", "y"),
            ("changes/gone_change/z.md", "z"),
        ):
            await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])

        result = await svc.soft_delete_change_dir(ws.id, "gone_change", location="archive")

        assert result["file_count"] == 1
        backup_dir = Path(str(result["backup_dir"]))
        assert (backup_dir / "changes" / "archive" / "gone_change" / "x.md").read_text(
            encoding="utf-8"
        ) == "x"

        rows = await _manifest_rows(db_session, ws.id)
        assert rows["changes/archive/gone_change/x.md"].exists is False
        assert rows["changes/archive/gone_change/x.md"].platform_deleted is True
        assert rows["changes/archive/gone_change/x.md"].version == 2
        # 归档区其它变更 + 活跃区同名变更零触碰
        assert rows["changes/archive/live_change/y.md"].platform_deleted is False
        assert rows["changes/gone_change/z.md"].platform_deleted is False
        assert rows["changes/gone_change/z.md"].exists is True

        assert not (spec_root / "changes" / "archive" / "gone_change").exists()
        assert (spec_root / "changes" / "archive" / "live_change" / "y.md").exists()
        assert (spec_root / "changes" / "gone_change" / "z.md").exists()


# ===========================================================================
# ④ 零文件幂等
# ===========================================================================


class TestZeroFileIdempotent:
    async def test_no_manifest_rows_returns_zero(self, db_session, tmp_path) -> None:
        """前缀下无任何 manifest 行 → file_count=0 不抛（幂等）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        await svc.apply_ops(ws.id, [_op("add", "changes/live/a.md", content=_b64("a"))])

        result = await svc.soft_delete_change_dir(ws.id, "never_existed")

        assert result["file_count"] == 0
        rows = await _manifest_rows(db_session, ws.id)
        assert rows["changes/live/a.md"].platform_deleted is False
        assert (spec_root / "changes" / "live" / "a.md").exists()


# ===========================================================================
# ⑤ CLI 墓碑写路径接线（platform_sync _apply_cli_tombstone → 本方法收敛镜像）
# ===========================================================================


class TestCliTombstoneWiring:
    async def test_tombstone_upsert_converges_mirror(self, db_session, tmp_path) -> None:
        """progress 上行 status='deleted'（task-04 墓碑）→ 镜像被 soft_delete_change_dir
        同步收敛：Change.location='deleted' + 文件入备份区 + manifest 三标记。"""
        from app.modules.change.model import Change
        from app.modules.platform_sync.service import PlatformSyncService

        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        for path, text in (
            ("changes/tomb_change/proposal.md", "p"),
            ("changes/tomb_change/tasks/task-01.md", "t"),
        ):
            await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])

        result = await PlatformSyncService(db_session).upsert_progress(
            ws.id,
            "tomb_change",
            _progress("tomb_change", status="deleted"),
            base_ts=None,
            pushed_at="2026-08-29T09:00:00.000Z",
            user="cli-user",
        )
        assert result.change_deleted is False

        change = (
            (
                await db_session.execute(
                    select(Change).where(
                        Change.workspace_id == ws.id,
                        Change.change_key == "tomb_change",
                    )
                )
            )
            .scalars()
            .one_or_none()
        )
        assert change is not None
        assert change.location == "deleted"

        rows = await _manifest_rows(db_session, ws.id)
        for p in ("changes/tomb_change/proposal.md", "changes/tomb_change/tasks/task-01.md"):
            assert rows[p].exists is False
            assert rows[p].platform_deleted is True
        assert not (spec_root / "changes" / "tomb_change").exists()
        # 备份区有文件（收敛真实发生，非仅置位）——备份区根与 spec_root 是兄弟
        # 目录：{spec_data_root}/spec-backups/{ws}（_backup_root，D-008）。
        from app.core.config import get_settings

        backup_parent = Path(get_settings().spec_data_root) / "spec-backups" / str(ws.id)
        moved = [p for p in backup_parent.rglob("proposal.md")]
        assert moved and moved[0].read_text(encoding="utf-8") == "p"


# Suppress unused-import warning for pytest (fixture discovery).
pytestmark = pytest.mark.asyncio
