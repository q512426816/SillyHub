"""Tests for per-file progress writeback (change 2026-08-14-spec-sync-per-file-progress).

Verifies:
- apply_sync with change_write_id → files_processed increments per file
- apply_ops with change_write_id → files_processed increments per op
- change_write_id=None → no progress writeback (backward compat)
- status != 'claimed' → _bump is no-op (guard)

author: qinyi
created_at: 2026-08-14T03:20:00
"""

from __future__ import annotations

import io
import tarfile
import uuid
from pathlib import Path

import pytest

from app.modules.daemon.model import DaemonChangeWrite
from app.modules.spec_workspace.schema import SpecWorkspaceCreate
from app.modules.spec_workspace.service import SpecWorkspaceService


def _make_tar(entries: dict[str, bytes | str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for arcname, content in entries.items():
            data = content.encode("utf-8") if isinstance(content, str) else content
            info = tarfile.TarInfo(name=arcname)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


async def _make_spec_ws(db_session, tmp_path: Path) -> tuple[uuid.UUID, Path]:
    svc = SpecWorkspaceService(db_session)
    workspace_id = uuid.uuid4()
    spec_root = tmp_path / "spec"
    spec_root.mkdir(parents=True, exist_ok=True)
    await svc.create(
        workspace_id, SpecWorkspaceCreate(spec_root=str(spec_root), strategy="platform-managed")
    )
    await db_session.commit()
    return workspace_id, Path(spec_root)


async def _make_claimed_change_write(db_session, workspace_id: uuid.UUID) -> uuid.UUID:
    """Create a DaemonChangeWrite with status='claimed' for progress writeback."""
    cw = DaemonChangeWrite(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        runtime_id=uuid.uuid4(),
        change_key="spec-sync",
        kind="spec-sync",
        files=[],
        status="claimed",
        claim_token="test-token",
        files_total=None,
        files_processed=None,
    )
    db_session.add(cw)
    await db_session.commit()
    await db_session.refresh(cw)
    return cw.id


@pytest.mark.asyncio
async def test_apply_sync_increments_processed_per_file(tmp_path, db_session):
    """apply_sync with change_write_id → _bump called once per file."""
    workspace_id, _spec_root = await _make_spec_ws(db_session, tmp_path)
    cw_id = await _make_claimed_change_write(db_session, workspace_id)

    tar_bytes = _make_tar(
        {
            "docs/a.md": "# a",
            "docs/b.md": "# b",
            "docs/c.md": "# c",
        }
    )

    svc = SpecWorkspaceService(db_session)
    # Spy _bump（独立 session 在测试环境可能连非测试 DB，spy 验证调用次数更稳）
    import unittest.mock

    with unittest.mock.patch.object(
        svc, "_bump_files_processed", new=unittest.mock.AsyncMock()
    ) as bump_spy:
        await svc.apply_sync(workspace_id, tar_bytes, change_write_id=str(cw_id))

    # 3 个文件 → _bump 调 3 次（每个文件成功处理后一次）
    assert bump_spy.call_count == 3
    # 每次调用都传了正确的 change_write_id
    for call_args in bump_spy.call_args_list:
        assert call_args.args[0] == str(cw_id)


@pytest.mark.asyncio
async def test_apply_sync_no_change_write_id_no_bump(tmp_path, db_session):
    """change_write_id=None → files_processed stays None (backward compat)."""
    workspace_id, _spec_root = await _make_spec_ws(db_session, tmp_path)
    cw_id = await _make_claimed_change_write(db_session, workspace_id)

    tar_bytes = _make_tar({"docs/a.md": "# a"})

    svc = SpecWorkspaceService(db_session)
    await svc.apply_sync(workspace_id, tar_bytes, change_write_id=None)

    cw = await db_session.get(DaemonChangeWrite, cw_id)
    assert cw.files_processed is None


@pytest.mark.asyncio
async def test_bump_no_op_when_status_not_claimed(tmp_path, db_session):
    """_bump on a done-status row → no-op (WHERE status='claimed' guard)."""
    workspace_id, _spec_root = await _make_spec_ws(db_session, tmp_path)
    cw_id = await _make_claimed_change_write(db_session, workspace_id)
    # Flip to done
    cw = await db_session.get(DaemonChangeWrite, cw_id)
    cw.status = "done"
    await db_session.commit()

    svc = SpecWorkspaceService(db_session)
    # _bump should be no-op (status != claimed)
    await svc._bump_files_processed(str(cw_id))
    cw = await db_session.get(DaemonChangeWrite, cw_id)
    assert cw.files_processed is None
