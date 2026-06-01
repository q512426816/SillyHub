"""Tests for diff_collector module — task-06."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.agent.diff_collector import (
    ZERO_DIFF_RESULT,
    _parse_stat_numbers,
    collect_diff,
)

# ---------------------------------------------------------------------------
# _parse_stat_numbers
# ---------------------------------------------------------------------------


class TestParseStatNumbers:
    def test_normal(self):
        text = "3 files changed, 10 insertions(+), 2 deletions(-)"
        assert _parse_stat_numbers(text) == (3, 10, 2)

    def test_only_insertions(self):
        text = "1 file changed, 5 insertions(+)"
        assert _parse_stat_numbers(text) == (1, 5, 0)

    def test_only_deletions(self):
        text = "1 file changed, 3 deletions(-)"
        assert _parse_stat_numbers(text) == (1, 0, 3)

    def test_no_changes(self):
        assert _parse_stat_numbers("") == (0, 0, 0)

    def test_zero_files_changed(self):
        text = "0 files changed"
        assert _parse_stat_numbers(text) == (0, 0, 0)

    def test_multiline_picks_last(self):
        lines = (
            " src/foo.py | 5 +++--\n"
            " src/bar.py | 10 +++++++++-\n"
            " 2 files changed, 10 insertions(+), 2 deletions(-)"
        )
        assert _parse_stat_numbers(lines) == (2, 10, 2)


# ---------------------------------------------------------------------------
# collect_diff
# ---------------------------------------------------------------------------


def _make_fake_proc(
    returncode: int = 0,
    stdout: bytes = b"",
    stderr: bytes = b"",
) -> MagicMock:
    """Build a fake subprocess that resolves communicate() immediately."""
    proc = MagicMock()
    proc.returncode = returncode
    proc.communicate = AsyncMock(return_value=(stdout, stderr))
    return proc


class TestCollectDiff:
    @pytest.mark.asyncio
    async def test_no_git_dir(self, tmp_path: Path):
        """repo_dir/.git doesn't exist → ZERO_DIFF_RESULT."""
        result = await collect_diff(tmp_path)
        assert result is ZERO_DIFF_RESULT

    @pytest.mark.asyncio
    async def test_no_changes(self, tmp_path: Path):
        """.git exists, git diff returns empty output."""
        (tmp_path / "repo").mkdir()
        (tmp_path / "repo" / ".git").mkdir()

        fake_proc = _make_fake_proc(stdout=b"")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            result = await collect_diff(tmp_path)

        assert result.files_changed == 0
        assert result.stat_summary == ""

    @pytest.mark.asyncio
    async def test_with_changes(self, tmp_path: Path):
        """Normal diff with changes parsed correctly."""
        (tmp_path / "repo").mkdir()
        (tmp_path / "repo" / ".git").mkdir()

        stat_output = b" foo.py | 5 +++--\n 1 file changed, 3 insertions(+), 2 deletions(-)\n"
        diff_output = b"diff --git a/foo.py b/foo.py\n--- a/foo.py\n+++ b/foo.py\n"

        call_count = 0

        async def _fake_exec(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _make_fake_proc(stdout=stat_output)
            return _make_fake_proc(stdout=diff_output)

        with (
            patch("asyncio.create_subprocess_exec", side_effect=_fake_exec),
            patch(
                "app.modules.agent.diff_collector.redact_output",
                side_effect=lambda x: x,
            ),
        ):
            result = await collect_diff(tmp_path)

        assert result.files_changed == 1
        assert result.insertions == 3
        assert result.deletions == 2
        assert "foo.py" in result.full_diff

    @pytest.mark.asyncio
    async def test_large_truncation(self, tmp_path: Path):
        """Diff exceeding max_diff_size gets truncated."""
        (tmp_path / "repo").mkdir()
        (tmp_path / "repo" / ".git").mkdir()

        big_diff = b"x" * 100_000
        stat_output = b"1 file changed, 999 insertions(+)\n"

        call_count = 0

        async def _fake_exec(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _make_fake_proc(stdout=stat_output)
            return _make_fake_proc(stdout=big_diff)

        with (
            patch("asyncio.create_subprocess_exec", side_effect=_fake_exec),
            patch(
                "app.modules.agent.diff_collector.redact_output",
                side_effect=lambda x: x,
            ),
        ):
            result = await collect_diff(tmp_path, max_diff_size=1000)

        assert result.full_diff.endswith("...[truncated]")
        assert len(result.full_diff) < 100_000

    @pytest.mark.asyncio
    async def test_stat_succeeds_diff_fails(self, tmp_path: Path):
        """stat returncode=0, diff returncode=1 → stat kept, full_diff empty."""
        (tmp_path / "repo").mkdir()
        (tmp_path / "repo" / ".git").mkdir()

        stat_output = b"1 file changed, 5 insertions(+)\n"

        call_count = 0

        async def _fake_exec(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _make_fake_proc(stdout=stat_output)
            return _make_fake_proc(returncode=1, stdout=b"")

        with (
            patch("asyncio.create_subprocess_exec", side_effect=_fake_exec),
            patch(
                "app.modules.agent.diff_collector.redact_output",
                side_effect=lambda x: x,
            ),
        ):
            result = await collect_diff(tmp_path)

        assert result.stat_summary != ""
        assert result.full_diff == ""
        assert result.files_changed == 0

    @pytest.mark.asyncio
    async def test_git_not_found(self, tmp_path: Path):
        """create_subprocess_exec raises FileNotFoundError."""
        (tmp_path / "repo").mkdir()
        (tmp_path / "repo" / ".git").mkdir()

        with patch(
            "asyncio.create_subprocess_exec",
            side_effect=FileNotFoundError("git not found"),
        ):
            result = await collect_diff(tmp_path)

        assert result is ZERO_DIFF_RESULT

    @pytest.mark.asyncio
    async def test_timeout(self, tmp_path: Path):
        """communicate raises TimeoutError."""
        (tmp_path / "repo").mkdir()
        (tmp_path / "repo" / ".git").mkdir()

        fake_proc = MagicMock()
        fake_proc.communicate = AsyncMock(side_effect=TimeoutError)

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            result = await collect_diff(tmp_path)

        assert result is ZERO_DIFF_RESULT

    @pytest.mark.asyncio
    async def test_oserror(self, tmp_path: Path):
        """create_subprocess_exec raises OSError."""
        (tmp_path / "repo").mkdir()
        (tmp_path / "repo" / ".git").mkdir()

        with patch(
            "asyncio.create_subprocess_exec",
            side_effect=OSError("permission denied"),
        ):
            result = await collect_diff(tmp_path)

        assert result is ZERO_DIFF_RESULT

    @pytest.mark.asyncio
    async def test_redaction_called(self, tmp_path: Path):
        """Verify redact_output is called on both stat and diff."""
        (tmp_path / "repo").mkdir()
        (tmp_path / "repo" / ".git").mkdir()

        stat_output = b"1 file changed, 1 insertion(+)\n"
        diff_output = b"diff with ghp_SECRET_TOKEN_HERE\n"

        call_count = 0

        async def _fake_exec(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _make_fake_proc(stdout=stat_output)
            return _make_fake_proc(stdout=diff_output)

        with (
            patch("asyncio.create_subprocess_exec", side_effect=_fake_exec),
            patch(
                "app.modules.agent.diff_collector.redact_output",
                return_value="REDACTED",
            ) as mock_redact,
        ):
            await collect_diff(tmp_path)

            assert mock_redact.call_count >= 1

    def test_zero_result_is_zero(self):
        assert ZERO_DIFF_RESULT.stat_summary == ""
        assert ZERO_DIFF_RESULT.full_diff == ""
        assert ZERO_DIFF_RESULT.files_changed == 0
        assert ZERO_DIFF_RESULT.insertions == 0
        assert ZERO_DIFF_RESULT.deletions == 0

    @pytest.mark.asyncio
    async def test_stat_nonzero_returncode(self, tmp_path: Path):
        """git diff --stat returns non-zero → ZERO_DIFF_RESULT."""
        (tmp_path / "repo").mkdir()
        (tmp_path / "repo" / ".git").mkdir()

        fake_proc = _make_fake_proc(returncode=128, stdout=b"fatal: not a git repo")

        with patch("asyncio.create_subprocess_exec", return_value=fake_proc):
            result = await collect_diff(tmp_path)

        assert result is ZERO_DIFF_RESULT
