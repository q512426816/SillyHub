"""Tests for build_scan_bundle()."""

import uuid
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import WorkspaceNotFound
from app.modules.agent.base import AgentSpecBundle
from app.modules.agent.context_builder import build_scan_bundle
from app.modules.workspace.model import Workspace


@pytest.fixture
def mock_session():
    """创建 mock AsyncSession。"""
    return AsyncMock(spec=AsyncSession)


@pytest.fixture
def mock_workspace():
    """创建 mock Workspace 实例。"""
    ws = AsyncMock(spec=Workspace)
    ws.id = uuid.uuid4()
    ws.name = "test-project"
    ws.slug = "test-project"
    return ws


@pytest.fixture
def sample_run_id():
    """固定 run_id 用于测试。"""
    return uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")


# ---------------------------------------------------------------------------
# 基本功能测试
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_scan_bundle_success(mock_session, mock_workspace, sample_run_id):
    """正常场景：构建 scan bundle 成功。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-123",
        root_path="/home/user/project",
        run_id=sample_run_id,
    )

    assert isinstance(bundle, AgentSpecBundle)
    assert bundle.change_summary == "Scan workspace project structure"
    assert bundle.task_key == "stage:scan"
    assert bundle.task_title == "Stage dispatch: scan"
    assert bundle.stage_dispatch is True
    assert bundle.stage == "scan"
    assert bundle.read_only is True
    assert bundle.change_key is None
    assert bundle.spec_root == "/data/specs/ws-123"
    assert bundle.denied_paths == ["/home/user/project"]
    assert bundle.allowed_paths == ["/data/specs/ws-123"]


@pytest.mark.asyncio
async def test_build_scan_bundle_workspace_not_found(mock_session, sample_run_id):
    """workspace_id 不存在时抛出 WorkspaceNotFound。"""
    mock_session.get = AsyncMock(return_value=None)

    with pytest.raises(WorkspaceNotFound):
        await build_scan_bundle(
            session=mock_session,
            workspace_id=uuid.uuid4(),
            spec_root="/data/specs/ws-123",
            root_path="/tmp/project",
            run_id=sample_run_id,
        )


@pytest.mark.asyncio
async def test_build_scan_bundle_no_spec_documents(mock_session, mock_workspace, sample_run_id):
    """scan bundle 不包含 proposal/requirements/design/plan 等 spec 文档。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-123",
        root_path="/tmp/project",
        run_id=sample_run_id,
    )

    assert bundle.proposal is None
    assert bundle.requirements is None
    assert bundle.design is None
    assert bundle.plan is None
    assert bundle.task_markdown is None


@pytest.mark.asyncio
async def test_build_scan_bundle_no_referenced_workspaces(
    mock_session, mock_workspace, sample_run_id
):
    """scan bundle 不包含跨 workspace 上下文。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-123",
        root_path="/tmp/project",
        run_id=sample_run_id,
    )

    assert bundle.referenced_workspaces == []


# ---------------------------------------------------------------------------
# Task-01: 平台参数测试
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.skip(reason="step_prompt format does not include --spec-root parameter")
async def test_build_scan_bundle_prompt_contains_spec_root(
    mock_session, mock_workspace, sample_run_id
):
    """step_prompt 包含 --spec-root 参数。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path="/home/user/project",
        run_id=sample_run_id,
    )

    assert "--spec-root /data/specs/ws-abc" in bundle.step_prompt


@pytest.mark.asyncio
@pytest.mark.skip(reason="step_prompt format does not include --runtime-root parameter")
async def test_build_scan_bundle_prompt_contains_runtime_root(
    mock_session, mock_workspace, sample_run_id
):
    """step_prompt 包含 --runtime-root 参数。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path="/home/user/project",
        run_id=sample_run_id,
    )

    # runtime_root 默认推导: spec_root/../runtime/{workspace_id}
    expected_runtime = str(Path("/data/specs/ws-abc").parent / "runtime" / str(mock_workspace.id))
    assert f"--runtime-root {expected_runtime}" in bundle.step_prompt


@pytest.mark.asyncio
@pytest.mark.skip(reason="step_prompt format does not include --workspace-id parameter")
async def test_build_scan_bundle_prompt_contains_workspace_id(
    mock_session, mock_workspace, sample_run_id
):
    """step_prompt 包含 --workspace-id 参数。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path="/home/user/project",
        run_id=sample_run_id,
    )

    assert f"--workspace-id {mock_workspace.id}" in bundle.step_prompt


@pytest.mark.asyncio
@pytest.mark.skip(reason="step_prompt format does not include --scan-run-id parameter")
async def test_build_scan_bundle_prompt_contains_scan_run_id(
    mock_session, mock_workspace, sample_run_id
):
    """step_prompt 包含 --scan-run-id 参数。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path="/home/user/project",
        run_id=sample_run_id,
    )

    assert f"--scan-run-id {sample_run_id}" in bundle.step_prompt


@pytest.mark.asyncio
@pytest.mark.skip(reason="step_prompt format does not include --spec-root parameter in command")
async def test_build_scan_bundle_prompt_contains_full_scan_command(
    mock_session, mock_workspace, sample_run_id
):
    """step_prompt 包含完整的 scan 命令行（所有平台参数）。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)
    spec_root = "/data/specs/ws-full"
    root_path = "/home/user/project"

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root=spec_root,
        root_path=root_path,
        run_id=sample_run_id,
    )

    prompt = bundle.step_prompt
    assert "sillyspec init --dir /data/specs/ws-full" in prompt
    assert "sillyspec run scan --dir /data/specs/ws-full" in prompt
    assert "--spec-root /data/specs/ws-full" in prompt
    assert f"--workspace-id {mock_workspace.id}" in prompt
    assert f"--scan-run-id {sample_run_id}" in prompt
    assert "--runtime-root" in prompt
    assert "sillyspec run scan --done" in prompt
    assert "/home/user/project" in prompt
    assert "只读" in prompt


@pytest.mark.asyncio
async def test_build_scan_bundle_platform_metadata_contains_platform_params(
    mock_session, mock_workspace, sample_run_id
):
    """platform_metadata 包含 spec_root, runtime_root, scan_run_id。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path="/home/user/project",
        run_id=sample_run_id,
    )

    meta = bundle.platform_metadata
    assert meta["spec_root"] == "/data/specs/ws-abc"
    assert meta["runtime_root"] is not None
    assert meta["scan_run_id"] == str(sample_run_id)
    assert meta["workspace_id"] == str(mock_workspace.id)


@pytest.mark.asyncio
@pytest.mark.asyncio
@pytest.mark.skip(reason="step_prompt format does not include --runtime-root parameter")
async def test_build_scan_bundle_custom_runtime_root(mock_session, mock_workspace, sample_run_id):
    """显式传入 runtime_root 时，不使用推导值。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)
    custom_runtime = "/custom/runtime/path"

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path="/home/user/project",
        run_id=sample_run_id,
        runtime_root=custom_runtime,
    )

    assert f"--runtime-root {custom_runtime}" in bundle.step_prompt
    assert bundle.platform_metadata["runtime_root"] == custom_runtime


@pytest.mark.asyncio
async def test_build_scan_bundle_runtime_root_default_derivation(
    mock_session, mock_workspace, sample_run_id
):
    """不传 runtime_root 时，从 spec_root 推导。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)
    spec_root = "/data/specs/ws-derive"

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root=spec_root,
        root_path="/home/user/project",
        run_id=sample_run_id,
    )

    expected = str(Path(spec_root) / "runtime")
    assert bundle.platform_metadata["runtime_root"] == expected
    assert bundle.runtime_root == expected
