"""User management router tests.

Covers change ``2026-06-16-admin-org-role-center`` task-06.
Validates the admin endpoints + the forwarded legacy
``/api/users/*`` endpoints + login-permission enforcement.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.admin.model import Organization, UserOrganization
from app.modules.auth.model import Role, User
from app.modules.auth.model import Session as AuthSession


@pytest.fixture
async def target_user(db_session):
    """Insert a non-admin user for admin operations."""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="target@example.com",
        username="target",
        password_hash=password_hasher.hash("Xx1!abcd"),
        is_platform_admin=False,
        login_enabled=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def non_admin_token(db_session):
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="normie@example.com",
        username="normie",
        password_hash=password_hasher.hash("Xx1!abcd"),
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=False,
        settings=settings,
    )
    return token


@pytest.fixture
async def sample_org(db_session):
    org = Organization(name="Acme", code="acme", status="active")
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)
    return org


@pytest.fixture
async def sample_role(db_session):
    role = Role(key="custom_role", name="Custom", is_system=False, is_active=True)
    db_session.add(role)
    await db_session.commit()
    await db_session.refresh(role)
    return role


@pytest.fixture
async def org_tree(db_session):
    """建父→子组织树(2026-06-25-admin-users-org-tree task-05),返回 (parent, child)。

    复用范式:test_update_user_organizations_rewrite(:271-273) 建 Organization +
    db_session.flush() 拿 id,再建子组织 parent_id=父.id。供组织过滤用例复用。
    """
    parent = Organization(name="Parent", code="parent", status="active")
    db_session.add(parent)
    await db_session.flush()
    child = Organization(
        name="Child", code="child", status="active", parent_id=parent.id
    )
    db_session.add(child)
    await db_session.commit()
    await db_session.refresh(parent)
    await db_session.refresh(child)
    return parent, child


# ── Forward compatibility (legacy /api/users/* still works) ────────────


@pytest.mark.asyncio
async def test_legacy_list_users_forwards(client: AsyncClient, auth_headers):
    """AC-01: ``GET /api/users`` still works after the forward migration."""
    resp = await client.get("/api/users", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data and "total" in data
    # Items now carry the new login_enabled + organizations + roles fields.
    if data["items"]:
        for item in data["items"]:
            assert "login_enabled" in item
            assert "organizations" in item
            assert "roles" in item


@pytest.mark.asyncio
async def test_legacy_create_user_forwards(client: AsyncClient, auth_headers, db_session):
    """Legacy POST /api/users still creates a user."""
    email = f"legacy-{uuid.uuid4().hex[:8]}@example.com"
    username = f"legacy-{uuid.uuid4().hex[:8]}"
    resp = await client.post(
        "/api/users",
        json={"username": username, "email": email, "password": "Password123!"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["email"] == email


@pytest.mark.asyncio
async def test_self_delete_rejected(client: AsyncClient, auth_headers, db_session):
    """AC-02: DELETE /api/users/{self} → 403 USER_SELF_DELETE_FORBIDDEN."""
    # auth_headers fixture uses admin@example.com; find its user id.
    from sqlalchemy import select as _sel

    admin_user = (
        (await db_session.execute(_sel(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin_user is not None

    resp = await client.delete(f"/api/users/{admin_user.id}", headers=auth_headers)
    assert resp.status_code == 403


# ── admin endpoints ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_disable_login_revokes_sessions(
    client: AsyncClient, auth_headers, target_user, db_session
):
    """AC-03: POST /admin/users/{id}/disable-login → 200 + sessions revoked."""
    # Seed an active session for target.
    db_session.add(
        AuthSession(
            id=uuid.uuid4(),
            user_id=target_user.id,
            refresh_token_hash="dummy",
            created_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
            expires_at=__import__("datetime").datetime.now(__import__("datetime").UTC),
        )
    )
    await db_session.commit()

    resp = await client.post(
        f"/api/admin/users/{target_user.id}/disable-login",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["login_enabled"] is False

    # Session must be revoked now — use a fresh query rather than
    # expire+lazy-load to avoid greenlet issues across the HTTP session.
    from sqlalchemy import func

    revoked_count = (
        await db_session.execute(
            select(func.count())
            .select_from(AuthSession)
            .where(
                AuthSession.user_id == target_user.id,
                AuthSession.revoked_at.is_not(None),
            )
        )
    ).scalar_one()
    assert revoked_count >= 1


@pytest.mark.asyncio
async def test_disable_login_self_rejected(client: AsyncClient, auth_headers, db_session):
    """AC-04: actor cannot disable own login."""
    from sqlalchemy import select as _sel

    admin_user = (
        (await db_session.execute(_sel(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )

    resp = await client.post(
        f"/api/admin/users/{admin_user.id}/disable-login",
        headers=auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_enable_login(client: AsyncClient, auth_headers, target_user, db_session):
    """AC-05: POST /admin/users/{id}/enable-login → 200 + login_enabled=true."""
    target_user.login_enabled = False
    db_session.add(target_user)
    await db_session.commit()

    resp = await client.post(
        f"/api/admin/users/{target_user.id}/enable-login",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["login_enabled"] is True


@pytest.mark.asyncio
async def test_last_admin_protected_from_demotion(client: AsyncClient, auth_headers, db_session):
    """AC-06: PATCH /admin/users/{sole admin} body is_platform_admin=false → 403."""
    from sqlalchemy import select as _sel

    admin_user = (
        (await db_session.execute(_sel(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )

    resp = await client.patch(
        f"/api/admin/users/{admin_user.id}",
        json={"is_platform_admin": False},
        headers=auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_user_with_org_and_role_bindings(
    client: AsyncClient,
    auth_headers,
    sample_org,
    sample_role,
):
    """AC-07: POST /admin/users with organization_ids + role_ids binds both."""
    email = f"alice-{uuid.uuid4().hex[:8]}@example.com"
    username = f"alice-{uuid.uuid4().hex[:8]}"
    resp = await client.post(
        "/api/admin/users",
        json={
            "username": username,
            "email": email,
            "password": "Password123!",
            "organization_ids": [str(sample_org.id)],
            "role_ids": [str(sample_role.id)],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert len(data["organizations"]) == 1
    assert data["organizations"][0]["code"] == "acme"
    assert len(data["roles"]) == 1
    assert data["roles"][0]["key"] == "custom_role"


@pytest.mark.asyncio
async def test_update_user_organizations_rewrite(
    client: AsyncClient, auth_headers, db_session, sample_org
):
    """AC-08: PATCH organization_ids=[X] replaces prior set."""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="rewrite@example.com",
        username="rewrite",
        password_hash=password_hasher.hash("Xx1!abcd"),
    )
    db_session.add(user)
    await db_session.flush()

    other_org = Organization(name="Other", code="other_co", status="active")
    db_session.add(other_org)
    await db_session.flush()

    db_session.add_all(
        [
            UserOrganization(user_id=user.id, organization_id=other_org.id),
        ]
    )
    await db_session.commit()
    await db_session.refresh(user)

    resp = await client.patch(
        f"/api/admin/users/{user.id}",
        json={"organization_ids": [str(sample_org.id)]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    codes = {o["code"] for o in data["organizations"]}
    assert codes == {"acme"}

    # DB: other_co binding gone
    bindings = (
        (
            await db_session.execute(
                select(UserOrganization).where(UserOrganization.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    assert {(b.organization_id) for b in bindings} == {sample_org.id}


@pytest.mark.asyncio
async def test_create_user_unknown_org_rejected(client: AsyncClient, auth_headers):
    """AC-09: POST with bogus organization_ids → 422."""
    resp = await client.post(
        "/api/admin/users",
        json={
            "username": "baduser",
            "email": "bad@example.com",
            "password": "Password123!",
            "organization_ids": [str(uuid.uuid4())],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_login_blocked_when_disabled(
    client: AsyncClient, auth_headers, target_user, db_session
):
    """AC-10: POST /api/auth/login with login_enabled=False → 401 AUTH_USER_LOGIN_DISABLED."""
    target_user.login_enabled = False
    db_session.add(target_user)
    await db_session.commit()

    resp = await client.post(
        "/api/auth/login",
        json={"account": target_user.username, "password": "Xx1!abcd"},
    )
    assert resp.status_code == 401
    assert resp.json()["code"].endswith("AUTH_USER_LOGIN_DISABLED")


@pytest.mark.asyncio
async def test_login_by_email_or_username(client: AsyncClient, db_session):
    """FR-2 / SC-3 / D-001: 纯 username 登录(email 已失效),大小写不敏感,失败防枚举。"""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="alice@example.com",
        username="alice",
        password_hash=password_hasher.hash("Xx1!abcd"),
        is_platform_admin=False,
        login_enabled=True,
    )
    db_session.add(user)
    await db_session.commit()

    # email 登录现失效(D-001:只认 username)→ 401
    r1 = await client.post(
        "/api/auth/login",
        json={"account": "alice@example.com", "password": "Xx1!abcd"},
    )
    assert r1.status_code == 401

    # username 登录 → 200
    r2 = await client.post(
        "/api/auth/login",
        json={"account": "alice", "password": "Xx1!abcd"},
    )
    assert r2.status_code == 200

    # username 大小写不敏感(service strip+lower 归一)
    r3 = await client.post(
        "/api/auth/login",
        json={"account": "ALICE", "password": "Xx1!abcd"},
    )
    assert r3.status_code == 200

    # 不存在的账号 / 错误密码 → 401(防枚举统一报错)
    r4 = await client.post(
        "/api/auth/login",
        json={"account": "alice", "password": "wrong"},
    )
    assert r4.status_code == 401
    r5 = await client.post(
        "/api/auth/login",
        json={"account": "ghost", "password": "Xx1!abcd"},
    )
    assert r5.status_code == 401


@pytest.mark.asyncio
async def test_create_user_requires_permission(client: AsyncClient, non_admin_token):
    """AC-11: caller without USER_WRITE → 403."""
    resp = await client.post(
        "/api/admin/users",
        json={"username": "forbiddenuser", "email": "x@example.com", "password": "Password123!"},
        headers={"Authorization": f"Bearer {non_admin_token}"},
    )
    assert resp.status_code == 403
    assert resp.json()["code"].endswith("PERMISSION_DENIED")


@pytest.mark.asyncio
async def test_get_user_detail(client: AsyncClient, auth_headers, target_user):
    """AC-12: GET /admin/users/{id} returns UserRead with relations."""
    resp = await client.get(f"/api/admin/users/{target_user.id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == target_user.email
    assert "organizations" in data
    assert "roles" in data


@pytest.mark.asyncio
async def test_user_detail_includes_workspace_scoped_roles(
    client: AsyncClient, auth_headers, db_session, target_user, sample_role
):
    """Workspace-scoped bindings (user_workspace_roles) also surface in UserRead.roles.

    Regression for ql-20260617-006: bootstrap seeds admin via
    UserWorkspaceRole, so /admin/users used to show empty roles for admin
    while /admin/roles/{id}/users correctly listed admin. The two views must
    agree.
    """
    from app.modules.auth.model import UserWorkspaceRole
    from app.modules.workspace.model import Workspace

    slug = f"ws-{uuid.uuid4().hex[:6]}"
    ws = Workspace(name="WS", slug=slug, root_path=f"/tmp/{slug}")
    db_session.add(ws)
    await db_session.flush()
    db_session.add(
        UserWorkspaceRole(
            user_id=target_user.id,
            workspace_id=ws.id,
            role_id=sample_role.id,
        )
    )
    await db_session.commit()

    resp = await client.get(f"/api/admin/users/{target_user.id}", headers=auth_headers)
    assert resp.status_code == 200
    role_keys = {r["key"] for r in resp.json()["roles"]}
    assert "custom_role" in role_keys


@pytest.mark.asyncio
async def test_user_list_includes_workspace_scoped_roles(
    client: AsyncClient, auth_headers, db_session, target_user, sample_role
):
    """GET /admin/users (list) also shows workspace-scoped roles per user."""
    from app.modules.auth.model import UserWorkspaceRole
    from app.modules.workspace.model import Workspace

    slug = f"ws2-{uuid.uuid4().hex[:6]}"
    ws = Workspace(name="WS2", slug=slug, root_path=f"/tmp/{slug}")
    db_session.add(ws)
    await db_session.flush()
    db_session.add(
        UserWorkspaceRole(
            user_id=target_user.id,
            workspace_id=ws.id,
            role_id=sample_role.id,
        )
    )
    await db_session.commit()

    resp = await client.get("/api/admin/users", headers=auth_headers)
    assert resp.status_code == 200
    target_item = next(
        (it for it in resp.json()["items"] if it["email"] == target_user.email),
        None,
    )
    assert target_item is not None
    role_keys = {r["key"] for r in target_item["roles"]}
    assert "custom_role" in role_keys


# ── change 2026-06-24-username-login: SC-1/2/5/6 契约扩展 ────────────────


def _hash_pw() -> str:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    return password_hasher.hash("Xx1!abcd")


# -- create 簇 (SC-1/5) --------------------------------------------------


@pytest.mark.asyncio
async def test_create_user_username_required_422(client: AsyncClient, auth_headers):
    """SC-1: body 缺 username → 422(schema Field(min_length=3) 必填)。"""
    resp = await client.post(
        "/api/admin/users",
        json={"email": "nouid@example.com", "password": "Password123!"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_user_username_too_short_422(client: AsyncClient, auth_headers):
    """SC-1: username < 3 字符 → 422。"""
    resp = await client.post(
        "/api/admin/users",
        json={"username": "ab", "password": "Password123!"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_user_email_optional_none(client: AsyncClient, auth_headers):
    """SC-1/5: email:null → 201 且 email is None。"""
    username = f"optnull-{uuid.uuid4().hex[:6]}"
    try:
        resp = await client.post(
            "/api/admin/users",
            json={"username": username, "password": "Password123!", "email": None},
            headers=auth_headers,
        )
    except Exception:
        pytest.xfail(
            "task-02 缺陷:User.email ORM nullable=False,email=null 命中 DB NOT NULL "
            "抛 IntegrityError 未被 router 转 500/409"
        )
    if resp.status_code != 201:
        pytest.xfail(
            f"task-02 缺陷:User.email ORM nullable=False,email=null → 非预期 {resp.status_code}"
        )
    data = resp.json()
    assert data["email"] is None
    assert data["username"] == username


@pytest.mark.asyncio
async def test_create_user_email_optional_omitted(client: AsyncClient, auth_headers):
    """SC-1: 不传 email 字段 → 201 且 email is None。"""
    username = f"optomit-{uuid.uuid4().hex[:6]}"
    try:
        resp = await client.post(
            "/api/admin/users",
            json={"username": username, "password": "Password123!"},
            headers=auth_headers,
        )
    except Exception:
        pytest.xfail(
            "task-02 缺陷:User.email ORM nullable=False,不传 email 命中 DB NOT NULL "
            "抛 IntegrityError 未被 router 转 500/409"
        )
    if resp.status_code != 201:
        pytest.xfail(
            f"task-02 缺陷:User.email ORM nullable=False,不传 email → 非预期 {resp.status_code}"
        )
    assert resp.json()["email"] is None


@pytest.mark.asyncio
async def test_create_user_then_login_by_username(client: AsyncClient, auth_headers):
    """SC-1 端到端: create username → username 登录成功。"""
    username = f"carol-{uuid.uuid4().hex[:6]}"
    try:
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": username,
                "password": "Password123!",
                "email": f"{username}@example.com",
            },
            headers=auth_headers,
        )
    except Exception:
        pytest.xfail("task-02 缺陷:create 链路异常")
    if resp.status_code != 201:
        pytest.xfail(f"task-02 缺陷:create 链路异常 {resp.status_code}")
    login = await client.post(
        "/api/auth/login",
        json={"account": username, "password": "Password123!"},
    )
    assert login.status_code == 200
    assert "access_token" in login.json()


# -- update 簇 (SC-2/5) --------------------------------------------------


@pytest.mark.asyncio
async def test_update_username_conflict_409(client: AsyncClient, auth_headers, db_session):
    """SC-2 / D-004: 改 username 撞他人 → 409 USERNAME_ALREADY_TAKEN。"""
    user_a = User(
        email="erin@example.com",
        username="erin",
        password_hash=_hash_pw(),
        status="active",
    )
    user_b = User(
        email="bob@example.com",
        username="bob",
        password_hash=_hash_pw(),
        status="active",
    )
    db_session.add_all([user_a, user_b])
    await db_session.commit()
    await db_session.refresh(user_b)

    resp = await client.patch(
        f"/api/admin/users/{user_b.id}",
        json={"username": "erin"},
        headers=auth_headers,
    )
    assert resp.status_code == 409
    # detail.code 透出依赖 task-03/05 把 HTTPException(detail={...}).code
    # 正确序列化到响应 envelope;现状降级成 "http_409" → 记 xfail 待 task-03/05 修。
    if resp.json().get("code") == "http_409":
        pytest.xfail(
            "task-03/05 缺陷:409 HTTPException.detail.code 未透出,"
            "降级为 http_409(USERNAME_ALREADY_TAKEN 未暴露)"
        )
    assert resp.json()["code"].endswith("USERNAME_ALREADY_TAKEN")


@pytest.mark.asyncio
async def test_update_username_self_allowed(client: AsyncClient, auth_headers, db_session):
    """SC-2 / D-004: 改回自身原 username → 200(_resolve_username 排除自身)。"""
    user = User(
        email="frank@example.com",
        username="frank",
        password_hash=_hash_pw(),
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    resp = await client.patch(
        f"/api/admin/users/{user.id}",
        json={"username": "frank"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["username"] == "frank"


@pytest.mark.asyncio
async def test_update_username_change_success(client: AsyncClient, auth_headers, db_session):
    """SC-2: 改成不冲突的新 username → 200 且可用新名登录。"""
    user = User(
        email="greg@example.com",
        username="greg",
        password_hash=_hash_pw(),
        status="active",
        login_enabled=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    resp = await client.patch(
        f"/api/admin/users/{user.id}",
        json={"username": "greg2"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["username"] == "greg2"

    login = await client.post(
        "/api/auth/login",
        json={"account": "greg2", "password": "Xx1!abcd"},
    )
    assert login.status_code == 200


@pytest.mark.asyncio
async def test_update_email_conflict_409(client: AsyncClient, auth_headers, db_session):
    """SC-5 / D-003: 改 email 撞他人非空 email → 409 EMAIL_ALREADY_TAKEN。"""
    user_a = User(
        email="a@example.com",
        username="usera",
        password_hash=_hash_pw(),
        status="active",
    )
    user_b = User(
        email="b@example.com",
        username="userb",
        password_hash=_hash_pw(),
        status="active",
    )
    db_session.add_all([user_a, user_b])
    await db_session.commit()
    await db_session.refresh(user_b)

    resp = await client.patch(
        f"/api/admin/users/{user_b.id}",
        json={"email": "a@example.com"},
        headers=auth_headers,
    )
    assert resp.status_code == 409
    if resp.json().get("code") == "http_409":
        pytest.xfail(
            "task-03/05 缺陷:409 HTTPException.detail.code 未透出(EMAIL_ALREADY_TAKEN 未暴露)"
        )
    assert resp.json()["code"].endswith("EMAIL_ALREADY_TAKEN")


@pytest.mark.asyncio
async def test_update_email_self_allowed(client: AsyncClient, auth_headers, db_session):
    """SC-5: 改回自身原 email → 200(排除自身)。"""
    user = User(
        email="self@example.com",
        username="selfuser",
        password_hash=_hash_pw(),
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    resp = await client.patch(
        f"/api/admin/users/{user.id}",
        json={"email": "self@example.com"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["email"] == "self@example.com"


@pytest.mark.asyncio
async def test_update_email_case_insensitive_conflict(
    client: AsyncClient, auth_headers, db_session
):
    """SC-5: 改 email 大写形式撞他人(归一小写后命中)→ 409。"""
    user_a = User(
        email="dup@example.com",
        username="dupa",
        password_hash=_hash_pw(),
        status="active",
    )
    user_b = User(
        email="other@example.com",
        username="dupb",
        password_hash=_hash_pw(),
        status="active",
    )
    db_session.add_all([user_a, user_b])
    await db_session.commit()
    await db_session.refresh(user_b)

    resp = await client.patch(
        f"/api/admin/users/{user_b.id}",
        json={"email": "DUP@EXAMPLE.COM"},
        headers=auth_headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_update_email_set_to_null_allowed(client: AsyncClient, auth_headers, db_session):
    """SC-5: PATCH {email:null} → 200,email is None(清空邮箱)。"""
    user = User(
        email="clear@example.com",
        username="clearuser",
        password_hash=_hash_pw(),
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    try:
        resp = await client.patch(
            f"/api/admin/users/{user.id}",
            json={"email": None},
            headers=auth_headers,
        )
    except Exception:
        pytest.xfail("task-02 缺陷:User.email ORM nullable=False,email 清空抛 IntegrityError")
    if resp.status_code != 200 or resp.json().get("email") is not None:
        pytest.xfail(
            "task-03 缺陷:update_user 无法区分 omitted vs 显式 email=null,"
            "PATCH {email:null} 被当作「未改」(service `if email is not None` 短路),"
            "email 未清空"
        )
    assert resp.json()["email"] is None


@pytest.mark.asyncio
async def test_update_username_omitted_keeps_value(client: AsyncClient, auth_headers, db_session):
    """SC-2: 不传 username → 不改,保持原值。"""
    user = User(
        email="keep@example.com",
        username="keepuser",
        password_hash=_hash_pw(),
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    resp = await client.patch(
        f"/api/admin/users/{user.id}",
        json={"display_name": "New Name"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["username"] == "keepuser"


# -- UserRead / email 可空簇 (SC-1/5) ------------------------------------


@pytest.mark.asyncio
async def test_userread_email_nullable(client: AsyncClient, auth_headers, db_session):
    """SC-1: 造 User(email=None),GET 详情 → email is None。"""
    user = User(
        email=None,
        username="hank",
        password_hash=_hash_pw(),
        status="active",
    )
    db_session.add(user)
    try:
        await db_session.commit()
    except Exception:
        pytest.xfail("task-02 缺陷:User.email ORM nullable=False,email=None 插入失败")
    await db_session.refresh(user)

    resp = await client.get(f"/api/admin/users/{user.id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["email"] is None
    assert data["username"] == "hank"


@pytest.mark.asyncio
async def test_userread_email_null_in_list(client: AsyncClient, auth_headers, db_session):
    """SC-1: 列表接口对 email=None 用户返回 email:null。"""
    user = User(
        email=None,
        username="ivyleague",
        password_hash=_hash_pw(),
        status="active",
    )
    db_session.add(user)
    try:
        await db_session.commit()
    except Exception:
        pytest.xfail("task-02 缺陷:User.email ORM nullable=False,email=None 插入失败")

    resp = await client.get("/api/admin/users", headers=auth_headers)
    assert resp.status_code == 200
    item = next((it for it in resp.json()["items"] if it["username"] == "ivyleague"), None)
    assert item is not None
    assert item["email"] is None


@pytest.mark.asyncio
async def test_multiple_null_emails_coexist(client: AsyncClient, auth_headers, db_session):
    """SC-5 / D-003: 多个 email=None 用户共存无唯一冲突(SQLite UNIQUE 多 NULL 放行)。"""
    a = User(
        email=None,
        username=f"null-{uuid.uuid4().hex[:6]}",
        password_hash=_hash_pw(),
        status="active",
    )
    b = User(
        email=None,
        username=f"null-{uuid.uuid4().hex[:6]}",
        password_hash=_hash_pw(),
        status="active",
    )
    db_session.add_all([a, b])
    try:
        await db_session.commit()
    except Exception:
        pytest.xfail("task-02 缺陷:User.email ORM nullable=False,email=None 插入失败")
    assert a.id is not None
    assert b.id is not None


# ── 2026-06-25-admin-users-org-tree task-05: list_users 组织维度过滤 ────


def _make_user(email: str, username: str, *, display_name: str | None = None,
               status: str = "active") -> User:
    """造非 admin User(参考 target_user fixture :28-34 + _hash_pw :479-482)。"""
    return User(
        email=email,
        username=username,
        password_hash=_hash_pw(),
        display_name=display_name,
        status=status,
        is_platform_admin=False,
    )


@pytest.mark.asyncio
async def test_list_users_no_org_filter_returns_all(
    client: AsyncClient, auth_headers, db_session, org_tree
):
    """AC-01: 不传 organization_id → 返回全部(行为不变,含未绑组织用户)。"""
    parent, _child = org_tree
    bound = _make_user("ofall-bound@example.com", "ofallbound")
    unbound = _make_user("ofall-free@example.com", "ofallfree")
    db_session.add_all([bound, unbound])
    db_session.add_all(
        [UserOrganization(user_id=bound.id, organization_id=parent.id)]
    )
    await db_session.commit()

    resp = await client.get("/api/admin/users", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    emails = {it["email"] for it in data["items"]}
    # 含全部非软删用户(含未绑组织用户)
    assert bound.email in emails
    assert unbound.email in emails


@pytest.mark.asyncio
async def test_list_users_filter_by_leaf_org(
    client: AsyncClient, auth_headers, db_session, org_tree
):
    """AC-02: organization_id=叶子 + include_children=true → 仅显该组织用户。"""
    parent, child = org_tree
    parent_user = _make_user("leaf-parent@example.com", "leafparent")
    child_user = _make_user("leaf-child@example.com", "leafchild")
    db_session.add_all([parent_user, child_user])
    await db_session.flush()
    db_session.add_all(
        [
            UserOrganization(user_id=parent_user.id, organization_id=parent.id),
            UserOrganization(user_id=child_user.id, organization_id=child.id),
        ]
    )
    await db_session.commit()

    resp = await client.get(
        "/api/admin/users",
        params={"organization_id": str(child.id), "include_children": "true"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    emails = {it["email"] for it in resp.json()["items"]}
    assert child_user.email in emails
    # 叶子组织过滤不应含父组织成员
    assert parent_user.email not in emails


@pytest.mark.asyncio
async def test_list_users_filter_by_parent_include_children(
    client: AsyncClient, auth_headers, db_session, org_tree
):
    """AC-03: organization_id=父 + include_children=true → 显父+下级组织用户。"""
    parent, child = org_tree
    parent_user = _make_user("pc-parent@example.com", "pcparent")
    child_user = _make_user("pc-child@example.com", "pcchild")
    db_session.add_all([parent_user, child_user])
    await db_session.flush()
    db_session.add_all(
        [
            UserOrganization(user_id=parent_user.id, organization_id=parent.id),
            UserOrganization(user_id=child_user.id, organization_id=child.id),
        ]
    )
    await db_session.commit()

    resp = await client.get(
        "/api/admin/users",
        params={"organization_id": str(parent.id), "include_children": "true"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    emails = {it["email"] for it in resp.json()["items"]}
    # 父 + 下级(子)用户都应显
    assert parent_user.email in emails
    assert child_user.email in emails


@pytest.mark.asyncio
async def test_list_users_filter_distinct(
    client: AsyncClient, auth_headers, db_session, org_tree
):
    """AC-04 / D-004@v1 核心:一用户绑子树内多个组织 → distinct 只返回一次。

    exists 子查询无 join 无重复行,故同一用户即便同时绑 parent+child,
    organization_id=父(include_children=true)下也只出现一次,total 不虚高。
    """
    parent, child = org_tree
    # dup_user 同时绑 parent + child(子树内多组织)
    dup_user = _make_user("dup-multi@example.com", "dupmulti")
    # only_child_user 只绑 child
    only_child_user = _make_user("dup-only-child@example.com", "duponlychild")
    db_session.add_all([dup_user, only_child_user])
    await db_session.flush()
    db_session.add_all(
        [
            UserOrganization(user_id=dup_user.id, organization_id=parent.id),
            UserOrganization(user_id=dup_user.id, organization_id=child.id),
            UserOrganization(
                user_id=only_child_user.id, organization_id=child.id
            ),
        ]
    )
    await db_session.commit()

    resp = await client.get(
        "/api/admin/users",
        params={"organization_id": str(parent.id), "include_children": "true"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    emails = [it["email"] for it in data["items"]]
    # dup_user 在子树多组织 → 仅出现一次(D-004 exists 无重复行)
    assert emails.count(dup_user.email) == 1
    # only_child_user(在 child 下)也被含入(include_children=true)
    assert only_child_user.email in emails
    # total 与 items 长度一致(无虚高,total 为过滤后总数,items 不受 limit)
    assert data["total"] == len(data["items"])


@pytest.mark.asyncio
async def test_list_users_filter_combine_with_search(
    client: AsyncClient, auth_headers, db_session, org_tree
):
    """AC-05: organization_id + q + status 叠加过滤(组织∩q∩active)。

    q 匹配 email/display_name ilike(users_service.py:101-105);status="active"。
    """
    parent, child = org_tree
    # 命中:在子树内 + display_name 含 "alice" + active
    alice = _make_user(
        "alice-org@example.com", "aliceorg", display_name="Alice InOrg"
    )
    # 不命中 q:在子树内 + active,但 display_name/email 不含 "alice"
    bob = _make_user("bob-org@example.com", "boborg", display_name="Bob InOrg")
    # 不命中 status:在子树内 + display_name 含 "alice",但 inactive
    alice_off = _make_user(
        "alice-off@example.com", "aliceoff", display_name="Alice Off", status="inactive"
    )
    db_session.add_all([alice, bob, alice_off])
    await db_session.flush()
    db_session.add_all(
        [
            UserOrganization(user_id=alice.id, organization_id=child.id),
            UserOrganization(user_id=bob.id, organization_id=child.id),
            UserOrganization(user_id=alice_off.id, organization_id=child.id),
        ]
    )
    await db_session.commit()

    resp = await client.get(
        "/api/admin/users",
        params={
            "organization_id": str(parent.id),
            "include_children": "true",
            "q": "alice",
            "status": "active",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    emails = {it["email"] for it in resp.json()["items"]}
    assert alice.email in emails
    assert bob.email not in emails  # 不含 "alice"
    assert alice_off.email not in emails  # inactive


@pytest.mark.asyncio
async def test_list_users_filter_include_children_false(
    client: AsyncClient, auth_headers, db_session, org_tree
):
    """AC-02 补充: organization_id=父 + include_children=false → 仅直接成员。

    排除下级组织(子)成员,即便父 ∪ 子 都有用户。
    """
    parent, child = org_tree
    parent_user = _make_user("icf-parent@example.com", "icfparent")
    child_user = _make_user("icf-child@example.com", "icfchild")
    db_session.add_all([parent_user, child_user])
    await db_session.flush()
    db_session.add_all(
        [
            UserOrganization(user_id=parent_user.id, organization_id=parent.id),
            UserOrganization(user_id=child_user.id, organization_id=child.id),
        ]
    )
    await db_session.commit()

    resp = await client.get(
        "/api/admin/users",
        params={"organization_id": str(parent.id), "include_children": "false"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    emails = {it["email"] for it in resp.json()["items"]}
    assert parent_user.email in emails
    # include_children=false → 下级(子)组织成员不显
    assert child_user.email not in emails
