"""Tests for ``/api/platform-settings/mcp`` and ``/api/platform-settings/mcp-whitelist``.

Covers change ``2026-07-07-skills-mcp-management-ui`` task-04:
- 4 admin endpoints (GET/PUT mcp config, GET/PUT whitelist)
- env secret redaction on admin GET (token/key/secret/password markers → ``<set>``)
- pydantic ``McpServersSchema`` validation → 422 on bad structure
- admin-only access (``SETTINGS_ADMIN`` via ``is_platform_admin`` short-circuit)
"""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User
from app.modules.settings.model import PlatformSetting

MCP_CFG_PATH = "/api/platform-settings/mcp"
MCP_WL_PATH = "/api/platform-settings/mcp-whitelist"


async def _make_user(session: AsyncSession, *, admin: bool) -> tuple[User, str]:
    from app.core.config import get_settings

    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── GET mcp config ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_mcp_config_empty_when_unset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    resp = await client.get(MCP_CFG_PATH, headers=_headers(token))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"mcpServers": {}}


@pytest.mark.asyncio
async def test_get_mcp_config_redacts_env_secrets(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    # 直接写一条带 secret env 的配置进 PlatformSetting（模拟已存储原值）
    raw = {
        "mcpServers": {
            "github": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github"],
                "env": {
                    "GITHUB_TOKEN": "ghp_secret_value_123",
                    "API_KEY": "sk-abc",
                    "CLIENT_SECRET": "topsecret",
                    "DB_PASSWORD": "hunter2",
                    "URL": "https://api.github.com",  # 非敏感，不遮蔽
                    "TIMEOUT": "30",
                },
            },
            "no-env-server": {"command": "uvx", "args": ["mcp-server"]},
        }
    }
    db_session.add(
        PlatformSetting(
            key="mcp.platform_default",
            value=json.dumps(raw),
            updated_by=uuid.uuid4(),
        )
    )
    await db_session.commit()

    resp = await client.get(MCP_CFG_PATH, headers=_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    env = body["mcpServers"]["github"]["env"]
    assert env["GITHUB_TOKEN"] == "<set>"
    assert env["API_KEY"] == "<set>"
    assert env["CLIENT_SECRET"] == "<set>"
    assert env["DB_PASSWORD"] == "<set>"
    # 非敏感字段保留原值
    assert env["URL"] == "https://api.github.com"
    assert env["TIMEOUT"] == "30"
    # 非 secret 字段不遮蔽
    assert body["mcpServers"]["github"]["command"] == "npx"
    assert body["mcpServers"]["no-env-server"]["command"] == "uvx"


# ── PUT mcp config ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_put_mcp_config_stores_raw_and_returns_redacted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    payload = {
        "mcpServers": {
            "github": {
                "command": "npx",
                "args": ["-y", "server-github"],
                "env": {"GITHUB_TOKEN": "ghp_real_token"},
            }
        }
    }
    resp = await client.put(MCP_CFG_PATH, headers=_headers(token), json=payload)
    assert resp.status_code == 200, resp.text
    # 返回值遮蔽（admin 视图一致）
    body = resp.json()
    assert body["mcpServers"]["github"]["env"]["GITHUB_TOKEN"] == "<set>"

    # 落库的是原值（不脱敏）—— daemon GET 端点会用原始值
    row = await db_session.get(PlatformSetting, "mcp.platform_default")
    assert row is not None
    stored = json.loads(row.value)
    assert stored["mcpServers"]["github"]["env"]["GITHUB_TOKEN"] == "ghp_real_token"


@pytest.mark.asyncio
async def test_put_mcp_config_overwrites_existing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    # 第一次写
    await client.put(
        MCP_CFG_PATH,
        headers=_headers(token),
        json={"mcpServers": {"a": {"command": "cmd-a", "args": []}}},
    )
    # 第二次写（覆盖）
    resp = await client.put(
        MCP_CFG_PATH,
        headers=_headers(token),
        json={"mcpServers": {"b": {"command": "cmd-b", "args": ["x"]}}},
    )
    assert resp.status_code == 200, resp.text
    get_resp = await client.get(MCP_CFG_PATH, headers=_headers(token))
    body = get_resp.json()
    assert set(body["mcpServers"].keys()) == {"b"}


@pytest.mark.asyncio
async def test_put_mcp_config_rejects_bad_structure(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=True)
    # mcpServers 值必须是对象，command 必须 non-empty
    resp = await client.put(
        MCP_CFG_PATH,
        headers=_headers(token),
        json={"mcpServers": {"bad": {"command": "", "args": []}}},
    )
    assert resp.status_code == 422, resp.text

    # args 必须是字符串数组
    resp2 = await client.put(
        MCP_CFG_PATH,
        headers=_headers(token),
        json={"mcpServers": {"bad": {"command": "ok", "args": [1, 2]}}},
    )
    assert resp2.status_code == 422, resp2.text


# ── Whitelist ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_whitelist_roundtrip(client: AsyncClient, db_session: AsyncSession) -> None:
    _, token = await _make_user(db_session, admin=True)
    # 初始空
    resp = await client.get(MCP_WL_PATH, headers=_headers(token))
    assert resp.status_code == 200, resp.text
    assert resp.json() == []

    # PUT 写入裸数组
    put_resp = await client.put(MCP_WL_PATH, headers=_headers(token), json=["github", "filesystem"])
    assert put_resp.status_code == 200, put_resp.text
    assert sorted(put_resp.json()) == ["filesystem", "github"]

    # GET 读回
    get_resp = await client.get(MCP_WL_PATH, headers=_headers(token))
    assert get_resp.status_code == 200
    assert sorted(get_resp.json()) == ["filesystem", "github"]

    # 落库
    row = await db_session.get(PlatformSetting, "mcp.whitelist")
    assert row is not None
    assert json.loads(row.value) == ["github", "filesystem"]


# ── 权限门控 ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_non_admin_get_mcp_config_forbidden(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=False)
    resp = await client.get(MCP_CFG_PATH, headers=_headers(token))
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_non_admin_put_mcp_config_forbidden(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=False)
    resp = await client.put(
        MCP_CFG_PATH,
        headers=_headers(token),
        json={"mcpServers": {}},
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_non_admin_get_whitelist_forbidden(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=False)
    resp = await client.get(MCP_WL_PATH, headers=_headers(token))
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_non_admin_put_whitelist_forbidden(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, token = await _make_user(db_session, admin=False)
    resp = await client.put(MCP_WL_PATH, headers=_headers(token), json=["x"])
    assert resp.status_code == 403, resp.text
