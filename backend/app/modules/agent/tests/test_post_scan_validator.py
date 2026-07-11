"""Post-scan validation acceptance tests.

Covers:
- source_root/.sillyspec/docs pollution => failed_post_check
- spec_root/.sillyspec/docs missing 7 scan docs => failed_post_check
- tool_use_error in logs => failed_post_check
- API Error / fatal in logs => failed_post_check
- git -C source_root get commit success
- source_root not git repo => source_commit=null, source_git_status=not_git_repo
- resumed_from_step correctly saved
"""

from __future__ import annotations

import asyncio
import json
import uuid
from unittest.mock import MagicMock

from app.modules.agent.post_scan_validator import (
    PostScanValidator,
    _check_log_patterns,
    _check_output_paths,
    validate_resume_state,
)


class TestSpecRootDocsValidation:
    """Test spec_root docs validation."""

    def test_missing_docs_directory(self, tmp_path):
        """spec_root/.sillyspec/docs missing => failed_post_check."""
        spec_root = tmp_path / "specs"
        spec_root.mkdir()

        errors = _check_output_paths(spec_root)
        assert len(errors) == 1
        assert errors[0].code == "expected_docs_missing"

    def test_empty_docs_directory(self, tmp_path):
        """docs directory exists but empty => failed_post_check."""
        spec_root = tmp_path / "specs"
        docs_dir = spec_root / ".sillyspec" / "docs"
        docs_dir.mkdir(parents=True)

        errors = _check_output_paths(spec_root)
        assert len(errors) == 1
        assert errors[0].code == "docs_empty"

    def test_missing_7_scan_documents(self, tmp_path):
        """Missing expected scan documents => failed_post_check."""
        spec_root = tmp_path / "specs"
        scan_dir = spec_root / ".sillyspec" / "docs" / "myapp" / "scan"
        scan_dir.mkdir(parents=True)

        # Only create 3 of 7 expected docs
        for doc_name in ["ARCHITECTURE", "CONVENTIONS", "PROJECT"]:
            (scan_dir / f"{doc_name}.md").write_text(f"# {doc_name}")

        errors = _check_output_paths(spec_root)
        assert len(errors) == 1
        assert errors[0].code == "missing_spec_artifacts"
        # Should report missing docs
        missing = errors[0].details.get("missing_types", [])
        assert "CONCERNS" in missing
        assert "INTEGRATIONS" in missing
        assert "STRUCTURE" in missing
        assert "TESTING" in missing

    def test_all_7_scan_documents_present(self, tmp_path):
        """All 7 expected scan documents present => no errors."""
        spec_root = tmp_path / "specs"
        scan_dir = spec_root / ".sillyspec" / "docs" / "myapp" / "scan"
        scan_dir.mkdir(parents=True)

        # Create all 7 expected docs
        for doc_name in [
            "ARCHITECTURE",
            "CONVENTIONS",
            "CONCERNS",
            "INTEGRATIONS",
            "PROJECT",
            "STRUCTURE",
            "TESTING",
        ]:
            (scan_dir / f"{doc_name}.md").write_text(f"# {doc_name}")

        errors = _check_output_paths(spec_root)
        assert len(errors) == 0


class TestLogPatternDetection:
    """Test error pattern detection in agent logs."""

    def test_tool_use_error_detected(self):
        """tool_use_error in output => error pattern detected."""
        output = "[STDERR] tool_use_error occurred"
        errors = _check_log_patterns(output)
        assert len(errors) >= 1
        assert any(e.code == "error_pattern_detected" for e in errors)

    def test_api_error_detected(self):
        """API Error in output => error pattern detected."""
        output = "[SYSTEM:api_error] API Error: rate limit exceeded"
        errors = _check_log_patterns(output)
        assert len(errors) == 1
        assert "api error" in errors[0].details["pattern"].lower()

    def test_fatal_detected(self):
        """fatal: in output => error pattern detected."""
        output = "[STDERR] fatal: cannot open file.txt"
        errors = _check_log_patterns(output)
        assert len(errors) == 1

    def test_document_content_not_scanned(self):
        """Document content mentioning 'API Error' should NOT trigger error."""
        # This is assistant output (document content), should be ignored
        output = """[ASSISTANT] Here's the API design:
## API Error Handling
The API returns 404 for not found.

[THINKING] Considering error patterns in API design
The document mentions API Error as a topic."""
        errors = _check_log_patterns(output)
        assert len(errors) == 0

    def test_mixed_channels_scanned_correctly(self):
        """Only stderr/system/tool channels scanned, not assistant content."""
        output = """[ASSISTANT] Document mentions API Error examples
[STDERR] actual API Error occurred
[RESULT] scan completed successfully"""
        errors = _check_log_patterns(output)
        # Should only detect the stderr error, not the assistant document content
        assert len(errors) == 1


