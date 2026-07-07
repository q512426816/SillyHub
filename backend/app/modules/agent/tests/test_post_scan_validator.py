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

from app.modules.agent.post_scan_validator import (
    PostScanValidator,
    ScanRunStatus,
    _check_local_config,
    _check_log_patterns,
    _check_output_paths,
    _check_source_pollution,
    _get_source_commit,
    validate_resume_state,
)


class TestSourceRootPollution:
    """Test source_root/.sillyspec/docs pollution detection."""

    def test_pollution_detected_when_source_root_has_docs(self, tmp_path):
        """source_root/.sillyspec/docs has files => failed_post_check."""
        source_root = tmp_path / "project"
        source_root.mkdir()
        spec_root = tmp_path / "specs"

        # Create pollution in source_root
        source_docs = source_root / ".sillyspec" / "docs"
        source_docs.mkdir(parents=True)
        (source_docs / "ARCHITECTURE.md").write_text("# Architecture")

        errors = _check_source_pollution(source_root, spec_root)
        assert len(errors) == 1
        assert errors[0].code == "source_root_pollution"
        assert errors[0].severity == "error"

    def test_no_pollution_when_source_root_clean(self, tmp_path):
        """source_root clean => no pollution errors."""
        source_root = tmp_path / "project"
        source_root.mkdir()
        spec_root = tmp_path / "specs"

        errors = _check_source_pollution(source_root, spec_root)
        assert len(errors) == 0


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


class TestSourceCommitRetrieval:
    """Test source_commit retrieval using git -C."""

    def test_git_repo_success(self, tmp_path):
        """Valid git repo => commit hash retrieved."""
        # Initialize a git repo
        import subprocess

        subprocess.run(["git", "init"], cwd=tmp_path, check=True, capture_output=True)
        (tmp_path / "test.txt").write_text("test")
        subprocess.run(["git", "add", "."], cwd=tmp_path, check=True, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=tmp_path,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"],
            cwd=tmp_path,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "commit", "-m", "Initial"],
            cwd=tmp_path,
            check=True,
            capture_output=True,
        )

        commit, error = _get_source_commit(tmp_path)
        assert commit is not None
        assert len(commit) == 40  # SHA-1 hash
        assert error is None

    def test_not_git_repo(self, tmp_path):
        """Not a git repo => source_commit=null, error=not_git_repo."""
        # tmp_path already exists by pytest, just check it
        commit, error = _get_source_commit(tmp_path)
        assert commit is None
        assert error == "not_git_repo"


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


