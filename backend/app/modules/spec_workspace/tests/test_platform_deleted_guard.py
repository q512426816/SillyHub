"""platform_deleted 防复活拦截 + apply_ops 空目录清理守护测试。

Change 2026-08-29-change-delete-closure-and-spec-pull task-02（design §5.1 空目录
清理 / §5.4 防复活标记 + B-2 落盘级加固）：

- ① apply_ops delete 后 ops 涉及空目录从磁盘消失（FR-02 幽灵目录修复）；
  非涉及目录（含本来就空的无关目录）零触碰（R-03：仅涉及目录链，禁整树扫描）；
  rename 清空源目录同样清理；
- ② add 命中 platform_deleted=True 墓碑行（通道 1，CLI 以 manifest 为锚 diff 本地
  残留文件发 add）→ conflict=True + server_versions + 返回 dict platform_deleted
  列表含被拒路径，文件未落盘、行不翻 exists；
- ③ rename 目标命中 platform_deleted 墓碑（通道 2，daemon 增量搬入已删目录）→
  同拒绝；源文件不动、墓碑维持；
- ④ delete op 在墓碑行上幂等放行（愈合方向，design §5.4：version+1、exists=False
  维持、move FileNotFoundError 容错、platform_deleted 不动）；
- ⑤ daemon 全量回退（``_write_spec_root`` 收到含已平台删除目录文件的 tar）→
  B-2 落盘集计算阶段前缀排除：该前缀文件不落盘（磁盘无目录）、不进 landed 集
  （manifest 行不回翻、未见新路径也不建行）、归档区三段前缀同理。

对照锚：platform_deleted 全 FALSE（普通软删 exists=False）走原路径——add/rename
复活语义不变（ql-20260819-004），服务层返回 dict 仅多 ``platform_deleted: []``。

直接调 service 级方法（对齐 test_full_sync_convergence.py 范式），断言真实磁盘
副作用（目录消失/文件未落盘）+ manifest 行状态。

author: qinyi
created_at: 2026-08-29
"""

from __future__ import annotations

import base64
import hashlib
import io
import tarfile
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

from app.modules.scan_docs.model import ScanDocument
from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.spec_workspace.schema import FileOp
from app.modules.spec_workspace.service import SpecWorkspaceService
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers（对齐 test_sync_incremental.py / test_full_sync_convergence.py 范式）
# ---------------------------------------------------------------------------


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _op(op: str, path: str, base_version: int = 0, **extra: object) -> FileOp:
    return FileOp(op=op, path=path, base_version=base_version, **extra)  # type: ignore[arg-type]


