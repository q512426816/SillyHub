"""Cryptographic primitives for the auth slice.

* Password hashing: ``passlib`` with bcrypt at cost 12 (references/15 §4).
* Access token: HS256 JWT signed by ``Settings.secret_key``, 15 min TTL.
* Refresh token: ``f"{token_id}.{secret}"`` (uuid4 hex + 32 random bytes,
  base64url-encoded). Returned to the client once; the full string is
  stored in DB as bcrypt(refresh_token), and ``hmac_token_id(token_id)``
  is stored alongside as the O(1) lookup index (D-002/D-005).

Token TTLs and the cost factor are settable so tests can drop bcrypt to
cost 4 for sub-100 ms login flows.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt as bcrypt_lib
from jose import JWTError, jwt
from pydantic import BaseModel

from app.core.config import Settings
from app.core.errors import AuthTokenInvalid

ACCESS_TOKEN_TYPE = "access"


class TokenPayload(BaseModel):
    """Validated JWT body, returned by :func:`decode_access_token`."""

    sub: uuid.UUID
    # email 可选：username-only 账号 email 为 NULL（D-001），token 仅携带；
    # decode 后无人消费 email（auth_deps / db 只读 sub），故允许 None。
    email: str | None
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
    email: str | None,
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
        raise AccessTokenError("token_expired", "登录凭证已过期，请重新登录。") from exc
    except JWTError as exc:
        raise AccessTokenError("token_invalid", "登录凭证无效，请重新登录。") from exc

    if payload.get("typ") != ACCESS_TOKEN_TYPE:
        raise AccessTokenError("token_wrong_type", "登录凭证无效，请重新登录。")

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
        raise AccessTokenError("token_malformed", "登录凭证格式有误，请重新登录。") from exc


# ── Refresh tokens ──────────────────────────────────────────────────────────


def generate_refresh_token() -> tuple[str, str]:
    """Return ``(refresh_token, token_id)``.

    ``refresh_token`` has the form ``f"{token_id}.{secret}"`` where
    ``token_id`` is a uuid4 hex (used to derive the DB lookup index) and
    ``secret`` is 32 random bytes, base64url-encoded. The full string is
    what the client carries and what gets bcrypt-hashed; only ``token_id``
    is fed to :func:`hmac_token_id` for indexing (D-002).
    """
    token_id = uuid.uuid4().hex
    secret = secrets.token_urlsafe(32)
    return f"{token_id}.{secret}", token_id


def parse_refresh_token(token: str) -> tuple[str, str]:
    """Split ``'{token_id}.{secret}'``; raise :class:`AuthTokenInvalid` on malformed.

    Malformed = no ``"."`` separator, or an empty ``token_id`` / ``secret``
    segment. Old opaque tokens (no ``"."``) trip this path and surface as a
    401 to the client (D-006).
    """
    if "." not in token:
        raise AuthTokenInvalid("登录状态异常，请重新登录。")
    token_id, secret = token.split(".", 1)
    if not token_id or not secret:
        raise AuthTokenInvalid("登录状态异常，请重新登录。")
    return token_id, secret


def hmac_token_id(token_id: str, settings: Settings) -> str:
    """HMAC-SHA256(``secret_key``, ``token_id``) hex — irreversible DB index key.

    Reusing ``settings.secret_key`` (D-005) so no new secret to manage. The
    hex digest is stored on the session row and used as the O(1) lookup key
    so the DB never sees the raw ``token_id`` in cleartext (defence against
    list/backup leakage).
    """
    return hmac.new(
        settings.secret_key.encode(),
        token_id.encode(),
        hashlib.sha256,
    ).hexdigest()


def hash_refresh_token(token: str) -> str:
    return password_hasher.hash(token)


def verify_refresh_token(token: str, hashed: str) -> bool:
    return password_hasher.verify(token, hashed)


def refresh_token_expiry(settings: Settings) -> datetime:
    return _utc_now() + timedelta(days=settings.auth_refresh_ttl_days)
