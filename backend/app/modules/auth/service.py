"""Auth use cases.

Single entry point for login / refresh / logout / me. The router is a thin
HTTP shell on top; tests can drive this service directly without going
through FastAPI.

Refresh strategy (references/15 §3):

* Each ``Session`` row stores ``bcrypt(refresh_token)`` + ``expires_at``.
* ``refresh()`` looks up the matching live session, **revokes it**, and
  issues a brand-new (access, refresh) pair.
* If the caller presents a refresh token that matches an *already revoked*
  session for that user, we treat it as a reuse attack and revoke every
  session for the user (the legitimate client will be forced to re-login).
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import Settings
from app.core.errors import (
    AuthInvalidCredentials,
    AuthRefreshReused,
    AuthTokenInvalid,
    AuthUserInactive,
    AuthUserLoginDisabled,
    PasswordIncorrect,
)
from app.core.logging import get_logger
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    password_hasher,
    refresh_token_expiry,
    verify_refresh_token,
)
from app.modules.auth.model import Session as SessionRow
from app.modules.auth.model import User
from app.modules.auth.schema import TokenPair
from app.modules.workflow.model import AuditLog

log = get_logger(__name__)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime) -> datetime:
    """把可能 naive 的 datetime 视为 UTC 并补 tzinfo。

    Session 的时间字段在 model 层声明为 ``DateTime(timezone=True)``,但 SQLite
    测试环境读回会丢失 tzinfo(Python datetime 变 naive),生产 PostgreSQL 保留
    aware。grace 判定需要与 ``_utc_now()``(aware UTC)做差,naive 混入会抛
    ``TypeError``。统一在此处兜底:naive 视为 UTC(本服务所有时间戳一律 UTC 写入)。
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


