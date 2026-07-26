"""business_member whitelist + cache invalidation + RBAC chain (task-03).

Change 2026-07-25-daemon-borrow-for-business task-03 / FR-03 / D-006@v2：

覆盖 members_service 侧三件事：
  1. ``ROLE_KEY_WHITELIST`` 含 ``business_member``（owner 可经成员接口授予）；
  2. ``add_or_update_member(role_key="business_member")`` 落地成功 **且** 触发
     ``invalidate_all_permissions``（R-05：grant 后清缓存，首次借用不被旧缓存挡）；
  3. 端到端 RBAC 链：被授 business_member 的用户在该工作空间内
     ``has_permission(DAEMON_BORROW)`` / ``has_permission(TASK_RUN_AGENT)`` 为 True，
     且不越权拿到 WORKSPACE_WRITE / CODE_WRITE（business_member 无写权限）。

测试范式照抄 ``tests/modules/test_permission_cache.py``：``_FakeRedis`` 内存替身 +
``monkeypatch.setattr("app.core.permission_cache.get_redis", ...)``。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import Role, RolePermission, User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.workspace import members_service
from app.modules.workspace.model import Workspace

pytestmark = pytest.mark.asyncio


# ── 内存 Redis 替身（照抄 test_permission_cache 范式）──────────────────────


class _FakeRedis:
    """最小内存 Redis 替身：支撑 get/set/delete/scan_iter。"""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self._store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._store[key] = value

    async def delete(self, *keys: str) -> int:
        deleted = 0
        for k in keys:
            if k in self._store:
                del self._store[k]
                deleted += 1
        return deleted

    async def scan_iter(self, *, match: str, count: int = 100):  # type: ignore[no-untyped-def]
        import fnmatch

        for k in list(self._store.keys()):
            if fnmatch.fnmatch(k, match):
                yield k


# ── helpers ─────────────────────────────────────────────────────────────────


async def _seed_business_member_role(db_session: AsyncSession) -> Role:
    """种 business_member 角色 + 三条权限（对齐迁移 BUSINESS_MEMBER_PERMISSIONS）。"""
    role = Role(
        id=uuid.uuid4(),
        key="business_member",
        name="业务成员",
        description="业务/管理人员",
        is_system=True,
    )
    db_session.add(role)
    await db_session.flush()
    for perm in (
        Permission.TASK_RUN_AGENT,
        Permission.DAEMON_BORROW,
        Permission.WORKSPACE_READ,
    ):
        db_session.add(RolePermission(role_id=role.id, permission=perm.value))
    await db_session.commit()
    await db_session.refresh(role)
    return role


async def _seed_workspace_and_user(
    db_session: AsyncSession, tmp_path: Any
) -> tuple[Workspace, User]:
    ws = Workspace(
        id=uuid.uuid4(),
        name="W",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path),
        status="active",
    )
    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="U",
        status="active",
        is_platform_admin=False,
    )
    db_session.add_all([ws, user])
    await db_session.commit()
    await db_session.refresh(ws)
    await db_session.refresh(user)
    return ws, user


# ---------------------------------------------------------------------------
# 1. ROLE_KEY_WHITELIST 含 business_member（D-006@v2 / F-04）
# ---------------------------------------------------------------------------


async def test_whitelist_includes_business_member() -> None:
    """members_service 白名单接受 business_member（owner 可经成员接口授予）。"""
    assert "business_member" in members_service.ROLE_KEY_WHITELIST


# ---------------------------------------------------------------------------
# 2. grant business_member → invalidate_all_permissions 被调（R-05）
# ---------------------------------------------------------------------------


async def test_grant_business_member_invalidates_permission_cache(
    db_session: AsyncSession, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``add_or_update_member(role_key="business_member")`` commit 后清权限缓存。

    R-05 红线：grant 后必须 ``invalidate_all_permissions``，否则首次借用命中
    旧 ``perm:{user_id}:{ws_id}`` 缓存（不含 daemon:borrow）而 403。
    members_service 对所有角色 grant 已统一调失效；本测试锁定 business_member
    也走该契约（防回归）。
    """
    role = await _seed_business_member_role(db_session)
    ws, user = await _seed_workspace_and_user(db_session, tmp_path)

    # spy：替换 members_service 命名空间里已绑定的 invalidate_all_permissions
    invalidate_calls = {"count": 0}

    async def _spy_invalidate() -> None:
        invalidate_calls["count"] += 1

    monkeypatch.setattr(members_service, "invalidate_all_permissions", _spy_invalidate)

    row = await members_service.add_or_update_member(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        role_key="business_member",
        granted_by=None,
    )
    assert row.role_id == role.id
    assert invalidate_calls["count"] == 1


