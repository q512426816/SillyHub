"""UserService — business logic for user management.

Extracted from settings/router.py. All mutating methods set audit_context
on the session so that audit_hooks.py auto-generates AuditLog entries.
"""

from __future__ import annotations

import json
import secrets
import string
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import PermissionDenied
from app.core.logging import get_logger
from app.core.security import password_hasher
from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.auth.model import Session as AuthSession
from app.modules.settings.schema import UserWorkspaceRead
from app.modules.workflow.model import AuditLog
from app.modules.workspace.model import Workspace

log = get_logger(__name__)


class UserService:
    """Stateless service; each request constructs a new instance."""

    def __init__(self, session: AsyncSession, actor_id: uuid.UUID) -> None:
        self.session = session
        self.actor_id = actor_id

    # ── helpers ──────────────────────────────────────────────────────────

    def _set_audit_context(self) -> None:
        self.session.info["audit_context"] = {
            "actor_id": self.actor_id,
            "workspace_id": None,
        }

    async def _revoke_sessions(self, user_id: uuid.UUID) -> None:
        await self.session.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )

    async def _active_admin_count(self) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(
                select(User)
                .where(
                    User.is_platform_admin.is_(True),
                    User.status == "active",
                    User.deleted_at.is_(None),
                )
                .subquery()
            )
        )
        return result.scalar() or 0

    # ── CRUD ─────────────────────────────────────────────────────────────

    async def list_users(
        self,
        *,
        q: str | None = None,
        status: str | None = None,
        role: str | None = None,
        sort: str = "created_at",
        order: str = "desc",
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[User], int]:
        base = select(User).where(col(User.deleted_at).is_(None))

        if q:
            pattern = f"%{q}%"
            base = base.where(
                (col(User.email).ilike(pattern)) | (col(User.display_name).ilike(pattern))
            )
        if status:
            base = base.where(col(User.status) == status)
        if role == "admin":
            base = base.where(User.is_platform_admin.is_(True))
        elif role == "user":
            base = base.where(User.is_platform_admin.is_(False))

        total_q = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(total_q)).scalar() or 0

        sort_col = {
            "email": User.email,
            "last_login_at": User.last_login_at,
        }.get(sort, User.created_at)
        order_fn = col(sort_col).desc if order == "desc" else col(sort_col).asc

        rows = (
            (await self.session.execute(base.order_by(order_fn()).limit(limit).offset(offset)))
            .scalars()
            .all()
        )
        return list(rows), total

    async def create_user(
        self,
        *,
        email: str,
        password: str,
        display_name: str | None = None,
        is_platform_admin: bool = False,
    ) -> User:
        self._set_audit_context()
        pw_hash = password_hasher.hash(password)
        now = datetime.now(UTC)
        user = User(
            id=uuid.uuid4(),
            email=email.lower().strip(),
            password_hash=pw_hash,
            display_name=display_name or email.split("@", 1)[0],
            status="active",
            is_platform_admin=is_platform_admin,
            created_at=now,
            updated_at=now,
        )
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)
        log.info("user.created", email=user.email, user_id=str(user.id))
        return user

    async def update_user(
        self,
        target_id: uuid.UUID,
        *,
        display_name: str | None = None,
        is_platform_admin: bool | None = None,
        status: str | None = None,
    ) -> User:
        target = await self.session.get(User, target_id)
        if target is None or target.deleted_at is not None:
            raise HTTPException(status_code=404, detail="User not found")

        # Self-disable protection
        if status == "disabled" and self.actor_id == target_id:
            raise PermissionDenied(
                "Cannot disable yourself.",
                details={"target_id": str(target_id)},
            )

        # Last-admin protection
        if is_platform_admin is False and target.is_platform_admin:
            count = await self._active_admin_count()
            if count <= 1:
                raise PermissionDenied(
                    "Cannot remove the last platform admin.",
                    details={"active_admins": count},
                )

        self._set_audit_context()

        if display_name is not None:
            target.display_name = display_name
        if is_platform_admin is not None:
            target.is_platform_admin = is_platform_admin
        if status is not None:
            target.status = status

        target.updated_at = datetime.now(UTC)
        self.session.add(target)

        # Revoke sessions when disabling
        if status == "disabled":
            await self._revoke_sessions(target_id)

        await self.session.commit()
        await self.session.refresh(target)
        return target

    async def delete_user(self, target_id: uuid.UUID) -> None:
        if self.actor_id == target_id:
            raise PermissionDenied(
                "Cannot delete yourself.",
                details={"target_id": str(target_id)},
            )

        target = await self.session.get(User, target_id)
        if target is None:
            return

        self._set_audit_context()
        now = datetime.now(UTC)
        target.deleted_at = now
        target.status = "deleted"
        self.session.add(target)

        await self._revoke_sessions(target_id)

        await self.session.commit()

    # ── Detail queries ──────────────────────────────────────────────────

    async def list_sessions(self, user_id: uuid.UUID) -> list[AuthSession]:
        result = await self.session.execute(
            select(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            .order_by(col(AuthSession.created_at).desc())
        )
        return list(result.scalars().all())

    async def revoke_session(self, target_id: uuid.UUID, session_id: uuid.UUID) -> None:
        """撤销单个会话。校验 session 归属 target_id 且未撤销。"""
        auth_session = await self.session.get(AuthSession, session_id)
        if (
            auth_session is None
            or auth_session.user_id != target_id
            or auth_session.revoked_at is not None
        ):
            raise HTTPException(status_code=404, detail="Session not found")

        self._set_audit_context()
        auth_session.revoked_at = datetime.now(UTC)
        self.session.add(auth_session)
        self.session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=self.actor_id,
                action="user.session_revoke",
                resource_type="user",
                resource_id=target_id,
                details_json=json.dumps(
                    {"session_id": str(session_id)}, default=str, ensure_ascii=False
                ),
                timestamp=datetime.now(UTC),
            )
        )
        await self.session.commit()
        log.info(
            "user.session_revoke",
            target_id=str(target_id),
            session_id=str(session_id),
            actor_id=str(self.actor_id),
        )

    async def revoke_all_sessions(self, target_id: uuid.UUID) -> int:
        """撤销目标用户所有活跃会话，返回被撤销数量。"""
        count_result = await self.session.execute(
            select(func.count()).select_from(
                select(AuthSession)
                .where(AuthSession.user_id == target_id, AuthSession.revoked_at.is_(None))
                .subquery()
            )
        )
        count = count_result.scalar() or 0
        if count == 0:
            return 0

        self._set_audit_context()
        await self._revoke_sessions(target_id)
        self.session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=self.actor_id,
                action="user.sessions_revoke_all",
                resource_type="user",
                resource_id=target_id,
                details_json=json.dumps({"revoked_count": count}, default=str, ensure_ascii=False),
                timestamp=datetime.now(UTC),
            )
        )
        await self.session.commit()
        log.info(
            "user.sessions_revoke_all",
            target_id=str(target_id),
            revoked_count=count,
            actor_id=str(self.actor_id),
        )
        return count

    async def list_audit_logs(self, user_id: uuid.UUID) -> list[AuditLog]:
        result = await self.session.execute(
            select(AuditLog)
            .where(
                or_(
                    AuditLog.resource_type == "user",
                    AuditLog.actor_id == user_id,
                ),
                AuditLog.resource_id == user_id,
            )
            .order_by(col(AuditLog.timestamp).desc())
            .limit(50)
        )
        return list(result.scalars().all())

    async def list_workspaces(self, target_id: uuid.UUID) -> list[UserWorkspaceRead]:
        """查询用户所属 Workspace 及角色。

        JOIN 路径: UserWorkspaceRole -> Workspace -> Role
        只返回 workspace.deleted_at IS NULL 的记录。
        """
        stmt = (
            select(
                Workspace.name.label("workspace_name"),
                Workspace.slug.label("workspace_slug"),
                Role.name.label("role_name"),
            )
            .select_from(UserWorkspaceRole)
            .join(Workspace, UserWorkspaceRole.workspace_id == Workspace.id)
            .join(Role, UserWorkspaceRole.role_id == Role.id)
            .where(
                UserWorkspaceRole.user_id == target_id,
                Workspace.deleted_at.is_(None),
            )
        )
        result = await self.session.execute(stmt)
        rows = result.all()
        return [
            UserWorkspaceRead(
                workspace_name=r.workspace_name,
                workspace_slug=r.workspace_slug,
                role_name=r.role_name,
            )
            for r in rows
        ]

    # ── Password reset ──────────────────────────────────────────────────

    @staticmethod
    def _generate_password(length: int = 12) -> str:
        alphabet = string.ascii_letters + string.digits + "!@#$%&*"
        return "".join(secrets.choice(alphabet) for _ in range(length))

    async def reset_password(
        self,
        target_id: uuid.UUID,
        new_password: str | None = None,
        force_change_on_next_login: bool = False,
    ) -> str:
        target = await self.session.get(User, target_id)
        if target is None or target.deleted_at is not None:
            raise HTTPException(status_code=404, detail="User not found")

        plaintext = new_password or self._generate_password()

        self._set_audit_context()
        target.password_hash = password_hasher.hash(plaintext)
        target.updated_at = datetime.now(UTC)
        self.session.add(target)

        await self._revoke_sessions(target_id)

        details = {
            "reset_by": str(self.actor_id),
            "force_change_on_next_login": force_change_on_next_login,
            "auto_generated": new_password is None,
        }
        self.session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=self.actor_id,
                action="user.password_reset",
                resource_type="user",
                resource_id=target_id,
                details_json=json.dumps(details, default=str, ensure_ascii=False),
                timestamp=datetime.now(UTC),
            )
        )

        await self.session.commit()
        log.info("user.password_reset", target_id=str(target_id), actor_id=str(self.actor_id))
        return plaintext
