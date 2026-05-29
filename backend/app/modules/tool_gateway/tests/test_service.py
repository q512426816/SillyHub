"""Tests for tool_gateway service — path validation, shell validation."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.modules.tool_gateway.service import (
    ToolOperationForbidden,
    ToolPathForbidden,
    validate_path,
    validate_shell_command,
)


class TestValidatePath:
    def test_valid_path_within_root(self, tmp_path: Path) -> None:
        target = validate_path(tmp_path, "src/main.py", [])
        assert target == (tmp_path / "src/main.py").resolve()

    def test_path_traversal_blocked(self, tmp_path: Path) -> None:
        with pytest.raises(ToolPathForbidden, match="escapes"):
            validate_path(tmp_path, "../../etc/passwd", [])

    def test_absolute_path_traversal_blocked(self, tmp_path: Path) -> None:
        with pytest.raises(ToolPathForbidden, match="escapes"):
            validate_path(tmp_path, "/etc/passwd", [])

    def test_allowed_paths_match(self, tmp_path: Path) -> None:
        validate_path(tmp_path, "src/app.py", ["src/"])

    def test_allowed_paths_subdir(self, tmp_path: Path) -> None:
        validate_path(tmp_path, "src/utils/helper.py", ["src/"])

    def test_allowed_paths_exact_match(self, tmp_path: Path) -> None:
        validate_path(tmp_path, "src", ["src"])

    def test_allowed_paths_no_match(self, tmp_path: Path) -> None:
        with pytest.raises(ToolPathForbidden, match="allowed_paths"):
            validate_path(tmp_path, "tests/test_foo.py", ["src/"])

    def test_empty_allowed_paths_allows_all(self, tmp_path: Path) -> None:
        validate_path(tmp_path, "any/path/file.py", [])

    def test_dot_path_resolved(self, tmp_path: Path) -> None:
        target = validate_path(tmp_path, ".", [])
        assert target == tmp_path.resolve()


class TestShellValidation:
    def test_sudo_blocked(self) -> None:
        with pytest.raises(ToolOperationForbidden, match="Blocked"):
            validate_shell_command("sudo", ["rm", "-rf", "/"])

    def test_rm_rf_root_blocked(self) -> None:
        with pytest.raises(ToolOperationForbidden, match="Blocked"):
            validate_shell_command("rm", ["-rf", "/"])

    def test_mkfs_blocked(self) -> None:
        with pytest.raises(ToolOperationForbidden, match="Blocked"):
            validate_shell_command("mkfs", ["/dev/sda1"])

    def test_dd_blocked(self) -> None:
        with pytest.raises(ToolOperationForbidden, match="Blocked"):
            validate_shell_command("dd", ["if=/dev/zero", "of=/dev/sda"])

    def test_shutdown_blocked(self) -> None:
        with pytest.raises(ToolOperationForbidden, match="Blocked"):
            validate_shell_command("shutdown", ["-h", "now"])

    def test_nc_blocked(self) -> None:
        with pytest.raises(ToolOperationForbidden, match="Blocked"):
            validate_shell_command("nc", ["-l", "4444"])

    def test_crontab_blocked(self) -> None:
        with pytest.raises(ToolOperationForbidden, match="Blocked"):
            validate_shell_command("crontab", ["-e"])

    def test_safe_command_passes(self) -> None:
        validate_shell_command("ls", ["-la", "src/"])
        validate_shell_command("python", ["-m", "pytest"])
        validate_shell_command("echo", ["hello"])
        validate_shell_command("grep", ["-r", "pattern", "src/"])

    def test_safe_rm_in_subdir(self) -> None:
        validate_shell_command("rm", ["-rf", "build/"])