async def test_update_member_role_to_business_member_invalidates_cache(
    db_session: AsyncSession, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """把已有成员切成 business_member 也清缓存（update_member_role 同契约）。"""
    await _seed_business_member_role(db_session)
    # 额外种 developer 角色作为起点（避免 update 时 role_not_seeded）
    dev_role = Role(
        id=uuid.uuid4(),
        key="developer",
        name="Developer",
        is_system=True,
    )
    db_session.add(dev_role)
    await db_session.commit()
    await db_session.refresh(dev_role)

    ws, user = await _seed_workspace_and_user(db_session, tmp_path)
    # 先授 developer
    await members_service.add_or_update_member(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        role_key="developer",
        granted_by=None,
    )

    invalidate_calls = {"count": 0}

    async def _spy_invalidate() -> None:
        invalidate_calls["count"] += 1

    monkeypatch.setattr(members_service, "invalidate_all_permissions", _spy_invalidate)

    await members_service.update_member_role(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        role_key="business_member",
    )
    assert invalidate_calls["count"] == 1


# ---------------------------------------------------------------------------
# 3. 端到端 RBAC 链：business_member 拿到 daemon:borrow + task:run_agent
# ---------------------------------------------------------------------------


async def test_business_member_rbac_chain_grants_borrow_and_run_agent(
    db_session: AsyncSession, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """被授 business_member 的用户在该 ws 内 has_permission 返回:
    DAEMON_BORROW=True / TASK_RUN_AGENT=True（FR-03 触发端点 + 借用回退授权），
    WORKSPACE_WRITE=False / CODE_WRITE=False（不越权，business_member 无写权限）。
    """
    # 用 _FakeRedis 替身，避免 has_permission 命中真实 Redis（降级噪声 + 慢）。
    fake_redis = _FakeRedis()
    monkeypatch.setattr("app.core.permission_cache.get_redis", lambda: fake_redis)

    await _seed_business_member_role(db_session)
    ws, user = await _seed_workspace_and_user(db_session, tmp_path)
    await members_service.add_or_update_member(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        role_key="business_member",
        granted_by=None,
    )

    # 刷新后 has_permission 走 user_workspace_roles → roles → role_permissions 链
    assert (
        await has_permission(
            db_session,
            user=user,
            permission=Permission.DAEMON_BORROW,
            workspace_id=ws.id,
        )
        is True
    )
    assert (
        await has_permission(
            db_session,
            user=user,
            permission=Permission.TASK_RUN_AGENT,
            workspace_id=ws.id,
        )
        is True
    )
    assert (
        await has_permission(
            db_session,
            user=user,
            permission=Permission.WORKSPACE_READ,
            workspace_id=ws.id,
        )
        is True
    )
    # 不越权：business_member 不带写权限
    assert (
        await has_permission(
            db_session,
            user=user,
            permission=Permission.WORKSPACE_WRITE,
            workspace_id=ws.id,
        )
        is False
    )
    assert (
        await has_permission(
            db_session,
            user=user,
            permission=Permission.CODE_WRITE,
            workspace_id=ws.id,
        )
        is False
    )