async def _make_workspace(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="platform-deleted-guard ws",
        slug=f"pg-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/platform-deleted-guard-test",
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


async def _seed_tombstone(
    db_session,
    ws_id: uuid.UUID,
    path: str,
    *,
    version: int = 2,
    content: bytes = b"deleted",
) -> SpecFileManifest:
    """直接造 platform_deleted=True 墓碑行（模拟 task-06 平台删除入口的落库终态）。"""
    row = SpecFileManifest(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        path=path,
        content_hash=hashlib.sha256(content).hexdigest(),
        version=version,
        exists=False,
        platform_deleted=True,
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


async def _get_row(db_session, ws_id: uuid.UUID, path: str) -> SpecFileManifest | None:
    return (
        (
            await db_session.execute(
                select(SpecFileManifest).where(
                    SpecFileManifest.workspace_id == ws_id,
                    SpecFileManifest.path == path,
                )
            )
        )
        .scalars()
        .first()
    )


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
# ① apply_ops 空目录清理（design §5.1 / FR-02 幽灵目录）
# ===========================================================================


class TestApplyOpsEmptyDirCleanup:
    async def test_delete_cleans_ops_involved_empty_dirs(self, db_session, tmp_path) -> None:
        """delete 清空目录后，ops 涉及目录链自底向上消失；非涉及目录零触碰。

        changes/gone（含子目录）两文件全删 → changes/ 整链消失；docs/（仍有文件）
        与本来就空的无关目录 unrelated-empty 原样保留（R-03：仅 ops 涉及目录链，
        整树扫描会把 unrelated-empty 一并误删，此断言防退化）。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        for path, text in (
            ("changes/gone/a.md", "a"),
            ("changes/gone/sub/b.md", "b"),
            ("docs/keep.md", "keep"),
        ):
            result = await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])
            assert result["conflict"] is False, result

        # 无关空目录（非本次 ops 涉及）——清理后必须原样保留
        unrelated = spec_root / "unrelated-empty"
        unrelated.mkdir()

        result = await svc.apply_ops(
            ws.id,
            [
                _op("delete", "changes/gone/a.md", base_version=1),
                _op("delete", "changes/gone/sub/b.md", base_version=1),
            ],
        )
        assert result["conflict"] is False, result

        # ops 涉及目录链整链消失（子 → 父 → changes 根）
        assert not (spec_root / "changes" / "gone" / "sub").exists()
        assert not (spec_root / "changes" / "gone").exists()
        assert not (spec_root / "changes").exists()
        # 非涉及目录零触碰
        assert (spec_root / "docs" / "keep.md").read_text(encoding="utf-8") == "keep"
        assert unrelated.exists()

    async def test_delete_keeps_dir_when_other_file_remains(self, db_session, tmp_path) -> None:
        """目录仍有其他文件 → 非空即停，目录保留。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        for path, text in (
            ("changes/mixed/a.md", "a"),
            ("changes/mixed/b.md", "b"),
        ):
            await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])

        result = await svc.apply_ops(ws.id, [_op("delete", "changes/mixed/a.md", base_version=1)])
        assert result["conflict"] is False, result

        assert not (spec_root / "changes" / "mixed" / "a.md").exists()
        assert (spec_root / "changes" / "mixed" / "b.md").exists()
        assert (spec_root / "changes" / "mixed").exists()

    async def test_rename_emptied_source_dir_cleaned(self, db_session, tmp_path) -> None:
        """rename 搬走目录内最后一个文件 → 源目录链清理，目标目录保留。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        for path, text in (
            ("changes/src/x.md", "x"),
            ("changes/dst/keep.md", "keep"),
        ):
            await svc.apply_ops(ws.id, [_op("add", path, content=_b64(text))])

        result = await svc.apply_ops(
            ws.id,
            [_op("rename", "changes/src/x.md", base_version=1, new_path="changes/dst/y.md")],
        )
        assert result["conflict"] is False, result

        # 源目录（rename 后为空）从磁盘消失
        assert not (spec_root / "changes" / "src").exists()
        # 目标目录两文件俱在，changes 根保留
        assert (spec_root / "changes" / "dst" / "keep.md").exists()
        assert (spec_root / "changes" / "dst" / "y.md").read_text(encoding="utf-8") == "x"
        assert (spec_root / "changes").exists()


# ===========================================================================
# ② add 复活拦截（通道 1：CLI 直跑以 manifest 为锚 diff 本地残留文件）
# ===========================================================================


class TestAddReviveInterception:
    async def test_add_on_platform_deleted_tombstone_rejected(self, db_session, tmp_path) -> None:
        """add 命中 platform_deleted=True 行 → 拒绝复活。

        conflict=True + server_versions 回服务器版本 + 返回 dict ``platform_deleted``
        列表含被拒路径；文件未落盘；行保持 exists=False / platform_deleted=True。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        tomb_path = "changes/dead/proposal.md"
        await _seed_tombstone(db_session, ws.id, tomb_path, version=2)

        result = await svc.apply_ops(
            ws.id,
            [
                _op(
                    "add",
                    tomb_path,
                    content=_b64("revive attempt"),
                    hash=hashlib.sha256(b"revive attempt").hexdigest(),
                )
            ],
        )

        assert result["conflict"] is True
        assert result["server_versions"] == {tomb_path: 2}
        assert result["platform_deleted"] == [tomb_path]
        assert result["new_versions"] == {}
        # 文件未落盘（目录都未建）
        assert not (spec_root / "changes" / "dead" / "proposal.md").exists()
        assert not (spec_root / "changes" / "dead").exists()
        # 行未翻回 exists / 未清墓碑
        row = await _get_row(db_session, ws.id, tomb_path)
        assert row is not None
        assert row.exists is False
        assert row.platform_deleted is True
        assert row.version == 2

    async def test_add_on_plain_soft_deleted_row_still_revives(self, db_session, tmp_path) -> None:
        """对照锚：普通软删行（exists=False、platform_deleted=False）add 照常复活。

        平台未删除任何变更时复活语义与现状一致（ql-20260819-004 不回归）。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        await svc.apply_ops(ws.id, [_op("add", "docs/a.md", content=_b64("old"))])
        await svc.apply_ops(ws.id, [_op("delete", "docs/a.md", base_version=1)])
        # 注意：delete 后 docs/ 已被空目录清理移除——复活 add 需重建父目录
        # （_write_op_file mkdir(parents=True) 天然满足）。
        result = await svc.apply_ops(
            ws.id,
            [
                _op(
                    "add",
                    "docs/a.md",
                    content=_b64("new"),
                    hash=hashlib.sha256(b"new").hexdigest(),
                )
            ],
        )

        assert result["conflict"] is False
        assert result["new_versions"] == {"docs/a.md": 3}
        assert result["platform_deleted"] == []
        assert (spec_root / "docs" / "a.md").read_text(encoding="utf-8") == "new"
        row = await _get_row(db_session, ws.id, "docs/a.md")
        assert row is not None
        assert row.exists is True
        assert row.platform_deleted is False

    async def test_plain_add_response_dict_shape_unchanged(self, db_session, tmp_path) -> None:
        """无任何拦截时返回 dict 仅多 ``platform_deleted: []``（既有三键不动）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        result = await svc.apply_ops(ws.id, [_op("add", "docs/plain.md", content=_b64("p"))])
        assert result == {
            "new_versions": {"docs/plain.md": 1},
            "conflict": False,
            "server_versions": None,
            "platform_deleted": [],
        }


