"""Init endpoint permission boundary tests — 2026-10-12-init-permission-relax.

修订 2026-08-14-security-audit-remediation FR-09 的权限档位：``POST
/api/workspaces/{id}/init`` 由 workspace-scoped ``workspace:write`` 放宽为
``workspace:read``（用户裁决 2026-10-12：init 语义是"为当前成员初始化本地
副本"（D-002/D-009），developer 等只读角色是它的日常消费者；服务层本就
强制成员 daemon 绑定，无绑定走既有 409 MemberBindingNotFound）。

三用例：
- developer 成员（角色仅 workspace:read，与生产权限精简后种子一致）无绑定
  → 409 而非 403（权限门放行的判别信号）；
- 非本工作区成员 → 仍 403（FR-09 工作区隔离意图不回退）；
- activate 端点不动 → 非成员仍 403（WORKSPACE_WRITE 保持，FR-04）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


@pytest.fixture()
async def readonly_role(db_session):
    """仅含 ``workspace:read`` 一个权限点的成员角色。

    对齐生产权限精简（2026-10-08-rbac-dead-permissions-cleanup）后 developer
    的真实权限面——不复刻旧测试夹具里 developer 带 workspace:write 的漂移。
    """
    from app.modules.auth.model import Role, RolePermission
    from app.modules.auth.permissions import Permission

    role = Role(
        id=uuid.uuid4(),
        key="dev_readonly_init_t",
        name="Developer (read-only, init test)",
        is_system=True,
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission=Permission.WORKSPACE_READ.value))
    await db_session.commit()
    return role


async def _make_user_and_token(db_session, *, email: str):
    """Create an active user + bearer token (hermetic, per-test SQLite)."""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    u = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=password_hasher.hash("Pass123!"),
        display_name="U",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    token, _ = create_access_token(
        user_id=u.id,
        email=u.email,
        is_admin=False,
        settings=get_settings(),
    )
    return u, token


async def _make_workspace(db_session, tmp_path, *, name: str):
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _bind_member(db_session, *, workspace_id, user_id, role_id):
    from app.modules.auth.model import UserWorkspaceRole

    db_session.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role_id,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_init_developer_member_without_binding_gets_409_not_403(
    client: AsyncClient, db_session, readonly_role, tmp_path
):
    """仅 workspace:read 的成员发起 init 必须过权限门：无 daemon 绑定 → 409。

    旧实现（WORKSPACE_WRITE 门）下此用例得 403 —— 本变更的先红信号。
    """
    user, token = await _make_user_and_token(db_session, email="dev-init@x.com")
    ws = await _make_workspace(db_session, tmp_path, name="InitRelax WS")
    await _bind_member(db_session, workspace_id=ws.id, user_id=user.id, role_id=readonly_role.id)

    resp = await client.post(f"/api/workspaces/{ws.id}/init", headers=_bearer(token))
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == "member_binding_not_found"


@pytest.mark.asyncio
async def test_init_non_member_still_403(client: AsyncClient, db_session, readonly_role, tmp_path):
    """非本工作区成员发起 init → 仍 403（FR-09 工作区隔离意图不回退）。"""
    _outsider, token = await _make_user_and_token(db_session, email="outsider-init@x.com")
    member, _ = await _make_user_and_token(db_session, email="member-init@x.com")
    ws = await _make_workspace(db_session, tmp_path, name="InitIsolation WS")
    # member 有绑定、outsider 没有——outsider 的 403 与角色无关。
    await _bind_member(db_session, workspace_id=ws.id, user_id=member.id, role_id=readonly_role.id)

    resp = await client.post(f"/api/workspaces/{ws.id}/init", headers=_bearer(token))
    assert resp.status_code == 403, resp.text
    body = resp.json()
    assert body["details"]["workspace_id"] == str(ws.id)


@pytest.mark.asyncio
async def test_activate_still_requires_write_non_member_403(
    client: AsyncClient, db_session, readonly_role, tmp_path
):
    """activate 端点不动（FR-04）：非成员仍 403，权限门保持 WORKSPACE_WRITE。"""
    _outsider, token = await _make_user_and_token(db_session, email="outsider-act@x.com")
    ws = await _make_workspace(db_session, tmp_path, name="ActUntouched WS")

    resp = await client.post(f"/api/workspaces/{ws.id}/activate", headers=_bearer(token))
    assert resp.status_code == 403, resp.text
    body = resp.json()
    assert body["details"]["permission"] == "workspace:write"
