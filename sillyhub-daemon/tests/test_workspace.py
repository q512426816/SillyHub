"""Tests for WorkspaceManager: clone, pull, collect_diff, clean."""

from __future__ import annotations

from pathlib import Path

import pytest

from sillyhub_daemon.workspace import WorkspaceManager, _parse_shortstat


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def base_dir(tmp_path):
    """Provide a temporary base directory for workspaces."""
    d = tmp_path / "workspaces"
    d.mkdir()
    return d


@pytest.fixture
def manager(base_dir):
    return WorkspaceManager(base_dir=base_dir)


@pytest.fixture
def git_repo(tmp_path):
    """Create a bare git repo and return (repo_path, repo_url).

    The repo has one commit with a file ``hello.txt`` on the ``main`` branch.
    """
    repo_dir = tmp_path / "origin"
    repo_dir.mkdir()

    # Init repo with an initial commit.
    _git(["init"], cwd=repo_dir)
    _git(["config", "user.email", "test@test.com"], cwd=repo_dir)
    _git(["config", "user.name", "Test"], cwd=repo_dir)
    # Ensure default branch is main.
    _git(["checkout", "-b", "main"], cwd=repo_dir)
    (repo_dir / "hello.txt").write_text("hello world")
    _git(["add", "hello.txt"], cwd=repo_dir)
    _git(["commit", "-m", "initial"], cwd=repo_dir)

    return repo_dir


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _git(args: list[str], *, cwd: Path) -> str:
    """Run a git command synchronously (for test setup)."""
    import subprocess

    result = subprocess.run(
        ["git"] + args,
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {args} failed: {result.stderr}")
    return result.stdout


# ---------------------------------------------------------------------------
# __init__
# ---------------------------------------------------------------------------


class TestInit:
    def test_creates_base_dir(self, tmp_path):
        target = tmp_path / "nested" / "dir"
        assert not target.exists()
        WorkspaceManager(base_dir=target)
        assert target.exists()

    def test_existing_base_dir_ok(self, base_dir):
        mgr = WorkspaceManager(base_dir=base_dir)
        assert mgr._base_dir == base_dir


# ---------------------------------------------------------------------------
# get_workspace_path
# ---------------------------------------------------------------------------


class TestGetWorkspacePath:
    def test_returns_path_under_base(self, manager, base_dir):
        p = manager.get_workspace_path("proj-42")
        assert p == base_dir / "proj-42"


# ---------------------------------------------------------------------------
# prepare_workspace -- clone
# ---------------------------------------------------------------------------


class TestPrepareWorkspaceClone:
    @pytest.mark.asyncio
    async def test_clones_from_remote(self, manager, git_repo):
        ws = await manager.prepare_workspace(
            "my-project",
            repo_url=str(git_repo),
            branch="main",
        )
        assert ws.exists()
        assert (ws / ".git").is_dir()
        assert (ws / "hello.txt").read_text() == "hello world"

    @pytest.mark.asyncio
    async def test_creates_empty_dir_without_url(self, manager):
        ws = await manager.prepare_workspace("empty-ws")
        assert ws.exists()
        assert ws.is_dir()
        assert not (ws / ".git").exists()

    @pytest.mark.asyncio
    async def test_clone_fails_with_bad_url(self, manager):
        with pytest.raises(RuntimeError, match="git clone"):
            await manager.prepare_workspace(
                "bad",
                repo_url="/nonexistent/path.git",
                branch="main",
            )


# ---------------------------------------------------------------------------
# prepare_workspace -- pull (update existing)
# ---------------------------------------------------------------------------


class TestPrepareWorkspacePull:
    @pytest.mark.asyncio
    async def test_pulls_existing_repo(self, manager, git_repo, base_dir):
        # First clone.
        ws = await manager.prepare_workspace(
            "pull-test",
            repo_url=str(git_repo),
            branch="main",
        )
        assert (ws / "hello.txt").exists()

        # Make a new commit in origin.
        (git_repo / "new_file.txt").write_text("new content")
        _git(["add", "new_file.txt"], cwd=git_repo)
        _git(["commit", "-m", "add new file"], cwd=git_repo)

        # Second call should pull.
        ws2 = await manager.prepare_workspace(
            "pull-test",
            repo_url=str(git_repo),
            branch="main",
        )
        assert ws2 == ws
        assert (ws / "new_file.txt").read_text() == "new content"


# ---------------------------------------------------------------------------
# collect_diff
# ---------------------------------------------------------------------------


class TestCollectDiff:
    @pytest.mark.asyncio
    async def test_no_changes(self, manager, git_repo):
        ws = await manager.prepare_workspace(
            "diff-test",
            repo_url=str(git_repo),
            branch="main",
        )
        result = await manager.collect_diff(ws)
        assert result["patch"] == ""
        assert result["files_changed"] == 0
        assert result["insertions"] == 0
        assert result["deletions"] == 0
        assert result["stats"] == ""

    @pytest.mark.asyncio
    async def test_with_changes(self, manager, git_repo):
        ws = await manager.prepare_workspace(
            "diff-changes",
            repo_url=str(git_repo),
            branch="main",
        )

        # Modify file.
        (ws / "hello.txt").write_text("modified content")

        result = await manager.collect_diff(ws)
        assert result["patch"] != ""
        assert result["files_changed"] >= 1
        assert "hello.txt" in result["patch"]

    @pytest.mark.asyncio
    async def test_stats_parsed(self, manager, git_repo):
        ws = await manager.prepare_workspace(
            "diff-stats",
            repo_url=str(git_repo),
            branch="main",
        )

        # Create a new file and modify existing.
        (ws / "new.txt").write_text("added line\n")
        (ws / "hello.txt").write_text("changed\n")

        result = await manager.collect_diff(ws)
        assert result["files_changed"] >= 1
        assert result["insertions"] >= 1
        assert result["stats"] != ""


# ---------------------------------------------------------------------------
# clean_workspace
# ---------------------------------------------------------------------------


class TestCleanWorkspace:
    @pytest.mark.asyncio
    async def test_removes_directory(self, manager, git_repo):
        ws = await manager.prepare_workspace(
            "clean-me",
            repo_url=str(git_repo),
            branch="main",
        )
        assert ws.exists()

        await manager.clean_workspace("clean-me")
        assert not ws.exists()

    @pytest.mark.asyncio
    async def test_noop_for_nonexistent(self, manager):
        # Should not raise.
        await manager.clean_workspace("does-not-exist")


# ---------------------------------------------------------------------------
# _parse_shortstat (unit test, no git needed)
# ---------------------------------------------------------------------------


class TestParseShortstat:
    def test_full_stats(self):
        text = " 3 files changed, 10 insertions(+), 2 deletions(-)"
        assert _parse_shortstat(text) == (3, 10, 2)

    def test_only_insertions(self):
        text = " 1 file changed, 5 insertions(+)"
        assert _parse_shortstat(text) == (1, 5, 0)

    def test_only_deletions(self):
        text = " 2 files changed, 3 deletions(-)"
        assert _parse_shortstat(text) == (2, 0, 3)

    def test_empty(self):
        assert _parse_shortstat("") == (0, 0, 0)

    def test_single_file(self):
        text = " 1 file changed, 1 insertion(+), 1 deletion(-)"
        assert _parse_shortstat(text) == (1, 1, 1)
