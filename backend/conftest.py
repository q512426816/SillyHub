"""Pytest fixtures.

Tests must not require a live Postgres / Redis. ``conftest`` therefore:

1. Injects safe defaults for required Settings *before* the app is imported.
2. Spins up an in-memory async SQLite engine and overrides ``get_session`` so
   DB-touching tests run hermetically.
3. Provides a fully-wired ``httpx.AsyncClient`` for HTTP-level tests.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
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

# Set spec_data_root to a temp directory for tests (CI may not have /data permissions)
_test_data_root = tempfile.gettempdir()
os.environ.setdefault("SPEC_DATA_ROOT", _test_data_root)


@pytest.fixture(autouse=True)
def _reset_settings_cache() -> Iterator[None]:
    """Clear the cached Settings between tests so env-var overrides take effect."""
    import tempfile

    from app.core.config import Settings, get_settings

    # Clear cache first
    get_settings.cache_clear()

    # Create a temp directory for spec data in tests
    test_data_root = tempfile.gettempdir()

    # Manually set spec_data_root in Settings to avoid permission issues in CI
    original_init = Settings.__init__

    def _patched_init(self, **kwargs):
        kwargs.setdefault("spec_data_root", test_data_root)
        original_init(self, **kwargs)

    Settings.__init__ = _patched_init

    yield

    # Restore original
    Settings.__init__ = original_init
    get_settings.cache_clear()


@pytest.fixture()
async def db_engine() -> AsyncIterator[Any]:
    """Create a fresh in-memory async SQLite engine + schema for the test."""
    from app.models.base import BaseModel

    # Registering feature models attaches their tables to BaseModel.metadata.
    from app.modules.admin import model as _admin_model  # noqa: F401
    from app.modules.agent import model as _agent_model  # noqa: F401
    from app.modules.auth import model as _auth_model  # noqa: F401
    from app.modules.change import model as _change_model  # noqa: F401
    from app.modules.daemon import model as _daemon_model  # noqa: F401
    from app.modules.git_identity import model as _git_identity_model  # noqa: F401

    # ppm 子域模型 (task-06:平台级 task 三表)
    from app.modules.ppm.task import model as _ppm_task_model  # noqa: F401
    from app.modules.scan_docs import conflict_model as _scan_conflict_model  # noqa: F401
    from app.modules.scan_docs import model as _scan_docs_model  # noqa: F401
    from app.modules.spec_workspace import model as _spec_ws_model  # noqa: F401
    from app.modules.task import model as _task_model  # noqa: F401
    from app.modules.tool_gateway import tool_policy as _tool_policy_model  # noqa: F401
    from app.modules.workflow import model as _workflow_model  # noqa: F401
    from app.modules.workspace import model as _ws_model  # noqa: F401
    from app.modules.worktree import model as _worktree_model  # noqa: F401

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


@pytest.fixture(autouse=True)
async def _redirect_session_factory(db_engine: Any) -> AsyncIterator[None]:
    """Point ``get_session_factory()`` at the in-memory test engine.

    Production code opens short-lived sessions through ``get_session_factory()``
    (SSE generators, background tasks) so connection-pool slots are released as
    soon as the query finishes instead of being held for the whole request.
    Those short-lived sessions must land on the same engine ``db_session`` /
    ``client`` use, otherwise they would try to reach the real Postgres.
    ``get_session_factory`` reads the module-level ``_SessionFactory`` global,
    so setting it once redirects every caller regardless of how it imported
    the function.
    """
    import app.core.db as db_module

    factory = async_sessionmaker(
        bind=db_engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )
    previous = db_module._SessionFactory
    db_module._SessionFactory = factory
    try:
        yield
    finally:
        db_module._SessionFactory = previous


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


@pytest.fixture(autouse=True)
async def _isolate_permission_timers() -> AsyncIterator[None]:
    """Deterministically reap + clear the module-level ``_permission_timers``
    singleton around every async test.

    ``_permission_timers`` is shared across all DaemonPermissionService
    instances (WS uplink + REST downlink) — see permission_service.py. A test
    that arms a timeout task must not leave a dangling, never-awaited task:
    under pytest-asyncio's function-scoped event loop the cancellation is only
    reaped during loop shutdown, whose timing is non-deterministic and
    occasionally lets a cancelled task leak into a later test's
    ``len(_timers) == 0`` assertion. Cancelling + awaiting here reaps every
    task *before* the loop closes, removing that window.
    """
    from app.modules.daemon.permission_service import _permission_timers

    _permission_timers.clear()
    yield
    pending = list(_permission_timers.values())
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    _permission_timers.clear()
