"""Async SQLAlchemy engine + session factory.

Engines are created lazily so that pure ``--help`` / migration / unit-test
invocations don't open a real connection at import time.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Final

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_SessionFactory: async_sessionmaker[AsyncSession] | None = None

_POOL_SIZE: Final[int] = 10
_MAX_OVERFLOW: Final[int] = 10
_POOL_TIMEOUT: Final[float] = 30.0
_POOL_RECYCLE: Final[int] = 1800  # 30 min — kill stale connections


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


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yield a session and ensure rollback on errors."""
    factory = get_session_factory()
    async with factory() as session:
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
