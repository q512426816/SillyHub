"""Local conftest for member_runtimes tests.

Overrides the shared ``db_engine`` fixture to build only the schema this module
needs. The root conftest builds the *full* ``BaseModel.metadata``; as of this
change a sibling in-flight task (2026-07-02-change-detail-file-tree-editor)
added ``DaemonChangeWrite.kind`` with ``server_default=text("create")`` which
renders as an unquoted SQL keyword on SQLite and aborts ``CREATE TABLE``. That
model is outside task-03's allowed_paths, so we cannot fix it here. Instead we
materialize a fresh metadata containing only the tables actually referenced by
these tests (auth/users, workspace, daemon_runtime, member_runtimes) and build
that — no daemon_change_writes, no syntax error.

This override is scoped to this directory and touches no production source.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


def _selected_metadata() -> Any:
    """Build a metadata containing only the tables this module needs.

    Importing the feature models attaches them to ``BaseModel.metadata``; we
    then copy just the relevant ``Table`` objects into a fresh ``MetaData`` so
    ``create_all`` does not try to emit the broken daemon_change_writes DDL.
    """
    from sqlalchemy import MetaData

    from app.models.base import BaseModel

    # Import to ensure registration (order-independent; tables are idempotent).
    from app.modules.auth import model as _auth  # noqa: F401
    from app.modules.daemon import model as _daemon  # noqa: F401
    from app.modules.workspace import model as _ws  # noqa: F401
    from app.modules.workspace.member_runtimes import model as _wmr  # noqa: F401

    full = BaseModel.metadata
    needed = {
        "users",
        "daemon_runtimes",
        "workspaces",
        "workspace_member_runtimes",
    }
    meta = MetaData()
    for name in needed:
        if name in full.tables:
            full.tables[name].to_metadata(meta)
    return meta


@pytest.fixture()
async def db_engine():  # type: ignore[no-untyped-def]
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    meta = _selected_metadata()
    async with engine.begin() as conn:
        await conn.run_sync(meta.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture()
async def db_session(db_engine: Any):
    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
