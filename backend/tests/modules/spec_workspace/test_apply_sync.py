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
    # d3f094da 起 build_bundle 返回 (spec_root, spec_version, tar_stream) 三元组。
    _, _, stream = await svc.build_bundle(workspace_id)
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


@pytest.mark.asyncio
async def test_apply_sync_overwrite_newer_mtime_archives_old_and_updates_row(tmp_path, db_session):
    """task-02 行为锚点（perf-remediation）：per-file FS 段入线程后，冲突覆盖语义
    零变更——已有行 + 新 tar 内容 hash 不同 + tar mtime 更新 → 归档旧内容到
    scan_doc_conflict_history、原地改写行（content/hash/mtime）、文件落盘。
    反向（tar mtime 更旧）不覆盖、不归档。"""
    import hashlib
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from app.modules.scan_docs.conflict_model import ScanDocConflictHistory
    from app.modules.scan_docs.model import ScanDocument

    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)

    # 预置既有行：旧内容 + 一天前的 source_mtime。
    old_ts = datetime.now(UTC) - timedelta(days=1)
    old_content = "# old world"
    old_row = ScanDocument(
        workspace_id=workspace_id,
        path="docs/index.md",
        doc_type="md",
        title="index.md",
        content=old_content,
        content_hash=hashlib.sha256(old_content.encode("utf-8")).hexdigest(),
        source_mtime=old_ts,
        exists=True,
    )
    db_session.add(old_row)
    await db_session.commit()

    # 新 tar：内容不同 + mtime 更新（现在）。
    buf = io.BytesIO()
    new_content = "# new world"
    data = new_content.encode("utf-8")
    with tarfile.open(fileobj=buf, mode="w") as tar:
        info = tarfile.TarInfo(name="docs/index.md")
        info.size = len(data)
        info.mtime = int(datetime.now(UTC).timestamp())
        tar.addfile(info, io.BytesIO(data))
    tar_bytes = buf.getvalue()

    svc = SpecWorkspaceService(db_session)
    await svc.apply_sync(workspace_id, tar_bytes)

    # 文件被新内容覆盖落盘。
    assert (spec_root / "docs" / "index.md").read_text(encoding="utf-8") == new_content

    # 行被原地改写（同 workspace+path 仍只有一行），hash/mtime 更新。
    rows = (
        (
            await db_session.execute(
                select(ScanDocument).where(
                    ScanDocument.workspace_id == workspace_id,
                    ScanDocument.path == "docs/index.md",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    updated = rows[0]
    assert updated.content == new_content
    assert updated.content_hash == hashlib.sha256(data).hexdigest()
    assert updated.source_mtime is not None and updated.source_mtime > old_ts

    # 旧内容归档到冲突历史（先归档后落盘的顺序语义由行改写 + 落盘共同体现）。
    history = (
        (
            await db_session.execute(
                select(ScanDocConflictHistory).where(
                    ScanDocConflictHistory.workspace_id == workspace_id,
                    ScanDocConflictHistory.path == "docs/index.md",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(history) == 1
    assert history[0].old_content == old_content


@pytest.mark.asyncio
async def test_apply_sync_fs_sections_run_outside_transaction(tmp_path, db_session, monkeypatch):
    """ql-20260817-005：_write_spec_root 的长 FS 段（tar 解包 staging / 逐文件
    read+sha256+move 循环）不得在打开的 DB 事务内执行。

    生产实例（2026-08-17，request_id a302bc5e）：spec_root 是 Windows bind mount，
    3560 文件全量同步的 FS 段跑 2.5min+，期间主连接零 SQL（冲突归档只
    session.add、进度回写走独立 session），PG idle_in_transaction_session_timeout
    （db.py 后端自设 120s）杀空闲事务连接，最终 commit 撞死连接 → sync 恒 500。
    锚定结构属性：FS 段采样点 ``in_transaction()`` 必须全 False；DB 写仍集中在
    最终 commit（原子性不变），同步语义（落盘 + clean）不受影响。"""
    import shutil as shutil_module

    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)

    txn_states: list[tuple[str, bool]] = []

    # 采样点①：tar 解包（to_thread 里的纯 FS 长段，get() 之后、prefetch SELECT 之前）。
    orig_extract = SpecWorkspaceService._extract_spec_tar_to_staging

    def probe_extract(tar_bytes, spec_root_arg, spec_root_resolved_arg):
        txn_states.append(("extract", db_session.in_transaction()))
        return orig_extract(tar_bytes, spec_root_arg, spec_root_resolved_arg)

    monkeypatch.setattr(
        SpecWorkspaceService, "_extract_spec_tar_to_staging", staticmethod(probe_extract)
    )

    # 采样点②：逐文件循环里的 shutil.move（每变更文件一次；to_thread 线程内调用）。
    orig_move = shutil_module.move

    def probe_move(src, dst):
        txn_states.append(("move", db_session.in_transaction()))
        return orig_move(src, dst)

    monkeypatch.setattr(shutil_module, "move", probe_move)

    tar_bytes = _make_tar({"docs/index.md": "# hello"})
    svc = SpecWorkspaceService(db_session)
    reparsed = await svc.apply_sync(workspace_id, tar_bytes)

    # 语义不变：同步照常完成（落盘 + clean + reparse 计数）。
    assert reparsed["reparsed_docs"] == 1
    assert (spec_root / "docs" / "index.md").read_text(encoding="utf-8") == "# hello"
    assert (await svc.get(workspace_id)).sync_status == "clean"

    # 结构属性：两个采样点都触发过，且全部在事务外。
    fired = {name for name, _ in txn_states}
    assert fired == {"extract", "move"}
    busy = [name for name, in_txn in txn_states if in_txn]
    assert not busy, f"FS 段仍在事务内（会被 idle-in-transaction 超时杀连接）: {busy}"


@pytest.mark.asyncio
async def test_apply_ops_fs_loop_runs_outside_transaction(tmp_path, db_session, monkeypatch):
    """ql-20260817-005（续）：apply_ops（增量 ops）同模式——预取 SELECT 后循环内
    纯 FS 写入 + session.add/delete（commit 前不发 SQL）直到最终 commit，init 大批量
    ops（首成员推全套骨架文件）同样会撞 idle-in-transaction 超时。锚定
    ``_apply_file_mtime``（每 add/update 必经）采样事务态必须 False，落盘语义不变。"""
    import base64

    from app.modules.spec_workspace.schema import FileOp

    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)

    txn_states: list[bool] = []
    orig_apply_mtime = SpecWorkspaceService._apply_file_mtime

    def probe_mtime(path, mtime):
        txn_states.append(db_session.in_transaction())
        return orig_apply_mtime(path, mtime)

    monkeypatch.setattr(SpecWorkspaceService, "_apply_file_mtime", staticmethod(probe_mtime))

    ops = [
        FileOp(
            op="add",
            path=f"docs/f{i}.md",
            base_version=0,
            content=base64.b64encode(f"# f{i}".encode()).decode("ascii"),
        )
        for i in range(3)
    ]
    svc = SpecWorkspaceService(db_session)
    result = await svc.apply_ops(workspace_id, ops)

    # 语义不变：全部落盘 + 版本从 1 起。
    assert result["conflict"] is False
    assert result["new_versions"] == {f"docs/f{i}.md": 1 for i in range(3)}
    for i in range(3):
        assert (spec_root / "docs" / f"f{i}.md").read_text(encoding="utf-8") == f"# f{i}"

    # 结构属性：循环内采样点全部在事务外。
    assert txn_states, "probe must have fired"
    assert not any(txn_states), "ops 循环仍在事务内（同 _write_spec_root 的 120s 暴露）"


@pytest.mark.asyncio
async def test_apply_sync_overwrite_older_mtime_keeps_existing(tmp_path, db_session):
    """task-02 行为锚点（续）：tar mtime 更旧 → 不覆盖（行内容/文件都不变）、
    不归档。防止线程化改造中 mtime 比较方向漂移。"""
    import hashlib
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from app.modules.scan_docs.conflict_model import ScanDocConflictHistory
    from app.modules.scan_docs.model import ScanDocument

    workspace_id, spec_root = await _make_spec_ws(tmp_path, db_session)

    # 预置既有行：mtime = 现在（更新）。
    new_ts = datetime.now(UTC)
    cur_content = "# current"
    db_session.add(
        ScanDocument(
            workspace_id=workspace_id,
            path="docs/index.md",
            doc_type="md",
            title="index.md",
            content=cur_content,
            content_hash=hashlib.sha256(cur_content.encode("utf-8")).hexdigest(),
            source_mtime=new_ts,
            exists=True,
        )
    )
    await db_session.commit()

    # tar：内容不同但 mtime = 2 天前（更旧）。
    buf = io.BytesIO()
    stale_content = "# stale incoming"
    data = stale_content.encode("utf-8")
    with tarfile.open(fileobj=buf, mode="w") as tar:
        info = tarfile.TarInfo(name="docs/index.md")
        info.size = len(data)
        info.mtime = int((datetime.now(UTC) - timedelta(days=2)).timestamp())
        tar.addfile(info, io.BytesIO(data))
    tar_bytes = buf.getvalue()

    # 预放当前文件（既有行对应内容）。
    (spec_root / "docs").mkdir(parents=True, exist_ok=True)
    (spec_root / "docs" / "index.md").write_text(cur_content, encoding="utf-8")

    svc = SpecWorkspaceService(db_session)
    await svc.apply_sync(workspace_id, tar_bytes)

    # 行与文件都保持既有内容。
    row = (
        (
            await db_session.execute(
                select(ScanDocument).where(
                    ScanDocument.workspace_id == workspace_id,
                    ScanDocument.path == "docs/index.md",
                )
            )
        )
        .scalars()
        .one()
    )
    assert row.content == cur_content
    assert (spec_root / "docs" / "index.md").read_text(encoding="utf-8") == cur_content

    history = (
        (
            await db_session.execute(
                select(ScanDocConflictHistory).where(
                    ScanDocConflictHistory.workspace_id == workspace_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert history == []