class AuthService:
    def __init__(self, db: AsyncSession, *, settings: Settings) -> None:
        self._db = db
        self._settings = settings
        password_hasher.configure(settings.auth_bcrypt_rounds)

    # ── Login / refresh / logout ──────────────────────────────────────────

    async def login(
        self,
        *,
        account: str,
        password: str,
        user_agent: str | None,
        ip: str | None,
    ) -> tuple[User, TokenPair]:
        # 纯登录名(username)登录(D-001):account 字段名保留(零契约改动),
        # 后端当 username 查;不再识别 @ email。username 在 DB 与
        # _resolve_username 中统一小写存储,此处同步 strip+lower。
        normalized = account.strip().lower()
        user = await self._lookup_active_user_by_username(normalized)
        if user is None or not password_hasher.verify(password, user.password_hash):
            # 统一中文报错，不区分「用户不存在」与「密码错」防枚举（D-001 纯 username 登录）。
            raise AuthInvalidCredentials("用户名或密码错误。")

        # Login permission gate (task-06 of 2026-06-16-admin-org-role-center).
        # Checked AFTER password verify so the error envelope matches
        # AuthInvalidCredentials — attackers cannot probe account existence
        # by comparing error codes.
        if not user.login_enabled:
            raise AuthUserLoginDisabled(
                "该账号的登录权限已被禁用。",
                details={"user_id": str(user.id)},
            )

        pair = await self._issue_token_pair(user, user_agent=user_agent, ip=ip)
        user.last_login_at = _utc_now()
        await self._db.commit()
        log.info("auth.login.success", user_id=str(user.id), email=user.email)
        return user, pair

    async def refresh(
        self,
        *,
        refresh_token: str,
        user_agent: str | None,
        ip: str | None,
    ) -> tuple[User, TokenPair]:
        user, session, is_grace = await self._consume_refresh_token(refresh_token)
        if not is_grace:
            # 正常 rotate:写 revoked_at + rotated_at(grace 判定锚点)。
            # is_grace=True 时 session 已 revoked+rotated,跳过避免刷新 rotated_at
            # 导致 grace 窗口被无限续期(关键防线)。
            await self._mark_session_rotated(session)
        pair = await self._issue_token_pair(user, user_agent=user_agent, ip=ip)
        await self._db.commit()
        log.info("auth.refresh.success", user_id=str(user.id), grace=is_grace)
        return user, pair

    async def logout_session_by_refresh(self, *, refresh_token: str) -> None:
        """Best-effort logout: if the token matches a live session, revoke it.

        Unlike :meth:`refresh`, an unknown / already-revoked token here is
        idempotent — clients regularly retry logout on network blips.
        """
        try:
            _, session, _ = await self._consume_refresh_token(refresh_token)
        except (AuthTokenInvalid, AuthRefreshReused, AuthUserInactive):
            return
        await self._mark_session_revoked(session)
        await self._db.commit()
        log.info("auth.logout.success", session_id=str(session.id))

    async def revoke_all_user_sessions(self, *, user_id: uuid.UUID) -> int:
        """Used by reuse-attack detection. Returns the number of sessions killed."""
        now = _utc_now()
        result = await self._db.execute(
            update(SessionRow)
            .where(col(SessionRow.user_id) == user_id)
            .where(col(SessionRow.revoked_at).is_(None))
            .values(revoked_at=now)
        )
        await self._db.commit()
        rowcount = int(getattr(result, "rowcount", 0) or 0)
        log.warning(
            "auth.sessions.revoked_all",
            user_id=str(user_id),
            count=rowcount,
        )
        return rowcount

    async def change_password(
        self, *, user_id: uuid.UUID, old_password: str, new_password: str
    ) -> None:
        """用户自助修改密码：verify 旧密码 → hash 新密码 → 撤销全部 session → 审计 → 统一 commit。

        撤销全部 session 用 execute-only UPDATE（不调 ``revoke_all_user_sessions``——其内部
        commit 会提前提交 password 改动，破坏 password+session+audit 原子性，X-001）。当前
        access_token 是无状态 JWT，``auth_access_ttl_minutes``（默认 30min）内仍有效=保留当前
        会话；其他设备 refresh 失效=撤销其他。
        """
        user = await self._db.get(User, user_id)
        if user is None or user.deleted_at is not None:
            raise AuthUserInactive("User not found.")
        if not password_hasher.verify(old_password, user.password_hash):
            raise PasswordIncorrect("旧密码错误。")

        user.password_hash = password_hasher.hash(new_password)
        user.updated_at = _utc_now()
        now = _utc_now()
        await self._db.execute(
            update(SessionRow)
            .where(col(SessionRow.user_id) == user_id)
            .where(col(SessionRow.revoked_at).is_(None))
            .values(revoked_at=now)
        )
        await self._db.flush()
        self._db.add(
            AuditLog(
                id=uuid.uuid4(),
                workspace_id=None,
                actor_id=user_id,
                action="user.password_change",
                resource_type="user",
                resource_id=user_id,
                details_json=json.dumps({"changed_self": True}, ensure_ascii=False),
                timestamp=now,
            )
        )
        await self._db.commit()
        log.info("auth.password_change", user_id=str(user_id))

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _lookup_active_user_by_email(self, email: str) -> User | None:
        stmt = (
            select(User)
            .where(col(User.email) == email.lower())
            .where(col(User.deleted_at).is_(None))
            .where(col(User.status) == "active")
            .limit(1)
        )
        return (await self._db.execute(stmt)).scalars().first()

    async def _lookup_active_user_by_username(self, username: str) -> User | None:
        stmt = (
            select(User)
            .where(col(User.username) == username.lower())
            .where(col(User.deleted_at).is_(None))
            .where(col(User.status) == "active")
            .limit(1)
        )
        return (await self._db.execute(stmt)).scalars().first()

    async def _issue_token_pair(
        self,
        user: User,
        *,
        user_agent: str | None,
        ip: str | None,
    ) -> TokenPair:
        access_token, payload = create_access_token(
            user_id=user.id,
            email=user.email,
            is_admin=user.is_platform_admin,
            settings=self._settings,
        )
        refresh_token = generate_refresh_token()
        expires_at = refresh_token_expiry(self._settings)
        row = SessionRow(
            id=uuid.uuid4(),
            user_id=user.id,
            refresh_token_hash=hash_refresh_token(refresh_token),
            user_agent=user_agent,
            ip=ip,
            created_at=_utc_now(),
            expires_at=expires_at,
        )
        self._db.add(row)
        await self._db.flush()
        return TokenPair(
            access_token=access_token,
            refresh_token=refresh_token,
            access_expires_in=payload.exp - payload.iat,
            refresh_expires_in=int((expires_at - _utc_now()).total_seconds()),
        )

    async def _consume_refresh_token(self, refresh_token: str) -> tuple[User, SessionRow, bool]:
        """消费 refresh token,返回 (user, session, is_grace)。

        is_grace=True 表示命中宽限续期——session 已 revoked+rotated 且在
        ``auth_refresh_grace_seconds`` 窗口内,上层 :meth:`refresh` 应跳过
        :meth:`_mark_session_rotated` 直接签发新对(否则会刷新 rotated_at
        把 grace 窗口无限续期)。
        """
        # We can't index by the plain token (it's bcrypt-hashed) so we walk
        # the recent live sessions of *anyone* and pick the one whose hash
        # verifies. For V1 (single host, <1k active sessions) this is fine;
        # if we ever scale this hot path we'll switch to per-token jti +
        # HMAC lookup.
        stmt = (
            select(SessionRow)
            .where(col(SessionRow.revoked_at).is_(None))
            .where(col(SessionRow.expires_at) > _utc_now())
            .order_by(col(SessionRow.created_at).desc())
        )
        candidates = (await self._db.execute(stmt)).scalars().all()
        for session in candidates:
            if verify_refresh_token(refresh_token, session.refresh_token_hash):
                user = await self._db.get(User, session.user_id)
                if user is None or user.deleted_at is not None or user.status != "active":
                    raise AuthUserInactive("User account is no longer active.")
                return user, session, False

        # live 未命中 → 查 revoked session(可能是 grace 续期,也可能是重放攻击)。
        revoked = await self._find_revoked_session(refresh_token)
        if revoked is not None:
            user = await self._db.get(User, revoked.user_id)
            if user is None or user.deleted_at is not None or user.status != "active":
                raise AuthUserInactive("User account is no longer active.")
            # grace 判定:rotated_at 存在且在窗口内 → 宽限续期,不吊销其它 session。
            # rotated_at is None(非 rotate 吊销,如 logout/admin 吊销)短路到重放分支。
            # grace=0 时 timedelta(seconds=0),elapsed < 0s 恒 False,退化为旧行为。
            if revoked.rotated_at is not None:
                rotated_at = _as_utc(revoked.rotated_at)
                if (_utc_now() - rotated_at) < timedelta(
                    seconds=self._settings.auth_refresh_grace_seconds
                ):
                    return user, revoked, True
            # 超 grace 或非 rotate 吊销 → 重放攻击,吊销该用户全部 session。
            await self.revoke_all_user_sessions(user_id=revoked.user_id)
            raise AuthRefreshReused(
                "Refresh token has already been used; all sessions revoked.",
                details={"user_id": str(revoked.user_id)},
            )

        raise AuthTokenInvalid("Refresh token is not recognised.")

    async def _find_revoked_session(self, refresh_token: str) -> SessionRow | None:
        """查匹配 refresh token 的已吊销 session(返回整行,以便读 rotated_at)。"""
        stmt = (
            select(SessionRow)
            .where(col(SessionRow.revoked_at).is_not(None))
            .order_by(col(SessionRow.revoked_at).desc())
            .limit(50)
        )
        for session in (await self._db.execute(stmt)).scalars().all():
            if verify_refresh_token(refresh_token, session.refresh_token_hash):
                return session
        return None

    async def _mark_session_revoked(self, session: SessionRow) -> None:
        session.revoked_at = _utc_now()
        self._db.add(session)
        await self._db.flush()

    async def _mark_session_rotated(self, session: SessionRow) -> None:
        """Rotate 专用:同时写 revoked_at + rotated_at。

        区别于 :meth:`_mark_session_revoked`(logout 用,只写 revoked_at):
        ``rotated_at`` 是 grace 判定的锚点,只有 refresh rotate 路径才写,
        主动登出的 session 不参与 grace 续期(契约表 logout 行)。
        """
        now = _utc_now()
        session.revoked_at = now
        session.rotated_at = now
        self._db.add(session)
        await self._db.flush()


