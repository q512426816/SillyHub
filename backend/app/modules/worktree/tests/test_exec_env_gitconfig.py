"""write_gitconfig 纵深防御测试（security-audit-remediation task-10 / FR-11）。

schema 层（GitIdentityCreate pattern）已拦换行/方括号/控制字符；本层防御的是
**绕过 schema 的路径**——service 直调 write_gitconfig 传入旧存量数据或内部
构造值时，注入内容不得落成恶意 gitconfig。语义选 fail-fast（ValueError）而非
静默跳过：注入尝试必须可观测。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.modules.worktree.exec_env import ExecEnvBuilder


@pytest.fixture()
def builder(tmp_path: Path) -> ExecEnvBuilder:
    return ExecEnvBuilder(base_dir=tmp_path)


def _lease_root(builder: ExecEnvBuilder, tmp_path: Path) -> Path:
    ids = {
        "workspace_id": "ws-001",
        "component_id": "comp-001",
        "user_id": "user-001",
        "change_id": "chg-001",
        "task_id": "task-001",
        "run_id": "run-001",
    }
    root = builder.lease_root(**ids)
    root.mkdir(parents=True)
    return root


def test_write_gitconfig_rejects_newline_in_username(
    builder: ExecEnvBuilder, tmp_path: Path
) -> None:
    """username 含 \\n → ValueError，且不落盘（无 gitconfig 文件 / 无注入行）。"""
    root = _lease_root(builder, tmp_path)
    with pytest.raises(ValueError, match="git_username"):
        builder.write_gitconfig(root, "octocat\n[credential]\thelper = !rm -rf /", None)
    assert not builder.gitconfig_path(root).exists()


def test_write_gitconfig_rejects_carriage_return_in_username(
    builder: ExecEnvBuilder, tmp_path: Path
) -> None:
    root = _lease_root(builder, tmp_path)
    with pytest.raises(ValueError):
        builder.write_gitconfig(root, "octocat\rx", None)
    assert not builder.gitconfig_path(root).exists()


def test_write_gitconfig_rejects_newline_in_email(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    """email 含 \\r\\n → ValueError，不落盘。"""
    root = _lease_root(builder, tmp_path)
    with pytest.raises(ValueError, match="git_email"):
        builder.write_gitconfig(root, "octocat", "a@example.com\r\n[core]\tx = y")
    assert not builder.gitconfig_path(root).exists()


def test_write_gitconfig_accepts_valid_values(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    """合法值回归：正常写入，内容含 name/email 行。"""
    root = _lease_root(builder, tmp_path)
    builder.write_gitconfig(root, "octocat", "octo@example.com")
    content = builder.gitconfig_path(root).read_text()
    assert "name = octocat" in content
    assert "email = octo@example.com" in content
    assert "\n[" not in content.replace("[user]", "", 1)  # 无伪造段头


def test_write_gitconfig_none_values_regression(builder: ExecEnvBuilder, tmp_path: Path) -> None:
    """None/None 回归：不写文件、不抛错（既有行为不变）。"""
    root = _lease_root(builder, tmp_path)
    builder.write_gitconfig(root, None, None)
    assert not builder.gitconfig_path(root).exists()
