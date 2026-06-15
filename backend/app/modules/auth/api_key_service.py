"""API Key use cases.

Long-lived credentials for daemon processes. Mirrors the refresh-token
pattern in :mod:`app.modules.auth.service`: plaintext is generated with
``secrets.token_urlsafe``, persisted as ``bcrypt(plaintext)``.

The ``shk_live_`` prefix is prepended to the plaintext so GitHub secret
scanning custom rules can match leaked keys, and so the UI can render a
friendlier "SillyHub Live Key" label. The prefix is *not* stored
separately — ``key_prefix`` is the first 12 plaintext chars (including
the prefix), giving admins a stable visual fingerprint.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import Settings
from app.core.logging import get_logger
from app.core.security import hash_refresh_token, password_hasher, verify_refresh_token
from app.modules.auth.model import ApiKey, User

log = get_logger(__name__)

API_KEY_PREFIX = "shk_live_"
_KEY_PREFIX_DISPLAY_LEN = 12


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _as_utc(dt: datetime) -> datetime:
    """Normalise a possibly-naive datetime (SQLite drops tzinfo) to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _generate_plaintext() -> str:
    """Generate a new plaintext API key (``shk_live_`` + 32 random bytes)."""
    return API_KEY_PREFIX + secrets.token_urlsafe(32)


def _display_prefix(plaintext: str) -> str:
    """First ~12 chars of the plaintext, used for UI display only."""
    return plaintext[:_KEY_PREFIX_DISPLAY_LEN]


class ApiKeyService:
    """CRUD + authenticate for long-lived API keys."""

    def __init__(self, db: AsyncSession, *, settings: Settings) -> None:
        self._db = db
        self._settings = settings
        password_hasher.configure(settings.auth_bcrypt_rounds)

    # ── Create / list / revoke ────────────────────────────────────────────

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        name: str,
        expires_at: datetime | None,
    ) -> tuple[ApiKey, str]:
        """Issue a new key. Returns ``(row, plaintext)`` — plaintext must be
        returned to the caller *now* and is never recoverable later."""
        plaintext = _generate_plaintext()
        row = ApiKey(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name.strip(),
            key_prefix=_display_prefix(plaintext),
            key_hash=hash_refresh_token(plaintext),
            last_used_at=None,
            expires_at=expires_at,
            created_at=_utc_now(),
            revoked_at=None,
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        log.info(
            "api_key.created",
            api_key_id=str(row.id),
            user_id=str(user_id),
            name=row.name,
        )
        return row, plaintext

    async def list_for_user(self, *, user_id: uuid.UUID) -> list[ApiKey]:
        """All keys for ``user_id``, newest first (including revoked)."""
        stmt = (
            select(ApiKey)
            .where(col(ApiKey.user_id) == user_id)
            .order_by(col(ApiKey.created_at).desc())
        )
        return list((await self._db.execute(stmt)).scalars().all())

    async def revoke(self, *, api_key_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        """Set ``revoked_at = now`` if the key belongs to ``user_id`` and is
        currently active. Returns ``True`` if a row was updated.

        Idempotent: revoking an already-revoked or non-existent key returns
        ``False`` (no error) so DELETE endpoints can return 404 uniformly.
        """
        now = _utc_now()
        result = await self._db.execute(
            update(ApiKey)
            .where(col(ApiKey.id) == api_key_id)
            .where(col(ApiKey.user_id) == user_id)
            .where(col(ApiKey.revoked_at).is_(None))
            .values(revoked_at=now)
        )
        rowcount = int(getattr(result, "rowcount", 0) or 0)
        if rowcount:
            await self._db.commit()
            log.info(
                "api_key.revoked",
                api_key_id=str(api_key_id),
                user_id=str(user_id),
            )
        return bool(rowcount)

    # ── Authenticate ──────────────────────────────────────────────────────

    async def authenticate(self, *, plaintext: str) -> User | None:
        """Resolve ``plaintext`` to an active :class:`User`, or ``None``.

        ``None`` covers every failure mode (unknown, revoked, expired,
        owner-disabled) — callers should raise ``AuthTokenInvalid`` to
        avoid leaking which case applied.
        """
        if not plaintext:
            return None

        # Sanity check: a real key always carries our prefix. Skip DB scan
        # entirely for clearly-wrong inputs (e.g. someone sent a JWT here).
        if not plaintext.startswith(API_KEY_PREFIX):
            return None

        # O(n) scan: bcrypt verify has no inverse. V1 scale (<1k keys) is
        # acceptable; switch to a prefix→hash lookup if/when needed.
        stmt = (
            select(ApiKey)
            .where(col(ApiKey.revoked_at).is_(None))
            .order_by(col(ApiKey.created_at).desc())
        )
        candidates = (await self._db.execute(stmt)).scalars().all()
        now = _utc_now()
        for key in candidates:
            if not verify_refresh_token(plaintext, key.key_hash):
                continue
            if key.expires_at is not None and _as_utc(key.expires_at) <= now:
                return None
            user = await self._db.get(User, key.user_id)
            if user is None or user.deleted_at is not None or user.status != "active":
                return None
            await self._mark_used(key)
            return user

        return None

    async def _mark_used(self, key: ApiKey) -> None:
        """Update ``last_used_at`` on a successful authenticate."""
        key.last_used_at = _utc_now()
        self._db.add(key)
        await self._db.commit()