class TestPostScanValidator:
    """Integration tests for PostScanValidator."""

    def test_failed_post_check_on_pollution(self, tmp_path):
        """Pollution in source_root => failed_post_check."""
        source_root = tmp_path / "project"
        spec_root = tmp_path / "specs"
        runtime_root = tmp_path / "runtime"
        source_root.mkdir()
        spec_root.mkdir()
        runtime_root.mkdir()

        # Create pollution
        (source_root / ".sillyspec" / "docs").mkdir(parents=True)
        (source_root / ".sillyspec" / "docs" / "TEST.md").write_text("# Test")

        # Initialize git
        import subprocess

        subprocess.run(["git", "init"], cwd=source_root, check=True, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=source_root,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"],
            cwd=source_root,
            check=True,
            capture_output=True,
        )

        validator = PostScanValidator(
            source_root=source_root,
            spec_root=spec_root,
            runtime_root=runtime_root,
            scan_run_id="test-run",
        )

        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))

        assert result.status == ScanRunStatus.FAILED_POST_CHECK
        assert any(e.code == "source_root_pollution" for e in result.errors)

    def test_success_on_clean_run(self, tmp_path):
        """Clean run with all docs => success."""
        source_root = tmp_path / "project"
        spec_root = tmp_path / "specs"
        runtime_root = tmp_path / "runtime"
        source_root.mkdir()
        spec_root.mkdir()
        runtime_root.mkdir()

        # Create git repo with actual commit
        import subprocess

        subprocess.run(["git", "init"], cwd=source_root, check=True, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=source_root,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"],
            cwd=source_root,
            check=True,
            capture_output=True,
        )
        # Create a file and commit
        (source_root / "test.txt").write_text("test")
        subprocess.run(["git", "add", "."], cwd=source_root, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "Initial"],
            cwd=source_root,
            check=True,
            capture_output=True,
        )

        # Create all expected docs in spec_root
        scan_dir = spec_root / ".sillyspec" / "docs" / "app" / "scan"
        scan_dir.mkdir(parents=True)
        for doc in [
            "ARCHITECTURE",
            "CONVENTIONS",
            "CONCERNS",
            "INTEGRATIONS",
            "PROJECT",
            "STRUCTURE",
            "TESTING",
        ]:
            (scan_dir / f"{doc}.md").write_text(f"# {doc}")

        # Create manifest to avoid warning
        manifest_dir = runtime_root / "scan-runs"
        manifest_dir.mkdir(parents=True)
        (manifest_dir / "manifest.json").write_text('{"status": "ok"}', encoding="utf-8")

        validator = PostScanValidator(
            source_root=source_root,
            spec_root=spec_root,
            runtime_root=runtime_root,
            scan_run_id="test-run",
        )

        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))

        assert result.status == ScanRunStatus.SUCCESS
        assert len(result.errors) == 0
        assert result.metadata.get("source_commit") is not None

    def test_non_git_repo_completes_with_warnings(self, tmp_path):
        """ql-20260617-014：非 git 仓库（rootPath 模式 / 项目尚未 git init）是合法状态，
        agent 跑完所有步骤 + 产出全部 docs 时不应标记失败，
        source_commit 失败降级 warning → COMPLETED_WITH_WARNINGS。
        """
        source_root = tmp_path / "project"
        spec_root = tmp_path / "specs"
        runtime_root = tmp_path / "runtime"
        source_root.mkdir()
        spec_root.mkdir()
        runtime_root.mkdir()

        # 注意：故意不 git init，模拟 rootPath 模式下非 git 仓库

        # Create all expected docs in spec_root
        scan_dir = spec_root / ".sillyspec" / "docs" / "app" / "scan"
        scan_dir.mkdir(parents=True)
        for doc in [
            "ARCHITECTURE",
            "CONVENTIONS",
            "CONCERNS",
            "INTEGRATIONS",
            "PROJECT",
            "STRUCTURE",
            "TESTING",
        ]:
            (scan_dir / f"{doc}.md").write_text(f"# {doc}")

        # Create manifest to avoid unrelated warning
        manifest_dir = runtime_root / "scan-runs"
        manifest_dir.mkdir(parents=True)
        (manifest_dir / "manifest.json").write_text('{"status": "ok"}', encoding="utf-8")

        validator = PostScanValidator(
            source_root=source_root,
            spec_root=spec_root,
            runtime_root=runtime_root,
            scan_run_id="test-nongit",
        )

        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))

        # ql-20260617-014：不应是 FAILED_POST_CHECK，应是 COMPLETED_WITH_WARNINGS
        assert result.status == ScanRunStatus.COMPLETED_WITH_WARNINGS
        # source_commit 失败作为 warning，不是 error
        assert all(e.code != "source_commit_failed" for e in result.errors)
        assert any(w.code == "source_commit_unavailable" for w in result.warnings)
        # metadata 仍记录 source_commit=None + error 原因
        assert result.metadata.get("source_commit") is None
        assert result.metadata.get("source_commit_error") == "not_git_repo"