async def bootstrap_admin_and_seed_rbac(db: AsyncSession, *, settings: Settings) -> None:
    """Create the bootstrap admin user + grant workspace_owner roles.

    This is a V1 "horizontal slice" bootstrap. It does not implement a full
    admin UI, so we rely on env vars for the first user.
    """
    if not settings.platform_bootstrap_admin_email:
        return

    admin_email = settings.platform_bootstrap_admin_email.strip().lower()
    admin_password = settings.platform_bootstrap_admin_password
    if not admin_password:
        # In containers we might not have secrets wired; do not block startup.
        return

    from app.core.logging import get_logger
    from app.modules.auth.model import Role, User, UserWorkspaceRole

    log = get_logger(__name__)

    # Ensure pgcrypto gen_random_uuid is present in production; migrations
    # already cover it, but tests may run with create_all.
    admin = await db.execute(select(User).where(col(User.email) == admin_email).limit(1))
    existing = admin.scalars().first()
    created_new = existing is None

    if existing is None:
        admin_id = uuid.uuid4()
        password_hash = password_hasher.hash(admin_password)
        existing = User(
            id=admin_id,
            email=admin_email,
            username=admin_email.split("@", 1)[0],
            password_hash=password_hash,
            display_name=settings.platform_bootstrap_admin_display_name
            or admin_email.split("@", 1)[0],
            status="active",
            is_platform_admin=True,
            created_at=_utc_now(),
            updated_at=_utc_now(),
        )
        db.add(existing)
        await db.flush()

    log.info(
        "auth.bootstrap.admin_created",
        email=admin_email,
        user_id=str(existing.id),
        created=created_new,
    )

    # Seed user_workspace_roles for every workspace so /api/auth/me is rich.
    workspace_owner_role = (
        (await db.execute(select(Role).where(col(Role.key) == "workspace_owner").limit(1)))
        .scalars()
        .first()
    )
    seeded_count = 0
    if workspace_owner_role is None:
        # Roles are seeded by migration; if not present we still keep admin
        # working thanks to platform_admin bypass.
        await db.commit()
        return

    # NOTE: Workspace imported lazily below to avoid circulars.
    from app.modules.workspace.model import Workspace

    workspaces = (
        (await db.execute(select(Workspace).where(col(Workspace.id).is_not(None)))).scalars().all()
    )
    existing_assignments = (
        (
            await db.execute(
                select(col(UserWorkspaceRole.workspace_id)).where(
                    col(UserWorkspaceRole.user_id) == existing.id
                )
            )
        )
        .scalars()
        .all()
    )
    existing_set = set(existing_assignments)

    for ws in workspaces:
        if ws.id in existing_set:
            continue
        db.add(
            UserWorkspaceRole(
                user_id=existing.id,
                workspace_id=ws.id,
                role_id=workspace_owner_role.id,
                granted_by=None,
                granted_at=_utc_now(),
            )
        )
        seeded_count += 1

    # Backfill workspaces.created_by for legacy nulls.
    await db.execute(
        update(Workspace).where(col(Workspace.created_by).is_(None)).values(created_by=existing.id)
    )
    log.info(
        "auth.bootstrap.rbac.roles_seeded",
        workspace_owner_role_id=str(workspace_owner_role.id),
        workspace_roles_seeded=seeded_count,
    )
    await db.commit()

    # Seed platform_admin role bound to every Permission (task-03). Idempotent:
    # subsequent boots reuse the existing role + permission bindings.
    await seed_platform_admin_role(db)


