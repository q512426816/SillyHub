"""Daemon distribution endpoint tests.

Covers the public, no-``/api``-prefix routes that make
``curl <SERVER>/daemon/install.sh | bash`` work end-to-end:

- ``GET /daemon/install.sh``
- ``GET /daemon/latest.json``
- ``GET /daemon/latest/sillyhub-daemon.js``

The bundled files are redirected to a ``tmp_path`` by monkeypatching
``settings.daemon_dist_dir``, so no real bundle is required.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from httpx import AsyncClient

from app.core.config import get_settings


@pytest.fixture()
def daemon_dist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Create a fake daemon-dist dir (install.sh + bundle), point settings at it."""
    dist = tmp_path / "daemon-dist"
    dist.mkdir()
    (dist / "install.sh").write_text(
        "#!/usr/bin/env bash\necho sillyhub-daemon install\n", encoding="utf-8"
    )
    (dist / "sillyhub-daemon.js").write_text(
        "/* ncc bundle stub */\nconsole.log('daemon');\n", encoding="utf-8"
    )
    monkeypatch.setattr(get_settings(), "daemon_dist_dir", dist)
    return dist


async def test_install_script(client: AsyncClient, daemon_dist: Path) -> None:
    resp = await client.get("/daemon/install.sh")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/x-shellscript")
    assert "sillyhub-daemon" in resp.text


async def test_latest_manifest(client: AsyncClient, daemon_dist: Path) -> None:
    resp = await client.get("/daemon/latest.json")
    assert resp.status_code == 200
    payload = resp.json()
    # Hard contract: install.sh parses "version" / "downloadUrl" via sed.
    assert "version" in payload
    assert payload["downloadUrl"].endswith("sillyhub-daemon.js")


async def test_daemon_bundle(client: AsyncClient, daemon_dist: Path) -> None:
    resp = await client.get("/daemon/latest/sillyhub-daemon.js")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/javascript")
    assert "daemon" in resp.text


async def test_install_script_404_when_missing(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "daemon_dist_dir", tmp_path)
    resp = await client.get("/daemon/install.sh")
    assert resp.status_code == 404


async def test_bundle_404_when_missing(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "daemon_dist_dir", tmp_path)
    resp = await client.get("/daemon/latest/sillyhub-daemon.js")
    assert resp.status_code == 404
