"""Tests for build_scan_bundle()."""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import AsyncMock

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


@pytest.mark.asyncio
async def test_build_scan_bundle_success(mock_session, mock_workspace):
    """正常场景：构建 scan bundle 成功。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-123",
        root_path="F:\\Projects\\MyApp",
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
    assert bundle.denied_paths == ["F:\\Projects\\MyApp"]
    assert bundle.allowed_paths == ["/data/specs/ws-123"]
    assert "sillyspec init" in bundle.step_prompt
    assert "sillyspec run scan" in bundle.step_prompt
    assert bundle.platform_metadata["mode"] == "scan"
    assert bundle.platform_metadata["root_path"] == "F:\\Projects\\MyApp"


@pytest.mark.asyncio
async def test_build_scan_bundle_workspace_not_found(mock_session):
    """workspace_id 不存在时抛出 WorkspaceNotFound。"""
    mock_session.get = AsyncMock(return_value=None)

    with pytest.raises(WorkspaceNotFound):
        await build_scan_bundle(
            session=mock_session,
            workspace_id=uuid.uuid4(),
            spec_root="/data/specs/ws-123",
            root_path="/tmp/project",
        )


@pytest.mark.asyncio
async def test_build_scan_bundle_step_prompt_content(mock_session, mock_workspace):
    """step_prompt 包含完整的 sillyspec 执行指令。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path="/home/user/project",
    )

    assert "sillyspec init --dir /data/specs/ws-abc" in bundle.step_prompt
    assert "sillyspec run scan --dir /data/specs/ws-abc" in bundle.step_prompt
    assert "sillyspec run scan --done" in bundle.step_prompt
    assert "/home/user/project" in bundle.step_prompt
    assert "只读" in bundle.step_prompt


@pytest.mark.asyncio
async def test_build_scan_bundle_no_spec_documents(mock_session, mock_workspace):
    """scan bundle 不包含 proposal/requirements/design/plan 等 spec 文档。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-123",
        root_path="/tmp/project",
    )

    assert bundle.proposal is None
    assert bundle.requirements is None
    assert bundle.design is None
    assert bundle.plan is None
    assert bundle.task_markdown is None


@pytest.mark.asyncio
async def test_build_scan_bundle_no_referenced_workspaces(mock_session, mock_workspace):
    """scan bundle 不包含跨 workspace 上下文。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-123",
        root_path="/tmp/project",
    )

    assert bundle.referenced_workspaces == []
