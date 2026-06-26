"""Tests for build_scan_bundle()."""

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import WorkspaceNotFound
from app.modules.agent.base import AgentSpecBundle
from app.modules.agent.context_builder import build_scan_bundle
from app.modules.workspace.model import Workspace


def _mock_settings(monkeypatch, *, transport: str, spec_data_host_dir: str) -> None:
    """monkeypatch get_settings 返回固定 transport + spec_data_host_dir 的假 settings。

    用 monkeypatch 而非新 fixture：作用域限本用例，自动还原，
    不影响同文件其他不依赖 transport 的测试（如 preflight 测试行 390+）。

    D-006@v1：context_builder.py 顶部是 `from app.core.config import get_settings`
    形式 import，符号已绑定到 context_builder 模块命名空间，必须同时 patch
    被测模块内的引用（app.modules.agent.context_builder.get_settings），仅 patch
    app.core.config.get_settings 不会生效。
    """
    from app.core import config

    fake = MagicMock()
    fake.spec_transport = transport
    fake.spec_data_host_dir = spec_data_host_dir
    monkeypatch.setattr(config, "get_settings", lambda: fake)
    monkeypatch.setattr("app.modules.agent.context_builder.get_settings", lambda: fake)


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


@pytest.mark.parametrize("transport", ["shared", "tar"])
@pytest.mark.asyncio
async def test_build_scan_bundle_prompt_spec_root_by_transport(
    mock_session, mock_workspace, sample_run_id, monkeypatch, transport
):
    """step_prompt 的 --spec-root 按 transport 分支：
    shared → settings.spec_data_host_dir/{ws_id}；
    tar    → ~/.sillyhub/daemon/specs/{ws_id}。

    覆盖 D-006@v1：改测试不改代码（build_scan_bundle 双轨设计：prompt 用宿主路径，
    bundle.spec_root/platform_metadata.spec_root 用入参容器路径）。

    旧断言 `--spec-root /data/specs/ws-abc`（入参硬编码）过时——生产代码 prompt
    不使用入参 spec_root，而是经 resolve_prompt_spec_root(transport, ws_id, settings)
    推导宿主路径。ws_id 是真实 UUID（mock_workspace.id = uuid.uuid4()），硬编码
    ws-abc 永远不匹配，旧断言必然失败。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)
    ws_id = str(mock_workspace.id)

    # mock settings：固定 spec_transport + spec_data_host_dir，消除环境依赖
    _mock_settings(monkeypatch, transport=transport, spec_data_host_dir="/test/host/specs")

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",  # 入参（容器路径，仅 bundle 字段用）
        root_path="/home/user/project",
        run_id=sample_run_id,
    )

    if transport == "shared":
        expected_spec_root = f"/test/host/specs/{ws_id}"
    else:  # tar
        expected_spec_root = f"~/.sillyhub/daemon/specs/{ws_id}"
    assert f"--spec-root {expected_spec_root}" in bundle.step_prompt

    # runtime_root 按 host_spec_root/runtime 推导（context_builder.py:518）
    expected_runtime_root = f"{expected_spec_root}/runtime"
    assert f"--runtime-root {expected_runtime_root}" in bundle.step_prompt

    # D-006 双轨：bundle.spec_root / metadata.spec_root 仍用入参容器路径
    assert bundle.spec_root == "/data/specs/ws-abc"
    assert bundle.platform_metadata["spec_root"] == "/data/specs/ws-abc"


@pytest.mark.asyncio
async def test_build_scan_bundle_path_source_daemon_client_locks_tar(
    mock_session, mock_workspace, sample_run_id, monkeypatch
):
    """方案 A：path_source='daemon-client' 锁死 tar，忽略全局 SPEC_TRANSPORT。

    即便全局 settings.spec_transport='shared'，path_source='daemon-client' 优先 →
    transport='tar' → prompt 含 daemon 本地路径 ~/.sillyhub/daemon/specs/{ws}。
    守护 per-workspace 决策覆盖全局 SPEC_TRANSPORT 的核心规则。
    """
    mock_session.get = AsyncMock(return_value=mock_workspace)
    ws_id = str(mock_workspace.id)
    # 全局设 shared，path_source='daemon-client' 应覆盖为 tar
    _mock_settings(monkeypatch, transport="shared", spec_data_host_dir="/test/host/specs")

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path="/home/user/project",
        run_id=sample_run_id,
        path_source="daemon-client",
    )

    expected_spec_root = f"~/.sillyhub/daemon/specs/{ws_id}"
    assert f"--spec-root {expected_spec_root}" in bundle.step_prompt
    # 守护：shared 宿主路径不应出现（tar 锁死，未被全局 shared 污染）
    assert f"/test/host/specs/{ws_id}" not in bundle.step_prompt


@pytest.mark.asyncio
async def test_build_scan_bundle_path_source_server_local_locks_shared(
    mock_session, mock_workspace, sample_run_id, monkeypatch
):
    """方案 A：path_source='server-local' 锁死 shared，忽略全局 SPEC_TRANSPORT。

    即便全局 settings.spec_transport='tar'，path_source='server-local' 优先 →
    transport='shared' → prompt 含宿主路径。守护 server-local 锁死 shared、忽略全局。
    """
    mock_session.get = AsyncMock(return_value=mock_workspace)
    ws_id = str(mock_workspace.id)
    # 全局设 tar，path_source='server-local' 应覆盖为 shared
    _mock_settings(monkeypatch, transport="tar", spec_data_host_dir="/test/host/specs")

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path="/home/user/project",
        run_id=sample_run_id,
        path_source="server-local",
    )

    expected_spec_root = f"/test/host/specs/{ws_id}"
    assert f"--spec-root {expected_spec_root}" in bundle.step_prompt
    # 守护：tar daemon 本地路径不应出现（shared 锁死，未被全局 tar 污染）
    assert f"~/.sillyhub/daemon/specs/{ws_id}" not in bundle.step_prompt


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
    mock_session, mock_workspace, sample_run_id, monkeypatch
):
    """平台模式（spec_root 非空）：step_prompt 含完整 scan 命令行（所有平台参数），
    且第 1 步直接是 scan 启动命令（无 init 步骤）。

    task-08：D-006 双轨——prompt 的 --spec-root 用宿主路径（由 transport + settings
    推导），非入参容器路径。mock settings 为 shared + 固定 host dir 消除环境依赖。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)
    spec_root = "/data/specs/ws-full"
    root_path = "/home/user/project"
    # D-006：prompt 用推导宿主路径，mock settings 消除环境依赖
    _mock_settings(monkeypatch, transport="shared", spec_data_host_dir="/test/host/specs")

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root=spec_root,
        root_path=root_path,
        run_id=sample_run_id,
    )

    prompt = bundle.step_prompt
    ws_id = str(mock_workspace.id)
    host_spec_root = f"/test/host/specs/{ws_id}"
    # task-08: 平台模式跳过 init —— 不应出现 init 命令行（仅提示性文本里提及 init）
    assert "sillyspec init --dir" not in prompt
    assert "第 1 步 — 初始化" not in prompt
    assert "sillyspec run scan" in prompt
    assert '--dir "/home/user/project"' in prompt
    # D-006：prompt 用宿主推导路径，非入参 spec_root
    assert f"--spec-root {host_spec_root}" in prompt
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
    # task-05：平台模式文档输出路径扁平（{host_spec_root}/docs/，无 .sillyspec 包裹），
    # 对齐 daemon 实际扁平产出 + SpecPathResolver(platform_managed=True).docs_dir 契约（D-005@v1）。
    assert f"{host_spec_root}/docs/" in prompt
    assert f"{host_spec_root}/.sillyspec/docs/" not in prompt


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
    assert 'sillyspec init --dir "/src/myaaa"' in prompt
    # 仍是"第 1 步 — 初始化"
    assert "第 1 步 — 初始化" in prompt
    assert "第 2 步 — 启动 scan" in prompt
    # task-05 回归守护：非平台（server-local / repo-native）分支仍指示 .sillyspec 包裹产出
    assert ".sillyspec/docs/" in prompt


