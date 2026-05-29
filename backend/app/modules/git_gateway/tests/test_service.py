"""Tests for git_gateway service — whitelist, blacklist, redaction, validation."""

from __future__ import annotations

import pytest

from app.modules.git_gateway.service import (
    ALLOWED_OPERATIONS,
    BLOCKED_PATTERNS,
    GitOperationForbidden,
    redact_output,
    validate_operation,
)


class TestWhitelist:
    def test_all_allowed_operations_recognized(self) -> None:
        expected = {
            "status", "diff", "add", "commit", "push", "pull", "fetch",
            "log", "branch", "checkout", "merge", "rebase",
        }
        assert expected == ALLOWED_OPERATIONS

    @pytest.mark.parametrize("op", list(ALLOWED_OPERATIONS))
    def test_allowed_operations_pass(self, op: str) -> None:
        validate_operation(op, [])  # should not raise


class TestBlacklist:
    def test_disallowed_operation_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="not allowed"):
            validate_operation("stash", [])

    def test_push_force_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="Blocked"):
            validate_operation("push", ["--force"])

    def test_reset_hard_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden):
            validate_operation("reset", ["--hard", "HEAD~1"])

    def test_clean_fd_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden):
            validate_operation("clean", ["-fd"])

    def test_reflog_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden):
            validate_operation("reflog", [])

    def test_exec_flag_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="Blocked"):
            validate_operation("log", ["--exec=rm -rf /"])

    def test_unknown_operation_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden):
            validate_operation("clone", [])


class TestRedaction:
    def test_github_pat_redacted(self) -> None:
        out = "Pushing to https://ghp_AbCdEf1234567890abcdefghijklmn@github.com/repo"
        assert "ghp_AbCdEf" not in redact_output(out)
        assert "***REDACTED***" in redact_output(out)

    def test_bearer_token_redacted(self) -> None:
        out = "Authorization: Bearer ghp_AbCdEf1234567890abcdefghijklmn"
        result = redact_output(out)
        assert "ghp_AbCdEf" not in result

    def test_url_token_redacted(self) -> None:
        out = "remote: https://user:ghp_AbCdEf1234567890abcdefghijklmn@github.com/repo"
        result = redact_output(out)
        assert "ghp_AbCdEf" not in result

    def test_github_pat_long_redacted(self) -> None:
        out = "token: github_pat_AAAA1234567890abcdefghijklmnopqrstuv"
        result = redact_output(out)
        assert "github_pat_" not in result

    def test_no_false_positives(self) -> None:
        out = "On branch main\nnothing to commit, working tree clean"
        assert redact_output(out) == out

    def test_truncation(self) -> None:
        long_out = "x" * 100_000
        result = redact_output(long_out)
        assert len(result) < 70_000
        assert "[truncated]" in result

    def test_empty_string(self) -> None:
        assert redact_output("") == ""
