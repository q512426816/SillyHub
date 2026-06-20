"""Async SQLAlchemy engine + session factory.

Engines are created lazily so that pure ``--help`` / migration / unit-test
invocations don't open a real connection at import time.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Final

from fastapi import Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_SessionFactory: async_sessionmaker[AsyncSession] | None = None

# Pool tuned for multi-agent load: daemon websockets + mission polling + worker
# lease callbacks all share this pool. Larger size/overflow tolerates concurrent
# callbacks; shorter recycle reclaims leaked/stale slots faster. Complements the
# c1de949 SSE/background slot-release fix.
_POOL_SIZE: Final[int] = 20
_MAX_OVERFLOW: Final[int] = 30
_POOL_TIMEOUT: Final[float] = 30.0
_POOL_RECYCLE: Final[int] = 300  # 5 min — reclaim leaked/stale slots faster


def get_engine() -> AsyncEngine:
    """Return (and lazily create) the process-wide async engine."""
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            pool_size=_POOL_SIZE,
            max_overflow=_MAX_OVERFLOW,
            pool_timeout=_POOL_TIMEOUT,
            pool_recycle=_POOL_RECYCLE,
            pool_pre_ping=True,
            future=True,
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return (and lazily create) the AsyncSession factory."""
    global _SessionFactory
    if _SessionFactory is None:
        _SessionFactory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )
    return _SessionFactory


# ---------------------------------------------------------------------------
# Audit context injection helpers
# ---------------------------------------------------------------------------


def _extract_token_from_request(request: Request) -> str | None:
    """Extract Bearer token from Authorization header (no external deps)."""
    raw = request.headers.get("authorization") or request.headers.get("Authorization")
    if not raw:
        return None
    parts = raw.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def _try_inject_audit_context(session: AsyncSession, request: Request) -> None:
    """Try to decode Bearer token and inject audit_context into session.info.

    Silently skips on failure (no token, invalid token, etc).
    """
    if "audit_context" in session.info:
        return  # Already set, do not overwrite

    token = _extract_token_from_request(request)
    if not token:
        return

    try:
        from app.core.config import get_settings
        from app.core.security import decode_access_token

        settings = get_settings()
        payload = decode_access_token(token, settings=settings)
    except Exception:
        return  # Invalid token — silent skip

    if payload.sub is None:
        return

    workspace_id = None
    path_params = request.path_params
    if "workspace_id" in path_params:
        try:
            workspace_id = uuid.UUID(path_params["workspace_id"])
        except (ValueError, TypeError):
            pass

    session.info["audit_context"] = {
        "actor_id": payload.sub,
        "workspace_id": workspace_id,
    }


async def get_session(
    request: Request = None,  # type: ignore[assignment]
) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yield a session with audit_context injected when possible."""
    factory = get_session_factory()
    async with factory() as session:
        if request is not None:
            _try_inject_audit_context(session, request)
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    """Dispose the underlying engine — call on application shutdown."""
    global _engine, _SessionFactory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _SessionFactory = None