@pytest.mark.asyncio
async def test_build_scan_bundle_dir_path_double_quoted(
    mock_session, mock_workspace, sample_run_id, monkeypatch
):
    """--dir 路径用双引号包裹，防 Windows 反斜杠路径在 Git Bash 无引号时被转义破坏。

    现象：root_path = C:\\Users\\qinyi\\myaaa（反斜杠）在 Git Bash 无引号执行时，
    \\U/\\q/\\I/\\m 被当转义吃掉反斜杠 → sillyspec 收到 C:Users... → Python pathlib
    解释成 drive-relative 相对路径拼到 cwd → 报"目录不存在"且路径变形。双引号内
    \\U 等（非 $ ` " \\ 换行）原样保留。同时覆盖含空格路径。平台模式 + mock settings。"""
    mock_session.get = AsyncMock(return_value=mock_workspace)
    _mock_settings(monkeypatch, transport="shared", spec_data_host_dir="/test/host/specs")

    bundle = await build_scan_bundle(
        session=mock_session,
        workspace_id=mock_workspace.id,
        spec_root="/data/specs/ws-abc",
        root_path=r"C:\Users\qinyi\my project",
        run_id=sample_run_id,
    )

    prompt = bundle.step_prompt
    # 平台模式：scan 启动命令与 done 命令的 --dir 都必须双引号包裹路径
    assert r'--dir "C:\Users\qinyi\my project"' in prompt
    # 不应出现裸 --dir 无引号形态（--dir 后直接跟 C: 而非 "C:）
    assert "--dir C:" not in prompt


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
    """显式传入 runtime_root 时，bundle 字段用入参值，prompt 仍用宿主推导路径。

    D-006 双轨：prompt 的 --runtime-root 始终由 host_spec_root/runtime 推导
    （context_builder.py:518），入参 runtime_root 仅作用于 bundle.runtime_root /
    platform_metadata.runtime_root（容器内 backend 访问路径）。"""
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

    # D-006：bundle 字段用入参容器路径（双轨不变）
    assert bundle.platform_metadata["runtime_root"] == custom_runtime
    assert bundle.runtime_root == custom_runtime


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
