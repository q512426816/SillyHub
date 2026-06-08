"""Post-scan validation service — platform-side guard for scan results.

Ensures scan agent output is properly validated before marking as success:
- Detects pollution in source_root/.sillyspec/docs
- Validates source_commit acquisition
- Intercepts error patterns in agent logs
- Enforces output path constraints
- Performs structured validation instead of trusting agent natural language

author: qinyi
created_at: 2026-06-08
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path

import yaml

from app.core.logging import get_logger

log = get_logger(__name__)


class ScanRunStatus(StrEnum):
    """Final scan run status after platform-side validation."""

    SUCCESS = "success"
    FAILED_POST_CHECK = "failed_post_check"
    COMPLETED_WITH_WARNINGS = "completed_with_warnings"


@dataclass
class ValidationError:
    """A single validation error found during post-scan checks."""

    code: str
    severity: str  # "error" or "warning"
    message: str
    details: dict = field(default_factory=dict)


@dataclass
class PostScanValidationResult:
    """Result of platform-side post-scan validation."""

    status: ScanRunStatus
    errors: list[ValidationError] = field(default_factory=list)
    warnings: list[ValidationError] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    @property
    def has_errors(self) -> bool:
        return len(self.errors) > 0

    @property
    def has_warnings(self) -> bool:
        return len(self.warnings) > 0


# Error patterns that indicate scan failure
ERROR_PATTERNS = [
    r"tool_use_error",
    r"API Error",
    r"rate_limit attempt 10/10",
    r"fatal:",
    r"File has not been read yet",
    r"source_commit.*无法获取|failed to get source_commit",
    r"Permission denied",
    r"command not found",
    r"No such file or directory",
    r"OSError.*errno",
    r"sillyspec.*error",
    r"scan.*failed",
]


def _check_log_patterns(output: str) -> list[ValidationError]:
    """Check agent output for error patterns.

    Only scans stderr/system/tool channels to avoid false positives from
    document content that may mention "API Error" as examples.
    """
    errors = []
    if not output:
        return errors

    # Split by channel markers to avoid scanning document content
    # Agent output format: [CHANNEL] content
    lines = output.split("\n")
    scanned_lines = []

    # Track if we're in a document content block (after [ASSISTANT] or [THINKING])
    in_document_block = False

    for line in lines:
        # Check if this is a channel marker line
        if line.startswith("[ASSISTANT]"):
            in_document_block = True
            continue
        if line.startswith("[THINKING]"):
            in_document_block = True
            continue
        # If we hit another channel marker, exit document block
        if (
            line.startswith("[")
            and not line.startswith("[ASSISTANT]")
            and not line.startswith("[THINKING]")
        ):
            in_document_block = False

        # Skip lines in document blocks
        if in_document_block:
            continue

        # Only scan lines from stderr, system, tool channels
        if any(
            marker in line
            for marker in ["[STDERR]", "[SYSTEM:", "[TOOL_USE]", "[RESULT", "[TOOL_RESULT"]
        ) or not line.startswith("["):
            scanned_lines.append(line)

    scanned_output = "\n".join(scanned_lines)
    output_lower = scanned_output.lower()

    for pattern in ERROR_PATTERNS:
        if re.search(pattern, output_lower, re.IGNORECASE):
            errors.append(
                ValidationError(
                    code="error_pattern_detected",
                    severity="error",
                    message=f"Error pattern found in log output: {pattern}",
                    details={"pattern": pattern},
                )
            )

    return errors


def _get_source_commit(source_root: Path) -> tuple[str | None, str | None]:
    """Get source commit using git -C to avoid cwd dependency.

    Returns:
        (commit_hash, error_message)
    """
    import subprocess

    try:
        proc = subprocess.run(
            ["git", "-C", str(source_root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if proc.returncode == 0:
            commit = proc.stdout.strip()
            if commit:
                return commit, None
        return None, "not_git_repo"
    except subprocess.TimeoutExpired:
        return None, "git_timeout"
    except FileNotFoundError:
        return None, "git_not_found"
    except Exception as exc:
        return None, str(exc)


def _check_source_pollution(source_root: Path, spec_root: Path) -> list[ValidationError]:
    """Check if docs were written to source_root instead of spec_root.

    Args:
        source_root: Original project directory (read-only target).
        spec_root: Platform-managed spec output directory.

    Returns:
        List of validation errors for pollution found.
    """
    errors = []
    source_docs = source_root / ".sillyspec" / "docs"

    if source_docs.exists() and any(source_docs.iterdir()):
        # Found docs in source_root - this is a violation
        rel_path = source_docs.relative_to(source_root)
        errors.append(
            ValidationError(
                code="source_root_pollution",
                severity="error",
                message="Agent wrote docs to source_root instead of spec_root",
                details={
                    "pollution_path": str(rel_path),
                    "expected_path": str(spec_root / ".sillyspec" / "docs"),
                    "hint": "Clean source docs or rerun with strict spec-root mode",
                },
            )
        )

    return errors


def _check_output_paths(spec_root: Path) -> list[ValidationError]:
    """Verify expected files exist under spec_root.

    Returns:
        List of validation errors for missing or misplaced files.
    """
    errors = []
    expected_docs = spec_root / ".sillyspec" / "docs"

    if not expected_docs.exists():
        errors.append(
            ValidationError(
                code="expected_docs_missing",
                severity="error",
                message=f"Expected docs directory not found: {expected_docs}",
                details={"expected_path": str(expected_docs)},
            )
        )
        return errors

    # Check for at least some content
    files = list(expected_docs.rglob("*"))
    if not any(f.is_file() for f in files):
        errors.append(
            ValidationError(
                code="docs_empty",
                severity="error",
                message="Docs directory exists but contains no files",
                details={"path": str(expected_docs)},
            )
        )
        return errors

    # Check for expected 7 scan document types
    # Expected: .sillyspec/docs/{component_key}/scan/{ARCHITECTURE,CONVENTIONS,CONCERNS,INTEGRATIONS,PROJECT,STRUCTURE,TESTING}.md
    expected_doc_types = {
        "ARCHITECTURE",
        "CONVENTIONS",
        "CONCERNS",
        "INTEGRATIONS",
        "PROJECT",
        "STRUCTURE",
        "TESTING",
    }

    # Find all scan directories under docs
    scan_dirs = list(expected_docs.glob("*/scan"))
    if not scan_dirs:
        errors.append(
            ValidationError(
                code="scan_dir_missing",
                severity="error",
                message="No scan directory found under docs",
                details={"expected_pattern": "*/scan"},
            )
        )
        return errors

    # Check each scan directory for expected documents
    for scan_dir in scan_dirs:
        found_types = set()
        for f in scan_dir.glob("*.md"):
            found_types.add(f.stem.upper())

        missing_types = expected_doc_types - found_types
        if missing_types:
            errors.append(
                ValidationError(
                    code="missing_spec_artifacts",
                    severity="error",
                    message=f"Missing expected scan documents: {', '.join(sorted(missing_types))}",
                    details={
                        "scan_dir": str(scan_dir.relative_to(spec_root)),
                        "missing_types": sorted(missing_types),
                        "found_types": sorted(found_types),
                    },
                )
            )

    return errors


def _check_manifest_exists(runtime_root: Path) -> list[ValidationError]:
    """Check if scan manifest was generated.

    Returns:
        List of validation errors for missing manifest.
    """
    errors = []
    manifest_path = runtime_root / "scan-runs" / "manifest.json"

    if not manifest_path.exists():
        errors.append(
            ValidationError(
                code="manifest_missing",
                severity="warning",
                message=f"Scan manifest not found: {manifest_path}",
                details={"expected_path": str(manifest_path)},
            )
        )

    return errors


def _check_local_config(source_root: Path) -> list[ValidationError]:
    """Validate local.yaml configuration against project scripts.

    If local.yaml exists with commands (npm run build/test/lint), verify
    the corresponding scripts exist in package.json.

    Args:
        source_root: Original project directory.

    Returns:
        List of validation warnings for config issues.
    """
    warnings = []
    local_yaml = source_root / ".sillyspec" / "local.yaml"

    if not local_yaml.exists():
        return warnings

    try:
        content = local_yaml.read_text(encoding="utf-8")
        config = yaml.safe_load(content)
    except (OSError, yaml.YAMLError):
        warnings.append(
            ValidationError(
                code="local_config_unreadable",
                severity="warning",
                message="local.yaml exists but cannot be parsed",
                details={"path": str(local_yaml)},
            )
        )
        return warnings

    if not isinstance(config, dict):
        return warnings

    # Check for npm/yarn/pnpm commands
    commands_to_check = []
    for key, value in config.items():
        if isinstance(value, str):
            if any(cmd in value for cmd in ["npm run", "yarn", "pnpm run"]):
                commands_to_check.append((key, value))
        elif isinstance(value, dict) and "commands" in value:
            cmds = value["commands"]
            if isinstance(cmds, list):
                for cmd in cmds:
                    if isinstance(cmd, str) and any(
                        c in cmd for c in ["npm run", "yarn", "pnpm run"]
                    ):
                        commands_to_check.append((key, cmd))

    if not commands_to_check:
        return warnings

    # Try to read package.json to verify scripts
    package_json = source_root / "package.json"
    available_scripts = {}

    if package_json.exists():
        try:
            pkg_content = package_json.read_text(encoding="utf-8")
            pkg_data = json.loads(pkg_content)
            if isinstance(pkg_data, dict):
                available_scripts = pkg_data.get("scripts", {})
        except (OSError, json.JSONDecodeError):
            pass

    # Verify each command
    for key, cmd in commands_to_check:
        # Extract script name from "npm run <script>" or "yarn <script>"
        script_name = None
        for pattern in [
            r"npm run (\S+)",
            r"yarn (\S+)",
            r"pnpm run (\S+)",
            r"pnpm (\S+)",
        ]:
            match = re.search(pattern, cmd)
            if match:
                script_name = match.group(1)
                break

        if script_name and script_name not in available_scripts:
            warnings.append(
                ValidationError(
                    code="local_config_invalid",
                    severity="warning",
                    message=f"local.yaml references missing script: {script_name}",
                    details={
                        "key": key,
                        "command": cmd,
                        "script_name": script_name,
                        "available_scripts": list(available_scripts.keys()),
                    },
                )
            )

    return warnings


class PostScanValidator:
    """Platform-side post-scan validation service."""

    def __init__(
        self,
        source_root: Path,
        spec_root: Path,
        runtime_root: Path,
        scan_run_id: str,
    ) -> None:
        """Initialize validator with scan context.

        Args:
            source_root: Original project directory (read-only).
            spec_root: Platform-managed spec output directory.
            runtime_root: Platform runtime directory for manifests.
            scan_run_id: The scan run ID for validation.
        """
        self.source_root = Path(source_root)
        self.spec_root = Path(spec_root)
        self.runtime_root = Path(runtime_root)
        self.scan_run_id = scan_run_id

    def validate(
        self,
        agent_output: str,
        agent_exit_code: int,
    ) -> PostScanValidationResult:
        """Perform complete platform-side validation.

        Args:
            agent_output: Full agent output (stdout + stderr).
            agent_exit_code: Exit code from agent process.

        Returns:
            PostScanValidationResult with final status and all issues.
        """
        errors: list[ValidationError] = []
        warnings: list[ValidationError] = []
        metadata: dict = {}

        # 1. Check for error patterns in output
        log_errors = _check_log_patterns(agent_output)
        errors.extend(log_errors)

        # 2. Get source_commit (must use git -C)
        commit, commit_error = _get_source_commit(self.source_root)
        if commit_error:
            errors.append(
                ValidationError(
                    code="source_commit_failed",
                    severity="error",
                    message=f"Failed to get source_commit: {commit_error}",
                    details={"source_root": str(self.source_root), "error": commit_error},
                )
            )
        metadata["source_commit"] = commit
        metadata["source_commit_error"] = commit_error

        # 3. Check for pollution in source_root
        pollution_errors = _check_source_pollution(self.source_root, self.spec_root)
        errors.extend(pollution_errors)

        # 4. Verify output paths
        path_errors = _check_output_paths(self.spec_root)
        errors.extend(path_errors)

        # 5. Check manifest existence
        manifest_warnings = _check_manifest_exists(self.runtime_root)
        warnings.extend(manifest_warnings)

        # 6. Check local.yaml configuration
        local_warnings = _check_local_config(self.source_root)
        warnings.extend(local_warnings)

        # 6. Determine final status
        status = self._determine_status(
            agent_exit_code=agent_exit_code,
            errors=errors,
            warnings=warnings,
        )

        metadata["validated_at"] = datetime.now(UTC).isoformat()
        metadata["scan_run_id"] = self.scan_run_id

        result = PostScanValidationResult(
            status=status,
            errors=errors,
            warnings=warnings,
            metadata=metadata,
        )

        log.info(
            "post_scan_validation_complete",
            scan_run_id=self.scan_run_id,
            status=status.value,
            error_count=len(errors),
            warning_count=len(warnings),
            source_commit=commit,
        )

        return result

    def _determine_status(
        self,
        agent_exit_code: int,
        errors: list[ValidationError],
        warnings: list[ValidationError],
    ) -> ScanRunStatus:
        """Determine final status based on validation results.

        Rules:
        - If agent exited with non-zero, always FAILED_POST_CHECK
        - If source_root pollution detected, FAILED_POST_CHECK
        - If source_commit failed, FAILED_POST_CHECK
        - If any error pattern detected, FAILED_POST_CHECK
        - If only warnings, COMPLETED_WITH_WARNINGS
        - If clean, SUCCESS
        """
        # Agent exit code non-zero → failed
        if agent_exit_code != 0:
            return ScanRunStatus.FAILED_POST_CHECK

        # Check for specific error codes
        error_codes = {e.code for e in errors}

        if "source_root_pollution" in error_codes:
            return ScanRunStatus.FAILED_POST_CHECK

        if "source_commit_failed" in error_codes:
            return ScanRunStatus.FAILED_POST_CHECK

        if "error_pattern_detected" in error_codes:
            return ScanRunStatus.FAILED_POST_CHECK

        if "expected_docs_missing" in error_codes:
            return ScanRunStatus.FAILED_POST_CHECK

        if "docs_empty" in error_codes:
            return ScanRunStatus.FAILED_POST_CHECK

        # Only warnings → completed with warnings
        if warnings:
            return ScanRunStatus.COMPLETED_WITH_WARNINGS

        # Clean success
        return ScanRunStatus.SUCCESS


def validate_resume_state(runtime_root: Path, scan_run_id: str) -> dict:
    """Check if scan was resumed and from which step.

    Args:
        runtime_root: Platform runtime directory.
        scan_run_id: The scan run ID.

    Returns:
        Dict with resumed_from_step, skipped_steps, is_resume flags.
    """
    result = {
        "is_resume": False,
        "resumed_from_step": None,
        "skipped_steps": [],
    }

    # Check for resume marker file
    resume_marker = runtime_root / "scan-runs" / scan_run_id / "resume.json"
    if resume_marker.exists():
        try:
            data = json.loads(resume_marker.read_text(encoding="utf-8"))
            result["is_resume"] = True
            result["resumed_from_step"] = data.get("current_step")
            result["skipped_steps"] = data.get("skipped_steps", [])
        except (OSError, json.JSONDecodeError):
            pass

    return result
