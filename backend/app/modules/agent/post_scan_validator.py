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

import asyncio
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app.core.logging import get_logger

if TYPE_CHECKING:
    from app.modules.daemon.host_fs import HostFsDelegate
    from app.modules.workspace.model import Workspace

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
    errors: list[ValidationError] = []
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


def _check_output_paths(spec_root: Path) -> list[ValidationError]:
    """Verify expected files exist under spec_root.

    Returns:
        List of validation errors for missing or misplaced files.
    """
    errors = []
    expected_docs = spec_root / "docs"  # D-005: 扁平根（无 .sillyspec 包裹）

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


class PostScanValidator:
    """Platform-side post-scan validation service."""

    def __init__(
        self,
        source_root: Path,
        spec_root: Path,
        runtime_root: Path,
        scan_run_id: str,
        *,
        delegate: HostFsDelegate | None = None,
        workspace: Workspace | None = None,
    ) -> None:
        """Initialize validator with scan context.

        Args:
            source_root: Original project directory (read-only).
            spec_root: Platform-managed spec output directory.
            runtime_root: Platform runtime directory for manifests.
            scan_run_id: The scan run ID for validation.
            delegate: :class:`HostFsDelegate`。validator 委托 git rev-parse /
                pollution archive / package.json reads 到绑定 daemon（D-009 方案 B —
                daemon exposes primitives only；pollution 判定 / 状态机 / ERROR_PATTERNS
                留 backend）。
            workspace: workspace 实体，delegate.* RPC 需要。
        """
        self.source_root = Path(source_root)
        self.spec_root = Path(spec_root)
        self.runtime_root = Path(runtime_root)
        self.scan_run_id = scan_run_id
        self.delegate = delegate
        self.workspace = workspace

    async def validate(
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

        D-007@2026-07-10（remove-server-local-workspace-mode）：单一 daemon-client
        模式，validate 永远走 ``_validate_daemon_client``（原 server-local
        subprocess/shutil 路径已删）。HostFsDelegate 经 RPC 取 commit / 污染归档 /
        package.json，校验逻辑（ERROR_PATTERNS / 状态机）仍留 backend 编排。
        """
        return await self._validate_daemon_client(agent_output, agent_exit_code)

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
        - If any error pattern detected, FAILED_POST_CHECK
        - If expected docs missing/empty, FAILED_POST_CHECK
        - If only warnings (incl. source_commit unavailable for non-git projects),
          COMPLETED_WITH_WARNINGS
        - If clean, SUCCESS

        ql-20260617-014：source_commit 失败不再视为 error（非 git 仓库合法），
        改在 validate() 中作 warning 处理，本函数不再判 source_commit_failed。
        """
        # Agent exit code non-zero → failed
        if agent_exit_code != 0:
            return ScanRunStatus.FAILED_POST_CHECK

        # Check for specific error codes
        error_codes = {e.code for e in errors}

        if "source_root_pollution" in error_codes:
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

    async def _validate_daemon_client(
        self,
        agent_output: str,
        agent_exit_code: int,
    ) -> PostScanValidationResult:
        """daemon-client 分支（task-07 / D-009 方案 B）。

        HostFsDelegate 仅暴露原语（git_rev_parse / pollution_archive /
        read_package_json），判定逻辑（ERROR_PATTERNS / 污染清点 / 状态机 /
        _determine_status）仍留 backend 编排，避免校验规则双端重复。

        D-006：delegate RPC 失败返回语义安全降级值（commit→None /
        pollution_archive→{archived:False} / package.json→None），绝不抛；
        backend 拿到降级值后按「校验跳过 / warning」处理，不阻塞 lease。

        注：daemon-client 模式下 source_root 在客户端机器，backend 无法直查
        本地污染（探本地 source_root/.sillyspec/docs 恒 False），污染检测的真实
        落点由 daemon 侧 pollution_archive 原语决定（archive 行为已隐含污染
        存在性判定）。
        """
        assert self.delegate is not None  # validate() 单一入口已保证
        assert self.workspace is not None

        errors: list[ValidationError] = []
        warnings: list[ValidationError] = []
        metadata: dict = {}

        # 1. Check for error patterns in output（纯字符串，与路径无关，留 backend）
        log_errors = _check_log_patterns(agent_output)
        errors.extend(log_errors)

        # 2. Get source_commit via delegate RPC（D-006 降级 None → warning）
        commit = await self.delegate.git_rev_parse(self.workspace, "HEAD")
        commit_error: str | None = None if commit else "git_rev_parse_unavailable"
        if not commit:
            warnings.append(
                ValidationError(
                    code="source_commit_unavailable",
                    severity="warning",
                    message=f"source_commit unavailable: {commit_error}",
                    details={
                        "source_root": str(self.source_root),
                        "error": commit_error,
                    },
                )
            )
        metadata["source_commit"] = commit
        metadata["source_commit_error"] = commit_error

        # 3 + 3.5. Pollution archive via delegate RPC（合并检测+清理：原语
        # 既已 archive 即隐含污染存在；archive 不可达时降级 archived=False，
        # backend 不强行报 source_root_pollution error，避免误报）。file_count
        # / archive_path 落 detail 供下游 warning 消费。
        cleanup = await self.delegate.pollution_archive(self.workspace, str(self.source_root))
        metadata["pollution_cleanup"] = cleanup
        if cleanup.get("archived"):
            detail = cleanup.get("detail") or {}
            file_count = detail.get("file_count") if isinstance(detail, dict) else None
            archive_path = detail.get("archive_path") if isinstance(detail, dict) else None
            warnings.append(
                ValidationError(
                    code="pollution_archived",
                    severity="warning",
                    message=(
                        f"Moved {file_count or 0} polluted files to {archive_path or 'archive'}"
                    ),
                    details=cleanup,
                )
            )

        # 4. Verify output paths（spec_root 在 platform-managed 模式下落到
        # backend 容器可访问的 specDir，保留 backend 直查；与原 server-local
        # 一致——spec_root 本就是平台托管目录，非宿主路径）。
        path_errors = await asyncio.to_thread(_check_output_paths, self.spec_root)
        errors.extend(path_errors)

        # 5. Check manifest existence（runtime_root 同 spec_root 属平台侧）。
        manifest_warnings = await asyncio.to_thread(_check_manifest_exists, self.runtime_root)
        warnings.extend(manifest_warnings)

        # 6. Check local.yaml configuration via delegate RPC（取 package.json
        # scripts 经 read_package_json 原语；local.yaml 解析逻辑留 backend
        # 编排，scripts map 缺失时 warning）。
        local_warnings = await self._check_local_config_daemon_client()
        warnings.extend(local_warnings)

        # 7. Determine final status（状态机留 backend 不动）
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

    async def _check_local_config_daemon_client(self) -> list[ValidationError]:
        """daemon-client 分支的 local.yaml script 校验（D-009 方案 B）。

        package.json scripts 经 delegate.read_package_json 原语取回，校验
        逻辑（commands_to_check / script_name 提取 / missing script warning）
        留 backend 编排，仅数据源换 RPC。
        local.yaml 本身经 delegate.read_local_yaml 原语取回。
        """
        assert self.delegate is not None
        assert self.workspace is not None

        config = await self.delegate.read_local_yaml(self.workspace)
        if not isinstance(config, dict):
            return []

        commands_to_check: list[tuple[str, str]] = []
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
            return []

        # package.json scripts 经 RPC 取回（D-006 降级 None → 跳过校验）
        pkg_data = await self.delegate.read_package_json(self.workspace)
        available_scripts: dict[str, Any] = {}
        if isinstance(pkg_data, dict):
            scripts = pkg_data.get("scripts", {})
            if isinstance(scripts, dict):
                available_scripts = scripts

        warnings: list[ValidationError] = []
        for key, cmd in commands_to_check:
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


def validate_resume_state(runtime_root: Path, scan_run_id: str) -> dict:
    """Check if scan was resumed and from which step.

    Args:
        runtime_root: Platform runtime directory.
        scan_run_id: The scan run ID.

    Returns:
        Dict with resumed_from_step, skipped_steps, is_resume flags.
    """
    result: dict[str, Any] = {
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
