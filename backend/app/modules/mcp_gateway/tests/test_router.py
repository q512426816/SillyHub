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


# ── gateway_url 成对下发（spike P0-2，2026-09-10）──────────────────────────────


@pytest.mark.asyncio
async def test_create_gateway_url_null_when_unconfigured_despite_forwarded_headers(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """ql-20260911-003-355a P2：未显式配置时 gateway_url=null——不信任可被请求方
    影响的 X-Forwarded-* / Host 头（token 成对落盘约定下会被引向第三方主机）。"""
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)

    resp = await client.post(
        f"/api/workspaces/{ws.id}/mcp-tokens",
        headers={
            "Authorization": f"Bearer {token}",
            "x-forwarded-proto": "https",
            "x-forwarded-host": "attacker.example.com",
        },
        json={"name": "ci", "scope": ["read"]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["gateway_url"] is None


@pytest.mark.asyncio
async def test_create_gateway_url_settings_override_wins(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """MCP_GATEWAY_PUBLIC_BASE_URL 显式配置优先于请求头推导（多入口/头不可信场景）。"""
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    monkeypatch.setattr(get_settings(), "mcp_gateway_public_base_url", "https://mcp.example.com/")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/mcp-tokens",
        headers={
            "Authorization": f"Bearer {token}",
            "x-forwarded-proto": "http",
            "x-forwarded-host": "ignored.example.com",
        },
        json={"name": "ci", "scope": ["read"]},
    )
    assert resp.status_code == 201, resp.text
    # 尾斜杠归一后拼 /mcp/，不产生双斜杠。
    assert resp.json()["gateway_url"] == "https://mcp.example.com/mcp/"


# ── 2026-10-11-apikey-mcp-copy-delete：plaintext 端点 + hard 删除 ─────────


async def _create_token(client: AsyncClient, h: dict, ws_id: str, name: str = "t") -> dict:
    resp = await client.post(
        f"/api/workspaces/{ws_id}/mcp-tokens",
        headers=h,
        json={"name": name, "scope": ["read"]},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_plaintext_endpoint_roundtrip_and_404_after_revoke(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    created = await _create_token(client, h, str(ws.id), name="copyable")

    got = await client.get(
        f"/api/workspaces/{ws.id}/mcp-tokens/{created['id']}/plaintext", headers=h
    )
    assert got.status_code == 200, got.text
    assert got.json()["token"] == created["token"]

    revoked = await client.delete(f"/api/workspaces/{ws.id}/mcp-tokens/{created['id']}", headers=h)
    assert revoked.status_code == 204
    gone = await client.get(
        f"/api/workspaces/{ws.id}/mcp-tokens/{created['id']}/plaintext", headers=h
    )
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_plaintext_endpoint_rejects_foreign_workspace(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """跨 workspace 取明文 → 404（防存在性探测，与吊销同语义）。"""
    ws = await _make_workspace(db_session)
    other_ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    created = await _create_token(client, h, str(ws.id))

    resp = await client.get(
        f"/api/workspaces/{other_ws.id}/mcp-tokens/{created['id']}/plaintext", headers=h
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_plaintext_endpoint_legacy_row_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """存量 hash-only 行（encrypted_token=NULL，直接插 ORM）→ 409 引导新建。"""
    from datetime import UTC, datetime

    from app.modules.mcp_gateway.model import McpTokenORM

    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}

    legacy = McpTokenORM(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        name="legacy",
        token_hash=uuid.uuid4().hex,
        encrypted_token=None,
        scope=["read"],
        created_at=datetime.now(UTC),
        last_used_at=None,
        revoked_at=None,
    )
    db_session.add(legacy)
    await db_session.commit()

    resp = await client.get(f"/api/workspaces/{ws.id}/mcp-tokens/{legacy.id}/plaintext", headers=h)
    assert resp.status_code == 409
    assert "新建" in resp.json()["message"]


@pytest.mark.asyncio
async def test_list_carries_plaintext_recoverable_flag(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    await _create_token(client, h, str(ws.id), name="fresh")

    items = (await client.get(f"/api/workspaces/{ws.id}/mcp-tokens", headers=h)).json()["items"]
    assert items[0]["plaintext_recoverable"] is True


@pytest.mark.asyncio
async def test_hard_delete_revoked_token_204_and_removed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    created = await _create_token(client, h, str(ws.id), name="doomed")

    await client.delete(f"/api/workspaces/{ws.id}/mcp-tokens/{created['id']}", headers=h)
    resp = await client.delete(
        f"/api/workspaces/{ws.id}/mcp-tokens/{created['id']}?hard=true", headers=h
    )
    assert resp.status_code == 204

    items = (await client.get(f"/api/workspaces/{ws.id}/mcp-tokens", headers=h)).json()["items"]
    assert all(it["id"] != created["id"] for it in items)


@pytest.mark.asyncio
async def test_hard_delete_active_token_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    created = await _create_token(client, h, str(ws.id), name="alive")

    resp = await client.delete(
        f"/api/workspaces/{ws.id}/mcp-tokens/{created['id']}?hard=true", headers=h
    )
    assert resp.status_code == 409
    assert "吊销" in resp.json()["message"]

    items = (await client.get(f"/api/workspaces/{ws.id}/mcp-tokens", headers=h)).json()["items"]
    mine = next(it for it in items if it["id"] == created["id"])
    assert mine["revoked_at"] is None  # 原吊销语义不受影响


@pytest.mark.asyncio
async def test_hard_delete_unknown_token_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    resp = await client.delete(
        f"/api/workspaces/{ws.id}/mcp-tokens/{uuid.uuid4()}?hard=true",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_hard_delete_cleans_up_bound_webhooks(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """hard delete 后该 token 名下 webhook 行一并移除（FR-04 级联承诺）。

    service 层显式删 webhook 子行（不依赖 FK CASCADE——单测 SQLite 不开外键
    PRAGMA，纯 FK 级联在测试面会残留），生产 PG 上与 FK CASCADE 双保险。
    """
    from datetime import UTC, datetime

    from sqlalchemy import select

    from app.modules.mcp_gateway.model import McpTokenORM, McpWebhookORM

    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}
    created = await _create_token(client, h, str(ws.id), name="hooked")

    webhook = McpWebhookORM(
        id=uuid.uuid4(),
        token_id=uuid.uuid4(),  # 占位，下面替换为真实 token id
        workspace_id=ws.id,
        url="https://hooks.example.com/done",
        secret="v1:" + "ab" * 8,
        events=["worker.completed"],
        active=True,
        created_at=datetime.now(UTC),
    )
    webhook.token_id = uuid.UUID(created["id"])
    db_session.add(webhook)
    await db_session.commit()

    await client.delete(f"/api/workspaces/{ws.id}/mcp-tokens/{created['id']}", headers=h)
    resp = await client.delete(
        f"/api/workspaces/{ws.id}/mcp-tokens/{created['id']}?hard=true", headers=h
    )
    assert resp.status_code == 204

    tokens_left = (
        await db_session.execute(
            select(McpTokenORM).where(McpTokenORM.id == uuid.UUID(created["id"]))
        )
    ).scalar_one_or_none()
    webhooks_left = (
        (
            await db_session.execute(
                select(McpWebhookORM).where(McpWebhookORM.token_id == uuid.UUID(created["id"]))
            )
        )
        .scalars()
        .all()
    )
    assert tokens_left is None
    assert webhooks_left == []
