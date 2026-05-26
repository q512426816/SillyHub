"""Pytest fixtures.

Tests must not require a live Postgres / Redis. ``conftest`` therefore:

1. Injects safe defaults for required Settings *before* the app is imported.
2. Spins up an in-memory async SQLite engine and overrides ``get_session`` so
   DB-touching tests run hermetically.
3. Provides a fully-wired ``httpx.AsyncClient`` for HTTP-level tests.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# IMPORTANT: env vars must be set before any `from app.*` import so that
# Settings(BaseSettings) loads them. ``conftest`` is imported by pytest first.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://platform:platform@localhost:5432/platform_test",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production-use-only")
os.environ.setdefault("ENVIRONMENT", "test")


@pytest.fixture(autouse=True)
def _reset_settings_cache() -> Iterator[None]:
    """Clear the cached Settings between tests so env-var overrides take effect."""
    from app.core.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
async def db_engine() -> AsyncIterator[Any]:
    """Create a fresh in-memory async SQLite engine + schema for the test."""
    from app.models.base import BaseModel

    # Registering feature models attaches their tables to BaseModel.metadata.
    from app.modules.component import model as _component_model  # noqa: F401
    from app.modules.workspace import model as _ws_model  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(BaseModel.metadata.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture()
async def db_session(db_engine: Any) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest.fixture()
async def client(db_engine: Any) -> AsyncIterator[AsyncClient]:
    """``httpx.AsyncClient`` bound to the app, with DB sessions routed to the test engine."""
    from app.core.db import get_session
    from app.main import app

    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_session] = _override_session
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_session, None)
