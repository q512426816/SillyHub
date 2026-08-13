"""Tests for ``SpecWorkspaceService.apply_sync`` / ``build_bundle``.

task-07 (2026-06-26-daemon-client-spec-sync-fix): D-003@v1 非对称契约——
push (apply_sync) 接收 daemon tar 内的 ``.runtime/``（整树覆盖，不再保留
backend 旧 .runtime），pull (build_bundle) 仍排除 ``.runtime/``。
FR-07：apply_sync 成功后落 ``last_synced_at`` / ``sync_status='clean'``。

author: qinyi
created_at: 2026-06-26
"""

from __future__ import annotations

import io
import tarfile
import uuid
from pathlib import Path

import pytest

from app.modules.spec_workspace.schema import SpecWorkspaceCreate
from app.modules.spec_workspace.service import SpecWorkspaceService


def _make_tar(entries: dict[str, bytes | str]) -> bytes:
    """Build an in-memory tar from ``{arcname: content}``.

    ``content`` of ``bytes`` is written verbatim; ``str`` is encoded utf-8.
    """
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for arcname, content in entries.items():
            data = content.encode("utf-8") if isinstance(content, str) else content
            info = tarfile.TarInfo(name=arcname)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _make_long_name_tar(entries: dict[str, bytes | str]) -> bytes:
    """Build a tar whose arcnames can exceed 100 bytes via GNU LongLink (ql-20260813-004 B).

    Python ``tarfile`` in ``GNU_FORMAT`` emits a ``'L'`` LongLink header for names > 100
    bytes — the same format daemon ``buildLongLinkHeader`` produces. Used to verify the
    backend unpacks long names without the 500 that truncated names caused.
    """
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.GNU_FORMAT) as tar:
        for arcname, content in entries.items():
            data = content.encode("utf-8") if isinstance(content, str) else content
            info = tarfile.TarInfo(name=arcname)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


async def _make_spec_ws(tmp_path: Path, db_session) -> tuple[uuid.UUID, Path]:
    """Create a spec_workspace whose spec_root points at ``tmp_path``."""
    svc = SpecWorkspaceService(db_session)
    workspace_id = uuid.uuid4()
    spec_root = tmp_path / "spec"
    spec_root.mkdir(parents=True, exist_ok=True)
    spec_ws = await svc.create(
        workspace_id,
        SpecWorkspaceCreate(spec_root=str(spec_root), strategy="platform-managed"),
    )
    # Stub last_synced_at to None initially so we can assert it gets stamped.
    spec_ws.last_synced_at = None
    spec_ws.sync_status = "dirty"
    await db_session.commit()
    await db_session.refresh(spec_ws)
    # apply_sync/get key off workspace_id (the FK), not the PK (spec_ws.id).
    return workspace_id, Path(spec_ws.spec_root)


@pytest.fixture(autouse=True)
def _stub_reparse(monkeypatch):
    """Avoid the real reparse (it walks the workspace table + filesystem).

    Return a stable ``parsed`` count and never raise, so apply_sync's success
    path (clean + last_synced_at) is exercised deterministically.
    """

    async def _fake_reparse(self, workspace_id):
        return ({"parsed": 1, "created": 1, "updated": 0, "deleted": 0}, None)

    from app.modules.scan_docs.service import ScanDocsService

    monkeypatch.setattr(ScanDocsService, "reparse", _fake_reparse)

    # Stub the phase dispatcher added by 2026-07-01-changes-align-sillyspec so
    # neither scan_docs nor change reparse hits the real workspace table.
    from app.modules.spec_workspace.service import SpecWorkspaceService

    async def _fake_phase(self, workspace_id, spec_ws, phase):
        return 1

    monkeypatch.setattr(SpecWorkspaceService, "_reparse_phase", _fake_phase)


