"""Tests for task-12: resolve_work_dir + _ensure_change_dir_in_worktree.

task-09（2026-07-06-daemon-host-fs-delegate）：resolve_work_dir 改 async + 注入
HostFsDelegate。workspace_root 存在性校验从 ql-006 的散落 ``if path_source !=
"daemon-client"`` point-fix 内聚到 delegate.stat（server-local 本地容器 stat /
daemon-client WS RPC 委托 daemon 宿主 stat）。下列测试覆盖：
  - 无 delegate 注入的向后兼容路径（保持 ql-006 行为：server-local 本地校验、
    daemon-client 跳过本地 stat）—— resolve_work_dir 调用方未传 delegate 时走此分支。
  - delegate 注入的两条路径：stat.exists=True 放行 / stat.exists=False raise
    AgentRunError（含 RPC 失败降级 {exists:False} 的等价模拟）。
"""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.service import AgentRunError, AgentService, resolve_work_dir

# ---------------------------------------------------------------------------
# resolve_work_dir tests (no delegate — backwards-compatible ql-006 path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_work_dir_write_stage_with_lease(tmp_path):
    """有 lease + 写阶段 → 返回 lease.path / 'repo'。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    mock_lease = MagicMock()
    mock_lease.path = str(tmp_path / "worktree-1")

    result = await resolve_work_dir(
        workspace_root=str(ws_root),
        change_path=None,
        change_key=None,
        lease=mock_lease,
        requires_worktree=True,
        read_only=False,
    )

    assert result == Path(str(tmp_path / "worktree-1")) / "repo"


@pytest.mark.asyncio
async def test_resolve_work_dir_write_stage_no_lease(tmp_path):
    """无 lease + 写阶段 → 返回 workspace root。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    result = await resolve_work_dir(
        workspace_root=str(ws_root),
        change_path=None,
        change_key=None,
        lease=None,
        requires_worktree=True,
        read_only=False,
    )

    assert result == ws_root


@pytest.mark.asyncio
async def test_resolve_work_dir_read_only_ignores_lease(tmp_path):
    """只读阶段 → 忽略 lease，返回 workspace root。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    mock_lease = MagicMock()
    mock_lease.path = str(tmp_path / "worktree-1")

    result = await resolve_work_dir(
        workspace_root=str(ws_root),
        change_path=None,
        change_key=None,
        lease=mock_lease,
        requires_worktree=False,
        read_only=True,
    )

    assert result == ws_root


@pytest.mark.asyncio
async def test_resolve_work_dir_read_only_with_change_path(tmp_path):
    """只读阶段 + change_path 有效目录 → 返回拼接路径。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()
    change_dir = ws_root / ".sillyspec" / "changes" / "my-change"
    change_dir.mkdir(parents=True)

    result = await resolve_work_dir(
        workspace_root=str(ws_root),
        change_path=".sillyspec/changes/my-change",
        change_key="my-change",
        lease=None,
        requires_worktree=False,
        read_only=True,
    )

    assert result == change_dir


@pytest.mark.asyncio
async def test_resolve_work_dir_read_only_change_path_not_exists(tmp_path):
    """只读阶段 + change_path 目录不存在 → fallback 到 workspace root。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    result = await resolve_work_dir(
        workspace_root=str(ws_root),
        change_path=".sillyspec/changes/nonexistent",
        change_key="nonexistent",
        lease=None,
        requires_worktree=False,
        read_only=True,
    )

    assert result == ws_root


@pytest.mark.asyncio
async def test_resolve_work_dir_workspace_root_not_exists():
    """delegate=None + workspace=None → 跳过存在性校验（D-007 单一 daemon-client 后
    resolve_work_dir 不再裸 Path.exists() 宿主路径），路径透传不抛错。

    production caller 一律注入 delegate；delegate=None 仅单测兜底。
    """
    result = await resolve_work_dir(
        workspace_root="/nonexistent/path/xyz",
        change_path=None,
        change_key=None,
        lease=None,
        requires_worktree=False,
        read_only=True,
    )
    assert result == Path("/nonexistent/path/xyz")


@pytest.mark.asyncio
async def test_resolve_work_dir_no_delegate_skips_stat():
    """无 delegate 注入 → 跳过本地 stat 校验，路径透传给 daemon（D-007 单一 daemon-client 后
    不再有 server-local / daemon-client 分流，缺 delegate 即缺校验）。"""
    host_path = "/nonexistent/host/path/C:/Users/x/proj"
    result = await resolve_work_dir(
        workspace_root=host_path,
        change_path=None,
        change_key=None,
        lease=None,
        requires_worktree=False,
        read_only=True,
    )
    assert result == Path(host_path)


@pytest.mark.asyncio
async def test_resolve_work_dir_no_delegate_change_path_fallback():
    """无 delegate + 只读 + change_path（容器内不存在）→ fallback ws_root 宿主路径。"""
    host_path = "C:\\Users\\x\\proj"
    result = await resolve_work_dir(
        workspace_root=host_path,
        change_path=".sillyspec/changes/foo",
        change_key="foo",
        lease=None,
        requires_worktree=False,
        read_only=True,
    )
    assert result == Path(host_path)


# ---------------------------------------------------------------------------
# resolve_work_dir tests (task-09 — HostFsDelegate injected)
# ---------------------------------------------------------------------------


def _make_delegate(stat_result: dict) -> MagicMock:
    """构造一个 mock HostFsDelegate，stat 返回 *stat_result*。"""
    delegate = MagicMock()
    delegate.stat = AsyncMock(return_value=stat_result)
    return delegate


def _make_workspace() -> MagicMock:
    """构造一个最小 mock Workspace（delegate.stat 的 RPC 分支需 workspace 对象）。

    D-007@2026-07-10：path_source / daemon_runtime_id 字段已从 Workspace 删除。
    """
    ws = MagicMock()
    return ws


@pytest.mark.asyncio
async def test_resolve_work_dir_delegate_stat_exists_passes():
    """delegate 注入 + stat.exists=True → 放行，不 raise（daemon-client RPC 命中）。"""
    workspace = _make_workspace()
    delegate = _make_delegate({"exists": True, "is_dir": True, "size": 0})

    result = await resolve_work_dir(
        workspace_root="/host/path/not/in/container",
        change_path=None,
        change_key=None,
        lease=None,
        requires_worktree=False,
        read_only=True,
        delegate=delegate,
        workspace=workspace,
    )

    assert result == Path("/host/path/not/in/container")
    delegate.stat.assert_awaited_once_with(workspace, "/host/path/not/in/container")


@pytest.mark.asyncio
async def test_resolve_work_dir_delegate_stat_not_exists_raises():
    """delegate 注入 + stat.exists=False → raise AgentRunError（RPC 失败降级等价路径）。

    task-04 D-006：daemon-client RPC 失败时 delegate.stat 降级返回
    {exists:False}，resolve_work_dir 据此 raise——与 daemon 断线 dispatch 校验
    缺位的失败语义一致（不再静默放行）。
    """
    workspace = _make_workspace()
    delegate = _make_delegate({"exists": False, "is_dir": False, "size": 0})

    with pytest.raises(AgentRunError) as exc_info:
        await resolve_work_dir(
            workspace_root="/host/path/disconnected",
            change_path=None,
            change_key=None,
            lease=None,
            requires_worktree=False,
            read_only=True,
            delegate=delegate,
            workspace=workspace,
        )

    assert "Workspace root does not exist" in str(exc_info.value)
    assert exc_info.value.details == {"workspace_root": "/host/path/disconnected"}


# ---------------------------------------------------------------------------
# _ensure_change_dir_in_worktree tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ensure_change_dir_copies_from_main_repo(tmp_path):
    """worktree 内不存在 → 从主 repo 复制。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    # 主 repo 中有 .sillyspec/changes/test-change/
    source_dir = ws_root / ".sillyspec" / "changes" / "test-change"
    source_dir.mkdir(parents=True)
    (source_dir / "proposal.md").write_text("# Proposal")

    # work_dir 是 worktree repo（无 .sillyspec/changes/test-change/）
    work_dir = tmp_path / "worktree" / "repo"
    work_dir.mkdir(parents=True)

    mock_session = AsyncMock(spec=AsyncSession)
    svc = AgentService(mock_session)

    await svc._ensure_change_dir_in_worktree(
        work_dir=work_dir,
        change_key="test-change",
        workspace_root=str(ws_root),
    )

    dest_dir = work_dir / ".sillyspec" / "changes" / "test-change"
    assert dest_dir.exists()
    assert (dest_dir / "proposal.md").read_text() == "# Proposal"


@pytest.mark.asyncio
async def test_ensure_change_dir_already_exists(tmp_path):
    """目标目录已存在 → 不执行复制。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    work_dir = tmp_path / "worktree" / "repo"
    work_dir.mkdir(parents=True)
    change_dir = work_dir / ".sillyspec" / "changes" / "test-change"
    change_dir.mkdir(parents=True)
    (change_dir / "existing.md").write_text("existing content")

    mock_session = AsyncMock(spec=AsyncSession)
    svc = AgentService(mock_session)

    # Mock shutil.copytree to ensure it's NOT called
    with patch("shutil.copytree") as mock_copy:
        await svc._ensure_change_dir_in_worktree(
            work_dir=work_dir,
            change_key="test-change",
            workspace_root=str(ws_root),
        )
        mock_copy.assert_not_called()

    # Original content preserved
    assert (change_dir / "existing.md").read_text() == "existing content"


@pytest.mark.asyncio
async def test_ensure_change_dir_main_repo_also_missing(tmp_path):
    """主 repo 也没有该目录 → 不报错，仅记录 warning。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    work_dir = tmp_path / "worktree" / "repo"
    work_dir.mkdir(parents=True)

    mock_session = AsyncMock(spec=AsyncSession)
    svc = AgentService(mock_session)

    # Should not raise
    await svc._ensure_change_dir_in_worktree(
        work_dir=work_dir,
        change_key="nonexistent-change",
        workspace_root=str(ws_root),
    )

    # Directory should NOT be created
    assert not (work_dir / ".sillyspec" / "changes" / "nonexistent-change").exists()


# ---------------------------------------------------------------------------
# Integration: start_stage_dispatch work dir behavior
# ---------------------------------------------------------------------------
