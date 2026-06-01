"""Tests for ExecEnvBuilder — filesystem isolation."""

from __future__ import annotations

import stat
from pathlib import Path

import pytest

from app.modules.worktree.exec_env import ExecEnvBuilder


@pytest.fixture()
def builder(tmp_path: Path) -> ExecEnvBuilder:
    return ExecEnvBuilder(base_dir=tmp_path)


def _ids() -> dict[str, str]:
    return {
        "workspace_id": "ws-001",
        "component_id": "comp-001",
        "user_id": "user-001",
        "change_id": "chg-001",
        "task_id": "task-001",
        "run_id": "run-001",
    }


def test_lease_root_structure(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    ids = _ids()
    root = builder.lease_root(**ids)
    assert (
        root == tmp_path / "ws-001/components/comp-001/worktrees/user-001/chg-001/task-001/run-001"
    )


def test_bare_repo_path(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    path = builder.bare_repo_path("ws-001", "comp-001")
    assert path == tmp_path / "ws-001/components/comp-001/.repo-bare"


def test_create_directories(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    ids = _ids()
    root = builder.lease_root(**ids)
    builder.create_directories(root)
    assert builder.repo_dir(root).is_dir()
    assert builder.home_dir(root).is_dir()


def test_write_gitconfig(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    ids = _ids()
    root = builder.lease_root(**ids)
    root.mkdir(parents=True)
    builder.write_gitconfig(root, "octocat", "octo@example.com")
    content = builder.gitconfig_path(root).read_text()
    assert "name = octocat" in content
    assert "email = octo@example.com" in content


def test_write_gitconfig_none_fields(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    ids = _ids()
    root = builder.lease_root(**ids)
    root.mkdir(parents=True)
    builder.write_gitconfig(root, None, None)
    assert not builder.gitconfig_path(root).exists()


def test_write_askpass(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    import sys

    ids = _ids()
    root = builder.lease_root(**ids)
    root.mkdir(parents=True)
    builder.write_askpass(root, "ghp_secret123")
    path = builder.askpass_path(root)
    assert path.exists()
    content = path.read_text()
    assert "ghp_secret123" in content
    if sys.platform != "win32":
        mode = path.stat().st_mode
        assert mode & stat.S_IRWXU == stat.S_IRWXU


def test_shred_askpass(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    ids = _ids()
    root = builder.lease_root(**ids)
    root.mkdir(parents=True)
    builder.write_askpass(root, "ghp_shredme")
    assert builder.askpass_path(root).exists()
    builder.shred_askpass(root)
    assert not builder.askpass_path(root).exists()


def test_shred_askpass_missing_file(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    ids = _ids()
    root = builder.lease_root(**ids)
    root.mkdir(parents=True)
    # Should not raise
    builder.shred_askpass(root)


def test_cleanup(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    ids = _ids()
    root = builder.lease_root(**ids)
    root.mkdir(parents=True)
    (root / "some_file.txt").write_text("data")
    builder.cleanup(root)
    assert not root.exists()


def test_cleanup_missing_dir(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    ids = _ids()
    root = builder.lease_root(**ids)
    # Should not raise
    builder.cleanup(root)


def test_build_env_vars(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    ids = _ids()
    root = builder.lease_root(**ids)
    env = builder.build_env_vars(root)
    assert env["HOME"] == str(builder.home_dir(root))
    assert env["GIT_CONFIG_GLOBAL"] == str(builder.gitconfig_path(root))
    assert env["GIT_ASKPASS"] == str(builder.askpass_path(root))
    assert env["GIT_TERMINAL_PROMPT"] == "0"
    assert "PATH" in env
    import sys

    if sys.platform == "win32":
        assert env["GIT_CONFIG_SYSTEM"] == "NUL"
    else:
        assert env["GIT_CONFIG_SYSTEM"] == "/dev/null"
