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

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import Settings
from app.core.errors import (
    AuthInvalidCredentials,
    AuthRefreshReused,
    AuthTokenInvalid,
    AuthUserInactive,
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

log = get_logger(__name__)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class AuthService:
    def __init__(self, db: AsyncSession, *, settings: Settings) -> None:
        self._db = db
        self._settings = settings
        password_hasher.configure(settings.auth_bcrypt_rounds)

    # ── Login / refresh / logout ──────────────────────────────────────────

    async def login(
        self,
        *,
        email: str,
        password: str,
        user_agent: str | None,
        ip: str | None,
    ) -> tuple[User, TokenPair]:
        user = await self._lookup_active_user_by_email(email)
        if user is None or not password_hasher.verify(password, user.password_hash):
            # Constant message: no email enumeration.
            raise AuthInvalidCredentials("Invalid email or password.")

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
        user, session = await self._consume_refresh_token(refresh_token)
        await self._mark_session_revoked(session)
        pair = await self._issue_token_pair(user, user_agent=user_agent, ip=ip)
        await self._db.commit()
        log.info("auth.refresh.success", user_id=str(user.id))
        return user, pair

    async def logout_session_by_refresh(self, *, refresh_token: str) -> None:
        """Best-effort logout: if the token matches a live session, revoke it.

        Unlike :meth:`refresh`, an unknown / already-revoked token here is
        idempotent — clients regularly retry logout on network blips.
        """
        try:
            _, session = await self._consume_refresh_token(refresh_token)
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

    async def _consume_refresh_token(self, refresh_token: str) -> tuple[User, SessionRow]:
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
                return user, session

        # Maybe this is a *revoked* token for someone — reuse attack.
        reused = await self._lookup_revoked_session_owner(refresh_token)
        if reused is not None:
            await self.revoke_all_user_sessions(user_id=reused)
            raise AuthRefreshReused(
                "Refresh token has already been used; all sessions revoked.",
                details={"user_id": str(reused)},
            )

        raise AuthTokenInvalid("Refresh token is not recognised.")

    async def _lookup_revoked_session_owner(self, refresh_token: str) -> uuid.UUID | None:
        stmt = (
            select(SessionRow)
            .where(col(SessionRow.revoked_at).is_not(None))
            .order_by(col(SessionRow.revoked_at).desc())
            .limit(50)
        )
        for session in (await self._db.execute(stmt)).scalars().all():
            if verify_refresh_token(refresh_token, session.refresh_token_hash):
                return session.user_id
        return None

    async def _mark_session_revoked(self, session: SessionRow) -> None:
        session.revoked_at = _utc_now()
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
