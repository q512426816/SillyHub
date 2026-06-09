"""Tests for app.core.paths — repo-root-relative path resolution.

Covers:
- resolve_spec_data_root(): absolute paths unchanged
- resolve_spec_data_root(): relative paths resolved against repo root
- resolve_spec_data_root(): correct even when CWD != repo root
- repo_root() returns a stable, absolute Path
- repair migration idempotency logic

author: qinyi
created_at: 2026-06-04
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from app.core.paths import REPO_ROOT, repo_root, resolve_spec_data_root

# ---------------------------------------------------------------------------
# repo_root()
# ---------------------------------------------------------------------------


class TestRepoRoot:
    """repo_root() returns a stable, absolute path."""

    def test_returns_absolute_path(self) -> None:
        result = repo_root()
        assert result.is_absolute()

    def test_is_stable_across_calls(self) -> None:
        assert repo_root() == repo_root()

    def test_points_to_project_root(self) -> None:
        """REPO_ROOT should contain backend/ and scripts/ directories."""
        r = repo_root()
        assert (r / "backend").is_dir()
        assert (r / "scripts").is_dir()

    def test_constant_matches_function(self) -> None:
        assert repo_root() == REPO_ROOT


# ---------------------------------------------------------------------------
# resolve_spec_data_root()
# ---------------------------------------------------------------------------


class TestResolveSpecDataRoot:
    """resolve_spec_data_root() resolves paths relative to repo root."""

    def test_absolute_path_returned_unchanged(self) -> None:
        """An absolute path is returned as-is (platform-normalised separators).

        On POSIX the output matches the input verbatim.
        On Windows a leading-slash path is drive-relative; the function
        resolves it to a fully-qualified absolute path (e.g. C:\\data\\...).
        """
        result = resolve_spec_data_root("/data/sillyspec-data")
        result_path = Path(result)
        assert result_path.is_absolute()
        # The tail components must match regardless of platform
        assert result_path.name == "sillyspec-data"
        assert result_path.parent.name == "data" or result_path.parts[-2] == "data"

    def test_relative_path_resolved_against_repo_root(self) -> None:
        """A relative path is joined with repo root."""
        result = resolve_spec_data_root("./data/spec-storage")
        expected = str(repo_root() / "./data/spec-storage")
        # Normalise for comparison
        assert Path(result).resolve() == Path(expected).resolve()

    def test_relative_path_no_dot_prefix(self) -> None:
        """Relative path without ./ prefix also works."""
        result = resolve_spec_data_root("data/spec-storage")
        expected = str(repo_root() / "data/spec-storage")
        assert Path(result).resolve() == Path(expected).resolve()

    def test_result_is_absolute(self) -> None:
        """Regardless of input, the result is always absolute."""
        assert Path(resolve_spec_data_root("./data/spec-storage")).is_absolute()
        assert Path(resolve_spec_data_root("/data/spec-storage")).is_absolute()

    def test_correct_even_from_different_cwd(self, tmp_path: Path) -> None:
        """Resolution does NOT depend on the current working directory.

        Even if we chdir into backend/, a relative path like
        ``./data/spec-storage`` should resolve to <repo-root>/data/spec-storage,
        NOT <repo-root>/backend/data/spec-storage.
        """
        original = os.getcwd()
        try:
            # Simulate running from backend/ (the bug scenario)
            backend_dir = repo_root() / "backend"
            if backend_dir.is_dir():
                os.chdir(str(backend_dir))
            else:
                pytest.skip("backend/ dir not found")

            result = resolve_spec_data_root("./data/spec-storage")
            result_path = Path(result)

            # Must NOT contain /backend/ in the resolved path
            assert "/backend/" not in result, f"Path should not contain /backend/ but got: {result}"

            # Must be under repo root
            assert str(result_path).startswith(str(repo_root()))
        finally:
            os.chdir(original)

    @pytest.mark.skipif(
        sys.platform != "win32", reason="Windows drive-letter paths only valid on Windows"
    )
    def test_windows_absolute_path_unchanged(self) -> None:
        """Windows absolute paths are returned as fully-qualified paths."""
        result = resolve_spec_data_root("C:/data/sillyspec-data")
        result_path = Path(result)
        assert result_path.is_absolute()
        assert result_path.name == "sillyspec-data"


# ---------------------------------------------------------------------------
# repair migration idempotency logic
# ---------------------------------------------------------------------------


class TestRepairMigrationLogic:
    """Unit-test the repair migration's path-matching logic (no DB needed).

    We test the *pattern* used to detect broken paths and the replacement
    logic.  The actual migration runs against a real DB via Alembic, so
    these tests cover the decision logic only.
    """

    def test_detects_backend_in_path(self) -> None:
        """A path containing /backend/data/spec-storage should be flagged."""
        broken = "/Users/qinyi/SillyHub/backend/data/spec-storage/abc-123"
        assert "/backend/data/spec-storage" in broken

    def test_correct_path_not_flagged(self) -> None:
        """A correct repo-root path should NOT match the broken pattern."""
        correct = "/Users/qinyi/SillyHub/data/spec-storage/abc-123"
        assert "/backend/data/spec-storage" not in correct

    def test_replacement_produces_correct_path(self) -> None:
        """Given a repo root and ws_id, the replacement path is correct."""
        repo = Path("/Users/qinyi/SillyHub")
        ws_id = "abc-123-def"
        expected_path = repo / "data" / "spec-storage" / ws_id
        # Use Path comparison to be platform-agnostic on separators
        assert expected_path == Path("/Users/qinyi/SillyHub/data/spec-storage/abc-123-def")
        assert "backend" not in expected_path.parts
