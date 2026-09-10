"""Tests for ``/api/platform-settings/mcp-whitelist``.

Covers change ``2026-07-07-skills-mcp-management-ui`` task-04（白名单子集）+
2026-09-10-mcp-central-registry task-13（旧 ``GET|PUT /api/platform-settings/mcp``
两端点随中央资产库上线移除，D-003；对应 config 用例已删，白名单回归保留）：
- GET/PUT whitelist（裸数组收发 + 落库 KV）
- admin-only access（``SETTINGS_ADMIN`` via ``is_platform_admin`` short-circuit）
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
