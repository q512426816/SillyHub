"""冲突推送平台留档（local_archive）构建与落库守护测试。

Change 2026-10-20-conflict-platform-archive task-01/02（design §做法概述 /
§接口契约）：

- 蒸馏器 `_distill_local_archive` 纯函数直测：
  - add/update/rename 条目形态（utf8 文本 content / mtime 透传 / rename 取
    new_path、delete 取 missing）；
  - 非 utf8 / 非法 base64 → binary 条目不存文本（fail-soft 不抛）；
  - 三重帽：单文件 32000 字符截断置 truncated；总量 512KB 后续条目停存
    content（路径/missing/binary/mtime 保留）；条目数 300 帽。
- apply_ops 七类被拒点 → open 行 details_json.local_archive 落库断言
  （乐观锁冲突 add / delete 冲突 missing / 墓碑前缀拦截 / rename 目标占用），
  以及冲突推送整体替换语义（第二次冲突推送覆盖第一次留档）。

对照锚：全绿推送不建行、既有 details 键（conflicting_paths/server_versions/
platform_deleted/last_seen_at）不缺——本变更只**新增** local_archive 键。

author: qinyi
created_at: 2026-10-20
"""

from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from app.modules.spec_profile.model import SpecConflict
from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.spec_workspace.schema import FileOp
from app.modules.spec_workspace.service import (
    ARCHIVE_ENTRY_CAP,
    ARCHIVE_TEXT_CAP_PER_FILE_CHARS,
    ARCHIVE_TOTAL_BYTE_CAP,
    SpecWorkspaceService,
    _distill_local_archive,
)
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers（对齐 test_platform_deleted_guard.py 范式）
# ---------------------------------------------------------------------------


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _op(op: str, path: str, base_version: int = 0, **extra: object) -> FileOp:
    return FileOp(op=op, path=path, base_version=base_version, **extra)


