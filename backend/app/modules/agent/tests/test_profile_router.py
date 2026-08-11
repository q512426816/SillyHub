"""AgentProfile router 端点测试（task-04）。

覆盖（design FR-01/14 + plan task-04 acceptance「CRUD 200 + 权限 403」）：
* workspace 级 CRUD + copy 全链路 200/201/204。
* platform 级：GET 列表（任意登录用户）+ GET/PATCH/DELETE 单档仅 admin。
* 权限 403：非成员访问 workspace 级端点 → 403；非 admin 访问 platform 单档 → 403。
* 鉴权复用现有 RBAC（``require_permission`` / ``require_platform_admin``），
  service 层三级 visibility 越权 → 403（AgentProfilePermissionDenied）。

测试走 ``client`` fixture（``app.main`` 全量 import，自动注册 profile 路由 +
模型，不受 conftest 表注册预存坑影响）。RBAC seed 仿
``test_workspace_admin_management`` 的 ``_grant_workspace_permission``。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.profile.model import AgentProfileVisibility
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.llm_provider.model import LlmProvider  # noqa: F401
from app.modules.workspace.model import Workspace

# 上方 ``from app.modules.agent.profile.model import AgentProfileVisibility`` 已
# 触发 profile 模型加载（定义 AgentProfile(table=True)），将 agent_profiles 表注
# 册进 BaseModel.metadata——隔离单跑本文件时 db_engine 的 create_all 即能建表，
# 无需依赖 client fixture 的 app.main 全量 import（避开 conftest 表注册预存坑）。
# task-11：profile 现有 llm_provider_id FK→llm_providers，单跑需 LlmProvider 模型
# 也加载，否则 create_all 建 agent_profiles 表时该 FK 找不到目标表（NoReferencedTableError）。


# ── helpers ─────────────────────────────────────────────────────────────────


async def _create_user(
    session: AsyncSession,
    *,
    is_platform_admin: bool = False,
    email: str | None = None,
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"prof-{uid.hex[:6]}@example.com",
        password_hash="x",
        display_name=f"U-{uid.hex[:4]}",
        status="active",
        is_platform_admin=is_platform_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token_for(user: User) -> str:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    return token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _grant_workspace_permission(
    session: AsyncSession,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    permission: Permission,
) -> None:
    """Seed a Role + RolePermission + UserWorkspaceRole so ``require_permission``
    passes for ``permission`` in ``workspace_id``（仿 test_workspace_admin_management）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"test-ws-{permission.value}-{uuid.uuid4().hex[:6]}",
        name=f"test ws {permission.value}",
    )
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission=permission.value))
    session.add(UserWorkspaceRole(user_id=user_id, workspace_id=workspace_id, role_id=role.id))
    await session.commit()


