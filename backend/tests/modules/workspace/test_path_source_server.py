"""Server-side path resolution for daemon-client vs server-local workspaces."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.modules.spec_workspace.bootstrap import preflight_workspace_code_root
from app.modules.workspace.service import (
    resolve_root_path_for_daemon,
    resolve_root_path_for_server,
)


def test_resolve_root_path_for_server_daemon_client_returns_none():
    assert resolve_root_path_for_server("C:/any/path", "daemon-client") is None


def test_resolve_root_path_for_server_local_rewrites(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    host_base = tmp_path / "projects"
    project = host_base / "happy"
    project.mkdir(parents=True)

    monkeypatch.setenv("HOST_PATH_PREFIX", str(host_base).replace("\\", "/"))
    monkeypatch.setenv("CONTAINER_PATH_PREFIX", "/host-projects")
    from app.core.config import get_settings

    get_settings.cache_clear()

    host_path = str(project).replace("\\", "/")
    assert resolve_root_path_for_server(host_path, "server-local") == "/host-projects/happy"


def test_preflight_workspace_code_root_skips_daemon_client():
    assert (
        preflight_workspace_code_root(
            r"C:\Users\qinyi\IdeaProjects\happy",
            path_source="daemon-client",
        )
        is None
    )


def test_preflight_workspace_code_root_checks_rewritten_server_path(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    mount = tmp_path / "host-projects"
    project = mount / "happy"
    project.mkdir(parents=True)
    (project / "package.json").write_text("{}")

    monkeypatch.setenv("HOST_PATH_PREFIX", "Z:/fake-host-projects")
    monkeypatch.setenv("CONTAINER_PATH_PREFIX", str(mount).replace("\\", "/"))
    from app.core.config import get_settings

    get_settings.cache_clear()

    host_path = "Z:/fake-host-projects/happy"
    assert not Path(host_path).exists()
    assert preflight_workspace_code_root(host_path, path_source="server-local") is None


# ── resolve_root_path_for_daemon（container→host，逆 _rewrite_path）──────────────


def test_resolve_root_path_for_daemon_daemon_client_passthrough(
    monkeypatch: pytest.MonkeyPatch,
):
    # daemon-client: root_path 本就在 daemon 机器，原样返回（不改写）
    assert resolve_root_path_for_daemon("C:/any/path", "daemon-client") == "C:/any/path"


def test_resolve_root_path_for_daemon_local_rewrites_container_to_host(
    monkeypatch: pytest.MonkeyPatch,
):
    # server-local: container_path_prefix → host_path_prefix
    monkeypatch.setenv("HOST_PATH_PREFIX", "F:/")
    monkeypatch.setenv("CONTAINER_PATH_PREFIX", "/host-projects")
    from app.core.config import get_settings

    get_settings.cache_clear()
    assert (
        resolve_root_path_for_daemon("/host-projects/WorkNew/SillyHub", "server-local")
        == "F:/WorkNew/SillyHub"
    )


def test_resolve_root_path_for_daemon_no_prefix_passthrough(
    monkeypatch: pytest.MonkeyPatch,
):
    # 裸机部署：未配前缀 → 原样返回（容器=宿主机）
    monkeypatch.delenv("HOST_PATH_PREFIX", raising=False)
    monkeypatch.delenv("CONTAINER_PATH_PREFIX", raising=False)
    from app.core.config import get_settings

    get_settings.cache_clear()
    assert resolve_root_path_for_daemon("/host-projects/X", "server-local") == "/host-projects/X"


def test_resolve_root_path_for_daemon_windows_backslash_normalized(
    monkeypatch: pytest.MonkeyPatch,
):
    # Windows 反斜杠路径规范化（\ → /）后再匹配前缀
    monkeypatch.setenv("HOST_PATH_PREFIX", "F:/")
    monkeypatch.setenv("CONTAINER_PATH_PREFIX", "/host-projects")
    from app.core.config import get_settings

    get_settings.cache_clear()
    assert (
        resolve_root_path_for_daemon(r"\host-projects\WorkNew\SillyHub", "server-local")
        == "F:/WorkNew/SillyHub"
    )


def test_resolve_root_path_for_daemon_non_matching_prefix_passthrough(
    monkeypatch: pytest.MonkeyPatch,
):
    # root_path 不以 container_path_prefix 开头 → 原样返回（如 spec_root 的 /data/...）
    monkeypatch.setenv("HOST_PATH_PREFIX", "F:/")
    monkeypatch.setenv("CONTAINER_PATH_PREFIX", "/host-projects")
    from app.core.config import get_settings

    get_settings.cache_clear()
    assert (
        resolve_root_path_for_daemon("/data/spec-workspaces/x", "server-local")
        == "/data/spec-workspaces/x"
    )
