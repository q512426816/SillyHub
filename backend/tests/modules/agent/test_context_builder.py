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
    assert bundle.denied_paths == []
    assert bundle.allowed_paths == ["/data/specs/ws-123", "/home/user/project"]


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

    # runtime_root 默认推导: spec_root/runtime
    expected_runtime = str(Path("/data/specs/ws-abc") / "runtime")
    assert f"--runtime-root {expected_runtime}" in bundle.step_prompt


@pytest.mark.asyncio
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
async def test_build_scan_bundle_prompt_contains_full_scan_command(
    mock_session, mock_workspace, sample_run_id
):
    """平台模式（spec_root 非空）：step_prompt 含完整 scan 命令行（所有平台参数），
    且第 1 步直接是 scan 启动命令（无 init 步骤）。"""
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
    # task-08: 平台模式跳过 init —— 不应出现 init 命令行（仅提示性文本里提及 init）
    assert "sillyspec init --dir" not in prompt
    assert "第 1 步 — 初始化" not in prompt
    assert "sillyspec run scan" in prompt
    assert "--dir /home/user/project" in prompt
    assert "--spec-root /data/specs/ws-full" in prompt
    assert f"--workspace-id {mock_workspace.id}" in prompt
    assert f"--scan-run-id {sample_run_id}" in prompt
    assert "--runtime-root" in prompt
    assert "--done" in prompt
    assert "/home/user/project" in prompt
    assert "只读" in prompt
    # task-08: 第 1 步直接是 scan 启动命令
    assert "第 1 步 — 启动 scan" in prompt
    # task-08: 不再有"在源码目录下创建 .sillyspec/"表述
    assert ".sillyspec/ 目录会在源码目录下创建" not in prompt


@pytest.mark.asyncio
async def test_build_scan_bundle_skips_init_in_platform_mode(
    mock_session, mock_workspace, sample_run_id
):
    """task-08: 平台模式（spec_root 非空）跳过 init 步骤。

    design.md §4.4 C1：平台模式 spec_root 非空时，源码目录不应建 .sillyspec，
    否则触发 sillyspec 源码保护"拒绝删除源码目录的 .sillyspec：检测到真实资产"。
    """
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/spec-ws/x",
        root_path="/src/myaaa",
        run_id=sample_run_id,
    )

    prompt = bundle.step_prompt
    # 不含 init 命令行（平台模式跳过；prompt 仅保留提示性文本"禁止执行 sillyspec init"）
    assert "sillyspec init --dir" not in prompt
    assert "第 1 步 — 初始化" not in prompt
    # 第 1 步直接是 scan 启动命令
    assert "第 1 步 — 启动 scan" in prompt
    # 不再有"在源码目录下创建 .sillyspec/"表述
    assert ".sillyspec/ 目录会在源码目录下创建" not in prompt
    # 源码目录保持只读
    assert "源码目录保持只读" in prompt


@pytest.mark.asyncio
async def test_build_scan_bundle_non_platform_keeps_init(
    mock_session, mock_workspace, sample_run_id
):
    """task-08: 非平台模式（spec_root 为空字符串）保留 init 步骤（向后兼容）。

    实际所有调用方都传 spec_root，但保留此分支避免回归。
    """
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="",
        root_path="/src/myaaa",
        run_id=sample_run_id,
    )

    prompt = bundle.step_prompt
    # 非平台模式保留 init
    assert "sillyspec init --dir /src/myaaa" in prompt
    # 仍是"第 1 步 — 初始化"
    assert "第 1 步 — 初始化" in prompt
    assert "第 2 步 — 启动 scan" in prompt


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


@pytest.mark.asyncio
async def test_build_scan_bundle_done_command_has_no_platform_params(
    mock_session, mock_workspace, sample_run_id
):
    """--done 命令示例不包含平台参数（CLI 从 platform-scan.json 恢复）。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path="/home/user/project",
        run_id=sample_run_id,
    )

    # 找到 --done 行
    prompt = bundle.step_prompt
    done_section_start = prompt.find("sillyspec run scan --done")
    assert done_section_start != -1, "--done 命令示例应在 prompt 中"

    # --done 区域之后 200 字符内不应出现平台参数
    done_section = prompt[done_section_start : done_section_start + 300]
    assert "--spec-root" not in done_section, "--done 命令不应包含 --spec-root"
    assert "--runtime-root" not in done_section, "--done 命令不应包含 --runtime-root"
    assert "--workspace-id" not in done_section, "--done 命令不应包含 --workspace-id"
    assert "--scan-run-id" not in done_section, "--done 命令不应包含 --scan-run-id"


# ---------------------------------------------------------------------------
# Preflight tests
# ---------------------------------------------------------------------------


def test_run_preflight_nonexistent_dir():
    """source_root 不存在时 preflight 失败。"""
    from app.modules.spec_workspace.bootstrap import _run_preflight

    result = _run_preflight(Path("/nonexistent/path"))
    assert result is not None
    assert "does not exist" in result


def test_run_preflight_empty_dir(tmp_path):
    """source_root 为空时 preflight 失败。"""
    from app.modules.spec_workspace.bootstrap import _run_preflight

    result = _run_preflight(tmp_path)
    assert result is not None
    assert "empty" in result


def test_run_preflight_no_project_signature(tmp_path):
    """source_root 有文件但无项目特征时 preflight 失败。"""
    from app.modules.spec_workspace.bootstrap import _run_preflight

    (tmp_path / "random.txt").write_text("hello")
    result = _run_preflight(tmp_path)
    assert result is not None
    assert "no recognizable project signature" in result


def test_run_preflight_has_package_json(tmp_path):
    """source_root 有 package.json 时 preflight 通过。"""
    from app.modules.spec_workspace.bootstrap import _run_preflight

    (tmp_path / "package.json").write_text("{}")
    assert _run_preflight(tmp_path) is None


def test_run_preflight_has_backend_dir(tmp_path):
    """source_root 有 backend/ 目录时 preflight 通过。"""
    from app.modules.spec_workspace.bootstrap import _run_preflight

    (tmp_path / "backend").mkdir()
    (tmp_path / "backend" / "main.py").write_text("pass")
    assert _run_preflight(tmp_path) is None


def test_run_preflight_platform_only_files_pass(tmp_path):
    """只有 README.md + .sillyspec + worktree 时，视为空目录失败。"""
    from app.modules.spec_workspace.bootstrap import _run_preflight

    (tmp_path / "README.md").write_text("# hello")
    (tmp_path / ".sillyspec").mkdir()
    (tmp_path / "worktree").mkdir()
    result = _run_preflight(tmp_path)
    assert result is not None
    assert "empty" in result


def test_run_preflight_code_in_subdirectory(tmp_path):
    """顶层无签名但子目录有 pyproject.toml 时 preflight 通过。"""
    from app.modules.spec_workspace.bootstrap import _run_preflight

    sub = tmp_path / "my-project"
    sub.mkdir()
    (sub / "pyproject.toml").write_text("[project]")
    assert _run_preflight(tmp_path) is None


def test_run_preflight_readme_with_code_pass(tmp_path):
    """有 README.md 和 backend/ 目录时 preflight 通过。"""
    from app.modules.spec_workspace.bootstrap import _run_preflight

    (tmp_path / "README.md").write_text("# project")
    (tmp_path / "backend").mkdir()
    (tmp_path / "backend" / "main.py").write_text("pass")
    assert _run_preflight(tmp_path) is None
