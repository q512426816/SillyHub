"""Tests for ``/api/workspaces/{workspace_id}/mcp-tokens`` router.

Covers WORKSPACE_WRITE gating, plaintext-only-on-create, list-without-plaintext,
and revoke→auth-fails end-to-end. Mirrors test_api_key_router.py style; the
workspace_id path param is exercised via the require_permission(WORKSPACE_WRITE)
dependency (platform admin short-circuits has_permission).

NOTE（task-02 execute）：worktree 无 .venv，本文件按惯例写齐**但不跑**——
verify 阶段在 task-01 model 落定后由 ``cd backend && uv run pytest
app/modules/mcp_gateway -q --no-cov`` 统一执行。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User
from app.modules.mcp_gateway.service import McpTokenService
from app.modules.workspace.model import Workspace


async def _make_user(session: AsyncSession, *, admin: bool) -> tuple[User, str]:
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


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


@pytest.mark.asyncio
async def test_writer_can_create_and_plaintext_returned_only_once(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}

    resp = await client.post(
        f"/api/workspaces/{ws.id}/mcp-tokens",
        headers=h,
        json={"name": "ci", "scope": ["read", "dispatch"]},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "ci"
    assert body["scope"] == ["read", "dispatch"]
    assert body["token"].startswith("shmcp_")
    assert "token_hash" not in body  # hash 绝不出现在响应（R-06）
    token_id = body["id"]
    plaintext = body["token"]

    # GET 必须不含明文（明文仅 POST 一次返回）
    listing = await client.get(f"/api/workspaces/{ws.id}/mcp-tokens", headers=h)
    assert listing.status_code == 200, listing.text
    items = listing.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == token_id
    assert "token" not in items[0]
    assert "token_hash" not in items[0]
    assert items[0]["revoked_at"] is None
    assert items[0]["last_used_at"] is None

    # 明文确实可用（authenticate 返 principal）
    svc = McpTokenService(db_session, settings=get_settings())
    principal = await svc.authenticate(plaintext)
    assert principal is not None
    assert principal.workspace_id == ws.id


@pytest.mark.asyncio
async def test_non_writer_cannot_create(client: AsyncClient, db_session: AsyncSession) -> None:
    """非 admin 且无 workspace 角色的用户 → require_permission(WORKSPACE_WRITE) → 403。"""
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=False)
    resp = await client.post(
        f"/api/workspaces/{ws.id}/mcp-tokens",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "x", "scope": ["read"]},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_non_writer_cannot_list(client: AsyncClient, db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=False)
    resp = await client.get(
        f"/api/workspaces/{ws.id}/mcp-tokens",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_revoke_returns_204_and_auth_fails(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """DELETE → 204；吊销后 authenticate 立即返 None（缓存同步清，无 TTL 放行窗口）。"""
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}

    created = await client.post(
        f"/api/workspaces/{ws.id}/mcp-tokens",
        headers=h,
        json={"name": "to-revoke", "scope": ["converge"]},
    )
    assert created.status_code == 201, created.text
    token_id = created.json()["id"]
    plaintext = created.json()["token"]

    deleted = await client.delete(f"/api/workspaces/{ws.id}/mcp-tokens/{token_id}", headers=h)
    assert deleted.status_code == 204

    # 吊销后 authenticate 返 None
    svc = McpTokenService(db_session, settings=get_settings())
    assert await svc.authenticate(plaintext) is None

    # 二次 DELETE（已吊销）→ 404（idempotent False → McpTokenNotFound）
    again = await client.delete(f"/api/workspaces/{ws.id}/mcp-tokens/{token_id}", headers=h)
    assert again.status_code == 404


@pytest.mark.asyncio
async def test_revoke_unknown_token_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}

    resp = await client.delete(f"/api/workspaces/{ws.id}/mcp-tokens/{uuid.uuid4()}", headers=h)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_rejects_invalid_scope(client: AsyncClient, db_session: AsyncSession) -> None:
    """scope 取值必须 ∈ {read, dispatch, converge}；非法值 → 422。"""
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}

    resp = await client.post(
        f"/api/workspaces/{ws.id}/mcp-tokens",
        headers=h,
        json={"name": "bad", "scope": ["read", "admin"]},  # 'admin' 非法
    )
    assert resp.status_code == 422