# ===========================================================================
# ③ rename 目标命中墓碑拦截（通道 2：daemon 增量把本地残留搬进已删目录）
# ===========================================================================


class TestRenameTargetInterception:
    async def test_rename_target_platform_deleted_tombstone_rejected(
        self, db_session, tmp_path
    ) -> None:
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)

        src = "changes/ok/tasks.md"
        await svc.apply_ops(ws.id, [_op("add", src, content=_b64("tasks"))])
        dead_target = "changes/dead/tasks.md"
        await _seed_tombstone(db_session, ws.id, dead_target, version=3)

        result = await svc.apply_ops(
            ws.id, [_op("rename", src, base_version=1, new_path=dead_target)]
        )

        assert result["conflict"] is True
        assert result["server_versions"] == {dead_target: 3}
        assert result["platform_deleted"] == [dead_target]
        assert result["new_versions"] == {}
        # 源文件不动（rename 整体被拒，未 move）
        assert (spec_root / "changes" / "ok" / "tasks.md").read_text(encoding="utf-8") == "tasks"
        # 目标未落盘、目录未建
        assert not (spec_root / "changes" / "dead").exists()
        # 墓碑行维持
        row = await _get_row(db_session, ws.id, dead_target)
        assert row is not None
        assert row.exists is False
        assert row.platform_deleted is True
        assert row.version == 3
        # 源行未迁移删除
        src_row = await _get_row(db_session, ws.id, src)
        assert src_row is not None
        assert src_row.exists is True


# ===========================================================================
# ④ delete op 在墓碑行上幂等放行（design §5.4：愈合方向不拦截）
# ===========================================================================


