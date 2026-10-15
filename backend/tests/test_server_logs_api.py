"""服务器日志端点测试（2026-10-15-server-logs-panel task-02）。

覆盖：tail 读取/JSON 解析降级/lines 白名单回退/空态/下载白名单防遍历/三态鉴权。
日志文件位置经 monkeypatch get_log_file_path 指向 tmp_path（不触碰真实日志目录）。
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

LOGS_PATH = "/api/server-logs"
DOWNLOAD_PATH = "/api/server-logs/download"


def _json_line(event: str, level: str = "info", **extra: Any) -> str:
    return json.dumps(
        {"event": event, "level": level, "timestamp": "2026-10-15T08:00:00Z", **extra},
        ensure_ascii=False,
    )


@pytest.fixture()
def log_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """把 get_log_file_path 指向 tmp_path/backend.log（返回该路径）。"""
    path = tmp_path / "backend.log"
    monkeypatch.setattr("app.core.logging.get_log_file_path", lambda log_dir=None: path)
    return path


async def _make_user_token(db_session: Any, *, admin: bool) -> str:
    """建用户并签 token（模式同 tests/test_health.py / test_mcp_settings.py）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── 三态鉴权 ────────────────────────────────────────────────────────────


async def test_server_logs_requires_login(client: AsyncClient, log_file: Path) -> None:
    resp = await client.get(LOGS_PATH)
    assert resp.status_code == 401, resp.text


async def test_server_logs_forbidden_without_permission(
    client: AsyncClient, db_session: Any, log_file: Path
) -> None:
    token = await _make_user_token(db_session, admin=False)
    resp = await client.get(LOGS_PATH, headers=_headers(token))
    assert resp.status_code == 403, resp.text


# ── 读取与解析 ──────────────────────────────────────────────────────────


async def test_list_parses_json_and_degrades_raw_lines(
    client: AsyncClient, db_session: Any, log_file: Path
) -> None:
    log_file.write_text(
        "\n".join(
            [
                _json_line("app.started", environment="dev"),
                "this-is-not-json",
                _json_line("health.checked", db="ok", redis="ok"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    token = await _make_user_token(db_session, admin=True)
    resp = await client.get(LOGS_PATH, headers=_headers(token))
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    assert payload["total_lines"] == 3
    assert payload["returned"] == 3
    assert payload["file"] == "backend.log"
    assert payload["hint"] is None
    entries = payload["entries"]
    assert entries[0]["event"] == "app.started"
    assert entries[0]["level"] == "info"
    assert entries[0]["fields"]["environment"] == "dev"
    assert entries[1]["parse_error"] is True
    assert entries[1]["raw"] == "this-is-not-json"
    assert entries[2]["event"] == "health.checked"
    # 文件清单（下载下拉数据源）
    names = [f["name"] for f in payload["available_files"]]
    assert "backend.log" in names


async def test_list_lines_whitelist_fallback_and_tail(
    client: AsyncClient, db_session: Any, log_file: Path
) -> None:
    """lines=999 非白名单 → 回退 200；250 行文件返回尾部 200 行（total 仍 250）。"""
    log_file.write_text(
        "\n".join(_json_line(f"evt.{i}") for i in range(250)) + "\n",
        encoding="utf-8",
    )
    token = await _make_user_token(db_session, admin=True)
    resp = await client.get(LOGS_PATH, params={"lines": 999}, headers=_headers(token))
    payload = resp.json()
    assert payload["total_lines"] == 250
    assert payload["returned"] == 200
    assert payload["entries"][-1]["event"] == "evt.249"
    assert payload["entries"][0]["event"] == "evt.50"


async def test_list_missing_file_empty_state(
    client: AsyncClient, db_session: Any, log_file: Path
) -> None:
    token = await _make_user_token(db_session, admin=True)
    resp = await client.get(LOGS_PATH, headers=_headers(token))
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["file"] is None
    assert payload["entries"] == []
    assert payload["total_lines"] == 0
    assert payload["hint"], "空态必须给出中文提示"


# ── 下载与白名单防遍历 ──────────────────────────────────────────────────


async def test_download_rejects_non_whitelist(
    client: AsyncClient, db_session: Any, log_file: Path
) -> None:
    log_file.write_text(_json_line("x") + "\n", encoding="utf-8")
    token = await _make_user_token(db_session, admin=True)
    for bad in ("../secret", "backend.log.x", "..\\windows\\win.ini", "/etc/passwd", ""):
        resp = await client.get(DOWNLOAD_PATH, params={"file": bad}, headers=_headers(token))
        assert resp.status_code == 400, f"{bad!r} must be rejected, got {resp.status_code}"


async def test_download_ok_and_missing_404(
    client: AsyncClient, db_session: Any, log_file: Path
) -> None:
    log_file.write_text(_json_line("download.me") + "\n", encoding="utf-8")
    token = await _make_user_token(db_session, admin=True)

    resp = await client.get(DOWNLOAD_PATH, params={"file": "backend.log"}, headers=_headers(token))
    assert resp.status_code == 200, resp.text
    assert "download.me" in resp.text
    assert "attachment" in resp.headers.get("content-disposition", "")

    resp = await client.get(
        DOWNLOAD_PATH, params={"file": "backend.log.1"}, headers=_headers(token)
    )
    assert resp.status_code == 404, resp.text


async def test_download_requires_login(client: AsyncClient, log_file: Path) -> None:
    resp = await client.get(DOWNLOAD_PATH, params={"file": "backend.log"})
    assert resp.status_code == 401, resp.text
