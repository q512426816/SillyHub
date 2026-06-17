"""Tests for ``seed_platform_admin_role``.

Covers change ``2026-06-16-admin-org-role-center`` task-03 AC-04..AC-06, AC-09.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlmodel import col

from app.modules.auth.model import Role, RolePermission
from app.modules.auth.permissions import Permission
from app.modules.auth.service import seed_platform_admin_role


@pytest.mark.asyncio
async def test_seed_creates_role_with_all_permissions(db_session) -> None:
    """First call creates ``platform_admin`` role + binds every Permission."""
    await seed_platform_admin_role(db_session)

    role = (
        (await db_session.execute(select(Role).where(col(Role.key) == "platform_admin")))
        .scalars()
        .first()
    )
    assert role is not None
    assert role.is_system is True
    assert role.is_active is True

    perms = {
        row[0]
        for row in (
            await db_session.execute(
                select(col(RolePermission.permission)).where(col(RolePermission.role_id) == role.id)
            )
        ).all()
    }
    expected = {p.value for p in Permission}
    assert perms == expected


@pytest.mark.asyncio
async def test_seed_is_idempotent(db_session) -> None:
    """Second call must not create duplicates."""
    await seed_platform_admin_role(db_session)
    await seed_platform_admin_role(db_session)

    role_rows = (
        (await db_session.execute(select(Role).where(col(Role.key) == "platform_admin")))
        .scalars()
        .all()
    )
    assert len(role_rows) == 1

    perm_rows = (
        (
            await db_session.execute(
                select(col(RolePermission.permission)).where(
                    col(RolePermission.role_id) == role_rows[0].id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(perm_rows) == len(list(Permission))


@pytest.mark.asyncio
async def test_seed_backfills_missing_permissions(db_session) -> None:
    """If role exists but Permission set shrank then regrew, missing entries are added back."""
    await seed_platform_admin_role(db_session)

    role = (
        (await db_session.execute(select(Role).where(col(Role.key) == "platform_admin")))
        .scalars()
        .first()
    )
    assert role is not None

    # Delete one permission binding, then re-run seed → it should be re-added.
    await db_session.execute(
        RolePermission.__table__.delete().where(
            RolePermission.__table__.c.role_id == role.id,
            RolePermission.__table__.c.permission == Permission.PLATFORM_ADMIN.value,
        )
    )
    await db_session.commit()

    await seed_platform_admin_role(db_session)

    perms = {
        row[0]
        for row in (
            await db_session.execute(
                select(col(RolePermission.permission)).where(col(RolePermission.role_id) == role.id)
            )
        ).all()
    }
    assert Permission.PLATFORM_ADMIN.value in perms