async def seed_platform_admin_role(db: AsyncSession) -> None:
    """Idempotently insert the ``platform_admin`` role + bind all Permissions.

    Mirrors change ``2026-06-16-admin-org-role-center`` task-03 §R-05.

    The role carries ``is_system=True`` so task-04 role handlers reject
    any modify/disable/delete attempt. Every entry in the
    :class:`~app.modules.auth.permissions.Permission` enum (37 after
    task-02 + problem:export 对齐) is bound so anyone holding this role short-circuits every
    RBAC check via
    :func:`app.modules.auth.rbac.collect_permissions_platform`.
    """
    from app.core.logging import get_logger
    from app.modules.auth.model import Role, RolePermission
    from app.modules.auth.permissions import Permission

    log = get_logger(__name__)

    existing = (
        (await db.execute(select(Role).where(col(Role.key) == "platform_admin").limit(1)))
        .scalars()
        .first()
    )

    if existing is None:
        existing = Role(
            key="platform_admin",
            name="平台管理员",
            description="系统内置角色，绑定全部权限（启动时种子）。",
            is_system=True,
            is_active=True,
        )
        db.add(existing)
        await db.flush()
        log.info("auth.seed.platform_admin_created", role_id=str(existing.id))

    bound = {
        row[0]
        for row in (
            await db.execute(
                select(col(RolePermission.permission)).where(
                    col(RolePermission.role_id) == existing.id
                )
            )
        ).all()
    }

    missing = [p.value for p in Permission if p.value not in bound]
    for perm in missing:
        db.add(RolePermission(role_id=existing.id, permission=perm))

    if missing:
        log.info(
            "auth.seed.platform_admin_permissions_synced",
            role_id=str(existing.id),
            added=len(missing),
            total=len(list(Permission)),
        )

    await db.commit()
