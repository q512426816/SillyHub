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
from sqlalchemy import select
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
os.environ.setdefault("SILLYSPEC_MASTER_KEY", "v1:" + "aa" * 32)


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
    from app.modules.auth import model as _auth_model  # noqa: F401
    from app.modules.change import model as _change_model  # noqa: F401
    from app.modules.git_identity import model as _git_identity_model  # noqa: F401
    from app.modules.scan_docs import model as _scan_docs_model  # noqa: F401
    from app.modules.task import model as _task_model  # noqa: F401
    from app.modules.worktree import model as _worktree_model  # noqa: F401
    from app.modules.workspace import model as _ws_model  # noqa: F401
    from app.modules.workflow import model as _workflow_model  # noqa: F401
    from app.modules.agent import model as _agent_model  # noqa: F401
    from app.modules.spec_workspace import model as _spec_ws_model  # noqa: F401

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


@pytest.fixture()
async def auth_admin_token(db_session: AsyncSession) -> str:
    """Create (or reuse) an in-memory platform admin and return access token."""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    settings = get_settings()
    # Make sure bcrypt rounds match test config.
    password_hasher.configure(settings.auth_bcrypt_rounds)

    admin_email = "admin@example.com"
    stmt = select(User).where(User.email == admin_email).limit(1)
    user = (await db_session.execute(stmt)).scalars().first()
    if user is None:
        import uuid

        admin_id = uuid.uuid4()
        user = User(
            id=admin_id,
            email=admin_email,
            password_hash=password_hasher.hash("Admin123!@#"),
            display_name="Admin",
            status="active",
            is_platform_admin=True,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    return token


@pytest.fixture()
def auth_headers(auth_admin_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {auth_admin_token}"}
