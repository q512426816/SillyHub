"""Tests for post-scan reparse and manifest validation in _execute_scan_run."""

import json
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.agent.base import AgentRunResult, AgentSpecBundle
from app.modules.agent.model import AgentRun
from app.modules.agent.service import AgentService


def _make_scan_bundle(
    workspace_id: uuid.UUID,
    spec_root: str = "/data/specs/ws-test",
    root_path: str = "/home/user/project",
    run_id: uuid.UUID | None = None,
) -> AgentSpecBundle:
    """构建一个最小 scan bundle 用于测试。"""
    return AgentSpecBundle(
        change_summary="Scan workspace project structure",
        task_key="stage:scan",
        task_title="Stage dispatch: scan",
        allowed_paths=[spec_root],
        denied_paths=[root_path],
        available_tools=["sillyspec"],
        platform_metadata={
            "workspace_id": str(workspace_id),
            "mode": "scan",
            "root_path": root_path,
            "spec_root": spec_root,
            "runtime_root": "/data/specs/runtime/" + str(workspace_id),
            "scan_run_id": str(run_id or uuid.uuid4()),
        },
        stage_dispatch=True,
        change_key=None,
        stage="scan",
        spec_root=spec_root,
        step_prompt="test scan prompt",
        read_only=True,
    )


def _setup_mock_session_factory(mock_session, mock_run):
    """构建 mock session factory（模拟 async with factory() as session）。"""
    mock_factory = MagicMock()
    mock_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_factory.return_value.__aexit__ = AsyncMock(return_value=False)
    return mock_factory


@pytest.mark.asyncio
@patch.object(AgentService, "_post_scan_reparse", new_callable=AsyncMock)
@patch("app.modules.agent.service.redact_agent_output", return_value="redacted")
async def test_execute_scan_run_calls_post_scan_reparse_on_success(mock_redact, mock_reparse):
    """_execute_scan_run 成功时（exit_code=0）应调用 _post_scan_reparse。"""
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    run_id = uuid.uuid4()
    bundle = _make_scan_bundle(workspace_id, run_id=run_id)

    mock_session = AsyncMock()
    mock_run = MagicMock(spec=AgentRun)
    mock_run.id = run_id
    mock_run.status = "pending"
    mock_session.get = AsyncMock(return_value=mock_run)

    mock_factory = _setup_mock_session_factory(mock_session, mock_run)

    mock_result = AgentRunResult(
        exit_code=0,
        stdout="scan complete",
        stderr="",
        redacted_output="scan complete",
    )
    mock_adapter_cls = MagicMock()
    mock_adapter_instance = MagicMock()
    mock_adapter_instance.run_with_bundle = AsyncMock(return_value=mock_result)
    mock_adapter_cls.return_value = mock_adapter_instance

    with (
        patch("app.core.db.get_session_factory", return_value=mock_factory),
        patch("app.modules.agent.service.ADAPTERS", {"claude_code": mock_adapter_cls}),
    ):
        svc = AgentService(AsyncMock())
        await svc._execute_scan_run(
            run_id=run_id,
            bundle=bundle,
            work_dir=Path("/tmp/test-workdir"),
            workspace_id=workspace_id,
            user_id=user_id,
        )

    mock_reparse.assert_called_once()
    call_kwargs = mock_reparse.call_args[1]
    assert call_kwargs["workspace_id"] == workspace_id


@pytest.mark.asyncio
@patch.object(AgentService, "_post_scan_reparse", new_callable=AsyncMock)
@patch("app.modules.agent.service.redact_agent_output", return_value="redacted")
async def test_execute_scan_run_no_reparse_on_failure(mock_redact, mock_reparse):
    """_execute_scan_run 失败时（exit_code!=0）不应调用 _post_scan_reparse。"""
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    run_id = uuid.uuid4()
    bundle = _make_scan_bundle(workspace_id)

    mock_session = AsyncMock()
    mock_run = MagicMock(spec=AgentRun)
    mock_run.id = run_id
    mock_run.status = "pending"
    mock_session.get = AsyncMock(return_value=mock_run)

    mock_factory = _setup_mock_session_factory(mock_session, mock_run)

    mock_result = AgentRunResult(
        exit_code=1,
        stdout="",
        stderr="error",
        redacted_output="error",
    )
    mock_adapter_cls = MagicMock()
    mock_adapter_instance = MagicMock()
    mock_adapter_instance.run_with_bundle = AsyncMock(return_value=mock_result)
    mock_adapter_cls.return_value = mock_adapter_instance

    with (
        patch("app.core.db.get_session_factory", return_value=mock_factory),
        patch("app.modules.agent.service.ADAPTERS", {"claude_code": mock_adapter_cls}),
    ):
        svc = AgentService(AsyncMock())
        await svc._execute_scan_run(
            run_id=run_id,
            bundle=bundle,
            work_dir=Path("/tmp/test-workdir"),
            workspace_id=workspace_id,
            user_id=user_id,
        )

    mock_reparse.assert_not_called()


