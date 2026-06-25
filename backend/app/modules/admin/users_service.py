"""User management service — moved from settings (task-06).

``/api/admin/users/*`` backend (change ``2026-06-16-admin-org-role-center``
task-06). Extends the historical ``UserService`` with org/role bindings
and login-permission control; ``settings/users_service`` re-exports
this class for back-compat.

Self-protection rules:

* ``delete_user(actor)`` → :class:`PermissionDenied` ``USER_SELF_DELETE_FORBIDDEN``
* ``disable_login(actor)`` → :class:`PermissionDenied` ``USER_SELF_DISABLE_LOGIN_FORBIDDEN``
* Removing the last ``is_platform_admin`` (via ``update_user`` or
  ``disable_login``) → ``USER_LAST_ADMIN_PROTECTED``

Org/role bindings are rewrite-style: ``None`` keeps the current set,
``[]`` clears it, ``[a, b]`` replaces it. ``disable_login`` revokes
every active session so the user is forced out immediately.
"""

from __future__ import annotations

import json
import secrets
import string
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import PermissionDenied
from app.core.logging import get_logger
from app.core.security import password_hasher
from app.modules.admin.model import Organization, UserOrganization, UserRole
from app.modules.admin.schema import UserWorkspaceRead
from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.auth.model import Session as AuthSession
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
            AuthSession.__table__.update()
            .where(AuthSession.__table__.c.user_id == user_id)
            .where(AuthSession.__table__.c.revoked_at.is_(None))
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

    async def get_user(self, target_id: uuid.UUID) -> User:
        target = await self.session.get(User, target_id)
        if target is None or target.deleted_at is not None:
            raise HTTPException(status_code=404, detail="User not found")
        return target

    async def create_user(
        self,
        *,
        password: str,
        username: str,
        email: str | None = None,
        display_name: str | None = None,
        is_platform_admin: bool = False,
        login_enabled: bool = True,
        organization_ids: list[uuid.UUID] | None = None,
        role_ids: list[uuid.UUID] | None = None,
    ) -> User:
        self._set_audit_context()
        pw_hash = password_hasher.hash(password)
        now = datetime.now(UTC)
        # username 必填且由用户明确指定,撞库应直接 409 报错让用户改,
        # 不再自动加序号(D-004 契约:create 冲突 = 用户输入错误)。
        resolved_username = username.strip().lower()
        await self._assert_username_available(resolved_username)
        normalized_email = email.lower().strip() if email else None
        user = User(
            id=uuid.uuid4(),
            email=normalized_email,
            username=resolved_username,
            password_hash=pw_hash,
            display_name=display_name or resolved_username,
            status="active",
            is_platform_admin=is_platform_admin,
            login_enabled=login_enabled,
            created_at=now,
            updated_at=now,
        )
        self.session.add(user)
        await self.session.flush()

        if organization_ids:
            await self._validate_organizations(organization_ids)
            for org_id in organization_ids:
                self.session.add(UserOrganization(user_id=user.id, organization_id=org_id))
        if role_ids:
            await self._validate_roles(role_ids)
            for role_id in role_ids:
                self.session.add(UserRole(user_id=user.id, role_id=role_id))

        self.session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=self.actor_id,
                action="user.created",
                resource_type="user",
                resource_id=user.id,
                details_json=json.dumps(
                    {"email": user.email, "is_platform_admin": user.is_platform_admin},
                    default=str,
                    ensure_ascii=False,
                ),
                timestamp=datetime.now(UTC),
            )
        )
        await self.session.commit()
        await self.session.refresh(user)
        log.info("user.created", email=user.email, user_id=str(user.id))
        return user

    async def _resolve_username(
        self,
        username: str,
        email: str | None = None,
        *,
        exclude_id: uuid.UUID | None = None,
    ) -> str:
        """username 必填,小写归一;前缀重复自动加序号(a/a2/a3…)。

        email 仅作兼容签名保留,不再参与 base 计算(username 必填,
        短路安全,email=None 也不崩)。exclude_id 用于 update 改名时
        排除自身,避免「把自己当成冲突」导致改名失败或被加序号。

        注意:create_user / update_user 自 D-004 起不再调用本方法加序号
        (用户明确指定的登录名冲突应 409 报错,不静默改名);本方法保留
        供其他场景(如 bootstrap 自动生成账号)使用。
        """
        base = username.strip().lower()
        candidate = base
        suffix = 2
        while True:
            stmt = select(User.id).where(User.username == candidate)
            if exclude_id is not None:
                stmt = stmt.where(User.id != exclude_id)
            exists = await self.session.execute(stmt.limit(1))
            if exists.scalars().first() is None:
                return candidate
            candidate = f"{base}{suffix}"
            suffix += 1

    async def _assert_username_available(
        self,
        username: str,
        *,
        exclude_id: uuid.UUID | None = None,
    ) -> None:
        """username 冲突直接抛 409 USERNAME_ALREADY_TAKEN(D-004 契约)。

        create/update 用户明确输入的登录名冲突 = 用户输入错误,应报错
        让用户改,而不是静默加序号。``exclude_id`` 用于 update 改名时
        排除自身。
        """
        stmt = (
            select(User.id).where(User.username == username).where(col(User.deleted_at).is_(None))
        )
        if exclude_id is not None:
            stmt = stmt.where(User.id != exclude_id)
        hit = await self.session.execute(stmt.limit(1))
        if hit.scalars().first() is not None:
            raise HTTPException(
                status_code=409,
                detail={"code": "USERNAME_ALREADY_TAKEN", "username": username},
            )

    async def update_user(
        self,
        target_id: uuid.UUID,
        *,
        display_name: str | None = None,
        is_platform_admin: bool | None = None,
        status: str | None = None,
        login_enabled: bool | None = None,
        username: str | None = None,
        email: str | None = None,
        organization_ids: list[uuid.UUID] | None = None,
        role_ids: list[uuid.UUID] | None = None,
    ) -> User:
        target = await self.session.get(User, target_id)
        if target is None or target.deleted_at is not None:
            raise HTTPException(status_code=404, detail="User not found")

        # Self-disable protection (existing).
        if status == "disabled" and self.actor_id == target_id:
            raise PermissionDenied(
                "Cannot disable yourself.",
                details={"target_id": str(target_id), "code": "USER_SELF_DISABLE_FORBIDDEN"},
            )

        # Last-admin protection — covers both demotion and login disable.
        becomes_non_admin = is_platform_admin is False and target.is_platform_admin
        disables_admin_login = (
            login_enabled is False and target.is_platform_admin and target.login_enabled
        )
        if becomes_non_admin or disables_admin_login:
            count = await self._active_admin_count()
            if count <= 1:
                raise PermissionDenied(
                    "Cannot remove the last platform admin.",
                    details={
                        "active_admins": count,
                        "code": "USER_LAST_ADMIN_PROTECTED",
                    },
                )

        self._set_audit_context()

        # ---- username 变更 + 唯一校验(D-004)----
        # exclude_id 排除自身,避免「我现在的名字和我自己冲突」;
        # 目标名已被他人占用 → 抛 409 USERNAME_ALREADY_TAKEN,不静默加序号改名。
        if username is not None and username.strip().lower() != (target.username or ""):
            resolved = username.strip().lower()
            await self._assert_username_available(resolved, exclude_id=target_id)
            target.username = resolved

        # ---- email 变更 + 非空唯一校验(D-003)----
        # None 表示「未传该字段」不动 email;空串视为「清空邮箱」(target.email=None)。
        if email is not None:
            normalized_email = email.lower().strip()
            prev = (target.email or "").lower()
            if normalized_email != prev:
                if normalized_email:
                    hit = await self.session.execute(
                        select(User.id)
                        .where(User.email == normalized_email)
                        .where(User.id != target_id)
                        .where(col(User.deleted_at).is_(None))
                        .limit(1)
                    )
                    if hit.scalars().first() is not None:
                        raise HTTPException(
                            status_code=409,
                            detail={"code": "EMAIL_ALREADY_TAKEN"},
                        )
                    target.email = normalized_email
                else:
                    target.email = None

        if display_name is not None:
            target.display_name = display_name
        if is_platform_admin is not None:
            target.is_platform_admin = is_platform_admin
        if status is not None:
            target.status = status
        if login_enabled is not None:
            target.login_enabled = login_enabled

        target.updated_at = datetime.now(UTC)
        self.session.add(target)

        if organization_ids is not None:
            await self._rewrite_organizations(target_id, organization_ids)
        if role_ids is not None:
            await self._rewrite_roles(target_id, role_ids)

        # Revoke sessions when disabling
        if status == "disabled" or login_enabled is False:
            await self._revoke_sessions(target_id)

        self.session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=self.actor_id,
                action="user.updated",
                resource_type="user",
                resource_id=target.id,
                details_json=json.dumps(
                    {
                        "display_name": display_name,
                        "is_platform_admin": is_platform_admin,
                        "status": status,
                        "login_enabled": login_enabled,
                        "username": username,
                        "email": email,
                    },
                    default=str,
                    ensure_ascii=False,
                ),
                timestamp=datetime.now(UTC),
            )
        )
        await self.session.commit()
        await self.session.refresh(target)
        return target

    async def delete_user(self, target_id: uuid.UUID) -> None:
        if self.actor_id == target_id:
            raise PermissionDenied(
                "Cannot delete yourself.",
                details={"target_id": str(target_id), "code": "USER_SELF_DELETE_FORBIDDEN"},
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

        self.session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=self.actor_id,
                action="user.deleted",
                resource_type="user",
                resource_id=target.id,
                details_json=json.dumps({"email": target.email}, default=str, ensure_ascii=False),
                timestamp=datetime.now(UTC),
            )
        )
        await self.session.commit()

    # ── Org / role bindings ──────────────────────────────────────────────

    async def _validate_organizations(self, organization_ids: list[uuid.UUID]) -> None:
        if not organization_ids:
            return
        rows = (
            (
                await self.session.execute(
                    select(col(Organization.id)).where(col(Organization.id).in_(organization_ids))
                )
            )
            .scalars()
            .all()
        )
        missing = set(organization_ids) - set(rows)
        if missing:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "VALIDATION_ERROR",
                    "missing_ids": [str(m) for m in missing],
                    "kind": "organization",
                },
            )

    async def _validate_roles(self, role_ids: list[uuid.UUID]) -> None:
        if not role_ids:
            return
        rows = (
            (await self.session.execute(select(col(Role.id)).where(col(Role.id).in_(role_ids))))
            .scalars()
            .all()
        )
        missing = set(role_ids) - set(rows)
        if missing:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "VALIDATION_ERROR",
                    "missing_ids": [str(m) for m in missing],
                    "kind": "role",
                },
            )

    async def _rewrite_organizations(
        self, target_id: uuid.UUID, organization_ids: list[uuid.UUID]
    ) -> None:
        await self._validate_organizations(organization_ids)
        await self.session.execute(
            UserOrganization.__table__.delete().where(
                UserOrganization.__table__.c.user_id == target_id
            )
        )
        for org_id in organization_ids:
            self.session.add(UserOrganization(user_id=target_id, organization_id=org_id))

    async def _rewrite_roles(self, target_id: uuid.UUID, role_ids: list[uuid.UUID]) -> None:
        await self._validate_roles(role_ids)
        await self.session.execute(
            UserRole.__table__.delete().where(UserRole.__table__.c.user_id == target_id)
        )
        for role_id in role_ids:
            self.session.add(UserRole(user_id=target_id, role_id=role_id))

    # ── Login permission ─────────────────────────────────────────────────

    async def disable_login(self, target_id: uuid.UUID) -> User:
        if self.actor_id == target_id:
            raise PermissionDenied(
                "Cannot disable your own login.",
                details={
                    "target_id": str(target_id),
                    "code": "USER_SELF_DISABLE_LOGIN_FORBIDDEN",
                },
            )

        target = await self.session.get(User, target_id)
        if target is None or target.deleted_at is not None:
            raise HTTPException(status_code=404, detail="User not found")

        # Last-admin protection
        if target.is_platform_admin and target.login_enabled:
            count = await self._active_admin_count()
            if count <= 1:
                raise PermissionDenied(
                    "Cannot disable login for the last platform admin.",
                    details={
                        "active_admins": count,
                        "code": "USER_LAST_ADMIN_PROTECTED",
                    },
                )

        self._set_audit_context()
        target.login_enabled = False
        target.updated_at = datetime.now(UTC)
        self.session.add(target)

        await self._revoke_sessions(target_id)

        self.session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=self.actor_id,
                action="user.login_disabled",
                resource_type="user",
                resource_id=target_id,
                details_json=json.dumps({}, default=str, ensure_ascii=False),
                timestamp=datetime.now(UTC),
            )
        )

        await self.session.commit()
        await self.session.refresh(target)
        return target

    async def enable_login(self, target_id: uuid.UUID) -> User:
        target = await self.session.get(User, target_id)
        if target is None or target.deleted_at is not None:
            raise HTTPException(status_code=404, detail="User not found")

        self._set_audit_context()
        target.login_enabled = True
        target.updated_at = datetime.now(UTC)
        self.session.add(target)

        self.session.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=self.actor_id,
                action="user.login_enabled",
                resource_type="user",
                resource_id=target_id,
                details_json=json.dumps({}, default=str, ensure_ascii=False),
                timestamp=datetime.now(UTC),
            )
        )

        await self.session.commit()
        await self.session.refresh(target)
        return target

    # ── Detail queries ──────────────────────────────────────────────────

    async def list_sessions(self, user_id: uuid.UUID) -> list[AuthSession]:
        result = await self.session.execute(
            select(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            .order_by(col(AuthSession.created_at).desc())
        )
        return list(result.scalars().all())

    async def revoke_session(self, target_id: uuid.UUID, session_id: uuid.UUID) -> None:
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
