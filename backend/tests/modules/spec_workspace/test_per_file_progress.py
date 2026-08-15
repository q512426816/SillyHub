"""Tests for progress writeback (change 2026-08-14-spec-sync-per-file-progress,
批量化重构 perf-remediation task-03).

Verifies:
- apply_sync with change_write_id → files_processed 终态准确（批量回写：50 文件/
  500ms 粒度中途回写 + finally 终态回写保证数值最终准确，design 兼容策略）
- apply_ops with change_write_id → files_processed 终态准确（同上批量语义）
- 批量化确实生效：写库次数远小于文件数（3 文件 1 次；60 文件 = 50 阈值 1 次
  中途 + finally 终态 1 次），不再每文件一次 UPDATE
- change_write_id=None → no progress writeback (backward compat)
- status != 'claimed' → _bump is no-op (guard)

author: qinyi
created_at: 2026-08-14T03:20:00
batch rewrite (task-03): 2026-08-15
"""

from __future__ import annotations

import base64
import io
import tarfile
import uuid
from pathlib import Path

import pytest

from app.modules.daemon.model import DaemonChangeWrite
from app.modules.spec_workspace import service as spec_ws_service
from app.modules.spec_workspace.schema import FileOp, SpecWorkspaceCreate
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


def _count_flushes(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Patch ``_BatchProgressWriter.flush`` with a counting wrapper.

    返回单元素 list（引用语义计数器）。同时把 500ms 时间窗拉长到 1h，
    让 flush 次数只由 50 文件批量阈值决定（确定性，不受测试机慢/快影响）。
    """
    monkeypatch.setattr(spec_ws_service._BatchProgressWriter, "_FLUSH_INTERVAL_S", 3600.0)
    orig_flush = spec_ws_service._BatchProgressWriter.flush
    counter = [0]

    async def _counting_flush(self: spec_ws_service._BatchProgressWriter) -> None:
        counter[0] += 1
        await orig_flush(self)

    monkeypatch.setattr(spec_ws_service._BatchProgressWriter, "flush", _counting_flush)
    return counter


async def _refresh_cw(db_session, cw_id: uuid.UUID) -> DaemonChangeWrite:
    """读取 change_write 最新落库态（绕开 db_session identity map 的过期缓存）。"""
    cw = await db_session.get(DaemonChangeWrite, cw_id)
    assert cw is not None
    await db_session.refresh(cw)
    return cw


@pytest.mark.asyncio
async def test_apply_sync_files_processed_terminal_accurate(tmp_path, db_session, monkeypatch):
    """apply_sync 3 文件 → 终态 files_processed == 3。

    批量语义（task-03，design 目标 5 授权调整原 call_count==3 断言）：3 文件
    （< 50 阈值、时间窗禁用）→ 仅 finally 终态 1 次回写，不再每文件一次 UPDATE。
    """
    workspace_id, _spec_root = await _make_spec_ws(db_session, tmp_path)
    cw_id = await _make_claimed_change_write(db_session, workspace_id)

    tar_bytes = _make_tar({f"docs/f{i}.md": f"# f{i}" for i in range(3)})

    flush_counter = _count_flushes(monkeypatch)
    svc = SpecWorkspaceService(db_session)
    await svc.apply_sync(workspace_id, tar_bytes, change_write_id=str(cw_id))

    cw = await _refresh_cw(db_session, cw_id)
    # 终态准确（design 兼容策略：数值最终准确）
    assert cw.files_processed == 3
    # 批量回写：3 文件只 1 次（finally 终态）UPDATE，上限 = 文件数
    assert 1 <= flush_counter[0] <= 3


@pytest.mark.asyncio
async def test_apply_sync_batch_threshold_flushes_at_50(tmp_path, db_session, monkeypatch):
    """60 文件 → 50 文件阈值触发 1 次中途回写 + finally 终态回写剩余 10。

    共 2 次 UPDATE（写库次数 ≈ 文件数/50，task-03 批量化目标），终态 == 60。
    """
    workspace_id, _spec_root = await _make_spec_ws(db_session, tmp_path)
    cw_id = await _make_claimed_change_write(db_session, workspace_id)

    tar_bytes = _make_tar({f"docs/f{i}.md": f"# f{i}" for i in range(60)})

    flush_counter = _count_flushes(monkeypatch)
    svc = SpecWorkspaceService(db_session)
    await svc.apply_sync(workspace_id, tar_bytes, change_write_id=str(cw_id))

    cw = await _refresh_cw(db_session, cw_id)
    assert cw.files_processed == 60
    assert flush_counter[0] == 2


@pytest.mark.asyncio
async def test_apply_ops_files_processed_terminal_accurate(tmp_path, db_session):
    """apply_ops 3 个成功 op → 终态 files_processed == 3（conflict op 不计）。"""
    workspace_id, _spec_root = await _make_spec_ws(db_session, tmp_path)
    cw_id = await _make_claimed_change_write(db_session, workspace_id)

    ops = [
        FileOp(
            op="add",
            path=f"docs/a{i}.md",
            base_version=0,
            content=base64.b64encode(f"# a{i}".encode()).decode("ascii"),
        )
        for i in range(3)
    ]
    svc = SpecWorkspaceService(db_session)
    result = await svc.apply_ops(workspace_id, ops, change_write_id=str(cw_id))
    assert result["conflict"] is False

    cw = await _refresh_cw(db_session, cw_id)
    assert cw.files_processed == 3


@pytest.mark.asyncio
async def test_apply_sync_no_change_write_id_no_bump(tmp_path, db_session):
    """change_write_id=None → files_processed stays None (backward compat)."""
    workspace_id, _spec_root = await _make_spec_ws(db_session, tmp_path)
    cw_id = await _make_claimed_change_write(db_session, workspace_id)

    tar_bytes = _make_tar({"docs/a.md": "# a"})

    svc = SpecWorkspaceService(db_session)
    await svc.apply_sync(workspace_id, tar_bytes, change_write_id=None)

    cw = await _refresh_cw(db_session, cw_id)
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
    cw = await _refresh_cw(db_session, cw_id)
    assert cw.files_processed is None
