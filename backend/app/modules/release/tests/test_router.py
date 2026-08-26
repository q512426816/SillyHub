"""HTTP-level tests for Release and Archive routers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.workspace.model import Workspace


async def _setup_workspace_and_user(db_session, tmp_path: Path) -> dict:
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Test WS",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path=str(tmp_path),
        status="active",
    )
    db_session.add(ws)

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=f"test-{user_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Test",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)
    await db_session.commit()

    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=True,
        settings=settings,
    )
    return {"ws_id": ws_id, "user_id": user_id, "token": token}


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── Release ────────────────────────────────────────────────────


async def test_create_release(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0", "title": "First Release"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["version"] == "v1.0.0"
    assert body["status"] == "draft"


async def test_list_releases(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    # Create 2 releases
    await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0"},
        headers=_auth(refs["token"]),
    )
    await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v2.0.0"},
        headers=_auth(refs["token"]),
    )

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/releases",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_approve_release(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0", "target_environment": "production"},
        headers=_auth(refs["token"]),
    )
    release_id = create_resp.json()["id"]

    # Create second user for approval
    approver_id = uuid.uuid4()
    approver = User(
        id=approver_id,
        email=f"approver-{approver_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Approver",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(approver)
    await db_session.commit()

    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    approver_token, _ = create_access_token(
        user_id=approver.id,
        email=approver.email,
        is_admin=True,
        settings=settings,
    )

    resp = await client.post(
        f"/api/releases/{release_id}/approve",
        json={"verdict": "approve", "comment": "LGTM"},
        headers=_auth(approver_token),
    )
    assert resp.status_code == 201
    assert resp.json()["verdict"] == "approve"


async def test_deploy_staging_release(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0", "target_environment": "staging"},
        headers=_auth(refs["token"]),
    )
    release_id = create_resp.json()["id"]

    # Move to staging first
    from app.modules.release.model import Release

    release = await db_session.get(Release, uuid.UUID(release_id))
    release.status = "staging"
    await db_session.commit()

    resp = await client.post(
        f"/api/releases/{release_id}/deploy",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "deployed"


async def test_rollback_release(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0"},
        headers=_auth(refs["token"]),
    )
    release_id = create_resp.json()["id"]

    from datetime import UTC, datetime

    from app.modules.release.model import Release

    release = await db_session.get(Release, uuid.UUID(release_id))
    release.status = "deployed"
    release.deployed_at = datetime.now(UTC)
    await db_session.commit()

    resp = await client.post(
        f"/api/releases/{release_id}/rollback",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rolled_back"


async def test_release_no_auth_401(client, db_session, tmp_path):
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0"},
    )
    assert resp.status_code == 401


async def test_promote_release_succeeds(client, db_session, tmp_path):
    """promote 路由路径无 workspace_id，须用 require_permission_any（原 require_permission 恒 422）。"""
    refs = await _setup_workspace_and_user(db_session, tmp_path)
    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/releases",
        json={"version": "v1.0.0"},
        headers=_auth(refs["token"]),
    )
    assert create_resp.status_code == 201
    release_id = create_resp.json()["id"]

    resp = await client.post(
        f"/api/releases/{release_id}/promote",
        headers=_auth(refs["token"]),
    )
    # 修复前：恒 422（路径无 workspace_id 占位符但依赖声明必填）。修复后：200 draft→staging。
    assert resp.status_code == 200
    assert resp.json()["status"] == "staging"


# ── ql-20260826-011：对象级鉴权（跨工作区越权 / IDOR）─────────────────────────


async def _seed_two_workspaces_with_release(db_session, tmp_path: Path) -> dict:
    """A 工作区（仅 DEPLOY_PRODUCTION 用户）+ B 工作区（含一张 staging 发布单）。"""
    from app.modules.release.schema import ReleaseCreate
    from app.modules.release.service import ReleaseService

    ws_a = Workspace(
        id=uuid.uuid4(),
        name="WS A",
        slug=f"ws-a-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "a"),
        status="active",
    )
    ws_b = Workspace(
        id=uuid.uuid4(),
        name="WS B",
        slug=f"ws-b-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "b"),
        status="active",
    )
    db_session.add_all([ws_a, ws_b])

    deployer_a = User(
        id=uuid.uuid4(),
        email=f"deployer-a-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="deployer-a",
        status="active",
    )
    member_b = User(
        id=uuid.uuid4(),
        email=f"member-b-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="member-b",
        status="active",
    )
    db_session.add_all([deployer_a, member_b])

    from app.modules.auth.model import Role, RolePermission, UserWorkspaceRole

    role_a = Role(
        id=uuid.uuid4(),
        key=f"role-a-{uuid.uuid4().hex[:8]}",
        name="Role A",
        description="test role",
    )
    db_session.add(role_a)
    db_session.add(RolePermission(role_id=role_a.id, permission="deploy:production"))
    db_session.add(
        UserWorkspaceRole(
            user_id=deployer_a.id,
            workspace_id=ws_a.id,
            role_id=role_a.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    release = await ReleaseService(db_session).create(
        ws_b.id,
        member_b.id,
        ReleaseCreate(version="v1.0.0", title="B 工作区发布"),
    )

    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    token_a, _ = create_access_token(
        user_id=deployer_a.id,
        email=deployer_a.email,
        is_admin=False,
        settings=settings,
    )
    token_b, _ = create_access_token(
        user_id=member_b.id,
        email=member_b.email,
        is_admin=False,
        settings=settings,
    )
    return {
        "ws_a": ws_a.id,
        "ws_b": ws_b.id,
        "deployer_a_token": token_a,
        "member_b_token": token_b,
        "release_id": release.id,
    }


async def test_approve_release_cross_workspace_403(client, db_session, tmp_path):
    """A 工作区 DEPLOY_PRODUCTION 用户审批 B 工作区发布单 → 403（原 require_permission_any 放行）。"""
    refs = await _seed_two_workspaces_with_release(db_session, tmp_path)
    resp = await client.post(
        f"/api/releases/{refs['release_id']}/approve",
        json={"verdict": "approve"},
        headers=_auth(refs["deployer_a_token"]),
    )
    assert resp.status_code == 403


async def test_deploy_release_cross_workspace_403(client, db_session, tmp_path):
    """A 工作区 DEPLOY_PRODUCTION 用户部署 B 工作区发布单 → 403。"""
    refs = await _seed_two_workspaces_with_release(db_session, tmp_path)
    resp = await client.post(
        f"/api/releases/{refs['release_id']}/deploy",
        headers=_auth(refs["deployer_a_token"]),
    )
    assert resp.status_code == 403


async def test_list_approvals_cross_workspace_403(client, db_session, tmp_path):
    """无 B 工作区成员身份的登录用户枚举 B 发布单审批记录 → 403（原仅登录校验）。"""
    refs = await _seed_two_workspaces_with_release(db_session, tmp_path)
    outsider = User(
        id=uuid.uuid4(),
        email=f"outsider-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="outsider",
        status="active",
    )
    db_session.add(outsider)
    await db_session.commit()

    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=outsider.id,
        email=outsider.email,
        is_admin=False,
        settings=get_settings(),
    )
    resp = await client.get(
        f"/api/releases/{refs['release_id']}/approvals",
        headers=_auth(token),
    )
    assert resp.status_code == 403


async def test_promote_release_cross_workspace_403(client, db_session, tmp_path):
    """A 工作区 DEPLOY_PRODUCTION（无 DEPLOY_STAGING）用户 promote B 发布单 → 403。

    注意 DEPLOY_PRODUCTION 与 DEPLOY_STAGING 是独立权限；A 用户只授了前者。
    """
    refs = await _seed_two_workspaces_with_release(db_session, tmp_path)
    resp = await client.post(
        f"/api/releases/{refs['release_id']}/promote",
        headers=_auth(refs["deployer_a_token"]),
    )
    assert resp.status_code == 403