@pytest.mark.asyncio
async def test_apply_sync_skips_runtime_and_stamps_sync(tmp_path, db_session):
    """apply_sync must overwrite spec_root with the tar's spec data, but skip
    ``.runtime/`` members entirely (ql-20260813-007: daemon runtime artifacts like
    sillyspec.db are not spec docs and can carry NUL bytes that crash asyncpg).
    Still stamps ``last_synced_at`` + ``sync_status='clean'`` (FR-07)."""
    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)

    # Pre-existing backend .runtime is left untouched (daemon no longer sends .runtime;
    # the per-file merge skips .runtime members instead of overwriting them).
    (spec_root / ".runtime").mkdir(parents=True, exist_ok=True)
    (spec_root / ".runtime" / "stale.txt").write_text("OLD", encoding="utf-8")

    tar_bytes = _make_tar(
        {
            "docs/index.md": "# hello",
            ".runtime/state.json": '{"v":2}',
        }
    )

    svc = SpecWorkspaceService(db_session)
    reparsed = await svc.apply_sync(workspace_id, tar_bytes)

    assert reparsed["reparsed_docs"] == 1
    # Spec tree overwritten.
    assert (spec_root / "docs" / "index.md").read_text(encoding="utf-8") == "# hello"
    # .runtime members from the tar are skipped — never written to spec_root.
    assert not (spec_root / ".runtime" / "state.json").exists()
    # stale.txt (pre-existing in spec_root, not in staging merge path) is untouched.
    assert (spec_root / ".runtime" / "stale.txt").read_text(encoding="utf-8") == "OLD"

    spec_ws = await svc.get(workspace_id)
    assert spec_ws.sync_status == "clean"
    assert spec_ws.last_synced_at is not None


@pytest.mark.asyncio
async def test_apply_sync_double_sync_idempotent(tmp_path, db_session):
    """Double-sync (scan 终态 + session-end, NFR-02) must be idempotent:
    same tree applied twice leaves spec_root equal and last_synced_at
    advancing (not None)."""
    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)
    tar_bytes = _make_tar(
        {
            "docs/a.md": "A",
            "docs/b.md": "B",
        }
    )

    svc = SpecWorkspaceService(db_session)
    await svc.apply_sync(workspace_id, tar_bytes)
    first_ts = (await svc.get(workspace_id)).last_synced_at
    assert first_ts is not None

    await svc.apply_sync(workspace_id, tar_bytes)
    second_ts = (await svc.get(workspace_id)).last_synced_at
    assert second_ts is not None

    assert (spec_root / "docs" / "a.md").read_text(encoding="utf-8") == "A"
    assert (spec_root / "docs" / "b.md").read_text(encoding="utf-8") == "B"
    assert (await svc.get(workspace_id)).sync_status == "clean"


@pytest.mark.asyncio
async def test_apply_sync_tar_slip_rejected(tmp_path, db_session):
    """Tar Slip (member escaping spec_root) is rejected with 422 before any
    disk write."""
    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)

    # A member whose normalised path resolves outside spec_root.
    tar_bytes = _make_tar({"../escape.txt": "evil"})

    from app.core.errors import AppError

    svc = SpecWorkspaceService(db_session)
    with pytest.raises(AppError) as exc_info:
        await svc.apply_sync(workspace_id, tar_bytes)

    assert exc_info.value.http_status == 422
    # spec_root untouched (no stray writes).
    assert not any(spec_root.iterdir())


@pytest.mark.asyncio
async def test_apply_sync_absolute_path_rejected(tmp_path, db_session):
    """Absolute paths / drive letters are rejected before disk write."""
    workspace_id, _ = await _make_spec_ws(tmp_path, db_session)

    tar_bytes = _make_tar({"/etc/passwd": "evil"})

    from app.core.errors import AppError

    svc = SpecWorkspaceService(db_session)
    with pytest.raises(AppError) as exc_info:
        await svc.apply_sync(workspace_id, tar_bytes)

    assert exc_info.value.http_status == 422


@pytest.mark.asyncio
async def test_build_bundle_excludes_runtime(tmp_path, db_session):
    """build_bundle (pull) must exclude ``.runtime/`` — the non-asymmetric
    counterpart of apply_sync (D-003@v1)."""
    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)

    (spec_root / "docs").mkdir(parents=True, exist_ok=True)
    (spec_root / "docs" / "index.md").write_text("# hi", encoding="utf-8")
    (spec_root / ".runtime").mkdir(parents=True, exist_ok=True)
    (spec_root / ".runtime" / "secret.json").write_text("{}", encoding="utf-8")
    (spec_root / "nested" / ".runtime").mkdir(parents=True, exist_ok=True)
    (spec_root / "nested" / ".runtime" / "deep.json").write_text("{}", encoding="utf-8")

    svc = SpecWorkspaceService(db_session)
    _, stream = await svc.build_bundle(workspace_id)
    tar_bytes = b"".join(stream)
    buf = io.BytesIO(tar_bytes)
    members: list[str] = []
    with tarfile.open(fileobj=buf, mode="r:*") as tar:
        members = [m.name for m in tar.getmembers()]

    # Spec data present, .runtime (top-level + nested) excluded.
    assert any(m == "docs/index.md" for m in members)
    assert not any(".runtime" in m for m in members)


