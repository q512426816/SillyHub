"""Tests for platform_sync workspace_router — workspace-scoped token 签发端点。

Change 2026-08-11-change-progress-projection task-07 / D-005@v1 / D-006@v1。

覆盖：
- POST /api/workspaces/{wid}/platform-sync-tokens：WORKSPACE_WRITE 门控（admin 201 /
  非 admin 403），明文 shpsync_ 仅 201 一次返回。
- POST /api/workspaces/resolve-by-root-path：connect 换发三态——反查不到活跃 workspace
  → 404（R-07）；反查到但无 WORKSPACE_WRITE → 403（D-006@v1 安全闭环）；通过 → 200 +
  shpsync_ token。鉴权接受 shk_live_ API key 与 JWT 两路径（design §7）。

镜像 mcp_gateway/tests/test_router.py 的 _make_user/_make_workspace 模式。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User
from app.modules.platform_sync.token_service import (
    PLATFORM_SYNC_TOKEN_PREFIX,
    PlatformSyncTokenService,
)
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


async def _make_workspace(session: AsyncSession, *, root_path: str | None = None) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=root_path or f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


# ── POST /workspaces/{wid}/platform-sync-tokens ──────────────────────────────


@pytest.mark.asyncio
async def test_writer_can_create_and_plaintext_returned_once(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """admin（WORKSPACE_WRITE）→ 201，明文 shpsync_ 仅本次返回，authenticate 可派生 user/ws。"""
    ws = await _make_workspace(db_session)
    user, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}

    resp = await client.post(
        f"/api/workspaces/{ws.id}/platform-sync-tokens",
        headers=h,
        json={"name": "ci"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["workspace_id"] == str(ws.id)
    assert body["token"].startswith(PLATFORM_SYNC_TOKEN_PREFIX)
    assert body["key_prefix"] == body["token"][:12]
    plaintext = body["token"]

    # 明文确实可用：authenticate 派生 (user=created_by, workspace_id)
    principal = await PlatformSyncTokenService(db_session, settings=get_settings()).authenticate(
        plaintext
    )
    assert principal is not None
    assert principal.workspace_id == ws.id
    assert principal.user.id == user.id


@pytest.mark.asyncio
async def test_non_writer_cannot_create_token(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """非 admin 且无 workspace 角色 → require_permission(WORKSPACE_WRITE) → 403。"""
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=False)
    resp = await client.post(
        f"/api/workspaces/{ws.id}/platform-sync-tokens",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "x"},
    )
    assert resp.status_code == 403


# ── POST /workspaces/resolve-by-root-path ────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_root_path_not_found_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """R-07：root_path 未绑活跃 workspace → 404。"""
    _, token = await _make_user(db_session, admin=True)
    resp = await client.post(
        "/api/workspaces/resolve-by-root-path",
        headers={"Authorization": f"Bearer {token}"},
        json={"root_path": "/tmp/never-bound-" + uuid.uuid4().hex[:8]},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_resolve_no_workspace_write_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """D-006@v1：反查到 workspace 但调用者无 WORKSPACE_WRITE → 403（安全闭环）。"""
    root = f"/tmp/ws-{uuid.uuid4().hex[:8]}"
    await _make_workspace(db_session, root_path=root)
    _, token = await _make_user(db_session, admin=False)  # 非 admin、无 ws 角色
    resp = await client.post(
        "/api/workspaces/resolve-by-root-path",
        headers={"Authorization": f"Bearer {token}"},
        json={"root_path": root},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_resolve_admin_returns_token(client: AsyncClient, db_session: AsyncSession) -> None:
    """admin（WORKSPACE_WRITE）+ 反查到 workspace → 200 + shpsync_ token（design §7）。"""
    root = f"/tmp/ws-{uuid.uuid4().hex[:8]}"
    ws = await _make_workspace(db_session, root_path=root)
    _, token = await _make_user(db_session, admin=True)

    resp = await client.post(
        "/api/workspaces/resolve-by-root-path",
        headers={"Authorization": f"Bearer {token}"},
        json={"root_path": root},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["workspace_id"] == str(ws.id)
    assert body["token"].startswith(PLATFORM_SYNC_TOKEN_PREFIX)