class TestLocalConfigValidation:
    """Test local.yaml configuration validation."""

    def test_local_config_with_missing_scripts(self, tmp_path):
        """local.yaml references missing npm script => warning."""
        source_root = tmp_path / "project"
        source_root.mkdir()

        # Create local.yaml with npm run commands (flat format)
        local_yaml = source_root / ".sillyspec" / "local.yaml"
        local_yaml.parent.mkdir(parents=True)
        local_yaml.write_text(
            "build: npm run build\ntest: npm run test\n",
            encoding="utf-8",
        )

        # Create package.json without those scripts
        package_json = source_root / "package.json"
        package_json.write_text('{"scripts": {"lint": "eslint ."}}', encoding="utf-8")

        warnings = _check_local_config(source_root)
        assert len(warnings) == 2
        assert all(w.code == "local_config_invalid" for w in warnings)
        assert any("build" in w.details.get("script_name", "") for w in warnings)
        assert any("test" in w.details.get("script_name", "") for w in warnings)

    def test_local_config_with_valid_scripts(self, tmp_path):
        """local.yaml references valid npm scripts => no warnings."""
        source_root = tmp_path / "project"
        source_root.mkdir()

        # Create local.yaml with npm run commands (flat format)
        local_yaml = source_root / ".sillyspec" / "local.yaml"
        local_yaml.parent.mkdir(parents=True)
        local_yaml.write_text(
            "build: npm run build\ntest: npm run test\n",
            encoding="utf-8",
        )

        # Create package.json with those scripts
        package_json = source_root / "package.json"
        package_json.write_text(
            '{"scripts": {"build": "webpack", "test": "jest"}}',
            encoding="utf-8",
        )

        warnings = _check_local_config(source_root)
        assert len(warnings) == 0


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
    """task-07 daemon-client 分流单测（D-009 方案 B）。"""

    def test_daemon_client_commit_success(self, tmp_path):
        import asyncio

        delegate = _FakeDelegate(commit="deadbeef")
        # workspace 仅作 path_source 分流载体，daemon-client 测试用最小占位。
        workspace = type("Ws", (), {"path_source": "daemon-client"})()
        validator = PostScanValidator(
            source_root=tmp_path / "src",
            spec_root=tmp_path / "spec",
            runtime_root=tmp_path / "runtime",
            scan_run_id="dc-1",
            delegate=delegate,
            path_source="daemon-client",
            workspace=workspace,
        )
        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))
        assert result.metadata.get("source_commit") == "deadbeef"
        assert result.metadata.get("path_source") == "daemon-client"

    def test_daemon_client_commit_unavailable_warning(self, tmp_path):
        import asyncio

        delegate = _FakeDelegate(commit=None)
        workspace = type("Ws", (), {"path_source": "daemon-client"})()
        validator = PostScanValidator(
            source_root=tmp_path / "src",
            spec_root=tmp_path / "spec",
            runtime_root=tmp_path / "runtime",
            scan_run_id="dc-2",
            delegate=delegate,
            path_source="daemon-client",
            workspace=workspace,
        )
        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))
        assert result.metadata.get("source_commit") is None
        assert any(w.code == "source_commit_unavailable" for w in result.warnings)

    def test_daemon_client_pollution_archived(self, tmp_path):
        import asyncio

        delegate = _FakeDelegate(
            archive={
                "archived": True,
                "detail": {"file_count": 3, "archive_path": "/host/archive/.sillyspec"},
            }
        )
        workspace = type("Ws", (), {"path_source": "daemon-client"})()
        validator = PostScanValidator(
            source_root=tmp_path / "src",
            spec_root=tmp_path / "spec",
            runtime_root=tmp_path / "runtime",
            scan_run_id="dc-3",
            delegate=delegate,
            path_source="daemon-client",
            workspace=workspace,
        )
        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))
        assert any(w.code == "pollution_archived" for w in result.warnings)
        assert result.metadata["pollution_cleanup"]["archived"] is True

    def test_daemon_client_local_config_missing_script(self, tmp_path):
        import asyncio

        delegate = _FakeDelegate(
            local_yaml={"build": "npm run build"},
            package_json={"scripts": {"lint": "eslint ."}},
        )
        workspace = type("Ws", (), {"path_source": "daemon-client"})()
        validator = PostScanValidator(
            source_root=tmp_path / "src",
            spec_root=tmp_path / "spec",
            runtime_root=tmp_path / "runtime",
            scan_run_id="dc-4",
            delegate=delegate,
            path_source="daemon-client",
            workspace=workspace,
        )
        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))
        assert any(
            w.code == "local_config_invalid" and w.details.get("script_name") == "build"
            for w in result.warnings
        )

    def test_server_local_fallback_when_no_delegate(self, tmp_path):
        """path_source=daemon-client 但 delegate/workspace=None → 降级 server-local。"""
        import asyncio

        validator = PostScanValidator(
            source_root=tmp_path / "src",
            spec_root=tmp_path / "spec",
            runtime_root=tmp_path / "runtime",
            scan_run_id="dc-5",
            delegate=None,
            path_source="server-local",
            workspace=None,
        )
        # _is_daemon_client() False → 走 server-local（asyncio.to_thread 不报错）
        result = asyncio.run(validator.validate(agent_output="", agent_exit_code=0))
        assert (
            result.metadata.get("path_source") is None
            or result.metadata.get("path_source") != "daemon-client"
        )
