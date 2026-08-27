"""Local conftest for daemon grants tests.

复用 workspace/member_runtimes/tests/conftest.py 的 selected-metadata 范式：
根 conftest 的 ``db_engine`` 会 create_all 全量 ``BaseModel.metadata``（模型
注册面大、迁移期表间依赖易碎），本目录只需 grants 表的 FK 闭包最小集
（users + daemon_instances + daemon_runtime_grants），单独物化一份精简 metadata
建表——隔离、快、不受其它模块在建模型影响。
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.base import BaseModel

# Import to ensure registration (order-independent; tables are idempotent).
from app.modules.auth import model as _auth  # noqa: F401
from app.modules.daemon import model as _daemon  # noqa: F401
from app.modules.daemon.grants import model as _grants  # noqa: F401


def _selected_metadata() -> MetaData:
    """Build a metadata containing only the tables grants tests need.

    FK 闭包：daemon_runtime_grants → daemon_instances / users；
    daemon_instances → users。users 表自身无外键，闭包到此为止。
    """
    full = BaseModel.metadata
    needed = ("users", "daemon_instances", "daemon_runtime_grants")
    meta = MetaData()
    for name in needed:
        if name in full.tables:
            full.tables[name].to_metadata(meta)
    return meta


@pytest.fixture()
async def db_engine():
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
