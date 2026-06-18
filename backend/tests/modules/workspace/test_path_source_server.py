"""Server-side path resolution for daemon-client vs server-local workspaces."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.modules.spec_workspace.bootstrap import preflight_workspace_code_root
from app.modules.workspace.service import resolve_root_path_for_server


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
