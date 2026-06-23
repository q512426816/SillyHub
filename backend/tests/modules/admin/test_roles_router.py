"""Role management router tests.

Covers change ``2026-06-16-admin-org-role-center`` task-04 AC-01..AC-09.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import (
    Role,
    RolePermission,
    User,
    UserWorkspaceRole,
)
from app.modules.auth.permissions import Permission


@pytest.fixture
async def system_role(db_session):
    """Insert a system role directly so we can test protection logic."""
    role = Role(
        key="platform_admin_test",
        name="Platform Admin Test",
        description="System-protected test role",
        is_system=True,
        is_active=True,
    )
    db_session.add(role)
    await db_session.commit()
    await db_session.refresh(role)
    return role


@pytest.fixture
async def non_admin_token(db_session):
    """A user with no roles and no platform_admin flag."""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="normie@example.com",
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


@pytest.mark.asyncio
async def test_create_role_success(client: AsyncClient, auth_headers):
    """AC-01: POST returns 201 with the role + permissions bound."""
    payload = {
        "key": "qa_lead",
        "name": "QA Lead",
        "description": "Read + review",
        "permission_keys": [
            Permission.TASK_READ.value,
            Permission.CODE_REVIEW.value,
        ],
    }
    resp = await client.post("/api/admin/roles", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["key"] == "qa_lead"
    assert data["is_system"] is False
    assert data["is_active"] is True
    assert sorted(data["permissions"]) == sorted(
        [Permission.TASK_READ.value, Permission.CODE_REVIEW.value]
    )
    assert data["user_count"] == 0


@pytest.mark.asyncio
async def test_create_role_invalid_permission_rejected(client: AsyncClient, auth_headers):
    """AC-02: Unknown permission string → 422 validation_error."""
    payload = {
        "key": "bad_role",
        "name": "Bad",
        "permission_keys": ["nonexistent:perm"],
    }
    resp = await client.post("/api/admin/roles", json=payload, headers=auth_headers)
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


@pytest.mark.asyncio
async def test_create_role_key_duplicate(client: AsyncClient, auth_headers):
    """AC-03: Reusing an existing key → 409 ROLE_KEY_DUPLICATE."""
    first = await client.post(
        "/api/admin/roles",
        json={"key": "dup_key", "name": "First"},
        headers=auth_headers,
    )
    assert first.status_code == 201

    resp = await client.post(
        "/api/admin/roles",
        json={"key": "dup_key", "name": "Second"},
        headers=auth_headers,
    )
    assert resp.status_code == 409
    assert resp.json()["code"].endswith("ROLE_KEY_DUPLICATE")


@pytest.mark.asyncio
async def test_update_system_role_rejected(client: AsyncClient, auth_headers, system_role: Role):
    """AC-04: PATCH on is_system=True → 403 ROLE_SYSTEM_PROTECTED."""
    resp = await client.patch(
        f"/api/admin/roles/{system_role.id}",
        json={"description": "hacked"},
        headers=auth_headers,
    )
    assert resp.status_code == 403
    assert resp.json()["code"].endswith("ROLE_SYSTEM_PROTECTED")


@pytest.mark.asyncio
async def test_update_role_replaces_permissions(client: AsyncClient, auth_headers, db_session):
    """AC-05: PATCH replaces permission set; user_count preserved."""
    create = await client.post(
        "/api/admin/roles",
        json={
            "key": "dev_role",
            "name": "Dev",
            "permission_keys": [Permission.TASK_READ.value],
        },
        headers=auth_headers,
    )
    assert create.status_code == 201
    role_id = create.json()["id"]

    resp = await client.patch(
        f"/api/admin/roles/{role_id}",
        json={
            "name": "Dev Updated",
            "permission_keys": [
                Permission.TASK_READ.value,
                Permission.CODE_WRITE.value,
            ],
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["name"] == "Dev Updated"
    assert sorted(data["permissions"]) == sorted(
        [Permission.TASK_READ.value, Permission.CODE_WRITE.value]
    )

    bound_count = (
        await db_session.execute(
            select(func_count())
            .select_from(RolePermission.__table__)
            .where(RolePermission.__table__.c.role_id == uuid.UUID(role_id))
        )
    ).scalar_one()
    assert bound_count == 2


@pytest.mark.asyncio
async def test_update_role_accepts_ppm_problem_export(client: AsyncClient, auth_headers):
    """Regression: PATCH with ``ppm:problem:export`` must NOT 422.

    Bug: role 编辑器回传已绑定的 ``ppm:problem:export``(迁移
    problem:change-process-log:export 归并而来),但 ``Permission`` 枚举
    曾缺失 PPM_PROBLEM_EXPORT,校验失败返回 422。修复后该权限合法。
    """
    create = await client.post(
        "/api/admin/roles",
        json={"key": "problem_owner", "name": "Problem Owner"},
        headers=auth_headers,
    )
    assert create.status_code == 201
    role_id = create.json()["id"]

    resp = await client.patch(
        f"/api/admin/roles/{role_id}",
        json={"permission_keys": [Permission.PPM_PROBLEM_EXPORT.value]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["permissions"] == [Permission.PPM_PROBLEM_EXPORT.value]


@pytest.mark.asyncio
async def test_disable_system_role_rejected(
    client: AsyncClient, auth_headers, system_role: Role, db_session
):
    """AC-06: POST /disable on is_system=True → 403 ROLE_SYSTEM_PROTECTED, DB unchanged."""
    resp = await client.post(
        f"/api/admin/roles/{system_role.id}/disable",
        headers=auth_headers,
    )
    assert resp.status_code == 403
    assert resp.json()["code"].endswith("ROLE_SYSTEM_PROTECTED")

    await db_session.refresh(system_role)
    assert system_role.is_active is True


@pytest.mark.asyncio
async def test_delete_role_success(client: AsyncClient, auth_headers):
    """AC-07: DELETE custom role with user_count=0 → 204 + cascade."""
    create = await client.post(
        "/api/admin/roles",
        json={
            "key": "throwaway",
            "name": "Throwaway",
            "permission_keys": [Permission.TASK_READ.value],
        },
        headers=auth_headers,
    )
    role_id = create.json()["id"]

    resp = await client.delete(f"/api/admin/roles/{role_id}", headers=auth_headers)
    assert resp.status_code == 204

    get_resp = await client.get(f"/api/admin/roles/{role_id}", headers=auth_headers)
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_role_in_use_rejected(client: AsyncClient, auth_headers, db_session):
    """AC-08: DELETE role with user_count>0 → 409 ROLE_IN_USE + detail.user_count."""
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        name="Test WS",
        slug="test-ws",
        root_path="/tmp/test",
        type="app",
    )
    db_session.add(ws)

    role = Role(key="used_role", name="Used", is_system=False, is_active=True)
    db_session.add(role)

    user = User(
        email="role-user@example.com",
        password_hash=password_hasher.hash("Xx1!abcd"),
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.flush()

    db_session.add(UserWorkspaceRole(user_id=user.id, role_id=role.id, workspace_id=ws.id))
    await db_session.commit()
    await db_session.refresh(role)

    resp = await client.delete(f"/api/admin/roles/{role.id}", headers=auth_headers)
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"].endswith("ROLE_IN_USE")
    assert body["details"]["user_count"] == 1


@pytest.mark.asyncio
async def test_list_roles_requires_permission(client: AsyncClient, non_admin_token: str):
    """AC-09: Unauthorised caller → 403 PERMISSION_DENIED."""
    resp = await client.get(
        "/api/admin/roles",
        headers={"Authorization": f"Bearer {non_admin_token}"},
    )
    assert resp.status_code == 403
    assert resp.json()["code"].endswith("PERMISSION_DENIED")


@pytest.mark.asyncio
async def test_list_roles_returns_paginated_envelope(client: AsyncClient, auth_headers):
    """Bonus: ``GET /api/admin/roles`` returns RoleListResponse shape."""
    resp = await client.get("/api/admin/roles", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert {"items", "total", "page", "size"} <= data.keys()
    assert data["page"] == 1


@pytest.mark.asyncio
async def test_list_role_users_merges_platform_and_workspace(
    client: AsyncClient, auth_headers, db_session
):
    """``GET /api/admin/roles/{id}/users`` returns platform + workspace bindings.

    Platform binding (``user_roles``) → ``binding_type=platform``;
    workspace binding (``user_workspace_roles``) → ``binding_type=workspace``
    with ``workspace_name`` populated. A user bound both ways appears twice,
    keeping the response shape consistent with ``user_count`` in the list view.
    """
    from app.modules.admin.model import UserRole
    from app.modules.workspace.model import Workspace

    ws = Workspace(name="Test WS", slug="test-ws-list-users", root_path="/tmp/test-lu", type="app")
    db_session.add(ws)
    role = Role(key="list_users_role", name="List Users Role", is_system=False, is_active=True)
    db_session.add(role)
    platform_user = User(
        email="platform-user@example.com",
        password_hash=password_hasher.hash("Xx1!abcd"),
        is_platform_admin=False,
    )
    ws_user = User(
        email="ws-user@example.com",
        password_hash=password_hasher.hash("Xx1!abcd"),
        is_platform_admin=False,
    )
    db_session.add_all([platform_user, ws_user])
    await db_session.flush()

    db_session.add(UserRole(user_id=platform_user.id, role_id=role.id))
    db_session.add(UserWorkspaceRole(user_id=ws_user.id, role_id=role.id, workspace_id=ws.id))
    await db_session.commit()
    await db_session.refresh(role)

    resp = await client.get(f"/api/admin/roles/{role.id}/users", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    by_email = {item["email"]: item for item in data["items"]}
    assert by_email["platform-user@example.com"]["binding_type"] == "platform"
    assert by_email["platform-user@example.com"]["workspace_name"] is None
    assert by_email["ws-user@example.com"]["binding_type"] == "workspace"
    assert by_email["ws-user@example.com"]["workspace_name"] == "Test WS"


@pytest.mark.asyncio
async def test_list_role_users_empty(client: AsyncClient, auth_headers, db_session):
    """Role with no bindings returns ``{items: [], total: 0}``."""
    role = Role(key="empty_role_lu", name="Empty", is_system=False, is_active=True)
    db_session.add(role)
    await db_session.commit()
    await db_session.refresh(role)

    resp = await client.get(f"/api/admin/roles/{role.id}/users", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0}


@pytest.mark.asyncio
async def test_list_role_users_role_not_found(client: AsyncClient, auth_headers):
    """Unknown role_id → 404 ROLE_NOT_FOUND."""
    resp = await client.get(f"/api/admin/roles/{uuid.uuid4()}/users", headers=auth_headers)
    assert resp.status_code == 404
    assert resp.json()["code"].endswith("ROLE_NOT_FOUND")


def func_count():
    """Import-safe alias for ``sqlalchemy.func.count`` to avoid leakage."""
    from sqlalchemy import func

    return func.count()
