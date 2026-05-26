"""Cryptographic primitives for the auth slice.

* Password hashing: ``passlib`` with bcrypt at cost 12 (references/15 §4).
* Access token: HS256 JWT signed by ``Settings.secret_key``, 15 min TTL.
* Refresh token: 32 random bytes, base64url-encoded, returned to the
  client once and stored in DB as bcrypt(refresh_token).

Token TTLs and the cost factor are settable so tests can drop bcrypt to
cost 4 for sub-100 ms login flows.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt as bcrypt_lib
from jose import JWTError, jwt
from pydantic import BaseModel

from app.core.config import Settings

ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"


class TokenPayload(BaseModel):
    """Validated JWT body, returned by :func:`decode_access_token`."""

    sub: uuid.UUID
    email: str
    is_admin: bool
    jti: uuid.UUID
    exp: int
    iat: int
    typ: str = ACCESS_TOKEN_TYPE


class _PasswordHasher:
    """Password hashing using the native ``bcrypt`` library.

    Note: we intentionally avoid ``passlib`` here because the current local
    bcrypt wheel is incompatible with passlib's bcrypt backend detection in
    this environment (it triggers a wrap-bug check and crashes during tests).
    """

    def __init__(self, rounds: int = 12) -> None:
        self._rounds = rounds

    @staticmethod
    def _truncate_password(password: str) -> bytes:
        # bcrypt only consumes up to 72 bytes.
        return password.encode("utf-8")[:72]

    def hash(self, password: str) -> str:
        salt = bcrypt_lib.gensalt(rounds=self._rounds)
        hashed = bcrypt_lib.hashpw(self._truncate_password(password), salt)
        return hashed.decode("utf-8")

    def verify(self, password: str, hashed: str) -> bool:
        try:
            return bcrypt_lib.checkpw(
                self._truncate_password(password),
                hashed.encode("utf-8"),
            )
        except (ValueError, TypeError):
            return False

    def configure(self, rounds: int) -> None:
        self._rounds = rounds


password_hasher = _PasswordHasher()


# ── JWT helpers ─────────────────────────────────────────────────────────────


def _utc_now() -> datetime:
    return datetime.now(UTC)


def create_access_token(
    *,
    user_id: uuid.UUID,
    email: str,
    is_admin: bool,
    settings: Settings,
    jti: uuid.UUID | None = None,
    issued_at: datetime | None = None,
) -> tuple[str, TokenPayload]:
    """Encode a 15-minute access JWT and return both the string and payload."""
    iat = issued_at or _utc_now()
    exp = iat + timedelta(minutes=settings.auth_access_ttl_minutes)
    jti = jti or uuid.uuid4()
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "is_admin": is_admin,
        "jti": str(jti),
        "iat": int(iat.timestamp()),
        "exp": int(exp.timestamp()),
        "typ": ACCESS_TOKEN_TYPE,
    }
    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token, TokenPayload(
        sub=user_id,
        email=email,
        is_admin=is_admin,
        jti=jti,
        iat=payload["iat"],
        exp=payload["exp"],
        typ=ACCESS_TOKEN_TYPE,
    )


class AccessTokenError(Exception):
    """Raised by :func:`decode_access_token` for invalid / expired tokens."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def decode_access_token(token: str, *, settings: Settings) -> TokenPayload:
    """Decode + validate an access token.

    Raises :class:`AccessTokenError` with a stable ``code`` so the router
    layer can map to the right HTTP error envelope.
    """
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise AccessTokenError("token_expired", "Access token has expired.") from exc
    except JWTError as exc:
        raise AccessTokenError("token_invalid", "Access token is invalid.") from exc

    if payload.get("typ") != ACCESS_TOKEN_TYPE:
        raise AccessTokenError("token_wrong_type", "Token is not an access token.")

    try:
        return TokenPayload(
            sub=uuid.UUID(payload["sub"]),
            email=payload["email"],
            is_admin=bool(payload.get("is_admin", False)),
            jti=uuid.UUID(payload["jti"]),
            iat=int(payload["iat"]),
            exp=int(payload["exp"]),
            typ=payload["typ"],
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise AccessTokenError("token_malformed", "Access token is malformed.") from exc


# ── Refresh tokens ──────────────────────────────────────────────────────────


def generate_refresh_token() -> str:
    """Opaque, URL-safe 32-byte token (≈43 chars after base64url)."""
    return secrets.token_urlsafe(32)


def hash_refresh_token(token: str) -> str:
    return password_hasher.hash(token)


def verify_refresh_token(token: str, hashed: str) -> bool:
    return password_hasher.verify(token, hashed)


def refresh_token_expiry(settings: Settings) -> datetime:
    return _utc_now() + timedelta(days=settings.auth_refresh_ttl_days)
