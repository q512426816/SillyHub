"""rbac.has_permission 判定链收紧专项测试。

变更 2026-09-20-workspace-member-visibility task-05（决策 D-001/D-002）：
直接对 ``rbac.has_permission`` 断言（不经 HTTP 依赖层），锁定 task-01
（commit 72c22616）/ task-03（commit 0c611260）收紧后的判定链语义——

工作区上下文内，平台级（``user_roles``）业务权限不再穿透，只有
``platform:admin`` 权限或 ``is_platform_admin`` 标志可以越成员门槛；
无工作区上下文的功能入口（``workspace_id=None``）维持平台级直通不变。

参数化 ``workspace:read`` 与 ``mcp:read`` 两组平台级业务权限（D-002：
收紧无白名单，不是只收 workspace:read 这一个权限）。

场景清单：
  A. 非成员 + 平台级角色持该业务权限：
     ``has_permission(workspace_id=W, perm)`` False（收紧本体），
     ``has_permission(None, perm)`` True（功能入口不变，FR-05）；
  B. 平台级角色含 ``platform:admin`` → 工作区上下文任意测的权限 True；
  C. ``is_platform_admin=True`` 用户（无任何角色行）→ True；
  D. ``UserWorkspaceRole`` 授 ``workspace_owner``（持 workspace:read 的角色）
     成员 → ``has_permission(W, WORKSPACE_READ)`` True（FR-06 对照组：
     收紧不影响真实成员路径），同一用户对非成员工作区仍 False。

夹具沿用 backend/conftest.py（db_session 为函数级 in-memory SQLite），
与 workspace/tests/test_platform_grant_list.py 同范式：真实建行跑真实 SQL。
权限缓存（core.permission_cache，Redis）在测试环境自然降级——Redis 不可用
时读写均吞错回退查 DB；可用时 root conftest 的 autouse ``_reset_redis_state``
每测试 FLUSHDB，且各测试用户均为新 uuid（缓存键 ``perm:{user_id}:*``
天然隔离），断言不受缓存污染。每个测试内先完成全部授权再断言，
避免同测试内回填缓存早于后续授权的时序问题。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.model import UserRole
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.workspace.model import Workspace

# D-002：两组互不相关的平台级业务权限参数化——证明收紧是普适规则而非白名单。
PLATFORM_BUSINESS_PERMS: list[Permission] = [Permission.WORKSPACE_READ, Permission.MCP_READ]


async def _make_user(db_session: AsyncSession, *, is_platform_admin: bool = False) -> User:
    from app.core.security import password_hasher

    user = User(
        id=uuid.uuid4(),
        email=f"rbac-scope-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_workspace(db_session: AsyncSession, *, name: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"{name}-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{name}-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _grant_platform_role(
    db_session: AsyncSession, *, user: User, key: str, permissions: list[str]
) -> None:
    """给 user 绑一个平台级角色（admin 模块 ``user_roles``），带指定权限集。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"{key}_{uuid.uuid4().hex[:8]}",
        name=key,
        description="test role for rbac workspace-scope",
    )
    db_session.add(role)
    for perm in permissions:
        db_session.add(RolePermission(role_id=role.id, permission=perm))
    db_session.add(UserRole(user_id=user.id, role_id=role.id))
    await db_session.commit()


async def _grant_workspace_role(
    db_session: AsyncSession,
    *,
    user: User,
    workspace: Workspace,
    key: str,
    permissions: list[str],
) -> None:
    """给 user 在指定工作区内授一个角色（``user_workspace_roles``）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"{key}_{uuid.uuid4().hex[:8]}",
        name=key,
        description="test workspace role for rbac workspace-scope",
    )
    db_session.add(role)
    for perm in permissions:
        db_session.add(RolePermission(role_id=role.id, permission=perm))
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=workspace.id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


@pytest.mark.parametrize("permission", PLATFORM_BUSINESS_PERMS)
async def test_platform_business_perm_blocked_in_workspace_context(
    db_session: AsyncSession, permission: Permission
) -> None:
    """场景 A：非成员 + 平台级角色持该业务权限。

    工作区上下文 False（平台级业务权限不穿透，D-001 收紧本体）；
    无工作区上下文 True（require_permission_any 功能入口语义不变，FR-05）。
    """
    ws = await _make_workspace(db_session, name="scope-a")
    user = await _make_user(db_session)
    await _grant_platform_role(
        db_session, user=user, key="plat_biz", permissions=[permission.value]
    )

    assert (
        await has_permission(db_session, user=user, permission=permission, workspace_id=ws.id)
        is False
    )
    assert (
        await has_permission(db_session, user=user, permission=permission, workspace_id=None)
        is True
    )


@pytest.mark.parametrize("permission", PLATFORM_BUSINESS_PERMS)
async def test_platform_admin_role_passes_workspace_context(
    db_session: AsyncSession, permission: Permission
) -> None:
    """场景 B：平台级角色含 platform:admin → 工作区上下文任意权限 True。

    角色只持 ``platform:admin``（不含被测业务权限本身），证明放行来自
    管理员准入段而非业务权限残留。
    """
    ws = await _make_workspace(db_session, name="scope-b")
    user = await _make_user(db_session)
    await _grant_platform_role(
        db_session, user=user, key="plat_admin", permissions=[Permission.PLATFORM_ADMIN.value]
    )

    assert (
        await has_permission(db_session, user=user, permission=permission, workspace_id=ws.id)
        is True
    )


@pytest.mark.parametrize("permission", PLATFORM_BUSINESS_PERMS)
async def test_platform_admin_flag_passes_workspace_context(
    db_session: AsyncSession, permission: Permission
) -> None:
    """场景 C：is_platform_admin=True 用户（无任何角色行）→ 短路 True。"""
    ws = await _make_workspace(db_session, name="scope-c")
    user = await _make_user(db_session, is_platform_admin=True)

    assert (
        await has_permission(db_session, user=user, permission=permission, workspace_id=ws.id)
        is True
    )


async def test_workspace_owner_member_has_workspace_read(
    db_session: AsyncSession,
) -> None:
    """场景 D：UserWorkspaceRole 授 workspace_owner（持 workspace:read）→ True。

    FR-06 对照组：收紧只挡平台级穿透，不影响工作区内真实成员的权限路径。
    同一用户对非成员工作区仍 False（成员资格按工作区隔离）。
    """
    own_ws = await _make_workspace(db_session, name="scope-d-own")
    other_ws = await _make_workspace(db_session, name="scope-d-other")
    user = await _make_user(db_session)
    await _grant_workspace_role(
        db_session,
        user=user,
        workspace=own_ws,
        key="workspace_owner",
        permissions=[Permission.WORKSPACE_READ.value],
    )

    assert (
        await has_permission(
            db_session,
            user=user,
            permission=Permission.WORKSPACE_READ,
            workspace_id=own_ws.id,
        )
        is True
    )
    assert (
        await has_permission(
            db_session,
            user=user,
            permission=Permission.WORKSPACE_READ,
            workspace_id=other_ws.id,
        )
        is False
    )
