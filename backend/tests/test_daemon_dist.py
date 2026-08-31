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
    # task-05: install.ps1 模板（含 {{SERVER_URL}} 占位，dist_router 动态替换）。
    # utf-8-sig = 带单个 UTF-8 BOM：镜像内真实模板由源文件 sillyhub-daemon/scripts/install.ps1
    # 携带 BOM（WinPS5.1 直执行按 UTF-8 解码），fixture 必须还原该事实，否则 dist_router
    # 的 utf-8-sig 剥 BOM 路径测不到（ql-20260831-003 双 BOM 回归的漏网原因）。
    (dist / "install.ps1").write_text(
        "# SillyHub daemon installer (PowerShell)\n"
        "$server = '{{SERVER_URL}}'\n"
        'Write-Host "installing from $server"\n',
        encoding="utf-8-sig",
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


# ── task-05: GET /daemon/install.ps1（动态生成 + server_url 推导 + 注入防护）──


async def test_install_ps1(client: AsyncClient, daemon_dist: Path) -> None:
    resp = await client.get("/daemon/install.ps1")
    assert resp.status_code == 200
    # charset=utf-8 必须显式：非 text/* 时 starlette 不自动补 charset，缺失则
    # PowerShell irm 按 latin1 解码 UTF-8 body → 中文 mojibake（ql-20260813-003 回归锚点）。
    ct = resp.headers["content-type"]
    assert ct == "application/x-powershell; charset=utf-8", ct
    # {{SERVER_URL}} 占位已被替换为推导地址（test client 默认 host）
    assert "{{SERVER_URL}}" not in resp.text
    assert "install" in resp.text
    # ql-20260831-003 回归锚点：模板带单 BOM（fixture utf-8-sig），但响应体绝不能以
    # \ufeff 开头——残留 BOM 会让用户 irm | iex 把首行注释当代码执行
    # （"无法将 Windows 项识别为 cmdlet"）。Dockerfile 侧另有"恰好一个 BOM"构建断言。
    assert not resp.text.startswith("\ufeff"), resp.text[:20]


async def test_install_ps1_server_url_derivation(client: AsyncClient, daemon_dist: Path) -> None:
    # X-Forwarded-Proto + X-Forwarded-Host → https://example.com（DG-01）
    resp = await client.get(
        "/daemon/install.ps1",
        headers={
            "x-forwarded-proto": "https",
            "x-forwarded-host": "example.com",
        },
    )
    assert resp.status_code == 200
    assert "https://example.com" in resp.text
    assert "{{SERVER_URL}}" not in resp.text


async def test_install_ps1_rejects_malicious_host(client: AsyncClient, daemon_dist: Path) -> None:
    # 非法 host（含引号/分号/空格）→ 白名单拒绝，回退 base_url（DG-03，不注入）
    resp = await client.get(
        "/daemon/install.ps1",
        headers={"x-forwarded-host": "evil.com'; rm -rf /"},
    )
    assert resp.status_code == 200
    assert "evil.com" not in resp.text
    assert "rm -rf" not in resp.text
    assert "{{SERVER_URL}}" not in resp.text


async def test_install_ps1_404_when_missing(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "daemon_dist_dir", tmp_path)
    resp = await client.get("/daemon/install.ps1")
    assert resp.status_code == 404
