"""UserService 支配权(platform-admin grant)校验测试。

覆盖 quick 安全加固:持 USER_WRITE 的非平台管理员不得在 create_user /
update_user 中授予 is_platform_admin 或绑定携带 platform:admin 权限的角色
(堵自提权 / 横向提权);平台管理员则可以。service 层直接构造 UserService 校验,
绕开 router 层 USER_WRITE 门(那是另一条独立防线,service 层为纵深防御)。
"""

from __future__ import annotations

import uuid

import pytest

from app.core.errors import PermissionDenied
from app.modules.admin.users_service import UserService
from app.modules.auth.model import Role, RolePermission, User
from app.modules.auth.permissions import Permission


def _mk_user(*, is_platform_admin: bool = False) -> User:
    return User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:8]}@example.com",
        username=f"u{uuid.uuid4().hex[:8]}",
        password_hash="x",
        is_platform_admin=is_platform_admin,
    )


async def _mk_platform_role(db_session) -> Role:
    """携带 platform:admin 权限的角色(等价 super_admin,migration 202605280900)。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"super-{uuid.uuid4().hex[:6]}",
        name="Super",
        is_system=False,
        is_active=True,
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission=Permission.PLATFORM_ADMIN.value))
    await db_session.commit()
    return role


async def _mk_plain_role(db_session) -> Role:
    """不带任何权限的普通角色。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"plain-{uuid.uuid4().hex[:6]}",
        name="Plain",
        is_system=False,
        is_active=True,
    )
    db_session.add(role)
    await db_session.commit()
    return role


# ── create_user ──────────────────────────────────────────────────────────────


async def test_non_admin_cannot_grant_is_platform_admin_on_create(db_session):
    """非平台管理员 → 创建 is_platform_admin=True 用户被拒(堵自提权)。"""
    actor = _mk_user(is_platform_admin=False)
    db_session.add(actor)
    await db_session.commit()
    svc = UserService(db_session, actor.id)
    with pytest.raises(PermissionDenied):
        await svc.create_user(
            username=f"t{uuid.uuid4().hex[:6]}",
            email=f"{uuid.uuid4().hex[:6]}@example.com",
            is_platform_admin=True,
        )


async def test_admin_can_grant_is_platform_admin_on_create(db_session):
    """平台管理员 → 可创建 is_platform_admin=True 用户。"""
    actor = _mk_user(is_platform_admin=True)
    db_session.add(actor)
    await db_session.commit()
    svc = UserService(db_session, actor.id)
    user, _ = await svc.create_user(
        username=f"t{uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:6]}@example.com",
        is_platform_admin=True,
    )
    assert user.is_platform_admin is True


async def test_non_admin_cannot_bind_platform_admin_role_on_create(db_session):
    """非平台管理员 → 创建时绑定 platform:admin 角色被拒。"""
    actor = _mk_user(is_platform_admin=False)
    role = await _mk_platform_role(db_session)
    db_session.add(actor)
    await db_session.commit()
    svc = UserService(db_session, actor.id)
    with pytest.raises(PermissionDenied):
        await svc.create_user(
            username=f"t{uuid.uuid4().hex[:6]}",
            email=f"{uuid.uuid4().hex[:6]}@example.com",
            role_ids=[role.id],
        )


async def test_non_admin_can_bind_plain_role_and_normal_user_on_create(db_session):
    """非平台管理员 → 创建普通用户 + 绑定普通角色放行(校验不过度封锁)。"""
    actor = _mk_user(is_platform_admin=False)
    role = await _mk_plain_role(db_session)
    db_session.add(actor)
    await db_session.commit()
    svc = UserService(db_session, actor.id)
    user, _ = await svc.create_user(
        username=f"t{uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:6]}@example.com",
        role_ids=[role.id],
    )
    assert user.id is not None


# ── update_user ──────────────────────────────────────────────────────────────


async def test_non_admin_cannot_promote_via_update(db_session):
    """非平台管理员 → update 授予 is_platform_admin=True 被拒。"""
    actor = _mk_user(is_platform_admin=False)
    target = _mk_user(is_platform_admin=False)
    db_session.add_all([actor, target])
    await db_session.commit()
    svc = UserService(db_session, actor.id)
    with pytest.raises(PermissionDenied):
        await svc.update_user(target.id, is_platform_admin=True)


async def test_non_admin_cannot_bind_platform_role_via_update(db_session):
    """非平台管理员 → update 绑定 platform:admin 角色被拒。"""
    actor = _mk_user(is_platform_admin=False)
    target = _mk_user(is_platform_admin=False)
    role = await _mk_platform_role(db_session)
    db_session.add_all([actor, target])
    await db_session.commit()
    svc = UserService(db_session, actor.id)
    with pytest.raises(PermissionDenied):
        await svc.update_user(target.id, role_ids=[role.id])


async def test_non_admin_can_bind_plain_role_via_update(db_session):
    """非平台管理员 → update 绑普通角色 / 显式降级不触发支配权(放行)。"""
    actor = _mk_user(is_platform_admin=False)
    target = _mk_user(is_platform_admin=False)
    role = await _mk_plain_role(db_session)
    db_session.add_all([actor, target])
    await db_session.commit()
    svc = UserService(db_session, actor.id)
    updated = await svc.update_user(target.id, is_platform_admin=False, role_ids=[role.id])
    assert updated.id == target.id
