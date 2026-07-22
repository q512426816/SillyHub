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

# 性能优化 Wave 1(2026-07-22 系统性能审计):会话级超时,防失控全表扫描/泄漏事务
# 占满共享连接池(配合本次补的缺失索引,慢查会被快速中断而非无限挂住连接)。
# 仅 asyncpg(PG)生效;aiosqlite(测试)忽略。单位毫秒。
_STATEMENT_TIMEOUT_MS: Final[str] = "30000"  # 30s — 单条语句上限
_IDLE_IN_TXN_TIMEOUT_MS: Final[str] = "10000"  # 10s — 空闲事务(开了事务未提交)
_LOCK_TIMEOUT_MS: Final[str] = "5000"  # 5s — 拿锁等待上限(fail fast)


def _build_connect_args(database_url: str) -> dict:
    """Return asyncpg ``server_settings`` for PG; empty for SQLite (tests).

    ``server_settings`` 在 asyncpg 连接建立时下发为 ``SET`` 等价会话参数,对所有
    该连接上的语句生效。aiosqlite 不认这些参数,故按方言分支(传错会连接报错)。
    """
    url = str(database_url)
    if url.startswith("postgresql"):
        return {
            "server_settings": {
                "statement_timeout": _STATEMENT_TIMEOUT_MS,
                "idle_in_transaction_session_timeout": _IDLE_IN_TXN_TIMEOUT_MS,
                "lock_timeout": _LOCK_TIMEOUT_MS,
            }
        }
    return {}


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
            connect_args=_build_connect_args(settings.database_url),
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
    request: Request = None,
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