@pytest.mark.asyncio
async def test_post_scan_reparse_calls_scan_docs_reparse(tmp_path):
    """_post_scan_reparse 成功路径应调用 ScanDocsService.reparse()。"""
    workspace_id = uuid.uuid4()
    spec_root = str(tmp_path / "spec")
    Path(spec_root).mkdir(parents=True, exist_ok=True)

    # 创建 manifest.json
    manifest_path = Path(spec_root) / "manifest.json"
    manifest_path.write_text(json.dumps({"source_commit": "abc123"}), encoding="utf-8")

    bundle = _make_scan_bundle(
        workspace_id, spec_root=spec_root, root_path=str(tmp_path / "project")
    )

    mock_session = AsyncMock()

    # Patch at the source module where it's imported from
    with (
        patch("app.modules.scan_docs.service.ScanDocsService") as MockScanDocsSvc,
    ):
        mock_scan_instance = AsyncMock()
        mock_scan_instance.reparse = AsyncMock(
            return_value=({"parsed": 5, "created": 3, "updated": 0, "deleted": 0}, MagicMock())
        )
        MockScanDocsSvc.return_value = mock_scan_instance

        svc = AgentService(AsyncMock())
        await svc._post_scan_reparse(
            session=mock_session,
            workspace_id=workspace_id,
            bundle=bundle,
        )

        MockScanDocsSvc.assert_called_once_with(mock_session)
        mock_scan_instance.reparse.assert_called_once_with(workspace_id)


@pytest.mark.asyncio
async def test_post_scan_reparse_skips_when_no_manifest(tmp_path):
    """_post_scan_reparse 在无 manifest.json 时跳过 reparse。"""
    workspace_id = uuid.uuid4()
    spec_root = str(tmp_path / "spec-no-manifest")
    Path(spec_root).mkdir(parents=True, exist_ok=True)

    bundle = _make_scan_bundle(workspace_id, spec_root=spec_root)

    mock_session = AsyncMock()

    with patch("app.modules.scan_docs.service.ScanDocsService") as MockScanDocsSvc:
        svc = AgentService(AsyncMock())
        await svc._post_scan_reparse(
            session=mock_session,
            workspace_id=workspace_id,
            bundle=bundle,
        )

        MockScanDocsSvc.assert_not_called()


@pytest.mark.asyncio
async def test_post_scan_reparse_skips_when_no_spec_root():
    """_post_scan_reparse 在 spec_root 为空时跳过。"""
    workspace_id = uuid.uuid4()
    bundle = _make_scan_bundle(workspace_id)
    bundle.spec_root = None

    mock_session = AsyncMock()

    with patch("app.modules.scan_docs.service.ScanDocsService") as MockScanDocsSvc:
        svc = AgentService(AsyncMock())
        await svc._post_scan_reparse(
            session=mock_session,
            workspace_id=workspace_id,
            bundle=bundle,
        )

        MockScanDocsSvc.assert_not_called()


@pytest.mark.asyncio
async def test_post_scan_reparse_manifest_commit_match(tmp_path):
    """_post_scan_reparse 校验 manifest.source_commit 与 git HEAD 一致。"""
    workspace_id = uuid.uuid4()
    spec_root = str(tmp_path / "spec-commit")
    Path(spec_root).mkdir(parents=True, exist_ok=True)

    commit_hash = "abc123def456"
    manifest_path = Path(spec_root) / "manifest.json"
    manifest_path.write_text(json.dumps({"source_commit": commit_hash}), encoding="utf-8")

    bundle = _make_scan_bundle(
        workspace_id, spec_root=spec_root, root_path=str(tmp_path / "project")
    )

    mock_session = AsyncMock()

    with (
        patch("app.modules.scan_docs.service.ScanDocsService") as MockScanDocsSvc,
        patch("subprocess.run") as mock_git,
    ):
        mock_scan_instance = AsyncMock()
        mock_scan_instance.reparse = AsyncMock(return_value=({"parsed": 0}, MagicMock()))
        MockScanDocsSvc.return_value = mock_scan_instance

        # git HEAD 匹配 manifest.source_commit
        mock_git.return_value = MagicMock(returncode=0, stdout=commit_hash + "\n")

        svc = AgentService(AsyncMock())
        await svc._post_scan_reparse(
            session=mock_session,
            workspace_id=workspace_id,
            bundle=bundle,
        )

        # git 被调用了（校验 commit）
        mock_git.assert_called_once()
        mock_scan_instance.reparse.assert_called_once()