async def _make_workspace(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="conflict-local-archive ws",
        slug=f"cla-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/conflict-local-archive-test",
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


async def _seed_manifest(
    db_session,
    ws_id: uuid.UUID,
    path: str,
    *,
    version: int,
    content: bytes,
    exists: bool = True,
    platform_deleted: bool = False,
) -> SpecFileManifest:
    row = SpecFileManifest(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        path=path,
        content_hash=hashlib.sha256(content).hexdigest(),
        version=version,
        exists=exists,
        platform_deleted=platform_deleted,
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


async def _open_conflict_row(db_session, ws_id: uuid.UUID) -> SpecConflict | None:
    return (
        (
            await db_session.execute(
                select(SpecConflict).where(
                    SpecConflict.workspace_id == ws_id,
                    SpecConflict.stage == "spec-sync",
                    SpecConflict.status == "open",
                )
            )
        )
        .scalars()
        .first()
    )


# ---------------------------------------------------------------------------
# 蒸馏器纯函数
# ---------------------------------------------------------------------------


class TestDistillLocalArchive:
    def test_add_utf8_entry_shape(self):
        entries = _distill_local_archive(
            [
                _op(
                    "add",
                    "changes/foo/design.md",
                    content=_b64("# 设计\n正文"),
                    mtime=1_760_000_000.5,
                )
            ]
        )
        assert entries == [
            {
                "path": "changes/foo/design.md",
                "missing": False,
                "content": "# 设计\n正文",
                "binary": False,
                "truncated": False,
                "mtime": datetime.fromtimestamp(1_760_000_000.5, tz=UTC).isoformat(),
            }
        ]

    def test_delete_entry_missing(self):
        entries = _distill_local_archive([_op("delete", "changes/foo/tasks.md", base_version=1)])
        assert entries == [
            {
                "path": "changes/foo/tasks.md",
                "missing": True,
                "content": None,
                "binary": False,
                "truncated": False,
                "mtime": None,
            }
        ]

    def test_rename_entry_uses_new_path(self):
        entries = _distill_local_archive(
            [
                _op(
                    "rename",
                    "changes/foo/old.md",
                    new_path="changes/archive/foo/old.md",
                    content=_b64("搬运内容"),
                    base_version=3,
                )
            ]
        )
        assert entries[0]["path"] == "changes/archive/foo/old.md"
        assert entries[0]["content"] == "搬运内容"
        assert entries[0]["missing"] is False

    def test_rename_without_content_kept_as_no_text(self):
        entries = _distill_local_archive([_op("rename", "a.md", new_path="b.md", base_version=1)])
        assert entries[0] == {
            "path": "b.md",
            "missing": False,
            "content": None,
            "binary": False,
            "truncated": False,
            "mtime": None,
        }

    def test_pathological_mtime_fail_soft_to_none(self):
        # 评审 P3：病态 mtime（超范围浮点）不炸蒸馏——fail-soft 为 None，
        # 其余条目字段照常。
        entries = _distill_local_archive(
            [
                _op(
                    "add",
                    "changes/foo/x.md",
                    content=_b64("ok"),
                    mtime=1e300,
                )
            ]
        )
        assert entries[0]["mtime"] is None
        assert entries[0]["content"] == "ok"

    def test_non_utf8_content_is_binary(self):
        entries = _distill_local_archive(
            [_op("add", "bin/file.bin", content=base64.b64encode(b"\xff\xfe\x00").decode())]
        )
        assert entries[0]["binary"] is True
        assert entries[0]["content"] is None

    def test_invalid_base64_fail_soft_as_binary(self):
        entries = _distill_local_archive([_op("add", "x.md", content="not-base64!!!")])
        assert entries[0]["binary"] is True
        assert entries[0]["content"] is None

    def test_per_file_text_cap_truncates(self):
        big = "x" * (ARCHIVE_TEXT_CAP_PER_FILE_CHARS + 8_000)
        entries = _distill_local_archive([_op("update", "big.md", content=_b64(big))])
        assert len(entries[0]["content"]) == ARCHIVE_TEXT_CAP_PER_FILE_CHARS
        assert entries[0]["truncated"] is True

    def test_total_byte_cap_stops_storing_content_not_paths(self):
        # 每条 30000 字符（低于单文件 32000 帽不触发截断），~17 条起超出 512KB
        # 总量帽 → 后续条目 content=None（路径/missing 保留）。
        per_file = "y" * 30_000
        ops = [_op("update", f"changes/foo/f{i:02d}.md", content=_b64(per_file)) for i in range(20)]
        entries = _distill_local_archive(ops)
        stored = [e for e in entries if e["content"] is not None]
        dropped = [e for e in entries if e["content"] is None]
        assert len(entries) == 20  # 路径清单必须完整保留
        assert 15 <= len(stored) <= 18  # 512KB / ~30KB ≈ 17 条文本
        assert dropped, "总量帽后必须有停存 content 的条目"
        assert all(e["path"] for e in dropped)
        assert all(e["content"] is None and e["missing"] is False for e in dropped)
        serialized = len(json.dumps(entries, ensure_ascii=False).encode("utf-8"))
        assert serialized <= ARCHIVE_TOTAL_BYTE_CAP + 30_000  # 停存后不失控膨胀

    def test_entry_cap_300(self):
        ops = [
            _op("delete", f"changes/foo/d{i:04d}.md", base_version=1)
            for i in range(ARCHIVE_ENTRY_CAP + 5)
        ]
        entries = _distill_local_archive(ops)
        assert len(entries) == ARCHIVE_ENTRY_CAP
        assert entries[0]["path"] == "changes/foo/d0000.md"

    def test_empty_ops_empty_archive(self):
        assert _distill_local_archive([]) == []


# ---------------------------------------------------------------------------
# apply_ops 被拒点 → open 行 local_archive 落库
# ---------------------------------------------------------------------------


class TestApplyOpsArchiveUpsert:
    async def test_optimistic_lock_conflict_archives_content(self, db_session, tmp_path):
        ws = await _make_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path)
        svc = SpecWorkspaceService(db_session)
        await _seed_manifest(
            db_session, ws.id, "changes/foo/design.md", version=2, content=b"server v2"
        )
        result = await svc.apply_ops(
            ws.id,
            [
                _op(
                    "update",
                    "changes/foo/design.md",
                    base_version=1,
                    content=_b64("machine v9"),
                    mtime=1.5,
                )
            ],
        )
        assert result["conflict"] is True
        row = await _open_conflict_row(db_session, ws.id)
        assert row is not None
        details = json.loads(row.details_json)
        entry = details["local_archive"][0]
        assert entry["path"] == "changes/foo/design.md"
        assert entry["content"] == "machine v9"
        assert entry["missing"] is False
        assert entry["mtime"] == datetime.fromtimestamp(1.5, tz=UTC).isoformat()
        # 既有键不缺（本变更只新增键）。
        assert details["conflicting_paths"] == ["changes/foo/design.md"]
        assert details["server_versions"] == {"changes/foo/design.md": 2}

    async def test_delete_conflict_archives_missing(self, db_session, tmp_path):
        ws = await _make_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path)
        svc = SpecWorkspaceService(db_session)
        await _seed_manifest(
            db_session, ws.id, "changes/foo/tasks.md", version=2, content=b"server"
        )
        result = await svc.apply_ops(ws.id, [_op("delete", "changes/foo/tasks.md", base_version=1)])
        assert result["conflict"] is True
        details = json.loads((await _open_conflict_row(db_session, ws.id)).details_json)
        assert details["local_archive"] == [
            {
                "path": "changes/foo/tasks.md",
                "missing": True,
                "content": None,
                "binary": False,
                "truncated": False,
                "mtime": None,
            }
        ]

    async def test_tombstone_prefix_rejection_archives(self, db_session, tmp_path):
        ws = await _make_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path)
        svc = SpecWorkspaceService(db_session)
        await _seed_manifest(
            db_session,
            ws.id,
            "changes/gone/old.md",
            version=1,
            content=b"x",
            exists=False,
            platform_deleted=True,
        )
        result = await svc.apply_ops(
            ws.id,
            [_op("add", "changes/gone/new.md", base_version=0, content=_b64("复活企图"))],
        )
        assert result["conflict"] is True
        assert result["platform_deleted"] == ["changes/gone/new.md"]
        details = json.loads((await _open_conflict_row(db_session, ws.id)).details_json)
        assert details["local_archive"][0]["path"] == "changes/gone/new.md"
        assert details["local_archive"][0]["content"] == "复活企图"

    async def test_rename_target_occupied_archives_new_path(self, db_session, tmp_path):
        ws = await _make_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path)
        svc = SpecWorkspaceService(db_session)
        # 源文件存在（本地与平台一致），目标被占用。
        await _seed_manifest(db_session, ws.id, "changes/foo/a.md", version=1, content=b"a")
        await _seed_manifest(db_session, ws.id, "changes/foo/b.md", version=4, content=b"occupied")
        (tmp_path / "changes/foo").mkdir(parents=True, exist_ok=True)
        (tmp_path / "changes/foo/a.md").write_bytes(b"a")
        (tmp_path / "changes/foo/b.md").write_bytes(b"occupied")
        result = await svc.apply_ops(
            ws.id,
            [
                _op(
                    "rename",
                    "changes/foo/a.md",
                    new_path="changes/foo/b.md",
                    base_version=1,
                )
            ],
        )
        assert result["conflict"] is True
        details = json.loads((await _open_conflict_row(db_session, ws.id)).details_json)
        assert details["local_archive"][0]["path"] == "changes/foo/b.md"
        assert details["local_archive"][0]["missing"] is False

    async def test_second_conflict_push_replaces_archive(self, db_session, tmp_path):
        ws = await _make_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path)
        svc = SpecWorkspaceService(db_session)
        await _seed_manifest(
            db_session, ws.id, "changes/foo/design.md", version=2, content=b"server v2"
        )
        await svc.apply_ops(
            ws.id,
            [_op("update", "changes/foo/design.md", base_version=1, content=_b64("第一次"))],
        )
        await svc.apply_ops(
            ws.id,
            [_op("update", "changes/foo/design.md", base_version=1, content=_b64("第二次"))],
        )
        row = await _open_conflict_row(db_session, ws.id)
        details = json.loads(row.details_json)
        assert [e["content"] for e in details["local_archive"]] == ["第二次"]

    async def test_green_push_leaves_no_open_row(self, db_session, tmp_path):
        ws = await _make_workspace(db_session)
        await _make_spec_workspace(db_session, ws, tmp_path)
        svc = SpecWorkspaceService(db_session)
        await svc.apply_ops(ws.id, [_op("add", "changes/foo/new.md", content=_b64("ok"))])
        assert await _open_conflict_row(db_session, ws.id) is None