async def _create_workspace(
    session: AsyncSession,
    *,
    created_by: uuid.UUID,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        status="active",
        created_by=created_by,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


def _ws_profiles_path(ws_id: uuid.UUID) -> str:
    return f"/api/workspaces/{ws_id}/agent-profiles"


# ── workspace 级 CRUD ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_workspace_crud_lifecycle(client: AsyncClient, db_session: AsyncSession):
    """workspace 成员：create → list → get → patch → delete 全链路。"""
    user = await _create_user(db_session)
    ws = await _create_workspace(db_session, created_by=user.id)
    await _grant_workspace_permission(db_session, user.id, ws.id, Permission.WORKSPACE_WRITE)
    await _grant_workspace_permission(db_session, user.id, ws.id, Permission.WORKSPACE_READ)
    h = _headers(_token_for(user))
    base = _ws_profiles_path(ws.id)

    # create（workspace 级档案）
    resp = await client.post(
        base,
        json={
            "name": "我的档案",
            "visibility": AgentProfileVisibility.WORKSPACE.value,
            "provider": "claude",
            "model": "claude-sonnet",
            "system_prompt": "你是助手",
            "mcp_refs": ["m1"],
            "skill_refs": ["s1"],
            # task-11：显式不绑，验证 DTO 接收 llm_provider_id + Read 透出 None。
            "llm_provider_id": None,
        },
        headers=h,
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "我的档案"
    assert created["visibility"] == AgentProfileVisibility.WORKSPACE.value
    assert created["workspace_id"] == str(ws.id)
    assert created["provider"] == "claude"
    assert created["version"] == 1
    assert created["is_system_default"] is False
    assert created["llm_provider_id"] is None  # task-11：未绑透出 None
    pid = created["id"]

    # list 含刚建档案
    resp = await client.get(base, headers=h)
    assert resp.status_code == 200
    names = {it["name"] for it in resp.json()["items"]}
    assert "我的档案" in names

    # get 单档
    resp = await client.get(f"{base}/{pid}", headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == pid
    assert resp.json()["llm_provider_id"] is None  # task-11：Read 字段返回

    # patch 更新 + version 递增
    resp = await client.patch(
        f"{base}/{pid}",
        json={"system_prompt": "新提示", "model": "claude-opus", "llm_provider_id": None},
        headers=h,
    )
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["system_prompt"] == "新提示"
    assert updated["model"] == "claude-opus"
    assert updated["version"] == 2
    assert updated["llm_provider_id"] is None  # task-11：显式 null=解绑语义（exclude_unset）

    # delete → 204
    resp = await client.delete(f"{base}/{pid}", headers=h)
    assert resp.status_code == 204
    # 再 get → 404
    resp = await client.get(f"{base}/{pid}", headers=h)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_workspace_copy_creates_clone(client: AsyncClient, db_session: AsyncSession):
    """copy 端点：复制源档内容到 actor 名下新档（private 默认）。"""
    user = await _create_user(db_session)
    ws = await _create_workspace(db_session, created_by=user.id)
    await _grant_workspace_permission(db_session, user.id, ws.id, Permission.WORKSPACE_WRITE)
    h = _headers(_token_for(user))
    base = _ws_profiles_path(ws.id)

    resp = await client.post(
        base,
        json={
            "name": "源档",
            "visibility": AgentProfileVisibility.WORKSPACE.value,
            "provider": "codex",
            "system_prompt": "orig",
        },
        headers=h,
    )
    assert resp.status_code == 201, resp.text
    src_id = resp.json()["id"]

    resp = await client.post(
        f"{base}/{src_id}/copy",
        json={"name": "克隆档"},
        headers=h,
    )
    assert resp.status_code == 201, resp.text
    dup = resp.json()
    assert dup["id"] != src_id
    assert dup["name"] == "克隆档"
    assert dup["provider"] == "codex"  # 内容复制
    assert dup["system_prompt"] == "orig"
    assert dup["visibility"] == AgentProfileVisibility.PRIVATE.value  # 默认 private


@pytest.mark.asyncio
async def test_workspace_endpoint_non_member_forbidden(
    client: AsyncClient, db_session: AsyncSession
):
    """非 workspace 成员访问 workspace 级端点 → 403（require_permission 拦截）。"""
    owner = await _create_user(db_session, email="owner@example.com")
    stranger = await _create_user(db_session, email="stranger@example.com")
    ws = await _create_workspace(db_session, created_by=owner.id)
    # 只给 owner 授权，stranger 无任何成员行
    await _grant_workspace_permission(db_session, owner.id, ws.id, Permission.WORKSPACE_WRITE)
    base = _ws_profiles_path(ws.id)

    stranger_h = _headers(_token_for(stranger))
    # POST → 403
    resp = await client.post(
        base,
        json={"name": "x", "provider": "claude"},
        headers=stranger_h,
    )
    assert resp.status_code == 403, resp.text
    # GET list → 403
    resp = await client.get(base, headers=stranger_h)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_workspace_get_other_users_private_forbidden(
    client: AsyncClient, db_session: AsyncSession
):
    """service 三级 visibility：B（成员）GET A 的 private 档 → 403。"""
    owner = await _create_user(db_session, email="o2@example.com")
    member = await _create_user(db_session, email="m2@example.com")
    ws = await _create_workspace(db_session, created_by=owner.id)
    for u in (owner, member):
        await _grant_workspace_permission(db_session, u.id, ws.id, Permission.WORKSPACE_WRITE)
        await _grant_workspace_permission(db_session, u.id, ws.id, Permission.WORKSPACE_READ)
    h_owner = _headers(_token_for(owner))
    base = _ws_profiles_path(ws.id)

    # owner 建 private 档
    resp = await client.post(
        base,
        json={"name": "private-of-owner", "visibility": "private", "provider": "claude"},
        headers=h_owner,
    )
    assert resp.status_code == 201, resp.text
    pid = resp.json()["id"]

    # member（同 ws 成员）读 owner 的 private → 403
    resp = await client.get(f"{base}/{pid}", headers=_headers(_token_for(member)))
    assert resp.status_code == 403, resp.text


# ── platform 级 ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_platform_list_any_authenticated_user(client: AsyncClient, db_session: AsyncSession):
    """GET /api/agent-profiles：任意登录用户可看 platform 可见档案。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    # 直接经 service seed 一个 platform 预置档案（避免走 admin 端点，独立验证列表）
    from app.modules.agent.profile.service import AgentProfileService

    await AgentProfileService(db_session).create(
        name="平台默认档",
        visibility=AgentProfileVisibility.PLATFORM,
        provider="claude",
        actor=admin,
    )

    user = await _create_user(db_session, email="plain@example.com")
    resp = await client.get("/api/agent-profiles", headers=_headers(_token_for(user)))
    assert resp.status_code == 200, resp.text
    names = {it["name"] for it in resp.json()["items"]}
    assert "平台默认档" in names


@pytest.mark.asyncio
async def test_platform_single_admin_only(client: AsyncClient, db_session: AsyncSession):
    """GET/PATCH/DELETE /api/agent-profiles/{id} 仅 admin：普通用户 → 403。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    from app.modules.agent.profile.service import AgentProfileService

    profile = await AgentProfileService(db_session).create(
        name="sys-default",
        visibility=AgentProfileVisibility.PLATFORM,
        provider="claude",
        actor=admin,
    )
    pid = profile.id

    user = await _create_user(db_session, email="nonadmin@example.com")
    h = _headers(_token_for(user))

    resp = await client.get(f"/api/agent-profiles/{pid}", headers=h)
    assert resp.status_code == 403, resp.text
    resp = await client.patch(f"/api/agent-profiles/{pid}", json={"system_prompt": "x"}, headers=h)
    assert resp.status_code == 403, resp.text
    resp = await client.delete(f"/api/agent-profiles/{pid}", headers=h)
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_platform_admin_can_update_and_delete(client: AsyncClient, db_session: AsyncSession):
    """admin 经 platform 端点可更新 + 删除平台档案。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    from app.modules.agent.profile.service import AgentProfileService

    profile = await AgentProfileService(db_session).create(
        name="admin-managed",
        visibility=AgentProfileVisibility.PLATFORM,
        provider="claude",
        actor=admin,
    )
    pid = profile.id
    h = _headers(_token_for(admin))

    resp = await client.get(f"/api/agent-profiles/{pid}", headers=h)
    assert resp.status_code == 200, resp.text

    resp = await client.patch(
        f"/api/agent-profiles/{pid}", json={"system_prompt": "admin-edit"}, headers=h
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["system_prompt"] == "admin-edit"
    assert resp.json()["version"] == 2

    resp = await client.delete(f"/api/agent-profiles/{pid}", headers=h)
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_unauthenticated_401(client: AsyncClient):
    """未带 Bearer → 401（区别于越权 403）。"""
    resp = await client.get("/api/agent-profiles")
    assert resp.status_code == 401


# ── scope=mine 聚合端点（task-01 / design §7.1 / D-004）──


@pytest.mark.asyncio
async def test_scope_mine_returns_aggregated_with_workspace_name(
    client: AsyncClient, db_session: AsyncSession
):
    """scope=mine：聚合响应含 workspace_name，跨 ws 可见全集，越权档不返回（R-01）。"""
    from app.modules.agent.profile.service import AgentProfileService

    actor = await _create_user(db_session, email="actor@example.com")
    other = await _create_user(db_session, email="other@example.com")
    admin = await _create_user(db_session, is_platform_admin=True, email="admin-scope@example.com")
    ws = await _create_workspace(db_session, created_by=actor.id)
    ws.name = "聚合测试工作区"
    db_session.add(ws)
    await db_session.commit()
    await _grant_workspace_permission(db_session, actor.id, ws.id, Permission.WORKSPACE_READ)

    # actor 的 private 档（跨 ws 概念，owner=actor、workspace_id=None）
    await AgentProfileService(db_session).create(
        name="actor-priv",
        visibility=AgentProfileVisibility.PRIVATE,
        provider="claude",
        actor=actor,
    )
    # actor 在 ws 建的 workspace 级档（actor 是成员）
    await AgentProfileService(db_session).create(
        name="actor-ws",
        visibility=AgentProfileVisibility.WORKSPACE,
        provider="claude",
        actor=actor,
        workspace=ws,
    )
    # other 的 private 档（actor 不应见到，R-01 越权）
    await AgentProfileService(db_session).create(
        name="other-priv",
        visibility=AgentProfileVisibility.PRIVATE,
        provider="claude",
        actor=other,
    )
    # platform 预置档（全平台可见）
    await AgentProfileService(db_session).create(
        name="plat-default",
        visibility=AgentProfileVisibility.PLATFORM,
        provider="claude",
        actor=admin,
    )

    resp = await client.get("/api/agent-profiles?scope=mine", headers=_headers(_token_for(actor)))
    assert resp.status_code == 200, resp.text
    items = {it["name"]: it for it in resp.json()["items"]}
    assert "actor-priv" in items  # 自己 private
    assert "actor-ws" in items  # 所属 ws 级
    assert "plat-default" in items  # platform 预置
    assert "other-priv" not in items  # 越权：不见 other 的 private（R-01）
    # workspace_name 填充规则：private/platform 为 null，workspace 级填归属名
    assert items["actor-priv"]["workspace_name"] is None
    assert items["actor-ws"]["workspace_name"] == "聚合测试工作区"
    assert items["actor-ws"]["workspace_id"] == str(ws.id)
    assert items["plat-default"]["workspace_name"] is None


@pytest.mark.asyncio
async def test_no_scope_keeps_platform_list_behavior(client: AsyncClient, db_session: AsyncSession):
    """未带 scope：保持原 platform 列表行为（C8 冻结），响应 items 不含 workspace_name。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    from app.modules.agent.profile.service import AgentProfileService

    await AgentProfileService(db_session).create(
        name="平台档",
        visibility=AgentProfileVisibility.PLATFORM,
        provider="claude",
        actor=admin,
    )
    user = await _create_user(db_session, email="plain-noscope@example.com")
    resp = await client.get("/api/agent-profiles", headers=_headers(_token_for(user)))
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert any(it["name"] == "平台档" for it in items)
    # C8：原 AgentProfileRead 结构，不含聚合专属字段 workspace_name
    assert all("workspace_name" not in it for it in items)