class TestResumeState:
    """Test resume state detection."""

    def test_resume_from_step_detected(self, tmp_path):
        """Resume marker file exists => resumed_from_step populated."""
        runtime_root = tmp_path / "runtime"
        scan_run_id = str(uuid.uuid4())
        resume_file = runtime_root / "scan-runs" / scan_run_id / "resume.json"
        resume_file.parent.mkdir(parents=True)

        resume_data = {
            "current_step": 3,
            "skipped_steps": [1, 2],
        }
        resume_file.write_text(json.dumps(resume_data), encoding="utf-8")

        result = validate_resume_state(runtime_root, scan_run_id)
        assert result["is_resume"] is True
        assert result["resumed_from_step"] == 3
        assert result["skipped_steps"] == [1, 2]

    def test_no_resume_marker(self, tmp_path):
        """No resume marker => default values."""
        runtime_root = tmp_path / "runtime"
        scan_run_id = str(uuid.uuid4())

        result = validate_resume_state(runtime_root, scan_run_id)
        assert result["is_resume"] is False
        assert result["resumed_from_step"] is None
        assert result["skipped_steps"] == []


class _FakeDelegate:
    """task-07 daemon-client 路径 mock：模拟 HostFsDelegate 原语返回值。"""

    def __init__(
        self,
        *,
        commit: str | None = "abc123",
        archive: dict | None = None,
        package_json: dict | None = None,
        local_yaml: dict | None = None,
    ) -> None:
        self._commit = commit
        self._archive = archive or {"archived": False, "detail": None}
        self._package_json = package_json
        self._local_yaml = local_yaml

    async def git_rev_parse(self, workspace, ref):
        return self._commit

    async def pollution_archive(self, workspace, source_root):
        return self._archive

    async def read_package_json(self, workspace):
        return self._package_json

    async def read_local_yaml(self, workspace):
        return self._local_yaml


class TestDaemonClientValidation:
    """task-07 daemon-client 单测（D-009 方案 B）。

    D-007@2026-07-10：单一 daemon-client 模式后 ``PostScanValidator`` 永远走
    ``_validate_daemon_client``，不再有 path_source 分流参数。
    """

    def test_daemon_client_commit_success(self, tmp_path):

        delegate = _FakeDelegate(commit="deadbeef")
        workspace = MagicMock()
        validator = PostScanValidator(
            source_root=tmp_path / "src",
            spec_root=tmp_path / "spec",
            runtime_root=tmp_path / "runtime",
            scan_run_id="dc-1",
            delegate=delegate,
            workspace=workspace,
        )
        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))
        assert result.metadata.get("source_commit") == "deadbeef"

    def test_daemon_client_commit_unavailable_warning(self, tmp_path):

        delegate = _FakeDelegate(commit=None)
        workspace = MagicMock()
        validator = PostScanValidator(
            source_root=tmp_path / "src",
            spec_root=tmp_path / "spec",
            runtime_root=tmp_path / "runtime",
            scan_run_id="dc-2",
            delegate=delegate,
            workspace=workspace,
        )
        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))
        assert result.metadata.get("source_commit") is None
        assert any(w.code == "source_commit_unavailable" for w in result.warnings)

    def test_daemon_client_pollution_archived(self, tmp_path):

        delegate = _FakeDelegate(
            archive={
                "archived": True,
                "detail": {"file_count": 3, "archive_path": "/host/archive/.sillyspec"},
            }
        )
        workspace = MagicMock()
        validator = PostScanValidator(
            source_root=tmp_path / "src",
            spec_root=tmp_path / "spec",
            runtime_root=tmp_path / "runtime",
            scan_run_id="dc-3",
            delegate=delegate,
            workspace=workspace,
        )
        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))
        assert any(w.code == "pollution_archived" for w in result.warnings)
        assert result.metadata["pollution_cleanup"]["archived"] is True

    def test_daemon_client_local_config_missing_script(self, tmp_path):

        delegate = _FakeDelegate(
            local_yaml={"build": "npm run build"},
            package_json={"scripts": {"lint": "eslint ."}},
        )
        workspace = MagicMock()
        validator = PostScanValidator(
            source_root=tmp_path / "src",
            spec_root=tmp_path / "spec",
            runtime_root=tmp_path / "runtime",
            scan_run_id="dc-4",
            delegate=delegate,
            workspace=workspace,
        )
        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))
        assert any(
            w.code == "local_config_invalid" and w.details.get("script_name") == "build"
            for w in result.warnings
        )
