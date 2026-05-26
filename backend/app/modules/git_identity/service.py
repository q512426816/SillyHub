"""Git identity CRUD and access-check logic."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.crypto import CredentialCipher
from app.core.errors import AppError, PermissionDenied
from app.core.logging import get_logger
from app.modules.git_identity.model import GitIdentity
from app.modules.git_identity.providers import PROVIDERS
from app.modules.git_identity.providers.base import AccessResult
from app.modules.git_identity.schema import AccessCheckRequest, GitIdentityCreate

log = get_logger(__name__)


class IdentityNotFound(AppError):
    code = "HTTP_404_IDENTITY_NOT_FOUND"
    http_status = 404


class IdentityRevoked(AppError):
    code = "IDENTITY_REVOKED"
    http_status = 400


class IdentityExpired(AppError):
    code = "IDENTITY_EXPIRED"
    http_status = 400


class GitIdentityService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        cipher: CredentialCipher | None = None,
    ) -> None:
        self._session = session
        self._cipher = cipher or self._default_cipher()

    @staticmethod
    def _default_cipher() -> CredentialCipher:
        from app.core.crypto import get_cipher
        return get_cipher()

    # ── CRUD ──────────────────────────────────────────────────────────

    async def list_(self, user_id: uuid.UUID) -> list[GitIdentity]:
        stmt = (
            select(GitIdentity)
            .where(col(GitIdentity.user_id) == user_id)
            .order_by(col(GitIdentity.created_at).desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get(self, identity_id: uuid.UUID, user_id: uuid.UUID) -> GitIdentity:
        stmt = select(GitIdentity).where(col(GitIdentity.id) == identity_id)
        row = (await self._session.execute(stmt)).scalars().first()
        if row is None:
            raise IdentityNotFound(
                f"Git identity '{identity_id}' not found.",
                details={"identity_id": str(identity_id)},
            )
        if row.user_id != user_id:
            raise PermissionDenied("Not your git identity.")
        return row

    async def create(
        self,
        user_id: uuid.UUID,
        data: GitIdentityCreate,
    ) -> GitIdentity:
        ct, key_id = self._cipher.encrypt(data.credential)
        row = GitIdentity(
            id=uuid.uuid4(),
            user_id=user_id,
            provider=data.provider,
            git_username=data.git_username,
            git_email=data.git_email,
            credential_type=data.credential_type,
            encrypted_credential=ct,
            key_id=key_id,
            allowed_repositories=data.allowed_repositories,
            expires_at=data.expires_at,
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        log.info("git_identity.created", identity_id=str(row.id), user_id=str(user_id))
        return row

    async def revoke(self, identity_id: uuid.UUID, user_id: uuid.UUID) -> GitIdentity:
        row = await self.get(identity_id, user_id)
        if row.revoked_at is not None:
            raise IdentityRevoked("Identity already revoked.")
        row.revoked_at = datetime.utcnow()
        await self._session.commit()
        await self._session.refresh(row)
        log.info("git_identity.revoked", identity_id=str(identity_id))
        return row

    # ── Access check ──────────────────────────────────────────────────

    async def check_access(
        self,
        user_id: uuid.UUID,
        request: AccessCheckRequest,
    ) -> AccessResult:
        row = await self.get(request.identity_id, user_id)
        self._assert_usable(row)

        provider = PROVIDERS.get(row.provider)
        if provider is None:
            return AccessResult(accessible=False, reason="unsupported_provider")

        token = self._cipher.decrypt(row.encrypted_credential, row.key_id)
        result = await provider.check_pat_access(token, request.repo_url)

        row.last_used_at = datetime.utcnow()
        await self._session.commit()
        return result

    # ── Helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _assert_usable(row: GitIdentity) -> None:
        if row.revoked_at is not None:
            raise IdentityRevoked(
                "Identity has been revoked.",
                details={"identity_id": str(row.id)},
            )
        if row.expires_at and row.expires_at < datetime.utcnow():
            raise IdentityExpired(
                "Identity has expired.",
                details={"identity_id": str(row.id), "expires_at": str(row.expires_at)},
            )
