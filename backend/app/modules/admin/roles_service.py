"""Role management service.

Backend of ``/api/admin/roles`` (change ``2026-06-16-admin-org-role-center``
task-04). System roles (``is_system=True``) are write-protected;
delete is gated on ``user_count == 0`` across both the platform-level
``user_roles`` table and the workspace-scoped ``user_workspace_roles``
table.

Audit logging is explicit (create / update / disable / enable / delete
all emit ``role.*`` rows into ``audit_logs``). The generic SQLAlchemy
hook in :mod:`app.core.audit_hooks` is not wired into the production
lifespan, so we mirror the users_service pattern and write AuditLog
directly.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import (
    RoleInUse,
    RoleKeyDuplicate,
    RoleNotFound,
    RoleSystemProtected,
)
from app.core.permission_cache import invalidate_all_permissions
from app.modules.admin.schema import (
    RoleCreateRequest,
    RoleListResponse,
    RoleRead,
    RoleUpdateRequest,
    RoleUserListResponse,
    RoleUserRead,
)
from app.modules.auth.model import (
    Role,
    RolePermission,
    User,
    UserWorkspaceRole,
)
from app.modules.workflow.model import AuditLog


def _user_roles_model() -> type:
    """Return the ``UserRole`` ORM class.

    Imported lazily from :mod:`app.modules.admin.model` (task-05 lands
    the actual class body). Failing to import indicates task-05 has
    not shipped yet — fall back to a sentinel that ``_count_users``
    treats as "no platform-level bindings" so task-04 can ship
    independently on top of the workspace role table alone.
    """

    try:
        from app.modules.admin.model import UserRole
    except ImportError:  # pragma: no cover - defensive
        return None  # type: ignore[return-value]
    return UserRole


async def _count_users(session: AsyncSession, role_id: uuid.UUID) -> int:
    """Distinct user count across ``user_roles`` + ``user_workspace_roles``."""
    user_ids_workspace: set[uuid.UUID] = {
        row[0]
        for row in (
            await session.execute(
                select(col(UserWorkspaceRole.user_id)).where(
                    col(UserWorkspaceRole.role_id) == role_id
                )
            )
        ).all()
    }

    user_ids_platform: set[uuid.UUID] = set()
    user_role_cls = _user_roles_model()
    if user_role_cls is not None:
        user_ids_platform = {
            row[0]
            for row in (
                await session.execute(
                    select(user_role_cls.user_id).where(user_role_cls.role_id == role_id)
                )
            ).all()
        }

    return len(user_ids_workspace | user_ids_platform)


async def _to_read(session: AsyncSession, role: Role) -> RoleRead:
    perms = [
        row[0]
        for row in (
            await session.execute(
                select(col(RolePermission.permission)).where(col(RolePermission.role_id) == role.id)
            )
        ).all()
    ]
    user_count = await _count_users(session, role.id)
    return RoleRead(
        id=role.id,
        key=role.key,
        name=role.name,
        description=role.description,
        is_system=role.is_system,
        is_active=role.is_active,
        permissions=perms,
        user_count=user_count,
        created_at=role.created_at,
        updated_at=role.updated_at,
    )


class RoleService:
    """All write operations are guarded by ``require_permission_any``
    at the router layer; this class focuses on business rules."""

    def __init__(self, session: AsyncSession, actor_id: uuid.UUID) -> None:
        self._session = session
        self._actor_id = actor_id

    def _audit(
        self,
        *,
        action: str,
        role: Role,
        details: dict | None = None,
    ) -> None:
        self._session.info.setdefault(
            "audit_context",
            {
                "actor_id": self._actor_id,
                "workspace_id": None,
            },
        )
        self._session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=self._actor_id,
                action=action,
                resource_type="role",
                resource_id=role.id,
                details_json=json.dumps(
                    {"key": role.key, "name": role.name, **(details or {})},
                    default=str,
                    ensure_ascii=False,
                ),
                timestamp=datetime.now(UTC),
            )
        )

    async def list(
        self,
        *,
        search: str = "",
        is_active: bool | None = None,
        page: int = 1,
        size: int = 20,
    ) -> RoleListResponse:
        """Paginated role list with optional ``key``/``name`` search."""
        stmt = select(Role)
        if search:
            like = f"%{search.lower()}%"
            stmt = stmt.where(
                (func.lower(col(Role.key)).like(like)) | (func.lower(col(Role.name)).like(like))
            )
        if is_active is not None:
            stmt = stmt.where(col(Role.is_active) == is_active)

        total = (
            await self._session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()

        rows = (
            (
                await self._session.execute(
                    stmt.order_by(col(Role.created_at).desc())
                    .offset(max(page - 1, 0) * size)
                    .limit(size)
                )
            )
            .scalars()
            .all()
        )

        items = [await _to_read(self._session, role) for role in rows]
        return RoleListResponse(items=items, total=total, page=page, size=size)

    async def get(self, role_id: uuid.UUID) -> RoleRead:
        role = await self._session.get(Role, role_id)
        if role is None:
            raise RoleNotFound(f"Role {role_id} not found.")
        return await _to_read(self._session, role)

    async def create(self, payload: RoleCreateRequest) -> RoleRead:
        existing = (
            (await self._session.execute(select(Role).where(col(Role.key) == payload.key).limit(1)))
            .scalars()
            .first()
        )
        if existing is not None:
            raise RoleKeyDuplicate(f"Role key '{payload.key}' already exists.")

        role = Role(
            key=payload.key,
            name=payload.name,
            description=payload.description,
            is_system=False,
            is_active=payload.is_active,
        )
        self._session.add(role)
        await self._session.flush()

        for perm in payload.permission_keys:
            self._session.add(RolePermission(role_id=role.id, permission=perm.value))
        self._audit(
            action="role.created",
            role=role,
            details={"permissions": [p.value for p in payload.permission_keys]},
        )
        await self._session.commit()
        await invalidate_all_permissions()
        await self._session.refresh(role)
        return await _to_read(self._session, role)

    async def update(self, role_id: uuid.UUID, payload: RoleUpdateRequest) -> RoleRead:
        role = await self._session.get(Role, role_id)
        if role is None:
            raise RoleNotFound(f"Role {role_id} not found.")
        if role.is_system:
            raise RoleSystemProtected(
                "System roles cannot be modified.",
                details={"role_key": role.key},
            )

        if payload.name is not None:
            role.name = payload.name
        if payload.description is not None:
            role.description = payload.description
        if payload.is_active is not None:
            role.is_active = payload.is_active

        if payload.permission_keys is not None:
            await self._session.execute(
                RolePermission.__table__.delete().where(
                    RolePermission.__table__.c.role_id == role.id
                )
            )
            for perm in payload.permission_keys:
                self._session.add(RolePermission(role_id=role.id, permission=perm.value))

        self._session.add(role)
        self._audit(action="role.updated", role=role, details={"is_active": role.is_active})
        await self._session.commit()
        await invalidate_all_permissions()
        await self._session.refresh(role)
        return await _to_read(self._session, role)

    async def disable(self, role_id: uuid.UUID) -> RoleRead:
        role = await self._session.get(Role, role_id)
        if role is None:
            raise RoleNotFound(f"Role {role_id} not found.")
        if role.is_system:
            raise RoleSystemProtected(
                "System roles cannot be disabled.",
                details={"role_key": role.key},
            )
        role.is_active = False
        self._session.add(role)
        self._audit(action="role.disabled", role=role)
        await self._session.commit()
        await invalidate_all_permissions()
        await self._session.refresh(role)
        return await _to_read(self._session, role)

    async def enable(self, role_id: uuid.UUID) -> RoleRead:
        role = await self._session.get(Role, role_id)
        if role is None:
            raise RoleNotFound(f"Role {role_id} not found.")
        role.is_active = True
        self._session.add(role)
        self._audit(action="role.enabled", role=role)
        await self._session.commit()
        await invalidate_all_permissions()
        await self._session.refresh(role)
        return await _to_read(self._session, role)

    async def delete(self, role_id: uuid.UUID) -> None:
        role = await self._session.get(Role, role_id)
        if role is None:
            raise RoleNotFound(f"Role {role_id} not found.")
        if role.is_system:
            raise RoleSystemProtected(
                "System roles cannot be deleted.",
                details={"role_key": role.key},
            )
        user_count = await _count_users(self._session, role.id)
        if user_count > 0:
            raise RoleInUse(user_count=user_count)

        self._audit(action="role.deleted", role=role)
        await self._session.execute(
            RolePermission.__table__.delete().where(RolePermission.__table__.c.role_id == role.id)
        )
        await self._session.delete(role)
        await self._session.commit()
        await invalidate_all_permissions()

    async def list_users(self, role_id: uuid.UUID) -> RoleUserListResponse:
        """Return every user bound to ``role_id``.

        Mirrors :func:`_count_users`'s dual-table logic so the count
        shown in the list view stays consistent with the users returned
        here. Platform-level bindings come from ``user_roles``; workspace
        bindings from ``user_workspace_roles`` (joined to ``workspaces``
        for display name). A user bound both ways appears twice — that
        matches what operators expect when auditing "who has this role".
        """
        role = await self._session.get(Role, role_id)
        if role is None:
            raise RoleNotFound(f"Role {role_id} not found.")

        items: list[RoleUserRead] = []

        user_role_cls = _user_roles_model()
        if user_role_cls is not None:
            platform_rows: list[tuple[Any, Any]] = (
                await self._session.execute(
                    select(User, user_role_cls)
                    .join(User, user_role_cls.user_id == User.id)
                    .where(user_role_cls.role_id == role_id)
                    .where(col(User.deleted_at).is_(None))
                    .order_by(col(User.email).asc())
                )
            ).all()
            for user, _binding in platform_rows:
                items.append(
                    RoleUserRead(
                        id=user.id,
                        email=user.email,
                        display_name=user.display_name,
                        is_platform_admin=user.is_platform_admin,
                        status=user.status,
                        login_enabled=getattr(user, "login_enabled", True),
                        binding_type="platform",
                    )
                )

        from app.modules.workspace.model import Workspace

        workspace_rows = (
            await self._session.execute(
                select(User, UserWorkspaceRole, Workspace)
                .join(User, UserWorkspaceRole.user_id == User.id)
                .join(Workspace, UserWorkspaceRole.workspace_id == Workspace.id)
                .where(UserWorkspaceRole.role_id == role_id)
                .where(col(User.deleted_at).is_(None))
                .where(col(Workspace.deleted_at).is_(None))
                .order_by(col(User.email).asc())
            )
        ).all()
        for user, _binding, workspace in workspace_rows:
            items.append(
                RoleUserRead(
                    id=user.id,
                    email=user.email,
                    display_name=user.display_name,
                    is_platform_admin=user.is_platform_admin,
                    status=user.status,
                    login_enabled=getattr(user, "login_enabled", True),
                    binding_type="workspace",
                    workspace_id=workspace.id,
                    workspace_name=workspace.name,
                )
            )

        return RoleUserListResponse(items=items, total=len(items))