class TestDeleteOpIdempotentOnTombstone:
    async def test_delete_on_platform_deleted_row_idempotent(self, db_session, tmp_path) -> None:
        """delete op 命中 platform_deleted=True 行 → 无异常、version+1、exists=False
        维持、platform_deleted 不动（磁盘无文件 → move FileNotFoundError 容错）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        tomb_path = "changes/dead/proposal.md"
        await _seed_tombstone(db_session, ws.id, tomb_path, version=5)

        result = await svc.apply_ops(ws.id, [_op("delete", tomb_path, base_version=5)])

        assert result["conflict"] is False
        assert result["new_versions"] == {tomb_path: 6}
        assert result["platform_deleted"] == []
        row = await _get_row(db_session, ws.id, tomb_path)
        assert row is not None
        assert row.exists is False
        assert row.platform_deleted is True
        assert row.version == 6


# ===========================================================================
# ⑤ _write_spec_root 落盘级前缀排除（B-2 加固，通道 3：daemon 全量回退）
# ===========================================================================


class TestWriteSpecRootExclusion:
    async def test_full_sync_tar_skips_platform_deleted_prefixes(
        self, db_session, tmp_path
    ) -> None:
        """tar 含已平台删除目录文件 → 前缀级不落盘、manifest 行不回翻。

        - 活跃区两段前缀 changes/{name}/、归档区三段前缀 changes/archive/{name}/
          同理排除；
        - 前缀内「从未见过的成员新路径」（无 manifest 行）同样不落盘、不建行
          （前缀探测优先于逐路径精确匹配，闭合 P2 边角）；
        - 正常变更目录文件照常落盘。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        spec_root.mkdir(parents=True)
        await _make_spec_workspace(db_session, ws, spec_root)
        await _seed_tombstone(db_session, ws.id, "changes/dead/proposal.md", version=2)
        await _seed_tombstone(db_session, ws.id, "changes/archive/gone/tasks.md", version=1)

        tar_bytes = _build_tar(
            {
                "docs": None,
                "docs/keep.md": b"# keep",
                "changes": None,
                "changes/dead": None,
                # 墓碑路径本体（daemon 陈旧缓存整树 tar）
                "changes/dead/proposal.md": b"revive attempt",
                # 前缀内未见新路径（无 manifest 行）
                "changes/dead/never-seen.md": b"unseen",
                # 归档区已删目录
                "changes/archive": None,
                "changes/archive/gone": None,
                "changes/archive/gone/tasks.md": b"t",
                # 正常变更目录（对照锚：照常落盘）
                "changes/live": None,
                "changes/live/ok.md": b"# ok",
            }
        )
        spec_ws, converged_files, converged_dirs = await SpecWorkspaceService(
            db_session
        )._write_spec_root(ws.id, tar_bytes)

        # 正常文件落盘
        assert (spec_root / "docs" / "keep.md").read_text(encoding="utf-8") == "# keep"
        assert (spec_root / "changes" / "live" / "ok.md").read_text(encoding="utf-8") == "# ok"
        # 已删目录不落盘（连目录都不在磁盘上）
        assert not (spec_root / "changes" / "dead").exists()
        assert not (spec_root / "changes" / "archive" / "gone").exists()
        # 无对账误删（落盘集与磁盘一致）
        assert converged_files == 0
        assert converged_dirs == 0

        rows = await _manifest_rows(db_session, ws.id)
        # 墓碑行不回翻：exists/platform_deleted/version 维持，未被对齐环触碰
        dead = rows["changes/dead/proposal.md"]
        assert dead.exists is False
        assert dead.platform_deleted is True
        assert dead.version == 2
        archived = rows["changes/archive/gone/tasks.md"]
        assert archived.exists is False
        assert archived.platform_deleted is True
        assert archived.version == 1
        # 前缀内未见新路径不建行
        assert "changes/dead/never-seen.md" not in rows
        # 正常文件照常建行
        assert rows["docs/keep.md"].exists is True
        assert rows["changes/live/ok.md"].exists is True

        # 连带证据：已删路径也不产 ScanDocument（文档树不复活）
        doc_paths = {
            d.path
            for d in (
                (
                    await db_session.execute(
                        select(ScanDocument).where(ScanDocument.workspace_id == ws.id)
                    )
                )
                .scalars()
                .all()
            )
        }
        assert doc_paths == {"docs/keep.md", "changes/live/ok.md"}
        assert spec_ws.sync_status == "clean"

    async def test_full_sync_without_tombstones_unchanged(self, db_session, tmp_path) -> None:
        """对照锚：无 platform_deleted 行时全量落盘行为与现状一致（原路径零变化）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        spec_root.mkdir(parents=True)
        await _make_spec_workspace(db_session, ws, spec_root)

        tar_bytes = _build_tar(
            {"docs": None, "docs/A.md": b"# A", "changes/x": None, "changes/x/p.md": b"# P"}
        )
        spec_ws, converged_files, converged_dirs = await SpecWorkspaceService(
            db_session
        )._write_spec_root(ws.id, tar_bytes)

        assert converged_files == 0
        assert converged_dirs == 0
        assert (spec_root / "docs" / "A.md").exists()
        assert (spec_root / "changes" / "x" / "p.md").exists()
        rows = await _manifest_rows(db_session, ws.id)
        assert set(rows) == {"docs/A.md", "changes/x/p.md"}
        assert all(r.exists is True and r.platform_deleted is False for r in rows.values())
        assert spec_ws.sync_status == "clean"


# Suppress unused-import warning for pytest (fixture discovery).
pytestmark = pytest.mark.asyncio