@pytest.mark.asyncio
async def test_apply_sync_long_name_via_gnu_longlink(tmp_path, db_session):
    """A member whose name > 100 bytes (packed via GNU LongLink, same format daemon
    ``buildLongLinkHeader`` emits) unpacks correctly instead of raising 500
    (ql-20260813-004 B)."""
    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)
    long_name = "changes/" + "a" * 90 + "/task.md"  # > 100 bytes total
    tar_bytes = _make_long_name_tar({long_name: "# long"})

    svc = SpecWorkspaceService(db_session)
    reparsed = await svc.apply_sync(workspace_id, tar_bytes)

    assert reparsed["reparsed_docs"] == 1
    assert (spec_root / long_name).read_text(encoding="utf-8") == "# long"


@pytest.mark.asyncio
async def test_apply_sync_skips_member_missing_in_staging(tmp_path, db_session, monkeypatch):
    """A tar member whose staging file is unreadable (old packer truncated name / race)
    is skipped with a warning instead of raising 500 (ql-20260813-004 C defense-in-depth)."""
    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)
    tar_bytes = _make_tar(
        {
            "docs/keep.md": "keep",
            "docs/ghost.md": "ghost",  # simulate this member missing from staging
        }
    )

    orig_read_bytes = Path.read_bytes

    def fake_read_bytes(self):
        if self.name == "ghost.md":
            raise FileNotFoundError(2, "no such file", str(self))
        return orig_read_bytes(self)

    monkeypatch.setattr(Path, "read_bytes", fake_read_bytes)

    svc = SpecWorkspaceService(db_session)
    reparsed = await svc.apply_sync(workspace_id, tar_bytes)

    # No 500; sync completes.
    assert reparsed["reparsed_docs"] == 1
    # keep.md landed; ghost.md skipped.
    assert (spec_root / "docs" / "keep.md").read_text(encoding="utf-8") == "keep"
    assert not (spec_root / "docs" / "ghost.md").exists()


@pytest.mark.asyncio
async def test_apply_sync_skips_runtime_db_with_nul_bytes(tmp_path, db_session):
    """A ``.runtime/sillyspec.db`` member carrying NUL bytes (SQLite binary) must
    be skipped, not written into ``scan_documents.content`` (PG text column rejects
    0x00 → asyncpg CharacterNotInRepertoireError → whole-batch rollback → HTTP 500).
    Regression for ql-20260813-007: the original 「同步到服务器」恒失败 bug."""
    from sqlalchemy import select

    from app.modules.scan_docs.model import ScanDocument

    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)

    # SQLite binaries are full of NUL bytes; a spec doc mixed in must still land.
    nul_blob = b"SQLite format 3\x00\x00\x00rest-of-db\x00"
    tar_bytes = _make_tar(
        {
            "docs/index.md": "# hello",
            ".runtime/sillyspec.db": nul_blob,
        }
    )

    svc = SpecWorkspaceService(db_session)
    # Must not raise (no 500 from asyncpg 0x00).
    reparsed = await svc.apply_sync(workspace_id, tar_bytes)

    assert reparsed["reparsed_docs"] == 1
    # Spec doc landed on disk; .runtime db skipped entirely.
    assert (spec_root / "docs" / "index.md").read_text(encoding="utf-8") == "# hello"
    assert not (spec_root / ".runtime" / "sillyspec.db").exists()
    # No .runtime member written into scan_documents.
    rows = (
        (
            await db_session.execute(
                select(ScanDocument.path).where(
                    ScanDocument.workspace_id == workspace_id,
                    ScanDocument.path.like(".runtime/%"),
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows == []
