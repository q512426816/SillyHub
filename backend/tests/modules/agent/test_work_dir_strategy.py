"""Tests for task-12: resolve_work_dir + _ensure_change_dir_in_worktree."""

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.service import AgentRunError, AgentService, resolve_work_dir
from app.modules.change.model import Change

# ---------------------------------------------------------------------------
# resolve_work_dir tests
# ---------------------------------------------------------------------------


def test_resolve_work_dir_write_stage_with_lease(tmp_path):
    """有 lease + 写阶段 → 返回 lease.path / 'repo'。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    mock_lease = MagicMock()
    mock_lease.path = str(tmp_path / "worktree-1")

    result = resolve_work_dir(
        workspace_root=str(ws_root),
        change_path=None,
        change_key=None,
        lease=mock_lease,
        requires_worktree=True,
        read_only=False,
    )

    assert result == Path(str(tmp_path / "worktree-1")) / "repo"


def test_resolve_work_dir_write_stage_no_lease(tmp_path):
    """无 lease + 写阶段 → 返回 workspace root。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    result = resolve_work_dir(
        workspace_root=str(ws_root),
        change_path=None,
        change_key=None,
        lease=None,
        requires_worktree=True,
        read_only=False,
    )

    assert result == ws_root


def test_resolve_work_dir_read_only_ignores_lease(tmp_path):
    """只读阶段 → 忽略 lease，返回 workspace root。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    mock_lease = MagicMock()
    mock_lease.path = str(tmp_path / "worktree-1")

    result = resolve_work_dir(
        workspace_root=str(ws_root),
        change_path=None,
        change_key=None,
        lease=mock_lease,
        requires_worktree=False,
        read_only=True,
    )

    assert result == ws_root


def test_resolve_work_dir_read_only_with_change_path(tmp_path):
    """只读阶段 + change_path 有效目录 → 返回拼接路径。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()
    change_dir = ws_root / ".sillyspec" / "changes" / "my-change"
    change_dir.mkdir(parents=True)

    result = resolve_work_dir(
        workspace_root=str(ws_root),
        change_path=".sillyspec/changes/my-change",
        change_key="my-change",
        lease=None,
        requires_worktree=False,
        read_only=True,
    )

    assert result == change_dir


def test_resolve_work_dir_read_only_change_path_not_exists(tmp_path):
    """只读阶段 + change_path 目录不存在 → fallback 到 workspace root。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    result = resolve_work_dir(
        workspace_root=str(ws_root),
        change_path=".sillyspec/changes/nonexistent",
        change_key="nonexistent",
        lease=None,
        requires_worktree=False,
        read_only=True,
    )

    assert result == ws_root


def test_resolve_work_dir_workspace_root_not_exists():
    """workspace root 不存在 → 抛出 AgentRunError。"""
    with pytest.raises(AgentRunError) as exc_info:
        resolve_work_dir(
            workspace_root="/nonexistent/path/xyz",
            change_path=None,
            change_key=None,
            lease=None,
            requires_worktree=False,
            read_only=True,
        )

    assert "Workspace root does not exist" in str(exc_info.value)


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


@pytest.mark.asyncio
async def test_start_stage_dispatch_write_no_worktree_logs_warning(tmp_path):
    """写阶段 + 无 lease → work_dir fallback 到 workspace root。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    mock_session = AsyncMock(spec=AsyncSession)
    mock_change = MagicMock(spec=Change)
    mock_change.path = ".sillyspec/changes/test"
    mock_change.change_key = "test"
    mock_change.title = "Test"
    mock_change.current_stage = "plan"
    mock_change.change_type = ""
    mock_change.affected_components = []

    async def _get(model, pk):
        return mock_change

    mock_session.get = AsyncMock(side_effect=_get)

    svc = AgentService(mock_session)
    with patch.object(
        svc, "_get_workspace_root", new_callable=AsyncMock, return_value=str(ws_root)
    ):
        with patch.object(svc, "_try_acquire_lease", new_callable=AsyncMock, return_value=None):
            with patch.object(svc, "_execute_stage_run", new_callable=AsyncMock) as mock_exec:
                with patch(
                    "app.modules.change.dispatch.load_prompt_template", return_value="test prompt"
                ):
                    await svc.start_stage_dispatch(
                        workspace_id=uuid.uuid4(),
                        change_id=uuid.uuid4(),
                        user_id=uuid.uuid4(),
                        stage="plan",
                        prompt_template="plan.md",
                        requires_worktree=True,
                        read_only=False,
                    )

    # Verify work_dir is workspace root (fallback)
    call_kwargs = mock_exec.call_args[1]
    assert call_kwargs["work_dir"] == ws_root


@pytest.mark.asyncio
async def test_start_stage_dispatch_read_only_skips_ensure_dir(tmp_path):
    """只读阶段 → _ensure_change_dir_in_worktree 不被调用。"""
    ws_root = tmp_path / "workspace"
    ws_root.mkdir()

    mock_session = AsyncMock(spec=AsyncSession)
    mock_change = MagicMock(spec=Change)
    mock_change.path = ".sillyspec/changes/test"
    mock_change.change_key = "test"
    mock_change.title = "Test"
    mock_change.current_stage = "scan"
    mock_change.change_type = ""
    mock_change.affected_components = []

    async def _get(model, pk):
        return mock_change

    mock_session.get = AsyncMock(side_effect=_get)

    svc = AgentService(mock_session)
    with patch.object(
        svc, "_get_workspace_root", new_callable=AsyncMock, return_value=str(ws_root)
    ):
        with patch.object(svc, "_try_acquire_lease", new_callable=AsyncMock, return_value=None):
            with patch.object(
                svc, "_ensure_change_dir_in_worktree", new_callable=AsyncMock
            ) as mock_ensure:
                with patch.object(svc, "_execute_stage_run", new_callable=AsyncMock) as _mock_exec:
                    with patch(
                        "app.modules.change.dispatch.load_prompt_template",
                        return_value="test prompt",
                    ):
                        await svc.start_stage_dispatch(
                            workspace_id=uuid.uuid4(),
                            change_id=uuid.uuid4(),
                            user_id=uuid.uuid4(),
                            stage="scan",
                            prompt_template="scan.md",
                            requires_worktree=False,
                            read_only=True,
                        )

    mock_ensure.assert_not_called()
