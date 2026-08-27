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
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from fastapi import status as http_status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError, PermissionDenied
from app.core.logging import get_logger
from app.core.permission_cache import invalidate_all_permissions
from app.core.security import password_hasher
from app.modules.admin.model import Organization, UserOrganization, UserRole
from app.modules.admin.organizations_service import _descendant_ids
from app.modules.admin.schema import UserWorkspaceRead
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.model import Session as AuthSession
from app.modules.auth.permissions import Permission
from app.modules.workflow.model import AuditLog
from app.modules.workspace.model import Workspace

log = get_logger(__name__)

# 新建用户/重置密码缺省口令的生成器（2026-08-20 审计 BS-1）：保留「管理员免输密码」
# 的便利，但每个初始口令独立随机、仅经创建/重置响应一次性下发，不再全局共享同一
# 明文（旧 DEFAULT_INITIAL_PASSWORD="SillyHub@123" 知道源码即可接管任意新账号）。
# 前缀/后缀保证同时含字母与数字，满足复杂度校验；不落日志、不落审计明细。


def generate_initial_password() -> str:
    """随机生成一次性初始口令（约 16 位，urlsafe 无歧义字符）。"""
    return f"Sh-{secrets.token_urlsafe(9)}-1a"


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

    async def _roles_carry_platform_admin(self, role_ids: list[uuid.UUID] | None) -> bool:
        """传入角色集合中是否存在携带 platform:admin 权限的角色。

        platform:admin(Permission.PLATFORM_ADMIN)是 RBAC 全权绕过权限,super_admin
        系统角色种子即带它(migration 202605280900)。绑定这类角色 = 授予平台超管,
        必须受支配权校验约束。
        """
        if not role_ids:
            return False
        stmt = (
            select(RolePermission.role_id)
            .where(RolePermission.role_id.in_(role_ids))
            .where(RolePermission.permission == Permission.PLATFORM_ADMIN.value)
            .limit(1)
        )
        return (await self.session.execute(stmt)).first() is not None

    async def _assert_actor_may_grant_platform_admin(
        self,
        *,
        granting_admin: bool,
        role_ids: list[uuid.UUID] | None,
    ) -> None:
        """支配权:只有 is_platform_admin 的调用者才能授予平台管理员标志或携带
        platform:admin 权限的角色。

        admin 端点 router 层已用 USER_WRITE 守门,但 USER_WRITE ≠ is_platform_admin,
        持 USER_WRITE 的非平台管理员不应越权授予超管(自提权/横向提权)。本检查是
        service 层纵深防御:授 is_platform_admin=True 或绑定 platform:admin 角色时
        必须确认 actor 自身 is_platform_admin,否则 PermissionDenied。
        """
        wants_platform = granting_admin or await self._roles_carry_platform_admin(role_ids)
        if not wants_platform:
            return
        actor = await self.session.get(User, self.actor_id)
        if actor is not None and actor.is_platform_admin:
            return
        raise PermissionDenied(
            "仅平台管理员可授予平台管理员权限或绑定平台管理员角色。",
            details={"code": "PLATFORM_ADMIN_GRANT_FORBIDDEN"},
        )

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
        organization_id: uuid.UUID | None = None,
        include_children: bool = True,
        ids: list[uuid.UUID] | None = None,
    ) -> tuple[list[User], int]:
        base = select(User).where(col(User.deleted_at).is_(None))
        # 按 id 精确批量查（前端 PpmUserSelect 已选值回填用，绕过关键字/分页，
        # 确保已选但不在当前页的用户能按 id 取回真实姓名）。
        if ids:
            base = base.where(col(User.id).in_(ids))

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

        # 组织维度过滤(exists 子查询,无 join 无重复行 → total/分页天然正确,D-004@v1)
        if organization_id is not None:
            org_ids: set[uuid.UUID] = {organization_id}
            if include_children:
                org_ids |= await _descendant_ids(self.session, organization_id)
            base = base.where(
                exists(
                    select(1)
                    .select_from(UserOrganization.__table__)
                    .where(
                        (UserOrganization.__table__.c.user_id == User.id)
                        & (UserOrganization.__table__.c.organization_id.in_(org_ids))
                    )
                )
            )

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
            raise HTTPException(status_code=404, detail="用户不存在或已被删除。")
        return target

    async def create_user(
        self,
        *,
        password: str | None = None,
        username: str,
        email: str | None = None,
        display_name: str | None = None,
        is_platform_admin: bool = False,
        login_enabled: bool = True,
        organization_ids: list[uuid.UUID] | None = None,
        role_ids: list[uuid.UUID] | None = None,
    ) -> tuple[User, str | None]:
        self._set_audit_context()
        # 支配权(纵深防御):授 is_platform_admin 或绑定 platform:admin 角色前校验调用者。
        await self._assert_actor_may_grant_platform_admin(
            granting_admin=is_platform_admin, role_ids=role_ids
        )
        # password 缺省 → 随机生成一次性初始密码（管理员表单不输入密码，明文经
        # 响应 initial_password 字段一次性下发，管理员转发给用户；BS-1）。
        generated_initial_password: str | None = None
        if password is None:
            password = generate_initial_password()
            generated_initial_password = password
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
        try:
            await self.session.flush()
        except IntegrityError:
            # R9（并发修复，2026-07-24）：并发建同 username 时预检双通过、flush 撞
            # ux_users_username 唯一约束。rollback 后重跑预检转友好 409，而非未处理 500。
            await self.session.rollback()
            await self._assert_username_available(resolved_username)
            raise  # 不可达：_assert_username_available 冲突时必 raise

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
        # D-002@v2：用户创建(含初始平台角色绑定)后清权限缓存。
        await invalidate_all_permissions()
        await self.session.refresh(user)
        log.info("user.created", email=user.email, user_id=str(user.id))
        return user, generated_initial_password

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
            # 预存缺陷修复（l10n task-03）：原 HTTPException(detail={dict}) 会被
            # 全局 handler str() 成 Python repr；改用 AppError 实例级 code 覆盖
            # （errors.py 文档化机制），code=HTTP_409_USERNAME_ALREADY_TAKEN、
            # 409 语义不变，技术标识移 details。
            raise AppError(
                f"用户名 {username} 已被占用，请更换后重试。",
                code="HTTP_409_USERNAME_ALREADY_TAKEN",
                http_status=http_status.HTTP_409_CONFLICT,
                details={"username": username},
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
            raise HTTPException(status_code=404, detail="用户不存在或已被删除。")

        # 支配权(纵深防御):授 is_platform_admin 或绑定 platform:admin 角色前校验调用者。
        # is_platform_admin=False(降级)不触发,交由下方 last-admin 保护兜底。
        await self._assert_actor_may_grant_platform_admin(
            granting_admin=is_platform_admin is True, role_ids=role_ids
        )

        # Self-disable protection (existing).
        if status == "disabled" and self.actor_id == target_id:
            raise PermissionDenied(
                "不能停用你自己。",
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
                    "不能移除最后一个平台管理员，请先指定其他管理员。",
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
                        # 同 _assert_username_available：dict detail 缺陷修复，改 AppError。
                        raise AppError(
                            "该邮箱已被其他用户使用，请更换后重试。",
                            code="HTTP_409_EMAIL_ALREADY_TAKEN",
                            http_status=http_status.HTTP_409_CONFLICT,
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
        # D-002@v2：用户更新(_rewrite_roles / is_platform_admin 翻转)后清权限缓存。
        await invalidate_all_permissions()
        await self.session.refresh(target)
        return target

    async def delete_user(self, target_id: uuid.UUID) -> None:
        if self.actor_id == target_id:
            raise PermissionDenied(
                "不能删除你自己。",
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
        # D-002@v2：用户删除后清权限缓存。
        await invalidate_all_permissions()

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
            raise AppError(
                "所选组织不存在或已被删除，请刷新后重试。",
                code="HTTP_422_VALIDATION_ERROR",
                http_status=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                details={"missing_ids": [str(m) for m in missing], "kind": "organization"},
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
            raise AppError(
                "所选角色不存在或已被删除，请刷新后重试。",
                code="HTTP_422_VALIDATION_ERROR",
                http_status=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                details={"missing_ids": [str(m) for m in missing], "kind": "role"},
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
                "不能停用自己的登录权限。",
                details={
                    "target_id": str(target_id),
                    "code": "USER_SELF_DISABLE_LOGIN_FORBIDDEN",
                },
            )

        target = await self.session.get(User, target_id)
        if target is None or target.deleted_at is not None:
            raise HTTPException(status_code=404, detail="用户不存在或已被删除。")

        # Last-admin protection
        if target.is_platform_admin and target.login_enabled:
            count = await self._active_admin_count()
            if count <= 1:
                raise PermissionDenied(
                    "不能停用最后一个平台管理员的登录权限，请先指定其他管理员。",
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
            raise HTTPException(status_code=404, detail="用户不存在或已被删除。")

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
            raise HTTPException(status_code=404, detail="会话不存在或已被吊销。")

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

    async def reset_password(
        self,
        target_id: uuid.UUID,
        new_password: str | None = None,
        force_change_on_next_login: bool = False,
    ) -> str:
        target = await self.session.get(User, target_id)
        if target is None or target.deleted_at is not None:
            raise HTTPException(status_code=404, detail="用户不存在或已被删除。")

        # 支配权：非平台管理员不得重置平台管理员的密码。重置接口会把新明文
        # 口令经响应下发给调用者——若不校验，任意 workspace 的 user:write
        # 持有者（router 层 require_permission_any 只查"任一 ws 有权限"）
        # 即可重置超管口令完成账号接管（与 _assert_actor_may_grant_platform_admin
        # 同一根因：USER_WRITE ≠ is_platform_admin）。
        if target.is_platform_admin:
            actor = await self.session.get(User, self.actor_id)
            if actor is None or not actor.is_platform_admin:
                raise PermissionDenied(
                    "仅平台管理员可重置平台管理员的密码。",
                    details={"code": "PLATFORM_ADMIN_RESET_FORBIDDEN"},
                )

        # 不显式传密码 → 随机生成一次性口令（BS-1），经响应 plaintext_password
        # 字段下发给管理员转发；用户登录后可自行修改（change-password）。
        plaintext = new_password or generate_initial_password()

        self._set_audit_context()
        target.password_hash = password_hasher.hash(plaintext)
        target.updated_at = datetime.now(UTC)
        self.session.add(target)

        await self._revoke_sessions(target_id)

        details = {
            "reset_by": str(self.actor_id),
            "force_change_on_next_login": force_change_on_next_login,
            "used_default_password": new_password is None,
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
